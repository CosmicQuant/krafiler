/**
 * kraFilingWorker.ts
 *
 * BullMQ worker that processes KRA nil return filing jobs one at a time.
 *
 * Run with:  npm run worker
 *
 * Architecture notes:
 *  - concurrency: 1  — sequential processing prevents KRA portal rate-limits.
 *  - Playwright is initialised fresh per job so a failed job cannot leak
 *    browser state (cookies, sessions) into the next one.
 *  - The submitted KRA password is decrypted in-memory and is NEVER logged.
 *  - If KRA forces a password reset, the generated replacement password is
 *    returned through job status so the operator can recover the credential.
 *  - The stealth plugin is applied once at module load (not per job).
 */

import 'dotenv/config';
import { randomInt } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { Worker, Job } from 'bullmq';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { redisConnection, KRA_QUEUE_NAME } from '../queues/kraFilingQueue';
import { decrypt } from '../utils/encryption';
import { storeReceiptLocally } from '../utils/storage';
import { sendReceiptNotification } from '../utils/notifications';
import { CredentialUpdate, FilingJob, FilingStepLog, TaxObligationType } from '../types';
import { packageToTZip } from '../scripts/kra-tot-generator';

// Apply stealth plugin once at module load
chromium.use(StealthPlugin());

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

const KRA_PORTAL_URL = 'https://itax.kra.go.ke/KRA-Portal/';
const KRA_DEBUG_ARTIFACTS = process.env.KRA_DEBUG_ARTIFACTS === 'true';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-flash-latest';
const PLAYWRIGHT_SLOW_MO = Math.max(0, Number.parseInt(process.env.PLAYWRIGHT_SLOW_MO ?? '0', 10) || 0);

const TAX_OBLIGATION_PATTERNS: Record<TaxObligationType, RegExp[]> = {
    income_tax_resident_individual: [
        /^income\s*tax\s*-\s*resident\s*individual$/i,
        /resident\s*individual/i,
        /^resident\s*individual$/i,
    ],
    monthly_rental_income: [
        /^income\s*tax\s*-\s*rent\s*income\s*\(mri\)$/i,
        /^income\s*tax\s*-\s*rent\s*income$/i,
        /rent\s*income/i,
        /monthly\s*rental\s*income/i,
        /\bmri\b/i,
    ],
    income_tax_non_resident_individual: [
        /^income\s*tax\s*-?\s*non-?resident\s*individual$/i,
        /non-?resident\s*individual/i,
    ],
    income_tax_company: [
        /^income\s*tax\s*-\s*company$/i,
        /^income\s*tax\s*company$/i,
        /company/i,
    ],
    vat: [
        /^value\s*added\s*tax$/i,
        /^vat$/i,
        /^Value\s*Added\s*Tax\s*\(VAT\)$/i,
        /value\s*added\s*tax/i,
    ],
    paye: [
        /^pay\s*as\s*you\s*earn$/i,
        /^paye$/i,
        /^Income\s*Tax\s*-\s*PAYE$/i,
        /pay\s*as\s*you\s*earn/i,
    ],
    turnover_tax: [
        /^turnover\s*tax$/i,
        /^tot$/i,
        /turnover\s*tax/i,
    ],
};

const LOGIN_FAILURE_PATTERNS = [
    /password\s+you\s+entered\s+is\s+incorrect/i,
    /incorrect\s+password/i,
    /invalid\s+password/i,
    /remaining\s+number\s+of\s+attempts/i,
    /account\s+(?:is\s+)?locked/i,
    /security\s+stamp.*incorrect/i,
    /captcha.*incorrect/i,
    /invalid\s+login/i,
];

const PASSWORD_EXPIRED_PATTERNS = [
    /your\s+password\s+has\s+expired/i,
    /change\s+password/i,
    /first\s*time\s*login/i,
];

const FAVORITE_COLOR_SECURITY_QUESTION_PATTERNS = [
    /^what\s+is\s+your\s+favorite\s+color\??$/i,
];

const FAVORITE_COLOR_SECURITY_ANSWER = 'Blue';

const TURNOVER_TAX_SUBMISSION_ERROR_PATTERNS = [
    /invalid\s+file/i,
    /period\s+already\s+filed/i,
    /already\s+submitted/i,
    /please\s+attach/i,
    /upload\s+file/i,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Waits for a random duration to simulate human interaction cadence without
 * making ordinary form entry feel artificially slow.
 */
function humanDelay(minMs = 150, maxMs = 450): Promise<void> {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function navigationDelay(): Promise<void> {
    return humanDelay(400, 900);
}

async function getOtpFromSmsService(providedOtpCode?: string): Promise<string> {
    const otpCode = providedOtpCode?.trim() || process.env.KRA_OTP_CODE?.trim();
    if (otpCode) {
        return otpCode;
    }

    throw new Error('KRA mobile verification is waiting for an OTP. Implement getOtpFromSmsService() or provide otpCode / KRA_OTP_CODE.');
}

async function getInputValue(locator: any): Promise<string> {
    return locator.evaluate((input: HTMLInputElement) => String(input.value ?? '').trim());
}

async function appendJobLog(
    job: Job<FilingJob>,
    message: string,
    options: {
        progress?: number;
        level?: FilingStepLog['level'];
    } = {}
): Promise<void> {
    const entry: FilingStepLog = {
        timestamp: new Date().toISOString(),
        message,
        progress: typeof options.progress === 'number' ? options.progress : null,
        level: options.level ?? 'info',
    };

    await job.log(JSON.stringify(entry));
}

async function setJobStep(job: Job<FilingJob>, progress: number, message: string): Promise<void> {
    await job.updateProgress(progress);
    await appendJobLog(job, message, { progress });
    console.log(`[Worker][${job.data.jobId}] ${message}`);
}

async function waitForAnySelector(
    page: any,
    selectors: string[],
    timeout = 20_000
): Promise<string | null> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            const found = await locator.count().then((count: number) => count > 0).catch(() => false);
            if (found) {
                return selector;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return null;
}

async function waitForPortalReadyWithReload(
    page: any,
    job: Job<FilingJob>,
    options: {
        description: string;
        selectors: string[];
        timeout?: number;
        reloadAttempts?: number;
    }
): Promise<void> {
    const {
        description,
        selectors,
        timeout = 20_000,
        reloadAttempts = 1,
    } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= reloadAttempts; attempt += 1) {
        try {
            await page.waitForLoadState('domcontentloaded', { timeout: timeout * 2 }).catch(() => {});
            await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

            // Check for KRA error page (session timeout / re-submit) early
            const errorSelectors = [
                ...selectors,
                'text=An Error Occured',
                'text=session has timed out',
                'text=page re-submit',
            ];
            const matchedSelector = await waitForAnySelector(page, errorSelectors, timeout);

            // If we matched an error message instead of an expected control, fail fast
            if (matchedSelector && (
                matchedSelector.includes('Error Occured') ||
                matchedSelector.includes('session has timed out') ||
                matchedSelector.includes('page re-submit')
            )) {
                const errorText = await page.locator('body').innerText().catch(() => '');
                const snippet = errorText.slice(0, 300);
                throw new Error(`KRA displayed an error page: ${snippet}`);
            }

            if (matchedSelector) {
                if (attempt > 0) {
                    await appendJobLog(job, `${description} recovered after reloading the page`, {
                        progress: typeof job.progress === 'number' ? job.progress : undefined,
                    });
                }
                return;
            }

            lastError = new Error(`${description} did not expose the expected UI controls`);
        } catch (error) {
            lastError = error as Error;
        }

        if (attempt < reloadAttempts) {
            await appendJobLog(job, `${description} is taking too long to load; reloading and retrying`, {
                progress: typeof job.progress === 'number' ? job.progress : undefined,
            });
            console.warn(`[Worker][${job.data.jobId}] ${description} stalled; reloading page (attempt ${attempt + 1}/${reloadAttempts})`);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
            await navigationDelay();
        }
    }

    throw lastError ?? new Error(`${description} did not finish loading`);
}

/**
 * Parses an arithmetic captcha string (e.g. "185 - 5 ?", "12 + 7 ?") and
 * returns the integer result.
 *
 * The KRA security stamp uses single-operator integer arithmetic — division
 * results are floored to avoid floating-point strings.
 *
 * @throws If the captcha text cannot be parsed with the expected regex.
 */
function solveCaptcha(captchaText: string): number {
    // Matches: <integer> <operator> <integer>
    const match = captchaText.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);

    if (!match) {
        throw new Error(`Unable to parse captcha text: "${captchaText}"`);
    }

    const a = parseInt(match[1], 10);
    const operator = match[2];
    const b = parseInt(match[3], 10);

    switch (operator) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return Math.floor(a / b);
        default: throw new Error(`Unknown captcha operator: "${operator}"`);
    }
}

