/**
 * kraFilingWorker.ts
 *
 * BullMQ worker that processes KRA nil return filing jobs one at a time.
 *
 * Run with:  npm run worker
 *
 * Architecture notes:
 *  - concurrency: 1  — sequential processing prevents KRA portal rate-limits.
 *  - Playwright launches a fresh browser process per job. A dedicated optional
 *    profile directory can be reused so static KRA assets stay cached across
 *    jobs while cookies and web storage are cleared before each run.
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
import { redisConnection, KRA_QUEUE_NAME, kraFilingQueue } from '../queues/kraFilingQueue';
import { openDb } from '../db/database';
import { decrypt } from '../utils/encryption';
import { storeReceiptLocally } from '../utils/storage';
import { sendReceiptNotification } from '../utils/notifications';
import { CredentialUpdate, FilingJob, FilingStepLog, TaxObligationType } from '../types';
import { packageToTZip } from '../scripts/kra-tot-generator';
import { fileNssfReturn } from '../scripts/file-nssf-return';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';

// Apply stealth plugin once at module load
chromium.use(StealthPlugin());

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);
const KRA_BROWSER_PROFILE_DIR = process.env.KRA_BROWSER_PROFILE_DIR ?? path.join(TMP_DIR, 'browser-profile');
const KRA_REUSE_BROWSER_PROFILE = process.env.KRA_REUSE_BROWSER_PROFILE !== 'false';

const KRA_PORTAL_URL = 'https://itax.kra.go.ke/KRA-Portal/';
const KRA_DEBUG_ARTIFACTS = process.env.KRA_DEBUG_ARTIFACTS === 'true';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-flash-latest';
const PLAYWRIGHT_SLOW_MO = Math.max(0, Number.parseInt(process.env.PLAYWRIGHT_SLOW_MO ?? '0', 10) || 0);
const KRA_BROWSER_CHANNEL = (process.env.KRA_BROWSER_CHANNEL ?? 'chrome').trim().toLowerCase();
const KRA_BROWSER_EXECUTABLE_PATH = process.env.KRA_BROWSER_EXECUTABLE_PATH?.trim() ?? '';
const WINDOWS_BROWSER_EXECUTABLE_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
] as const;

type BrowserLaunchPreference = {
    label: string;
    executablePath?: string;
    channel?: 'chrome' | 'msedge';
};

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
    nssf: [
        /^nssf$/i
    ]
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

const AUTHENTICATED_DASHBOARD_SELECTORS = [
    '#homePageLink',
    'a:has-text("Logout")',
    'a:has-text("Returns")',
] as const;

const PASSWORD_CHANGE_SELECTORS = [
    'text=YOUR PASSWORD HAS EXPIRED!',
    'text=Change Password',
    'text=FIRST TIME LOGIN!',
    'text=Security Question',
] as const;

const MOBILE_VERIFICATION_SELECTORS = [
    'text=Mobile Number Verification',
    'button:has-text("Send Verification Code")',
] as const;

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

const PAYE_SUBMISSION_ERROR_PATTERNS = [
    /please\s+upload\s+form/i,
    /please\s+attach/i,
    /upload\s+file/i,
    /invalid\s+file/i,
    /selected\s+tax\s+obligation/i,
    /error\s+occurred\s+while\s+uploading/i,
];

const PAYE_RETRYABLE_UPLOAD_ERROR_PATTERNS = [
    /please\s+upload\s+form/i,
    /please\s+attach/i,
    /upload\s+file/i,
];

const PAYE_UPLOAD_TRIGGER_SELECTORS = [
    'button:has-text("Upload")',
    'input[type="button"][value*="Upload" i]',
    'input[type="submit"][value*="Upload" i]',
    'input[type="image"][src*="upload" i]',
    'a:has-text("Upload")',
    'button[id*="upload" i]',
    'input[type="button"][id*="upload" i]',
    'input[type="submit"][id*="upload" i]',
    'input[type="image"][id*="upload" i]',
    'button[name*="upload" i]',
    'input[type="button"][name*="upload" i]',
    'input[type="submit"][name*="upload" i]',
    'input[type="image"][name*="upload" i]',
    'a[onclick*="upload" i]',
    'input[onclick*="upload" i]',
    'button[onclick*="upload" i]',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Waits for a random duration to simulate human interaction cadence without
 * making ordinary form entry feel artificially slow.
 */