function extractGeminiText(payload: any): string {
    const candidates = payload?.candidates;

    if (!Array.isArray(candidates)) {
        return '';
    }

    return candidates
        .flatMap((candidate: any) => candidate?.content?.parts ?? [])
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim();
}

async function solveCaptchaWithGemini(screenshotPath: string, jobId: string): Promise<{ expression: string; answer: string }> {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is required for Gemini captcha extraction');
    }

    const imageBuffer = await fs.readFile(screenshotPath);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            systemInstruction: {
                parts: [
                    {
                        text: 'Extract the KRA Security Stamp arithmetic captcha from screenshots and respond in the exact requested format only.',
                    },
                ],
            },
            contents: [
                {
                    parts: [
                        {
                            inline_data: {
                                mime_type: 'image/png',
                                data: imageBuffer.toString('base64'),
                            },
                        },
                        {
                            text: [
                                'Read the Kenya Revenue Authority login page screenshot.',
                                'Find the Security Stamp arithmetic captcha only.',
                                'Return exactly one line and nothing else in this format:',
                                'expression=<left><operator><right>;answer=<integer>',
                                'Example: expression=78+9;answer=87',
                                'Do not include words, markdown, or explanations.'
                            ].join(' '),
                        },
                    ],
                },
            ],
            generationConfig: {
                responseMimeType: 'text/plain',
                temperature: 0,
                topP: 0.1,
                candidateCount: 1,
                maxOutputTokens: 32,
                mediaResolution: 'MEDIA_RESOLUTION_HIGH',
                thinkingConfig: {
                    thinkingBudget: 0,
                },
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Gemini request failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    const rawText = extractGeminiText(payload);
    const match = rawText.match(/expression\s*=\s*(\d+)\s*([\+\-\*\/])\s*(\d+)\s*;\s*answer\s*=\s*(-?\d+)/i);

    if (!match) {
        throw new Error(`Gemini returned an unexpected captcha format: "${rawText}"`);
    }

    const expression = `${match[1]} ${match[2]} ${match[3]}`;
    const answer = match[4].trim();
    const expectedAnswer = String(solveCaptcha(expression));

    if (answer !== expectedAnswer) {
        throw new Error(`Gemini answer mismatch for job ${jobId}: expression ${expression}, expected ${expectedAnswer}, got ${answer}`);
    }

    return { expression, answer };
}

async function selectOptionByTextPatterns(
    locator: any,
    patterns: RegExp[]
): Promise<{ value: string; text: string }> {
    const options = await locator.evaluate((select: any) =>
        Array.from(select.options).map((option: any) => ({
            value: String(option.value ?? '').trim(),
            text: String(option.textContent ?? '').trim(),
        }))
    );

    const match = options.find((option: { value: string; text: string }) =>
        option.value && patterns.some((pattern) => pattern.test(option.text))
    );

    if (!match) {
        throw new Error(`No matching option found. Available options: ${options.map((o: any) => `${o.text} [${o.value}]`).join(', ')}`);
    }

    await locator.selectOption(match.value);
    return match;
}

async function waitForDialogMessage(page: any, timeout = 5_000): Promise<string | null> {
    try {
        const dialog = await page.waitForEvent('dialog', { timeout });
        const message = dialog.message();
        await dialog.accept();
        return message;
    } catch {
        return null;
    }
}

async function findMatchingPortalMessage(
    page: any,
    patterns: RegExp[]
): Promise<string | null> {
    const candidates = await page.evaluate(() => {
        const texts = new Set<string>();
        const selectors = [
            '#errorDiv',
            '.error-message',
            '.ui-message-error',
            '.ui-messages-error',
            '[id*="error"]',
            '[class*="error"]',
            'font[color="red"]',
        ];

        for (const selector of selectors) {
            document.querySelectorAll(selector).forEach((element) => {
                const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
                if (text) {
                    texts.add(text);
                }
            });
        }

        (document.body?.innerText ?? '')
            .split(/\r?\n/)
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .forEach((line) => texts.add(line));

        return Array.from(texts);
    });

    return candidates.find((candidate: string) =>
        patterns.some((pattern) => pattern.test(candidate))
    ) ?? null;
}

async function waitForMatchingPortalMessage(
    page: any,
    patterns: RegExp[],
    timeout = 8_000
): Promise<string | null> {
    if (patterns.length === 0) {
        return null;
    }

    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        const message = await findMatchingPortalMessage(page, patterns).catch(() => null);
        if (message) {
            return message;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return null;
}

async function detectAuthenticatedPortalState(
    page: any,
    timeout = 30_000
): Promise<'dashboard' | 'login' | 'mobile-verification' | 'password-change' | null> {
    const selector = await waitForAnySelector(page, [
        '#homePageLink',
        'a:has-text("Logout")',
        'a:has-text("Returns")',
        '#logid',
        '#loginButton',
        'input[name="captcahText"]',
        'text=Mobile Number Verification',
        'button:has-text("Send Verification Code")',
        'text=YOUR PASSWORD HAS EXPIRED!',
        'text=Change Password',
        'text=FIRST TIME LOGIN!',
        'text=Security Question',
    ], timeout);

    if (!selector) {
        return null;
    }

    if (/Mobile Number Verification|Send Verification Code/i.test(selector)) {
        return 'mobile-verification';
    }

    if (PASSWORD_EXPIRED_PATTERNS.some((pattern) => pattern.test(selector))) {
        return 'password-change';
    }

    if (/#logid|#loginButton|captcahText/.test(selector)) {
        return 'login';
    }

    if (/#homePageLink|Logout|Returns/.test(selector)) {
        return 'dashboard';
    }

    return null;
}

async function fillSecurityAnswerFields(page: any, answer: string): Promise<boolean> {
    const findSecurityAnswerInput = async (labelPattern: RegExp) => {
        const candidates = await page.locator('input:visible').evaluateAll((elements: HTMLInputElement[]) => {
            const isVisible = (element: HTMLElement) => {
                const style = window.getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            };

            return elements
                .map((input, index) => {
                    const type = (input.getAttribute('type') ?? '').toLowerCase();
                    const rowText = input.closest('tr, td, div, label')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
                    const label = input.id
                        ? document.querySelector(`label[for="${input.id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
                        : '';

                    return {
                        index,
                        type,
                        rowText,
                        label,
                        disabled: input.disabled,
                        readOnly: input.readOnly,
                        visible: isVisible(input),
                    };
                })
                .filter((candidate) => candidate.visible)
                .filter((candidate) => !candidate.disabled && !candidate.readOnly)
                .filter((candidate) => !['hidden', 'password', 'checkbox', 'radio', 'submit', 'button'].includes(candidate.type));
        });

        const match = candidates.find((candidate: { index: number; rowText: string; label: string }) =>
            labelPattern.test(`${candidate.rowText} ${candidate.label}`)
        );

        return match ? page.locator('input:visible').nth(match.index) : null;
    };

    const securityAnswerField = await findSecurityAnswerInput(/(^|\b)security answer\b/i);
    const confirmSecurityAnswerField = await findSecurityAnswerInput(/confirm security answer/i);

    if (securityAnswerField && confirmSecurityAnswerField) {
        await securityAnswerField.fill(answer);
        await confirmSecurityAnswerField.fill(answer);
        return true;
    }

    const fallbackTextInputs = page.locator('input:not([type]):visible, input[type="text"]:visible, input[type="search"]:visible, input[type="email"]:visible');
    const fallbackCount = await fallbackTextInputs.count();
    if (fallbackCount >= 2) {
        await fallbackTextInputs.nth(0).fill(answer);
        await fallbackTextInputs.nth(1).fill(answer);
        return true;
    }

    return false;
}

function formatPortalDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    if (!year || !month || !day) {
        throw new Error(`Invalid ISO date provided: "${isoDate}"`);
    }

    return `${day}/${month}/${year}`;
}

async function setPortalDateField(
    locator: any,
    isoDate: string,
    label: string
): Promise<void> {
    const portalDate = formatPortalDate(isoDate);
    const fieldState = await locator.evaluate((input: HTMLInputElement) => ({
        value: String(input.value ?? '').trim(),
        readOnly: Boolean(input.readOnly),
        disabled: Boolean(input.disabled),
    }));

    if (fieldState.disabled) {
        throw new Error(`${label} field is disabled on the KRA form`);
    }

    if (fieldState.value === portalDate || fieldState.value === isoDate) {
        return;
    }

    if (fieldState.readOnly) {
        await locator.evaluate((input: HTMLInputElement, value: string) => {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
        }, portalDate);
        return;
    }

    await locator.fill(portalDate);
}

async function selectRentalPropertyAnswer(page: any, ownsRentalProperty: boolean): Promise<boolean> {
    const rentalRow = page.locator('tr:has-text("rental")').first();
    if (await rentalRow.count() > 0) {
        const rowRadios = rentalRow.locator('input[type="radio"]');
        const radioCount = await rowRadios.count();
        if (radioCount >= 2) {
            const targetIndex = ownsRentalProperty ? 0 : 1;
            await rowRadios.nth(targetIndex).check();
            return true;
        }
    }

    const valueCandidates = ownsRentalProperty
        ? ['yes', 'y', 'true', '1']
        : ['no', 'n', 'false', '0'];

    for (const value of valueCandidates) {
        const candidate = page.locator(`input[type="radio"][value="${value}"]`).first();
        if (await candidate.count() > 0) {
            await candidate.check();
            return true;
        }
    }

    const labelText = ownsRentalProperty ? /^yes$/i : /^no$/i;
    const label = page.getByText(labelText).first();
    if (await label.count() > 0) {
        await label.click();
        return true;
    }

    return false;
}

function shuffleCharacters(characters: string[]): string {
    const copy = [...characters];

    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = randomInt(0, index + 1);
        [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }

    return copy.join('');
}

function generateKraCompliantPassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const special = '@#$!%*?';
    const all = `${upper}${lower}${digits}${special}`;

    const pick = (alphabet: string) => alphabet[randomInt(0, alphabet.length)];
    const characters = [pick(upper), pick(lower), pick(digits), pick(special)];

    while (characters.length < 14) {
        characters.push(pick(all));
    }

    return shuffleCharacters(characters);
}

function escapeAttributeValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function fillMonthlyRentalIncomeAmount(
    page: any,
    job: Job<FilingJob>,
    rentalIncomeAmount: number
): Promise<void> {
    if (!Number.isFinite(rentalIncomeAmount) || rentalIncomeAmount <= 0) {
        throw new Error('MRI filing requires a positive rental income amount');
    }

    type VisibleInputCandidate = {
        tag: string;
        id: string;
        name: string;
        type: string;
        placeholder: string;
        value: string;
        readOnly: boolean;
        disabled: boolean;
        visible: boolean;
        rowText: string;
        label: string;
    };

    const candidateMetadata: VisibleInputCandidate[] = await page.evaluate(() => {
        const isVisible = (element: HTMLElement) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        return Array.from(document.querySelectorAll('input, textarea'))
            .map((element) => {
                const input = element as HTMLInputElement | HTMLTextAreaElement;
                const rowText = input.closest('tr, td, div, label')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
                const label = input.id
                    ? document.querySelector(`label[for="${input.id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
                    : '';

                return {
                    tag: input.tagName,
                    id: input.id ?? '',
                    name: input.getAttribute('name') ?? '',
                    type: 'type' in input ? input.type ?? '' : '',
                    placeholder: input.getAttribute('placeholder') ?? '',
                    value: input.value ?? '',
                    readOnly: Boolean((input as HTMLInputElement).readOnly),
                    disabled: Boolean((input as HTMLInputElement).disabled),
                    visible: isVisible(input as HTMLElement),
                    rowText,
                    label,
                };
            })
            .filter((candidate: VisibleInputCandidate) => candidate.visible)
            .filter((candidate: VisibleInputCandidate) => !candidate.disabled && !candidate.readOnly)
            .filter((candidate: VisibleInputCandidate) => !['hidden', 'submit', 'button', 'radio', 'checkbox', 'password'].includes((candidate.type || '').toLowerCase()));
    });

    const rankedCandidate = candidateMetadata.find((candidate: VisibleInputCandidate) => {
        const haystack = [candidate.id, candidate.name, candidate.placeholder, candidate.label, candidate.rowText]
            .join(' ')
            .toLowerCase();

        return /rent|rental|income|gross|amount/.test(haystack) && !/period|from|to|date/.test(haystack);
    }) ?? candidateMetadata.find((candidate: VisibleInputCandidate) => ['number', 'text', ''].includes((candidate.type || '').toLowerCase()));

    if (!rankedCandidate) {
        await appendJobLog(job, `MRI amount field could not be matched. Visible input metadata: ${JSON.stringify(candidateMetadata)}`, {
            progress: 70,
            level: 'error',
        });
        throw new Error('Could not locate the monthly rental income input field');
    }

    let fieldLocator;
    if (rankedCandidate.id) {
        fieldLocator = page.locator(`[id="${escapeAttributeValue(rankedCandidate.id)}"]`).first();
    } else if (rankedCandidate.name) {
        fieldLocator = page.locator(`[name="${escapeAttributeValue(rankedCandidate.name)}"]`).first();
    } else {
        fieldLocator = page.locator('input:visible, textarea:visible').first();
    }

    await fieldLocator.fill(String(rentalIncomeAmount));
    await appendJobLog(job, `Entered MRI amount ${rentalIncomeAmount} into ${rankedCandidate.name || rankedCandidate.id || rankedCandidate.placeholder || 'the detected amount field'}`, {
        progress: 70,
    });
}

async function performKraLogin(
    page: any,
    job: Job<FilingJob>,
    kraPin: string,
    kraPassword: string,
    options: {
        pinProgress: number;
        pinMessage: string;
        passwordProgress: number;
        passwordMessage: string;
        captchaProgress: number;
        captchaMessage: string;
        submitProgress: number;
        submitMessage: string;
        otpCode?: string;
    }
): Promise<{ passwordExpired: boolean }> {
    const { jobId } = job.data;

    await setJobStep(job, options.pinProgress, options.pinMessage);

    await page.waitForSelector('#logid', { timeout: 15_000 });
    await page.fill('#logid', kraPin);

    console.log(`[Worker][${jobId}] Clicking Continue (CheckPIN)…`);
    const checkPinDialogPromise = waitForDialogMessage(page, 10_000);
    const continueFound = await page.$('a[href="javascript:CheckPIN();"]');
    if (continueFound) {
        await continueFound.click();
    } else {
        console.log(`[Worker][${jobId}] Continue <a> not found via href selector, calling CheckPIN() via JS…`);
        await page.evaluate(() => { (globalThis as any).CheckPIN(); });
    }

    const checkPinDialogMessage = await checkPinDialogPromise;
    if (checkPinDialogMessage) {
        console.log(`[Worker][${jobId}] KRA dialog: "${checkPinDialogMessage}"`);
    }

    const passwordVisible = await page.waitForSelector('input[type="password"]:visible', { timeout: 18_000 })
        .then(() => true)
        .catch(() => false);

    if (!passwordVisible) {
        const errMsg = checkPinDialogMessage
            ?? await page.$eval('#errorDiv, .error-message, [id*="error"]', (el: any) => el.textContent?.trim()).catch(() => null)
            ?? 'Password section did not appear after CheckPIN(). The KRA PIN may be invalid or inactive.';
        throw new Error(`PIN validation failed: ${errMsg}`);
    }

    await humanDelay(150, 350);

    await setJobStep(job, options.passwordProgress, options.passwordMessage);
    await page.fill('input[type="password"]', kraPassword);

    await humanDelay(150, 350);

    await setJobStep(job, options.captchaProgress, options.captchaMessage);
    await page.waitForSelector('input[name="captcahText"]', { timeout: 10_000 });

    let captchaAnswer = '';
    const captchaSelectors = [
        '#loginCaptcha',
        '#captchaImg',
        '#captcha_img',
        'img[id*="captcha"]',
        'img[src*="GenerateCaptcha"]',
        'img[src*="captcha"]',
    ];
    const screenPath = path.join(TMP_DIR, `captcha-element-${jobId}.png`);
    let usedElementScreenshot = false;

    for (const selector of captchaSelectors) {
        const captchaElement = await page.$(selector);
        if (!captchaElement) {
            continue;
        }

        const box = await captchaElement.boundingBox();
        if (!box || box.width < 10 || box.height < 10) {
            continue;
        }

        await captchaElement.screenshot({ path: screenPath, type: 'png' });
        usedElementScreenshot = true;
        console.log(`[Worker][${jobId}] Lossless captcha element screenshot saved via ${selector}: ${screenPath}`);
        break;
    }

    if (!usedElementScreenshot) {
        await page.screenshot({ path: screenPath, fullPage: false, type: 'png' });
        console.log(`[Worker][${jobId}] Captcha element not found; fell back to viewport screenshot: ${screenPath}`);
    }

    try {
        const captchaResult = await solveCaptchaWithGemini(screenPath, jobId);
        captchaAnswer = captchaResult.answer;
        console.log(`[Worker][${jobId}] Gemini parsed captcha: "${captchaResult.expression}" => ${captchaResult.answer}`);
    } catch (e) {
        console.warn(`[Worker][${jobId}] Gemini captcha extraction failed:`, (e as Error).message);
    }

    if (!captchaAnswer) {
        console.warn(`[Worker][${jobId}] Could not solve captcha with Gemini — login will likely fail.`);
    }

    await page.fill('input[name="captcahText"]', captchaAnswer);

    await humanDelay(500, 1_000);

    await setJobStep(job, options.submitProgress, options.submitMessage);

    const loginDialogPromise = waitForDialogMessage(page, 10_000);
    await page.click('#loginButton');
    const loginDialogMessage = await loginDialogPromise;
    if (loginDialogMessage) {
        console.log(`[Worker][${jobId}] KRA dialog: "${loginDialogMessage}"`);
        await appendJobLog(job, `KRA login dialog: ${loginDialogMessage}`, { progress: options.submitProgress, level: 'error' });
        throw new Error(loginDialogMessage);
    }

    const loginFailureMessage = await waitForMatchingPortalMessage(page, LOGIN_FAILURE_PATTERNS, 6_000);
    if (loginFailureMessage) {
        await appendJobLog(job, `KRA login rejected the request: ${loginFailureMessage}`, {
            progress: options.submitProgress,
            level: 'error',
        });
        throw new Error(loginFailureMessage);
    }

    const postLoginSelector = await waitForAnySelector(page, [
        '#homePageLink',
        'a:has-text("Logout")',
        'a:has-text("Returns")',
        'text=YOUR PASSWORD HAS EXPIRED!',
        'text=Change Password',
        'text=FIRST TIME LOGIN!',
        'text=Security Question',
        'text=Mobile Number Verification',
        'button:has-text("Send Verification Code")',
    ], 30_000);

    if (postLoginSelector && PASSWORD_EXPIRED_PATTERNS.some((pattern) => pattern.test(postLoginSelector))) {
        return { passwordExpired: true };
    }

    if (postLoginSelector && /Mobile Number Verification|Send Verification Code/i.test(postLoginSelector)) {
        await handleMobileVerification(page, job, options.otpCode);
        return { passwordExpired: false };
    }

    if (!postLoginSelector) {
        await waitForPortalReadyWithReload(page, job, {
            description: 'Post-login dashboard',
            selectors: ['#homePageLink', 'a:has-text("Logout")', 'a:has-text("Returns")'],
            timeout: 20_000,
            reloadAttempts: 1,
        });
    }

    return { passwordExpired: false };
}

async function handleExpiredPasswordReset(
    page: any,
    job: Job<FilingJob>,
    currentPassword: string
): Promise<CredentialUpdate> {
    await setJobStep(job, 42, 'KRA requires a credential update before filing can continue');

    const expiredFormVisible = await waitForAnySelector(page, ['text=YOUR PASSWORD HAS EXPIRED!', 'text=Change Password', 'text=FIRST TIME LOGIN!', 'text=Security Question'], 15_000);
    if (!expiredFormVisible) {
        throw new Error('Expected the KRA credential update page, but it did not appear');
    }

    const visiblePasswordFields = page.locator('input[type="password"]:visible');
    const visiblePasswordFieldCount = await visiblePasswordFields.count();
    if (visiblePasswordFieldCount < 3) {
        throw new Error('KRA showed the credential update page, but the password fields were not all visible');
    }

    const generatedPassword = generateKraCompliantPassword();

    await setJobStep(job, 44, 'Generating a compliant replacement iTax password');
    await visiblePasswordFields.nth(0).fill(currentPassword);
    await visiblePasswordFields.nth(1).fill(generatedPassword);
    await visiblePasswordFields.nth(2).fill(generatedPassword);

    const securityQuestionSelect = page.locator('select:visible').filter({ has: page.locator('option') }).first();
    if (await securityQuestionSelect.count() > 0) {
        await setJobStep(job, 45, 'Completing KRA security question setup');
        await selectOptionByTextPatterns(securityQuestionSelect, FAVORITE_COLOR_SECURITY_QUESTION_PATTERNS);

        const answersFilled = await fillSecurityAnswerFields(page, FAVORITE_COLOR_SECURITY_ANSWER);
        if (!answersFilled) {
            throw new Error('KRA requested security answers, but the answer fields were not visible');
        }
    }

    const guidelineCheckboxes = page.locator('input[type="checkbox"]:visible');
    const guidelineCheckboxCount = await guidelineCheckboxes.count();
    for (let index = 0; index < guidelineCheckboxCount; index += 1) {
        const checkbox = guidelineCheckboxes.nth(index);
        const isChecked = await checkbox.isChecked().catch(() => false);
        if (!isChecked) {
            await checkbox.check();
        }
    }

    await humanDelay(250, 600);

    await setJobStep(job, 46, 'Submitting the forced password change');
    const passwordChangeDialogPromise = waitForDialogMessage(page, 10_000);
    await page.locator('input[value="Submit"], button:has-text("Submit"), a:has-text("Submit")').first().click();
    const passwordChangeDialogMessage = await passwordChangeDialogPromise;
    if (passwordChangeDialogMessage && !/success/i.test(passwordChangeDialogMessage)) {
        throw new Error(`KRA rejected the password change: ${passwordChangeDialogMessage}`);
    }

    const postResetState = await detectAuthenticatedPortalState(page, 15_000);
    if (postResetState === 'password-change') {
        const portalMessage = await page.$eval('#errorDiv, .error-message, [id*="error"]', (el: any) => el.textContent?.trim()).catch(() => null);
        throw new Error(`Password change did not complete: ${portalMessage ?? 'KRA kept the credential update screen open'}`);
    }

    const credentialUpdate: CredentialUpdate = {
        passwordChanged: true,
        newPassword: generatedPassword,
        changedAt: new Date().toISOString(),
    };

    await appendJobLog(job, 'Password updated successfully. Returning to login with the generated credential.', { progress: 46 });
    await job.updateData({
        ...job.data,
        credentialUpdate,
    });

    return credentialUpdate;
}

async function handleMobileVerification(
    page: any,
    job: Job<FilingJob>,
    providedOtpCode?: string
): Promise<void> {
    await setJobStep(job, 41, 'Completing KRA mobile number verification');

    const sendVerificationButton = page.locator('button:has-text("Send Verification Code"), input[value*="Send Verification Code" i], a:has-text("Send Verification Code")').first();
    if (await sendVerificationButton.count() > 0) {
        await sendVerificationButton.click();
    }

    const otpFieldSelector = await waitForAnySelector(page, [
        'input[name*="otp" i]',
        'input[id*="otp" i]',
        'input[placeholder*="verification code" i]',
        'input[placeholder*="otp" i]',
        'input[maxlength="6"]',
    ], 20_000);

    if (!otpFieldSelector) {
        throw new Error('KRA requested mobile verification, but the OTP input field did not appear');
    }

    const otpCode = await getOtpFromSmsService(providedOtpCode);
    await page.locator(otpFieldSelector).first().fill(otpCode);
    await appendJobLog(job, 'Entered the mobile verification code', { progress: 41 });
    await humanDelay(250, 600);

    const verifyButton = page.locator('button:has-text("Verify"), button:has-text("Submit"), input[value*="Verify" i], input[value*="Submit" i], a:has-text("Verify")').first();
    if (await verifyButton.count() > 0) {
        await verifyButton.click();
    }

    await waitForPortalReadyWithReload(page, job, {
        description: 'Post-OTP dashboard',
        selectors: ['#homePageLink', 'a:has-text("Logout")', 'a:has-text("Returns")'],
        timeout: 20_000,
        reloadAttempts: 1,
    });
}

async function uploadPayeTaxZip(page: any, job: any): Promise<void> {
    const payload = job.data.payload;
    if (!payload.payeZipUrl) {
        throw new Error('PAYE Upload filing requires payeZipUrl in the queued job payload');
    }
    await appendJobLog(job, `Downloading PAYE ZIP file from ${payload.payeZipUrl}`, { progress: 68 });
    const res = await fetch(payload.payeZipUrl);
    if (!res.ok) throw new Error(`Failed to fetch PAYE ZIP: ${res.statusText}`);
    const zipPath = require('path').join(TMP_DIR, `paye-${job.data.jobId}.zip`);
    await require('fs').promises.writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ timeout: 20_000 });
    await fileInput.setInputFiles(zipPath);
    const termsCheckbox = page.locator('input[type="checkbox"]:near(:text("Terms and Conditions")), input[type="checkbox"][name*="agree" i], input[type="checkbox"][id*="agree" i], input[type="checkbox"]').first();
    await termsCheckbox.check();
    await appendJobLog(job, `Uploaded PAYE ZIP file and accepted the declaration`, { progress: 70 });
}

async function uploadTurnoverTaxZip(
    page: any,
    job: Job<FilingJob>
): Promise<void> {
    const payload = job.data.payload;
    if (!payload.totYear || !payload.totMonth || payload.totTurnover === undefined) {
        throw new Error('Turnover Tax filing requires totYear, totMonth, and totTurnover in the queued job payload');
    }

    const outputDir = path.join(TMP_DIR, 'generated-zips');
    const inputSettings = {
        taxPayerPin: payload.kraPin,
        returnPeriod: { year: payload.totYear, month: payload.totMonth },
        turnover: payload.totTurnover,
        returnType: 'Original' as const
    };

    await appendJobLog(job, `Generating ToT ZIP payload for period ${payload.totMonth}/${payload.totYear} with turnover ${payload.totTurnover}`, {
        progress: 68,
    });

    const resolvedZipPath = await packageToTZip(inputSettings, outputDir);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ timeout: 20_000 });
    await fileInput.setInputFiles(resolvedZipPath);

    const termsCheckbox = page.locator(
        'input[type="checkbox"][name*="agree" i], input[type="checkbox"][id*="agree" i], input[type="checkbox"]'
    ).first();
    await termsCheckbox.check();

    await appendJobLog(job, `Uploaded ToT ZIP file ${path.basename(resolvedZipPath)} and accepted the declaration`, {
        progress: 70,
    });
}