function humanDelay(minMs = 80, maxMs = 180): Promise<void> {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function navigationDelay(): Promise<void> {
    return humanDelay(140, 320);
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function resolvePreferredBrowserLaunches(): Promise<BrowserLaunchPreference[]> {
    const candidates: BrowserLaunchPreference[] = [];
    const seen = new Set<string>();

    const pushCandidate = (candidate: BrowserLaunchPreference) => {
        const key = `${candidate.executablePath ?? ''}|${candidate.channel ?? ''}`;
        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        candidates.push(candidate);
    };

    if (KRA_BROWSER_EXECUTABLE_PATH && await pathExists(KRA_BROWSER_EXECUTABLE_PATH)) {
        pushCandidate({
            label: `system browser at ${KRA_BROWSER_EXECUTABLE_PATH}`,
            executablePath: KRA_BROWSER_EXECUTABLE_PATH,
        });
    }

    if (process.platform === 'win32') {
        for (const browserPath of WINDOWS_BROWSER_EXECUTABLE_CANDIDATES) {
            if (await pathExists(browserPath)) {
                pushCandidate({
                    label: `system browser at ${browserPath}`,
                    executablePath: browserPath,
                });
            }
        }
    }

    if (KRA_BROWSER_CHANNEL === 'chrome' || KRA_BROWSER_CHANNEL === 'msedge') {
        pushCandidate({
            label: `Playwright ${KRA_BROWSER_CHANNEL} channel`,
            channel: KRA_BROWSER_CHANNEL,
        });
    }

    pushCandidate({ label: 'bundled Playwright Chromium' });
    return candidates;
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

class JobCancelledError extends Error {
    constructor(message = 'Job cancelled by user.') {
        super(message);
        this.name = 'JobCancelledError';
    }
}

function hasCancellationRequest(jobData?: Partial<FilingJob> | null): boolean {
    return typeof jobData?.cancelRequestedAt === 'string' && jobData.cancelRequestedAt.trim().length > 0;
}

async function assertJobNotCancelled(
    job: Job<FilingJob>,
    context: string,
    progress?: number
): Promise<void> {
    const latestJob = await kraFilingQueue.getJob(String(job.id ?? job.data.jobId));
    const latestJobData = (latestJob?.data ?? job.data) as FilingJob;
    if (!hasCancellationRequest(latestJobData)) {
        return;
    }

    const progressValue = typeof progress === 'number'
        ? progress
        : typeof job.progress === 'number'
            ? job.progress
            : undefined;

    await appendJobLog(job, `Cancellation requested by operator. Stopping during ${context}.`, {
        progress: progressValue,
    });
    console.warn(`[Worker][${job.data.jobId}] Cancellation requested during ${context}; stopping the job.`);
    throw new JobCancelledError();
}

async function setJobStep(job: Job<FilingJob>, progress: number, message: string): Promise<void> {
    await assertJobNotCancelled(job, message, progress);
    await job.updateProgress(progress);
    await appendJobLog(job, message, { progress });
    console.log(`[Worker][${job.data.jobId}] ${message}`);
}

async function resolveTimingContext(
    details?: string | (() => string | Promise<string>)
): Promise<string> {
    if (!details) {
        return '';
    }

    try {
        const resolved = typeof details === 'function' ? await details() : details;
        return resolved ? ` | ${resolved}` : '';
    } catch {
        return '';
    }
}

async function measureJobPhase<T>(
    job: Job<FilingJob>,
    label: string,
    progress: number | undefined,
    action: () => Promise<T>,
    details?: string | (() => string | Promise<string>)
): Promise<T> {
    const startedAt = new Date();
    const startedMs = Date.now();
    const progressValue = typeof progress === 'number' ? progress : undefined;
    await assertJobNotCancelled(job, label, progressValue);
    const startMessage = `Timing start | ${label} | startedAt=${startedAt.toISOString()}`;
    await appendJobLog(job, startMessage, { progress: progressValue });
    console.log(`[Worker][${job.data.jobId}] ${startMessage}`);

    try {
        const result = await action();
        const endedAt = new Date();
        const durationMs = Date.now() - startedMs;
        const context = await resolveTimingContext(details);
        const endMessage = `Timing end | ${label} | startedAt=${startedAt.toISOString()} | endedAt=${endedAt.toISOString()} | durationMs=${durationMs}${context}`;
        await appendJobLog(
            job,
            endMessage,
            { progress: progressValue }
        );
        console.log(`[Worker][${job.data.jobId}] ${endMessage}`);
        return result;
    } catch (error) {
        const endedAt = new Date();
        const durationMs = Date.now() - startedMs;
        const context = await resolveTimingContext(details);
        const message = error instanceof Error ? error.message : String(error);
        const failureMessage = `Timing failure | ${label} | startedAt=${startedAt.toISOString()} | endedAt=${endedAt.toISOString()} | durationMs=${durationMs} | error=${message}${context}`;
        await appendJobLog(
            job,
            failureMessage,
            { progress: progressValue, level: 'error' }
        );
        console.warn(`[Worker][${job.data.jobId}] ${failureMessage}`);
        throw error;
    }
}

async function waitForAnySelector(
    page: any,
    selectors: string[],
    timeout = 20_000,
    cancellation?: {
        job?: Job<FilingJob>;
        context?: string;
        progress?: number;
    }
): Promise<string | null> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        if (cancellation?.job) {
            await assertJobNotCancelled(
                cancellation.job,
                cancellation.context ?? 'a portal wait',
                cancellation.progress
            );
        }

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

async function findVisibleSelector(
    page: any,
    selectors: readonly string[]
): Promise<string | null> {
    for (const selector of selectors) {
        const isVisible = await page.locator(selector).first().isVisible().catch(() => false);
        if (isVisible) {
            return selector;
        }
    }

    return null;
}

async function isBlankKraLoginShell(page: any): Promise<boolean> {
    return page.evaluate(() => {
        const bodyText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
        const visibleControls = Array.from(document.querySelectorAll('input, button, a, select, textarea')).some((element) => {
            const htmlElement = element as HTMLElement;
            const style = window.getComputedStyle(htmlElement);
            const rect = htmlElement.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        });

        return /\/KRA-Portal\/login\.htm/i.test(window.location.href)
            && ['interactive', 'complete'].includes(document.readyState)
            && bodyText.length === 0
            && !visibleControls;
    }).catch(() => false);
}

type PostLoginOutcome =
    | { type: 'dashboard'; selector: string }
    | { type: 'password-change'; selector: string }
    | { type: 'mobile-verification'; selector: string }
    | { type: 'dialog'; message: string }
    | { type: 'login-failure'; message: string }
    | { type: 'blank-login-shell' }
    | { type: 'timeout' };

async function waitForPostLoginOutcome(
    page: any,
    job: Job<FilingJob>,
    progress: number,
    timeout = 18_000
): Promise<PostLoginOutcome> {
    let dialogMessage: string | null = null;
    void waitForDialogMessage(page, 4_000)
        .then((message) => {
            dialogMessage = message;
        })
        .catch(() => undefined);

    const deadline = Date.now() + timeout;
    let blankShellDetectedAt: number | null = null;

    while (Date.now() < deadline) {
        await assertJobNotCancelled(job, 'post-login landing selector', progress);

        if (dialogMessage) {
            return { type: 'dialog', message: dialogMessage };
        }

        const loginFailureMessage = await findMatchingPortalMessage(page, LOGIN_FAILURE_PATTERNS).catch(() => null);
        if (loginFailureMessage) {
            return { type: 'login-failure', message: loginFailureMessage };
        }

        const dashboardSelector = await findVisibleSelector(page, AUTHENTICATED_DASHBOARD_SELECTORS);
        if (dashboardSelector) {
            return { type: 'dashboard', selector: dashboardSelector };
        }

        const passwordChangeSelector = await findVisibleSelector(page, PASSWORD_CHANGE_SELECTORS);
        if (passwordChangeSelector) {
            return { type: 'password-change', selector: passwordChangeSelector };
        }

        const mobileVerificationSelector = await findVisibleSelector(page, MOBILE_VERIFICATION_SELECTORS);
        if (mobileVerificationSelector) {
            return { type: 'mobile-verification', selector: mobileVerificationSelector };
        }

        const blankLoginShell = await isBlankKraLoginShell(page);
        if (blankLoginShell) {
            blankShellDetectedAt ??= Date.now();
            if (Date.now() - blankShellDetectedAt >= 1_500) {
                return { type: 'blank-login-shell' };
            }
        } else {
            blankShellDetectedAt = null;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return { type: 'timeout' };
}

async function waitForPortalReadyWithReload(
    page: any,
    job: Job<FilingJob>,
    options: {
        description: string;
        selectors: string[];
        timeout?: number;
        reloadAttempts?: number;
        waitForNetworkIdle?: boolean;
    }
): Promise<void> {
    const {
        description,
        selectors,
        timeout = 20_000,
        reloadAttempts = 1,
        waitForNetworkIdle = false,
    } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= reloadAttempts; attempt += 1) {
        try {
            await assertJobNotCancelled(job, description, typeof job.progress === 'number' ? job.progress : undefined);
            const alreadyLoaded = await page.evaluate(() => ['interactive', 'complete'].includes(document.readyState)).catch(() => false);
            if (!alreadyLoaded) {
                await page.waitForLoadState('domcontentloaded', { timeout: Math.max(5_000, timeout) }).catch(() => {});
            }
            if (waitForNetworkIdle) {
                await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
            }

            // Check for KRA error page (session timeout / re-submit) early
            const errorSelectors = [
                ...selectors,
                'text=An Error Occured',
                'text=session has timed out',
                'text=page re-submit',
            ];
            const matchedSelector = await waitForAnySelector(page, errorSelectors, timeout, {
                job,
                context: description,
                progress: typeof job.progress === 'number' ? job.progress : undefined,
            });

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
            await assertJobNotCancelled(job, `${description} reload`, typeof job.progress === 'number' ? job.progress : undefined);
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

async function solveCaptchaWithTesseract(screenshotPath: string, jobId: string): Promise<{ expression: string; answer: string }> {
    const processedPath = screenshotPath.replace('.png', '-processed.png');
    
    // Pre-process KRA image: grayscale, normalize to boost contrast
    await sharp(screenshotPath)
        .greyscale()
        .normalize()
        .threshold(160)
        .toFile(processedPath);

    const { data: { text } } = await Tesseract.recognize(processedPath, 'eng');
    
    const rawText = text.replace(/[^0-9+\-*/= ]/g, '').trim();
    const match = rawText.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/i);

    if (!match) {
        throw new Error(`Tesseract failed to extract captcha format. Raw text: "${text}", Cleaned: "${rawText}"`);
    }

    const expression = `${match[1]} ${match[2]} ${match[3]}`;
    const expectedAnswer = String(solveCaptcha(expression));

    return { expression, answer: expectedAnswer };
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

async function summariseCurrentPage(page: any): Promise<string> {
    return page.evaluate(() => {
        const bodyText = (document.body?.innerText ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 240);

        return JSON.stringify({
            title: document.title ?? '',
            readyState: document.readyState ?? '',
            url: window.location.href,
            bodyText,
        });
    }).catch(() => 'unavailable');
}

async function snapshotPageControls(page: any): Promise<string> {
    return page.evaluate(() => {
        const bodyText = (document.body?.innerText ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 320);

        const controlSelectors = [
            'input',
            'button',
            'a',
            'label',
            'select',
            'textarea',
            'iframe',
        ];

        const controls = controlSelectors.flatMap((selector) =>
            Array.from(document.querySelectorAll(selector)).slice(0, 80).map((element) => {
                const htmlElement = element as HTMLElement;
                const style = window.getComputedStyle(htmlElement);
                const input = element as HTMLInputElement;
                return {
                    tag: element.tagName,
                    id: htmlElement.id ?? '',
                    name: input.name ?? '',
                    type: input.type ?? '',
                    text: (htmlElement.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
                    value: (input.value ?? '').slice(0, 120),
                    href: htmlElement.getAttribute('href') ?? '',
                    onclick: htmlElement.getAttribute('onclick') ?? '',
                    visible: style.display !== 'none' && style.visibility !== 'hidden',
                    disabled: 'disabled' in input ? Boolean(input.disabled) : false,
                };
            })
        );

        return JSON.stringify({
            title: document.title ?? '',
            readyState: document.readyState ?? '',
            url: window.location.href,
            bodyText,
            controls,
        });
    }).catch(() => 'unavailable');
}

async function returnToPayeUploadPage(page: any, job: Job<FilingJob>): Promise<void> {
    const backControl = page.locator('#backBtn, input[value*="Back" i], button:has-text("Back"), a:has-text("Back")').first();
    const backControlCount = await backControl.count().catch(() => 0);

    if (backControlCount > 0) {
        await backControl.click({ force: true }).catch(async () => {
            await backControl.click().catch(() => undefined);
        });
    } else {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
    }

    await appendJobLog(job, 'Returned to the PAYE upload form after KRA rejected the attachment', { progress: 80 });
    await waitForPortalReadyWithReload(page, job, {
        description: 'PAYE upload page after upload retry',
        selectors: ['input[type="file"]', '#submitBtn', 'input[value="Submit"]', 'text=Terms and Conditions', 'button:has-text("Upload")', 'input[value*="Upload" i]'],
        timeout: 30_000,
        reloadAttempts: 0,
    });
}

async function getFileInputValue(locator: any): Promise<string> {
    return locator.evaluate((input: HTMLInputElement) => String(input.value ?? '').trim());
}

async function waitForFileInputSelection(
    fileInput: any,
    fileName: string,
    timeout = 3_000
): Promise<string> {
    const deadline = Date.now() + timeout;
    let lastValue = '';

    while (Date.now() < deadline) {
        lastValue = await getFileInputValue(fileInput).catch(() => '');
        if (lastValue.toLowerCase().includes(fileName.toLowerCase())) {
            return lastValue;
        }

        await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return lastValue;
}

async function resolveBestPayeFileInput(page: any): Promise<{
    locator: any;
    metadata: {
        id: string;
        name: string;
        accept: string;
        visible: boolean;
        disabled: boolean;
        label: string;
        rowText: string;
        multiple: boolean;
    };
}> {
    const candidates = await page.evaluate(() => {
        const isVisible = (element: HTMLElement) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        return Array.from(document.querySelectorAll('input[type="file"]'))
            .map((element, index) => {
                const input = element as HTMLInputElement;
                const linkedLabel = input.id
                    ? Array.from(document.querySelectorAll('label')).find((label) => label.getAttribute('for') === input.id) ?? null
                    : null;
                const nearestLabel = input.closest('label');
                const label = (linkedLabel?.textContent ?? nearestLabel?.textContent ?? '').replace(/\s+/g, ' ').trim();
                const rowText = (input.closest('tr, td, div, form')?.textContent ?? '').replace(/\s+/g, ' ').trim();
                const haystack = [input.id, input.name, input.accept, label, rowText].join(' ').toLowerCase();

                let score = 0;
                if (!input.disabled) {
                    score += 100;
                }
                if (isVisible(input)) {
                    score += 40;
                }
                if (/zip|upload|attach|file|browse|choose/.test(haystack)) {
                    score += 25;
                }
                if (/paye|return|form/.test(haystack)) {
                    score += 10;
                }
                if ((input.accept ?? '').toLowerCase().includes('zip')) {
                    score += 20;
                }

                return {
                    index,
                    score,
                    id: input.id ?? '',
                    name: input.name ?? '',
                    accept: input.accept ?? '',
                    visible: isVisible(input),
                    disabled: Boolean(input.disabled),
                    label,
                    rowText,
                    multiple: Boolean(input.multiple),
                };
            })
            .sort((left, right) => right.score - left.score);
    });

    if (!candidates.length) {
        throw new Error('Could not find any file input on the PAYE upload page');
    }

    const bestCandidate = candidates[0];
    return {
        locator: page.locator('input[type="file"]').nth(bestCandidate.index),
        metadata: {
            id: bestCandidate.id,
            name: bestCandidate.name,
            accept: bestCandidate.accept,
            visible: bestCandidate.visible,
            disabled: bestCandidate.disabled,
            label: bestCandidate.label,
            rowText: bestCandidate.rowText,
            multiple: bestCandidate.multiple,
        },
    };
}

async function selectUploadFile(
    page: any,
    fileInput: any,
    zipPath: string
): Promise<{ method: 'filechooser' | 'input'; triggerLabel: string | null }> {
    const chooserTriggerSelector = [
        'input[type="file"]:visible',
        'label:has(input[type="file"])',
        'label:has-text("Choose File")',
        'label:has-text("Browse")',
        'button:has-text("Choose File")',
        'button:has-text("Browse")',
        'input[type="button"][value*="Choose File" i]',
        'input[type="button"][value*="Browse" i]',
        'input[type="submit"][value*="Choose File" i]',
        'input[type="submit"][value*="Browse" i]',
        'a:has-text("Choose File")',
        'a:has-text("Browse")',
    ].join(', ');

    const chooserTrigger = page.locator(chooserTriggerSelector).first();
    const chooserTriggerCount = await chooserTrigger.count().catch(() => 0);

    if (chooserTriggerCount > 0) {
        const triggerLabel = await chooserTrigger.evaluate((element: HTMLElement) => {
            if (element instanceof HTMLInputElement) {
                return element.value || element.name || element.id || 'visible file input';
            }

            return element.textContent?.replace(/\s+/g, ' ').trim() || element.getAttribute('name') || element.id || 'file chooser trigger';
        }).catch(() => 'file chooser trigger');

        const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 2_500 }).catch(() => null);
        await chooserTrigger.click({ force: true }).catch(async () => {
            await chooserTrigger.click().catch(() => undefined);
        });

        const fileChooser = await fileChooserPromise;
        if (fileChooser) {
            await fileChooser.setFiles(zipPath);
            return { method: 'filechooser', triggerLabel };
        }
    }

    await fileInput.setInputFiles(zipPath);
    return { method: 'input', triggerLabel: null };
}

async function clickUploadTriggerIfPresent(page: any): Promise<string | null> {
    const uploadSelector = PAYE_UPLOAD_TRIGGER_SELECTORS.map((selector) => `${selector}:visible`).join(', ');

    const uploadTrigger = page.locator(uploadSelector).first();
    const triggerCount = await uploadTrigger.count().catch(() => 0);
    if (!triggerCount) {
        return null;
    }

    const label = await uploadTrigger.evaluate((element: HTMLElement) => {
        if (element instanceof HTMLInputElement) {
            return element.value || element.name || element.id || 'upload control';
        }

        return element.textContent?.replace(/\s+/g, ' ').trim() || element.getAttribute('name') || element.id || 'upload control';
    }).catch(() => 'upload control');

    await uploadTrigger.click();
    return label;
}

async function waitForPayeUploadAcknowledgement(
    page: any,
    fileInput: any,
    fileName: string,
    requirePageAcknowledgement = false,
    timeout = 8_000
): Promise<{ acknowledged: boolean; inputValue: string; portalMessage: string | null; matchedText: string | null }> {
    const deadline = Date.now() + timeout;
    const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const positivePatterns = [
        new RegExp(escapedFileName, 'i'),
        /uploaded\s+successfully/i,
        /file\s+uploaded/i,
        /upload\s+successful/i,
    ];

    while (Date.now() < deadline) {
        const portalMessage = await findMatchingPortalMessage(page, PAYE_SUBMISSION_ERROR_PATTERNS).catch(() => null);
        if (portalMessage) {
            return { acknowledged: false, inputValue: await getFileInputValue(fileInput).catch(() => ''), portalMessage, matchedText: null };
        }

        const inputValue = await getFileInputValue(fileInput).catch(() => '');
        const visibleUploadTriggerCount = await page
            .locator(PAYE_UPLOAD_TRIGGER_SELECTORS.map((selector) => `${selector}:visible`).join(', '))
            .count()
            .catch(() => 0);
        const fileSelected = inputValue && inputValue.toLowerCase().includes(fileName.toLowerCase());

        if (
            fileSelected
            && requirePageAcknowledgement
            && visibleUploadTriggerCount === 0
        ) {
            return { acknowledged: true, inputValue, portalMessage: null, matchedText: null };
        }

        const bodyText = await page.locator('body').innerText().catch(() => '');
        const matchedText = bodyText
            .split(/\r?\n/)
            .map((line: string) => line.replace(/\s+/g, ' ').trim())
            .find((line: string) => positivePatterns.some((pattern) => pattern.test(line))) ?? null;

        if (matchedText) {
            return { acknowledged: true, inputValue, portalMessage: null, matchedText };
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return {
        acknowledged: false,
        inputValue: await getFileInputValue(fileInput).catch(() => ''),
        portalMessage: null,
        matchedText: null,
    };
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
        ...AUTHENTICATED_DASHBOARD_SELECTORS,
        '#logid',
        '#loginButton',
        'input[name="captcahText"]',
        ...MOBILE_VERIFICATION_SELECTORS,
        ...PASSWORD_CHANGE_SELECTORS,
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
    await fieldLocator.blur(); // Blur the field so KRA auto-calculates the tax

    // Also click somewhere neutral on the body to be absolutely sure the onblur event fires.
    await page.locator('body').click({ position: { x: 10, y: 10 } });

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
        // Temporarily bypassing Tesseract because it hallucinations on KRA noise lines.
        throw new Error('OCR disabled to force manual input');
    } catch (e) {
        console.warn(`[Worker][${jobId}] OCR captcha extraction failed:`, (e as Error).message);
    }

    if (!captchaAnswer) {
        console.warn(`[Worker][${jobId}] Could not solve captcha automatically. PLEASE TYPE IT MANUALLY in the browser! (Waiting 15 seconds)`);
        await page.focus('input[name="captcahText"]');
        await humanDelay(15000, 15000); // Wait 15s for the user to key it in.
        captchaAnswer = await page.inputValue('input[name="captcahText"]');
    } else {
        await page.fill('input[name="captcahText"]', captchaAnswer);
    }

    await humanDelay(500, 1_000);

    await setJobStep(job, options.submitProgress, options.submitMessage);

    await page.click('#loginButton');
    const postLoginOutcome = await measureJobPhase(job, 'post-login landing selector', options.submitProgress, async () => {
        return await waitForPostLoginOutcome(page, job, options.submitProgress);
    }, () => `currentUrl=${page.url()}`);

    if (postLoginOutcome.type === 'dialog') {
        console.log(`[Worker][${jobId}] KRA dialog: "${postLoginOutcome.message}"`);
        await appendJobLog(job, `KRA login dialog: ${postLoginOutcome.message}`, { progress: options.submitProgress, level: 'error' });
        throw new Error(postLoginOutcome.message);
    }

    if (postLoginOutcome.type === 'login-failure') {
        await appendJobLog(job, `KRA login rejected the request: ${postLoginOutcome.message}`, {
            progress: options.submitProgress,
            level: 'error',
        });
        throw new Error(postLoginOutcome.message);
    }

    if (postLoginOutcome.type === 'password-change') {
        return { passwordExpired: true };
    }

    if (postLoginOutcome.type === 'mobile-verification') {
        await handleMobileVerification(page, job, options.otpCode);
        return { passwordExpired: false };
    }

    if (postLoginOutcome.type === 'blank-login-shell') {
        const blankShellSnapshot = await summariseCurrentPage(page);
        await appendJobLog(job, `Detected a blank post-login shell before dashboard recovery: ${blankShellSnapshot}`, {
            progress: options.submitProgress,
            level: 'error',
        });
        await appendJobLog(job, 'Blank post-login login.htm shell detected; reloading early instead of waiting through the full dashboard timeout', {
            progress: options.submitProgress,
        });
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => undefined);
        await navigationDelay();
        await measureJobPhase(job, 'post-login dashboard ready', options.submitProgress, async () => {
            await waitForPortalReadyWithReload(page, job, {
                description: 'Post-login dashboard',
                selectors: [...AUTHENTICATED_DASHBOARD_SELECTORS],
                timeout: 10_000,
                reloadAttempts: 0,
            });
        }, () => `currentUrl=${page.url()}`);
        return { passwordExpired: false };
    }

    if (postLoginOutcome.type === 'timeout') {
        const postLoginSnapshot = await summariseCurrentPage(page);
        await appendJobLog(job, `Post-login page snapshot before dashboard retry: ${postLoginSnapshot}`, {
            progress: options.submitProgress,
            level: 'error',
        });
        await measureJobPhase(job, 'post-login dashboard ready', options.submitProgress, async () => {
            await waitForPortalReadyWithReload(page, job, {
                description: 'Post-login dashboard',
                selectors: [...AUTHENTICATED_DASHBOARD_SELECTORS],
                timeout: 12_000,
                reloadAttempts: 1,
            });
        }, () => `currentUrl=${page.url()}`);
    }

    return { passwordExpired: false };
}

async function handleExpiredPasswordReset(
    page: any,
    job: Job<FilingJob>,
    currentPassword: string
): Promise<CredentialUpdate> {
    await setJobStep(job, 42, 'KRA requires a credential update before filing can continue');

    const expiredFormVisible = await waitForAnySelector(page, ['text=YOUR PASSWORD HAS EXPIRED!', 'text=Change Password', 'text=FIRST TIME LOGIN!', 'text=Security Question'], 15_000, {
        job,
        context: 'KRA credential update page',
        progress: 42,
    });
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
    const latestJob = await kraFilingQueue.getJob(String(job.id ?? job.data.jobId));
    await job.updateData({
        ...((latestJob?.data ?? job.data) as FilingJob),
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
    ], 20_000, {
        job,
        context: 'mobile verification OTP field',
        progress: 41,
    });

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
    await appendJobLog(job, `Preparing PAYE ZIP file from ${payload.payeZipUrl}`, { progress: 68 });
    
    let zipPath = '';
    const path = require('path');
    const fs = require('fs');

    if (payload.payeZipUrl.startsWith('/clients/')) {
        // Files generated by the backend API are stored in frontend/public/clients
        zipPath = path.resolve(__dirname, '../../../frontend/public', decodeURIComponent(payload.payeZipUrl.substring(1)));
        if (!fs.existsSync(zipPath)) {
            throw new Error(`Generated ZIP file not found on disk at: ${zipPath}`);
        }
    } else {
        // Fallback for full HTTP urls if ever passed
        const fullZipUrl = payload.payeZipUrl.startsWith('http') ? payload.payeZipUrl : `http://localhost:3000${payload.payeZipUrl}`;
        const res = await fetch(fullZipUrl);
        if (!res.ok) throw new Error(`Failed to fetch PAYE ZIP: ${res.statusText}`);
        zipPath = path.join(TMP_DIR, `paye-${job.data.jobId}.zip`);
        await fs.promises.writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
    }

    const zipStats = fs.statSync(zipPath);
    await appendJobLog(job, `Resolved PAYE ZIP on disk: ${zipPath} (${zipStats.size} bytes)`, { progress: 68 });

    const { locator: fileInput, metadata: fileInputMetadata } = await resolveBestPayeFileInput(page);
    await fileInput.waitFor({ timeout: 20_000 });
    await appendJobLog(job, `Using PAYE attachment input ${JSON.stringify(fileInputMetadata)}`, { progress: 68 });

    const termsCheckbox = page.locator('input[type="checkbox"]:near(:text("Terms and Conditions")), input[type="checkbox"][name*="agree" i], input[type="checkbox"][id*="agree" i], input[type="checkbox"]').first();
    const fileName = path.basename(zipPath);
    let lastUploadIssue = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
        await appendJobLog(job, `PAYE attachment attempt ${attempt}/2: binding ${fileName} to the selected KRA file input`, { progress: 68 });
        await fileInput.setInputFiles(zipPath);

        const selectedValue = await waitForFileInputSelection(fileInput, fileName, 3_000);
        if (!selectedValue.toLowerCase().includes(fileName.toLowerCase())) {
            lastUploadIssue = `The selected KRA file input did not retain ${fileName}. Current value: ${selectedValue || '[empty]'}`;
            const uploadUiState = await page.evaluate((selectors: string[]) => {
                const controls = selectors.flatMap((selector) =>
                    Array.from(document.querySelectorAll(selector)).map((element) => {
                        const htmlElement = element as HTMLElement;
                        const style = window.getComputedStyle(htmlElement);
                        const input = element as HTMLInputElement;

                        return {
                            selector,
                            tag: element.tagName,
                            id: htmlElement.id ?? '',
                            name: input.name ?? '',
                            type: input.type ?? '',
                            text: (htmlElement.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
                            value: (input.value ?? '').slice(0, 120),
                            disabled: 'disabled' in input ? Boolean(input.disabled) : false,
                            visible: style.display !== 'none' && style.visibility !== 'hidden',
                        };
                    })
                );

                const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((element) => {
                    const input = element as HTMLInputElement;
                    return {
                        id: input.id ?? '',
                        name: input.name ?? '',
                        value: input.value ?? '',
                        disabled: Boolean(input.disabled),
                    };
                });

                return JSON.stringify({ controls, fileInputs });
            }, PAYE_UPLOAD_TRIGGER_SELECTORS).catch(() => 'unavailable');
            await appendJobLog(job, `PAYE attachment attempt ${attempt} did not stick: ${lastUploadIssue}`, {
                progress: 69,
                level: 'error',
            });
            await appendJobLog(job, `PAYE upload UI state after attempt ${attempt}: ${uploadUiState}`, {
                progress: 69,
                level: 'error',
            });
            continue;
        }

        await appendJobLog(job, `Selected ${fileName} in the KRA attachment field (${selectedValue})`, { progress: 68 });

        const checkboxCount = await termsCheckbox.count().catch(() => 0);
        if (checkboxCount > 0) {
            await termsCheckbox.check().catch(async () => {
                await termsCheckbox.click({ force: true }).catch(() => undefined);
            });
        }

        await humanDelay(250, 600);

        await appendJobLog(job, 'Selected the PAYE ZIP and accepted the declaration. KRA will process the file when Submit is clicked.', {
            progress: 70,
        });
        return;
    }

    throw new Error(lastUploadIssue || `KRA did not acknowledge PAYE upload for ${fileName}`);
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

    
    const isNssfReturn = taxObligationType === 'nssf';

    console.log(`[Worker] Starting job ${jobId} for identifier ${kraPin}`);
    await appendJobLog(job, 'Job accepted by worker');

    let activePassword = decrypt(encryptedPassword, iv, authTag);
    let credentialUpdate: CredentialUpdate | null = job.data.credentialUpdate ?? null;

    if (isNssfReturn) {
        const nssfFileUrl = (payload as any).nssfFileUrl;
        if (!nssfFileUrl) throw new Error("Missing NSSF File URL in payload.");
        await fileNssfReturn(job, kraPin, activePassword, nssfFileUrl, '04/2026');
        return { receiptPath: '', receiptNumber: null, credentialUpdate };
    }

    await fs.mkdir(TMP_DIR, { recursive: true });

    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

    try {
        // ── Step 2: Launch browser with stealth configuration ────────────────────
        await setJobStep(job, 5, 'Launching browser session');
        const isHeadless = false;
        const launchOptions = {
            headless: isHeadless,
            slowMo: isHeadless ? 0 : PLAYWRIGHT_SLOW_MO,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--start-maximized',
                ...(isHeadless ? ['--disable-gpu'] : []),
            ],
        };

        const contextOptions = {
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: null,
            acceptDownloads: true,
            locale: 'en-KE',
            timezoneId: 'Africa/Nairobi',
        };

        const page = await measureJobPhase(job, 'browser launch', 5, async () => {
            const launchPreferences = await resolvePreferredBrowserLaunches();
            let lastLaunchError: Error | null = null;

            for (const preference of launchPreferences) {
                const effectiveLaunchOptions = {
                    ...launchOptions,
                    ...(preference.executablePath ? { executablePath: preference.executablePath } : {}),
                    ...(preference.channel ? { channel: preference.channel } : {}),
                };

                try {
                    await appendJobLog(job, `Attempting browser launch via ${preference.label}`, { progress: 5 });

                    if (KRA_REUSE_BROWSER_PROFILE) {
                        await fs.mkdir(KRA_BROWSER_PROFILE_DIR, { recursive: true });
                        context = await chromium.launchPersistentContext(KRA_BROWSER_PROFILE_DIR, {
                            ...effectiveLaunchOptions,
                            ...contextOptions,
                        });
                        await context.clearCookies().catch(() => undefined);
                        await context.addInitScript(() => {
                            try {
                                window.localStorage.clear();
                            } catch {
                                // Ignore storage clear failures for opaque origins like about:blank.
                            }

                            try {
                                window.sessionStorage.clear();
                            } catch {
                                // Ignore storage clear failures for opaque origins like about:blank.
                            }
                        });
                        await appendJobLog(job, `Using persistent KRA browser profile cache at ${KRA_BROWSER_PROFILE_DIR}`, { progress: 5 });
                    } else {
                        browser = await chromium.launch(effectiveLaunchOptions);
                        context = await browser.newContext(contextOptions);
                    }

                    await appendJobLog(job, `Using browser engine: ${preference.label}`, { progress: 5 });
                    const existingPages = context.pages();
                    return existingPages[0] ?? await context.newPage();
                } catch (error) {
                    lastLaunchError = error as Error;
                    await appendJobLog(job, `Browser launch via ${preference.label} failed: ${lastLaunchError.message}`, {
                        progress: 5,
                        level: 'error',
                    });

                    if (context) {
                        await context.close().catch(() => undefined);
                        context = undefined;
                    }

                    if (browser) {
                        await browser.close().catch(() => undefined);
                        browser = undefined;
                    }
                }
            }

            throw lastLaunchError ?? new Error('No browser launch strategy succeeded');
        }, () => `profileReuse=${KRA_REUSE_BROWSER_PROFILE}${KRA_REUSE_BROWSER_PROFILE ? ` profileDir=${KRA_BROWSER_PROFILE_DIR}` : ''} preferredBrowser=${KRA_BROWSER_EXECUTABLE_PATH || KRA_BROWSER_CHANNEL || 'chromium'}`);

        // ── Step 3: Navigate to KRA iTax portal ─────────────────────────────────
        await setJobStep(job, 10, 'Navigating to the KRA portal');

        await measureJobPhase(job, 'page.goto KRA portal', 10, async () => {
            await page.goto(KRA_PORTAL_URL, {
                waitUntil: 'domcontentloaded',
                timeout: 90_000, // KRA portal can be very slow
            });
        }, () => `currentUrl=${page.url()}`);
        await measureJobPhase(job, 'login page ready', 10, async () => {
            await waitForPortalReadyWithReload(page, job, {
                description: 'KRA login page',
                selectors: ['#logid', '#loginButton', 'input[name="captcahText"]'],
                timeout: 12_000,
                reloadAttempts: 1,
            });
        }, () => `currentUrl=${page.url()}`);

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
        await setJobStep(job, 50, isTotReturn ? 'Opening the KRA ToT return form' : isMriReturn ? 'Opening the KRA MRI return form' : isPayeUpload ? 'Opening the KRA PAYE return form' : 'Opening the KRA nil return form');

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
        const returnsReadyLabel = isTotReturn
            ? 'ToT return obligation page ready'
            : isMriReturn
                ? 'MRI return obligation page ready'
                : isPayeUpload
                    ? 'PAYE return obligation page ready'
                    : 'Nil return obligation page ready';

        await measureJobPhase(job, returnsReadyLabel, 50, async () => {
            await waitForPortalReadyWithReload(page, job, {
                description: isTotReturn ? 'ToT return obligation page' : isMriReturn ? 'MRI return obligation page' : isPayeUpload ? 'PAYE return obligation page' : 'Nil return obligation page',
                selectors: ['select#regType', 'select[name="obligationId"]', 'tr:has-text("Type") select'],
                timeout: 15_000,
                reloadAttempts: 1,
            });
        }, () => `currentUrl=${page.url()}`);

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
        const uploadPageSelectors = isTotReturn || isPayeUpload
            ? [
                'input[type="file"]',
                'input[name*="file" i]',
                'input[id*="file" i]',
                'input[value*="Browse" i]',
                'text=Terms and Conditions',
                'text=Choose File',
                'text=Attach',
                'button:has-text("Upload")',
                'input[value*="Upload" i]',
                'input[type="image"][src*="upload" i]',
                '#submitBtn',
                'input[value="Submit"]',
            ]
            : isMriReturn
                ? ['#txtPeriodFrom', '#txtPeriodTo', 'button:has-text("Next")', 'input[value="Next"]']
                : ['#txtPeriodFrom', '#txtPeriodTo', '#submitBtn', 'input[name="txtPeriodFrom"]'];

        try {
            await waitForPortalReadyWithReload(page, job, {
                description: isTotReturn ? 'ToT upload page' : isPayeUpload ? 'PAYE upload page' : isMriReturn ? 'MRI return details page' : 'Nil return details page',
                selectors: uploadPageSelectors,
                timeout: 60_000,
                reloadAttempts: 0,
            });
        } catch (error) {
            if (isPayeUpload) {
                const uploadPageSnapshot = await snapshotPageControls(page);
                await appendJobLog(job, `PAYE upload page snapshot after obligation selection: ${uploadPageSnapshot}`, {
                    progress: 60,
                    level: 'error',
                });
            }
            throw error;
        }

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
                // Section A: We just filled the dates. We must click 'Next' to go to Section B.
                await appendJobLog(job, `Clicking Next to navigate to Section B (Details of Rental Income)`, { progress: 72 });
                const nextDialogPromise1 = waitForDialogMessage(page, 5_000);
                await page.locator('input[value="Next"], button:has-text("Next"), a:has-text("Next")').locator('visible=true').first().click();
                const nextDialogMessage1 = await nextDialogPromise1;
                if (nextDialogMessage1) {
                    await appendJobLog(job, `KRA dialog on Section A: ${nextDialogMessage1}`, { progress: 72, level: 'info' });
                }
                await page.waitForTimeout(4000); // Give Section B time to render

                // Section B: Fill the rental income amount.
                await fillMonthlyRentalIncomeAmount(page, job, rentalIncomeAmount ?? Number.NaN);

                // Click Next to go to Section C (Summary of Tax Due)
                await appendJobLog(job, `Clicking Next to navigate to Section C (Summary of Tax Due)`, { progress: 76 });
                const nextDialogPromise2 = waitForDialogMessage(page, 5_000);
                await page.locator('input[value="Next"], button:has-text("Next"), a:has-text("Next")').locator('visible=true').first().click();
                const nextDialogMessage2 = await nextDialogPromise2;
                if (nextDialogMessage2) {
                    await appendJobLog(job, `KRA dialog on Section B: ${nextDialogMessage2}`, { progress: 76, level: 'info' });
                }
                await page.waitForTimeout(4000); // Give Section C time to render

                // Now on Section C, ready to be submitted in Step 11.
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
        await setJobStep(job, 80, isTotReturn ? 'Submitting the ToT return to KRA' : isPayeUpload ? 'Submitting the PAYE return to KRA' : isMriReturn ? 'Submitting the MRI return to KRA' : 'Submitting the nil return to KRA');

        let submitDialogMessage: string | null = null;
        let postSubmitPortalMessage: string | null = null;
        let receiptPageLinks: Array<{ id: string; href: string; onclick: string; text: string; className: string }> = [];
        let downloadMeta: { id: string; href: string; onclick: string; text: string; className: string } | undefined;
        const confirmationOnlyDialogPattern = /do\s+you\s+want\s+to\s+upload\s+the\s+form/i;

        for (let submitAttempt = 1; submitAttempt <= (isPayeUpload ? 2 : 1); submitAttempt++) {
            const submitDialogPromise = waitForDialogMessage(page, 10_000);

            await page.locator('#submitBtn, input[value="Submit"], button:has-text("Submit"), a:has-text("Submit")').first().click();
            submitDialogMessage = await submitDialogPromise;
            if (submitDialogMessage) {
                console.log(`[Worker][${jobId}] KRA dialog: "${submitDialogMessage}"`);
                await appendJobLog(job, `KRA submit dialog: ${submitDialogMessage}`, { progress: 80 });
            }

            postSubmitPortalMessage = await waitForMatchingPortalMessage(
                page,
                isTotReturn ? TURNOVER_TAX_SUBMISSION_ERROR_PATTERNS : isPayeUpload ? PAYE_SUBMISSION_ERROR_PATTERNS : [],
                8_000
            );

            const shouldRetryPayeSubmit =
                isPayeUpload
                && submitAttempt === 1
                && !!postSubmitPortalMessage
                && PAYE_RETRYABLE_UPLOAD_ERROR_PATTERNS.some((pattern) => pattern.test(postSubmitPortalMessage ?? ''));

            if (shouldRetryPayeSubmit) {
                await appendJobLog(job, `KRA reported the PAYE form was not attached. Re-uploading once before retrying submit.`, {
                    progress: 80,
                    level: 'error',
                });
                await uploadPayeTaxZip(page, job);
                await humanDelay(400, 900);
                continue;
            }

            if (postSubmitPortalMessage && !/acknowledg|receipt/i.test(postSubmitPortalMessage)) {
                await appendJobLog(job, `KRA submit validation message: ${postSubmitPortalMessage}`, { progress: 80, level: 'error' });
                const shouldRetryImmediately =
                    isPayeUpload
                    && submitAttempt === 1
                    && PAYE_RETRYABLE_UPLOAD_ERROR_PATTERNS.some((pattern) => pattern.test(postSubmitPortalMessage ?? ''));

                if (shouldRetryImmediately) {
                    await appendJobLog(job, 'KRA reported the PAYE form was not attached. Returning to the upload form and retrying once.', {
                        progress: 80,
                        level: 'error',
                    });
                    await returnToPayeUploadPage(page, job);
                    await uploadPayeTaxZip(page, job);
                    await humanDelay(400, 900);
                    continue;
                }

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

            const settledPortalMessage = await waitForMatchingPortalMessage(
                page,
                isTotReturn ? TURNOVER_TAX_SUBMISSION_ERROR_PATTERNS : isPayeUpload ? PAYE_SUBMISSION_ERROR_PATTERNS : [],
                6_000
            );
            if (settledPortalMessage) {
                postSubmitPortalMessage = settledPortalMessage;
            }

            const shouldRetryAfterSummary =
                isPayeUpload
                && submitAttempt === 1
                && !!postSubmitPortalMessage
                && PAYE_RETRYABLE_UPLOAD_ERROR_PATTERNS.some((pattern) => pattern.test(postSubmitPortalMessage ?? ''));

            if (shouldRetryAfterSummary) {
                await appendJobLog(job, 'KRA summary page still says the PAYE form was not attached. Returning to the upload form and retrying once.', {
                    progress: 80,
                    level: 'error',
                });
                await returnToPayeUploadPage(page, job);
                await uploadPayeTaxZip(page, job);
                await humanDelay(400, 900);
                continue;
            }

            // Inspect all links on the receipt page to find the download link by its actual attributes
            receiptPageLinks = await page.$$eval(
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
            downloadMeta = receiptPageLinks.find(
                (link) =>
                    link.onclick.toLowerCase().includes('download') ||
                    link.href.toLowerCase().includes('download') ||
                    link.id.toLowerCase().includes('download')
            );

            break;
        }

        if (!downloadMeta && postSubmitPortalMessage) {
            await appendJobLog(job, `KRA prevented receipt generation: ${postSubmitPortalMessage}`, { progress: 80, level: 'error' });
            throw new Error(postSubmitPortalMessage);
        }

        if (!downloadMeta && submitDialogMessage && !confirmationOnlyDialogPattern.test(submitDialogMessage)) {
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
        if (context) {
            await context.close();
        }
        if (browser) {
            await browser.close();
        }
        context = undefined;
        browser = undefined;

        // ── Step 13: Store receipt in the workspace ───────────────────────────────
        await setJobStep(job, 94, 'Storing the receipt in the workspace');
        const { receiptPath: storedReceiptPath, relativePath } = await storeReceiptLocally(receiptPath, jobId);
        await appendJobLog(job, `Receipt stored locally at ${relativePath}`, { progress: 94 });

        try {
            let obligationCol = '';
            if (taxObligationType === 'turnover_tax') obligationCol = 'tot';
            else if (taxObligationType === 'monthly_rental_income') obligationCol = 'mri';
            else if (taxObligationType === 'vat') obligationCol = 'vat';
            else if (taxObligationType === 'paye') obligationCol = 'paye';

            if (obligationCol) {
                const db = await openDb();
                await db.run(
                    `UPDATE clients SET ${obligationCol}LastFiledDate = ?, ${obligationCol}ReceiptUrl = ? WHERE pin = ?`,
                    [new Date().toISOString(), `/api/receipts/${relativePath.replace(/\\/g, '/')}`, kraPin]
                );
                await appendJobLog(job, `Updated client ${obligationCol.toUpperCase()} last filed tracking`, { progress: 95 });
            }
        } catch (e) {
            console.error('[Worker] Failed to update client tracking:', e);
        }

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
        const isCancelled = error instanceof JobCancelledError;

        if (isCancelled) {
            const latestJob = await kraFilingQueue.getJob(String(job.id ?? job.data.jobId)).catch(() => null);
            await job.updateData({
                ...((latestJob?.data ?? job.data) as FilingJob),
                cancelledAt: new Date().toISOString(),
            }).catch(() => undefined);
            await appendJobLog(job, `Job cancelled: ${error.message}`, {
                progress: currentProgress ?? undefined,
            });
            console.warn(`[Worker][${jobId ?? 'unknown'}] Job cancelled by operator — closing browser without extra debug capture.`);
        } else {
            await appendJobLog(job, `Job failed: ${error.message}`, {
                progress: currentProgress ?? undefined,
                level: 'error',
            });
            console.warn(`[Worker][${jobId ?? 'unknown'}] Job failed — closing Chrome after capturing debug artifacts.`);
        }

        if (context || browser) {
            try {
                if (!isCancelled) {
                    const failScreenshot = path.join(TMP_DIR, `failure-${jobId}-${Date.now()}.png`);
                    const pages = context ? context.pages() : browser?.contexts().flatMap((browserContext) => browserContext.pages()) ?? [];
                    if (pages.length > 0) {
                        await pages[0].screenshot({ path: failScreenshot, fullPage: true });
                        console.log(`[Worker] Failure screenshot: ${failScreenshot}`);
                    }
                }
            } catch (_) {
                // Ignore screenshot failures so the original job error still propagates.
            }

            try {
                if (context) {
                    await context.close();
                } else if (browser) {
                    await browser.close();
                }
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