async function extractReceiptNumber(page: any): Promise<string | null> {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const receiptMatch = bodyText.match(/(?:Acknowledg(?:e)?ment|Receipt)\s*(?:Number|No\.?|#)?\s*[:\-]?\s*([A-Z0-9\-/]+)/i);
    return receiptMatch?.[1] ?? null;
}

// ─── Core Job Processor ───────────────────────────────────────────────────────

async function processFilingJob(job: Job<FilingJob>): Promise<{ receiptPath: string; receiptNumber: string | null; credentialUpdate: CredentialUpdate | null }> {
    const { jobId, userId, payload } = job.data;
    const {
        kraPin,
        encryptedPassword,
        iv,
        authTag,
        periodFrom,
        periodTo,
        taxObligationType,
        ownsRentalProperty,
        rentalIncomeAmount,
        otpCode,
    } = payload;
    const isMriReturn = taxObligationType === 'monthly_rental_income';
    const isTotReturn = taxObligationType === 'turnover_tax';
    const isPayeUpload = taxObligationType === 'paye' && !!(payload as any).payeZipUrl;

    console.log(`[Worker] Starting job ${jobId} for PIN ${kraPin}`);
    await appendJobLog(job, 'Job accepted by worker');

    // ── Step 1: Decrypt password in-memory ──────────────────────────────────────
    // The plaintext password exists only in this local scope and is GC'd after
    // the browser session closes.
    let activePassword = decrypt(encryptedPassword, iv, authTag);
    let credentialUpdate: CredentialUpdate | null = job.data.credentialUpdate ?? null;

    await fs.mkdir(TMP_DIR, { recursive: true });

    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

    try {
        // ── Step 2: Launch browser with stealth configuration ────────────────────
        await setJobStep(job, 5, 'Launching browser session');
        const isHeadless = false;
        browser = await chromium.launch({
            headless: isHeadless,
            slowMo: isHeadless ? 0 : PLAYWRIGHT_SLOW_MO,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--start-maximized',
                ...(isHeadless ? ['--disable-gpu'] : []),
            ],
        });

        const context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: null,
            acceptDownloads: true,
            locale: 'en-KE',
            timezoneId: 'Africa/Nairobi',
        });

        const page = await context.newPage();

        // ── Step 3: Navigate to KRA iTax portal ─────────────────────────────────
        await setJobStep(job, 10, 'Navigating to the KRA portal');

        await page.goto(KRA_PORTAL_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 90_000, // KRA portal can be very slow
        });
        await waitForPortalReadyWithReload(page, job, {
            description: 'KRA login page',
            selectors: ['#logid', '#loginButton', 'input[name="captcahText"]'],
            timeout: 12_000,
            reloadAttempts: 1,
        });

        // Dump real element IDs/names so we can verify selectors
        if (KRA_DEBUG_ARTIFACTS) {
            const loginElements = await page.$$eval(
                'input, button, select, a',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (els: any[]) => els.map((el: any) => ({
                    tag: el.tagName,
                    id: el.id ?? '',
                    name: el.name ?? '',
                    type: el.type ?? '',
                    value: (el.value ?? '').slice(0, 30),
                    text: (el.textContent ?? '').trim().slice(0, 40),
                    onclick: (el.getAttribute('onclick') ?? '').slice(0, 60),
                    href: (el.getAttribute('href') ?? '').slice(0, 80),
                }))
            );
            console.log(`[Worker][${jobId}] Login page elements:`, JSON.stringify(loginElements, null, 2));
        }

        await navigationDelay();

        const firstLogin = await performKraLogin(page, job, kraPin, activePassword, {
            pinProgress: 20,
            pinMessage: 'Entering KRA PIN and validating taxpayer account',
            passwordProgress: 30,
            passwordMessage: 'Entering iTax password',
            captchaProgress: 35,
            captchaMessage: 'Solving KRA captcha',
            submitProgress: 40,
            submitMessage: 'Submitting KRA login',
            otpCode,
        });

        if (firstLogin.passwordExpired) {
            credentialUpdate = await handleExpiredPasswordReset(page, job, activePassword);
            activePassword = credentialUpdate.newPassword;

            const postResetState = await detectAuthenticatedPortalState(page, 20_000);
            if (postResetState === 'mobile-verification') {
                await handleMobileVerification(page, job, otpCode);
            } else if (postResetState !== 'dashboard') {
                await setJobStep(job, 48, 'KRA returned to login after the password reset; logging in with the generated password');
                await page.goto(KRA_PORTAL_URL, {
                    waitUntil: 'domcontentloaded',
                    timeout: 90_000,
                });
                await waitForPortalReadyWithReload(page, job, {
                    description: 'KRA login page after password reset',
                    selectors: ['#logid', '#loginButton', 'input[name="captcahText"]'],
                    timeout: 12_000,
                    reloadAttempts: 1,
                });

                const relogin = await performKraLogin(page, job, kraPin, activePassword, {
                    pinProgress: 49,
                    pinMessage: 'Re-entering KRA PIN after password reset',
                    passwordProgress: 49,
                    passwordMessage: 'Entering the generated replacement password',
                    captchaProgress: 49,
                    captchaMessage: 'Solving KRA captcha for the second login attempt',
                    submitProgress: 49,
                    submitMessage: 'Submitting KRA login with the updated password',
                    otpCode,
                });

                if (relogin.passwordExpired) {
                    throw new Error('KRA still requested another password change after the automated reset');
                }
            } else {
                await appendJobLog(job, 'KRA kept the session logged in after the password reset, continuing without a second login.', { progress: 49 });
            }
        }

        await navigationDelay();

        // ── Step 8: Navigate to Returns submenu ──────────────────────────────────
        await setJobStep(job, 50, isTotReturn ? 'Opening the KRA ToT return form' : isMriReturn ? 'Opening the KRA MRI return form' : 'Opening the KRA nil return form');

        // Take a screenshot and dump the nav menu so we can discover the real selectors
        if (KRA_DEBUG_ARTIFACTS) {
            const postLoginScreenshot = path.join(TMP_DIR, `post-login-${jobId}.png`);
            await page.screenshot({ path: postLoginScreenshot, fullPage: true });
            console.log(`[Worker][${jobId}] Post-login screenshot: ${postLoginScreenshot}`);

            const navElements = await page.$$eval(
                'a, li, td, th, span',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (els: any[]) => els
                    .map((el: any) => ({
                        tag: el.tagName,
                        id: el.id ?? '',
                        text: (el.textContent ?? '').trim().slice(0, 50),
                        href: (el.getAttribute('href') ?? '').slice(0, 80),
                        onclick: (el.getAttribute('onclick') ?? '').slice(0, 80),
                    }))
                    .filter((el: any) => el.text.length > 0)
                    .slice(0, 60)
            );
            console.log(`[Worker][${jobId}] Post-login nav elements:`, JSON.stringify(navElements, null, 2));
        }

        // Try to find and click the Returns menu — KRA uses various selectors
        // Try: text match, href match, id match
        const returnsLink = await page.$('#returns') ??
            await page.$('a:has-text("Returns")') ??
            await page.$('td:has-text("Returns") a') ??
            await page.$('li:has-text("Returns") a') ??
            await page.$('a[href*="return"]');

        if (returnsLink) {
            console.log(`[Worker][${jobId}] Found Returns menu element, hovering…`);
            await returnsLink.hover();
        } else {
            console.warn(`[Worker][${jobId}] Returns menu element not found by common selectors — trying page text click`);
            await page.getByText('Returns', { exact: true }).first().hover();
        }

        const filingLinkSelector = isMriReturn || isTotReturn || isPayeUpload
        ? 'a[href*="showEReturns"], a.mainMenu[href*="showEReturns"], a:has-text("File Return")'
        : 'a[href*="nilReturn"], a[href*="NilReturn"], a[href*="nil-return"], a:has-text("Nil Return")';
        
        try {
            const filingLink = await page.waitForSelector(filingLinkSelector, { timeout: 10_000 });
            await filingLink.click({ force: true });
        } catch (error) {
            console.log(`[Worker][${jobId}] Falling back to evaluate script for File Return click.`);
            if (isMriReturn || isTotReturn || isPayeUpload) {
                await page.evaluate(() => {
                    const el = document.querySelector('a[href*="showEReturns"], a.mainMenu[href*="showEReturns"]') as HTMLElement;
                    if (el) el.click();
                    else (window as any).showEReturns();
                });
            } else {
                await page.evaluate(() => {
                    const el = document.querySelector('a[href*="nilReturn"], a:has-text("Nil Return")') as HTMLElement;
                    if (el) el.click();
                });
            }
        }
        await waitForPortalReadyWithReload(page, job, {
        description: isTotReturn ? 'ToT return obligation page' : isMriReturn ? 'MRI return obligation page' : isPayeUpload ? 'PAYE return obligation page' : 'Nil return obligation page',
            selectors: ['select#regType', 'select[name="obligationId"]', 'tr:has-text("Type") select'],
            timeout: 15_000,
            reloadAttempts: 1,
        });

        await navigationDelay();

        // ── Step 9: Select return type and tax obligation ────────────────────────
        await setJobStep(job, 60, isTotReturn ? 'Selecting ToT return type and tax obligation' : isMriReturn ? 'Selecting MRI return type and tax obligation' : isPayeUpload ? 'Selecting PAYE return type and preparing upload' : 'Selecting nil return type and tax obligation');

        if (KRA_DEBUG_ARTIFACTS) {
            const selectMetadata = await page.$$eval(
                'select',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (els: any[]) => els.map((el: any) => ({
                    id: el.id ?? '',
                    name: el.name ?? '',
                    options: Array.from(el.options).map((option: any) => ({
                        value: option.value ?? '',
                        text: (option.textContent ?? '').trim(),
                    })),
                }))
            );
            console.log(`[Worker][${jobId}] Return select metadata:`, JSON.stringify(selectMetadata, null, 2));
        }

        const typeSelectLocator = page.locator('tr').filter({ hasText: 'Type' }).locator('select').locator('visible=true').first();
        try {
            await typeSelectLocator.waitFor({ state: 'visible', timeout: 10_000 });
            const typeSelectDisabled = await typeSelectLocator.isDisabled();
            if (typeSelectDisabled) {
                const currentType = await typeSelectLocator.evaluate((select: any) => ({
                    value: String(select.value ?? '').trim(),
                    text: String(select.options?.[select.selectedIndex]?.textContent ?? '').trim(),
                }));
                console.log(`[Worker][${jobId}] Return type is locked by KRA: ${currentType.text} [${currentType.value}]`);
            } else {
                const typeChoice = await selectOptionByTextPatterns(typeSelectLocator, [/^self$/i]);
                console.log(`[Worker][${jobId}] Selected return type: ${typeChoice.text} [${typeChoice.value}]`);
            }
        } catch (e: any) {
            console.log(`[Worker][${jobId}] Type select dropdown not visible or error:`, e.message);
        }

        const obligationSelect = page.locator('select#regType, select[name="obligationId"]').first();
        await obligationSelect.waitFor({ timeout: 10_000 });
        const obligationChoice = await selectOptionByTextPatterns(
            obligationSelect,
            TAX_OBLIGATION_PATTERNS[taxObligationType]
        );
        console.log(`[Worker][${jobId}] Selected tax obligation: ${obligationChoice.text} [${obligationChoice.value}]`);
        await appendJobLog(job, `Selected tax obligation: ${obligationChoice.text}`, { progress: 60 });

        const nextDialogPromise = waitForDialogMessage(page, 10_000);
        await page.locator('#nextBtn, input[value="Next"], button:has-text("Next"), a:has-text("Next")').first().click();
        const nextDialogMessage = await nextDialogPromise;
        if (nextDialogMessage) {
            console.log(`[Worker][${jobId}] KRA dialog: "${nextDialogMessage}"`);
            await appendJobLog(job, `KRA blocked the form after obligation selection: ${nextDialogMessage}`, { progress: 60, level: 'error' });
            throw new Error(nextDialogMessage);
        }
        // IMPORTANT: Do NOT reload after clicking "Next" — KRA treats page
        // reloads as form re-submissions and invalidates the session with
        // "Your session has timed out or an attempt to page re-submit happened".
        // Instead, wait with a generous timeout and no reload attempts.
        await waitForPortalReadyWithReload(page, job, {
            description: isTotReturn ? 'ToT upload page' : isMriReturn ? 'MRI return details page' : 'Nil return details page',
            selectors: isTotReturn
                ? ['input[type="file"]', '#submitBtn', 'input[value="Submit"]', 'text=Terms and Conditions']
                : isMriReturn
                    ? ['#txtPeriodFrom', '#txtPeriodTo', '#submitBtn', 'input[name*="rent" i]', 'input[name*="income" i]', 'input[name*="amount" i]']
                    : ['#txtPeriodFrom', '#txtPeriodTo', '#submitBtn', 'input[name="txtPeriodFrom"]'],
            timeout: 60_000,
            reloadAttempts: 0,
        });

        await navigationDelay();

        // ── Step 10: Fill return details ─────────────────────────────────────────
        await setJobStep(job, 70, isTotReturn ? 'Uploading the ToT ZIP file and accepting the declaration' : isPayeUpload ? 'Uploading the PAYE ZIP file and accepting the declaration' : isMriReturn ? 'Confirming the MRI period and entering monthly rental income' : 'Confirming the return period and rental-property answer');

    if (isTotReturn) {
        await uploadTurnoverTaxZip(page, job);
    } else if (isPayeUpload) {
        await uploadPayeTaxZip(page, job);
    } else {

            // Use precise selectors — broad patterns like input[name*="to" i] match
            // hidden fields such as <input name="token_key"> causing fill() failures.
            const directFromField = page.locator('#txtPeriodFrom, #periodFrom, input[name="txtPeriodFrom"], input[name*="periodFrom" i]').first();
            const directToField = page.locator('#txtPeriodTo, #periodTo, input[name="txtPeriodTo"], input[name*="periodTo" i]').first();
            const directFromCount = await directFromField.count();
            const directToCount = await directToField.count();

            if (directFromCount > 0 && directToCount > 0) {
                const existingFromDate = await getInputValue(directFromField);
                const existingToDate = await getInputValue(directToField);
                if (existingFromDate && existingToDate) {
                    await appendJobLog(job, `KRA prepopulated the return period: ${existingFromDate} to ${existingToDate}`, { progress: 70 });
                } else {
                    await setPortalDateField(directFromField, periodFrom, 'From date');
                    await setPortalDateField(directToField, periodTo, 'To date');
                }
            } else {
                const dateFields = page.locator('input[placeholder*="dd/mm/yyyy" i], input[placeholder*="dd-mm-yyyy" i]');
                const dateFieldCount = await dateFields.count();
                if (dateFieldCount >= 2) {
                    const existingFromDate = await getInputValue(dateFields.nth(0));
                    const existingToDate = await getInputValue(dateFields.nth(1));
                    if (existingFromDate && existingToDate) {
                        await appendJobLog(job, `KRA prepopulated the return period: ${existingFromDate} to ${existingToDate}`, { progress: 70 });
                    } else {
                        await setPortalDateField(dateFields.nth(0), periodFrom, 'From date');
                        await setPortalDateField(dateFields.nth(1), periodTo, 'To date');
                    }
                }
            }

            if (isMriReturn) {
                await fillMonthlyRentalIncomeAmount(page, job, rentalIncomeAmount ?? Number.NaN);
            } else {
                const rentalAnswered = await selectRentalPropertyAnswer(page, ownsRentalProperty);
                if (rentalAnswered) {
                    await appendJobLog(job, `Selected rental-property answer: ${ownsRentalProperty ? 'Yes' : 'No'}`, { progress: 70 });
                } else {
                    const radioMetadata = await page.$$eval(
                        'input[type="radio"]',
                        (els: HTMLInputElement[]) => els.map((el) => ({
                            name: el.name ?? '',
                            value: el.value ?? '',
                            checked: Boolean(el.checked),
                        }))
                    ).catch(() => []);
                    await appendJobLog(job, `Rental-property radio could not be matched on the form. Available radios: ${JSON.stringify(radioMetadata)}`, {
                        progress: 70,
                        level: 'error',
                    });
                    throw new Error('Could not select the rental-property answer on the nil return form');
                }
            }
        }

        await humanDelay(400, 900);

        // ── Step 11: Submit (handle JS confirmation dialog) ──────────────────────
        await setJobStep(job, 80, isTotReturn ? 'Submitting the ToT return to KRA' : isMriReturn ? 'Submitting the MRI return to KRA' : 'Submitting the nil return to KRA');

        const submitDialogPromise = waitForDialogMessage(page, 10_000);

        await page.locator('#submitBtn, input[value="Submit"], button:has-text("Submit"), a:has-text("Submit")').first().click();
        const submitDialogMessage = await submitDialogPromise;
        if (submitDialogMessage) {
            console.log(`[Worker][${jobId}] KRA dialog: "${submitDialogMessage}"`);
            await appendJobLog(job, `KRA submit dialog: ${submitDialogMessage}`, { progress: 80 });
        }

        const postSubmitPortalMessage = await waitForMatchingPortalMessage(
            page,
            isTotReturn ? TURNOVER_TAX_SUBMISSION_ERROR_PATTERNS : [],
            8_000
        );
        if (postSubmitPortalMessage && !/acknowledg|receipt/i.test(postSubmitPortalMessage)) {
            await appendJobLog(job, `KRA submit validation message: ${postSubmitPortalMessage}`, { progress: 80, level: 'error' });
            throw new Error(postSubmitPortalMessage);
        }

        // Do NOT reload after submit — same re-submit issue as the "Next" button.
        await waitForPortalReadyWithReload(page, job, {
            description: 'Post-submit receipt page',
            selectors: [
                'text=Return Receipt Generated',
                'text=Return Submitted successfully',
                'text=Acknowledgement Number',
                'text=Acknowledgment Receipt',
                'text=Acknowledgement Receipt',
                'text=Receipt Number',
            ],
            timeout: 60_000,
            reloadAttempts: 0,
        }).catch(async () => {
            // The receipt button may legitimately be absent if KRA returned a blocking dialog.
            await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        });

        // Inspect all links on the receipt page to find the download link by its actual attributes
        const receiptPageLinks = await page.$$eval(
            'a',
            (els: HTMLAnchorElement[]) => els.map((el) => ({
                id: el.id ?? '',
                href: el.getAttribute('href') ?? '',
                onclick: el.getAttribute('onclick') ?? '',
                text: (el.textContent ?? '').trim(),
                className: el.className ?? '',
            })).filter((el) => el.text.length > 0 || el.onclick.length > 0)
        );
        if (KRA_DEBUG_ARTIFACTS) {
            console.log(`[Worker][${jobId}] Receipt page links:`, JSON.stringify(receiptPageLinks, null, 2));
        }

        // Find the download link by its onclick/href attribute (the actual handler KRA uses)
        const downloadMeta = receiptPageLinks.find(
            (link) =>
                link.onclick.toLowerCase().includes('download') ||
                link.href.toLowerCase().includes('download') ||
                link.id.toLowerCase().includes('download')
        );

        if (!downloadMeta && submitDialogMessage) {
            await appendJobLog(job, `KRA prevented receipt generation: ${submitDialogMessage}`, { progress: 80, level: 'error' });
            throw new Error(submitDialogMessage);
        }

        if (!downloadMeta) {
            await appendJobLog(job, `No download link found on the receipt page. Available links: ${JSON.stringify(receiptPageLinks)}`, { progress: 80, level: 'error' });
            throw new Error('Could not locate the receipt download link on the KRA receipt page');
        }

        console.log(`[Worker][${jobId}] Found download link: id="${downloadMeta.id}", onclick="${downloadMeta.onclick}", href="${downloadMeta.href}", text="${downloadMeta.text}"`);

        const receiptNumber = await extractReceiptNumber(page);
        if (receiptNumber) {
            await appendJobLog(job, `Receipt number detected: ${receiptNumber}`, { progress: 90 });
        }

        await navigationDelay();

        // ── Step 12: Download PDF acknowledgment receipt ─────────────────────────
        await setJobStep(job, 90, 'Waiting for the acknowledgment receipt download');

        const receiptFileName = `kra-receipt-${jobId}-${Date.now()}.pdf`;
        const receiptPath = path.join(TMP_DIR, receiptFileName);

        // Build a precise selector from the actual element attributes
        let downloadSelector: string;
        if (downloadMeta.id) {
            downloadSelector = `#${downloadMeta.id}`;
        } else if (downloadMeta.onclick) {
            downloadSelector = `a[onclick*="${downloadMeta.onclick.slice(0, 40).replace(/"/g, '\\"')}"]`;
        } else {
            downloadSelector = `a[href*="${downloadMeta.href.slice(0, 40).replace(/"/g, '\\"')}"]`;
        }
        console.log(`[Worker][${jobId}] Using download selector: ${downloadSelector}`);

        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            page.click(downloadSelector),
        ]);

        await download.saveAs(receiptPath);
        console.log(`[Worker][${jobId}] Receipt saved: ${receiptPath}`);

        // Clean up browser resources before network I/O
        await context.close();
        await browser.close();
        browser = undefined;

        // ── Step 13: Store receipt in the workspace ───────────────────────────────
        await setJobStep(job, 94, 'Storing the receipt in the workspace');
        const { receiptPath: storedReceiptPath, relativePath } = await storeReceiptLocally(receiptPath, jobId);
        await appendJobLog(job, `Receipt stored locally at ${relativePath}`, { progress: 94 });

        // ── Step 14: Notify user ──────────────────────────────────────────────────
        await setJobStep(job, 98, 'Dispatching completion notification');
        await sendReceiptNotification({
            userId,
            jobId,
            kraPin,
            receiptPath: storedReceiptPath,
            completedAt: new Date().toISOString(),
        });

        await setJobStep(job, 100, 'Job completed successfully');
        console.log(`[Worker][${jobId}] Job completed. Receipt path: ${storedReceiptPath}`);
        return {
            receiptPath: storedReceiptPath,
            receiptNumber,
            credentialUpdate,
        };
    } catch (err) {
        const error = err as Error;
        const currentProgress = typeof job.progress === 'number' ? job.progress : null;
        await appendJobLog(job, `Job failed: ${error.message}`, {
            progress: currentProgress ?? undefined,
            level: 'error',
        });
        console.warn(`[Worker][${jobId ?? 'unknown'}] Job failed — closing Chrome after capturing debug artifacts.`);
        if (browser) {
            try {
                const failScreenshot = path.join(TMP_DIR, `failure-${jobId}-${Date.now()}.png`);
                const pages = browser.contexts().flatMap((context) => context.pages());
                if (pages.length > 0) {
                    await pages[0].screenshot({ path: failScreenshot, fullPage: true });
                    console.log(`[Worker] Failure screenshot: ${failScreenshot}`);
                }
            } catch (_) {
                // Ignore screenshot failures so the original job error still propagates.
            }

            try {
                await browser.close();
            } catch (_) {
                // Ignore close failures so BullMQ still receives the original error.
            }
        }
        throw err; // Re-throw so BullMQ marks the job as failed
    }
}

// ─── Worker Registration ──────────────────────────────────────────────────────

export const kraFilingWorker = new Worker<FilingJob>(
    KRA_QUEUE_NAME,
    processFilingJob,
    {
        connection: redisConnection,
        /**
         * concurrency: 1 — jobs run sequentially.
         * Running multiple Playwright sessions simultaneously risks IP bans and
         * corrupted KRA portal session state.
         */
        concurrency: 1,
    }
);

kraFilingWorker.on('active', (job) => {
    console.log(`[Worker] Job ${job.id} started`);
});

kraFilingWorker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
});

kraFilingWorker.on('failed', (job, err: Error) => {
    console.error(`[Worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
});

kraFilingWorker.on('progress', (job, progress) => {
    console.log(`[Worker] Job ${job.id} progress: ${progress}%`);
});

kraFilingWorker.on('error', (err: Error) => {
    console.error('[Worker] Worker error:', err.message);
});

console.log(`[Worker] Listening on queue "${KRA_QUEUE_NAME}" (concurrency: 1)`);
