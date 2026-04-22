import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { chromium } from 'playwright-extra';
import type { BrowserContext, Dialog, Download, Locator, Page } from 'playwright';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { storeReceiptLocally } from '../utils/storage';
import { packageToTZip, ToTReturnInput } from './kra-tot-generator';

chromium.use(StealthPlugin());

const KRA_PORTAL_URL = 'https://itax.kra.go.ke/KRA-Portal/';
const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);
const TOT_OBLIGATION_PATTERNS = [
    /^turnover\s*tax$/i,
    /^tot$/i,
    /turnover\s*tax/i,
];
const SUBMISSION_ERROR_PATTERNS = [
    /invalid\s+file/i,
    /period\s+already\s+filed/i,
    /already\s+submitted/i,
    /session\s+has\s+timed\s+out/i,
    /session\s+expired/i,
    /page\s+re-submit/i,
    /please\s+attach/i,
    /upload\s+file/i,
];
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

type SelectOption = {
    value: string;
    text: string;
};

type TotFilingConfig = {
    kraPin: string;
    kraPassword: string;
    zipFilePath?: string;
    year?: number;
    month?: number;
    turnover?: number;
    otpCode?: string;
    headless: boolean;
    slowMo: number;
};

type TotFilingResult = {
    success: boolean;
    message: string;
    receiptPath?: string;
    receiptNumber?: string | null;
    submissionDialogMessages: string[];
};

function getConfig(): TotFilingConfig {
    const kraPin = process.env.KRA_PIN?.trim() ?? '';
    const kraPassword = process.env.KRA_PASSWORD?.trim() ?? '';
    const zipFilePath = process.env.TOT_ZIP_PATH?.trim() ?? '';
    const yearRaw = process.env.TOT_YEAR?.trim() ?? '';
    const monthRaw = process.env.TOT_MONTH?.trim() ?? '';
    const turnoverRaw = process.env.TOT_TURNOVER?.trim() ?? '';

    const headlessOverride = process.env.PLAYWRIGHT_HEADLESS;
    const headless = typeof headlessOverride === 'string'
        ? headlessOverride !== 'false'
        : process.env.NODE_ENV === 'production';

    if (!kraPin) {
        throw new Error('KRA_PIN is required');
    }

    if (!kraPassword) {
        throw new Error('KRA_PASSWORD is required');
    }

    if (!zipFilePath && (!yearRaw || !monthRaw || !turnoverRaw)) {
        throw new Error('You must provide either TOT_ZIP_PATH or TOT_YEAR, TOT_MONTH, and TOT_TURNOVER');
    }

    return {
        kraPin,
        kraPassword,
        zipFilePath: zipFilePath || undefined,
        year: yearRaw ? parseInt(yearRaw, 10) : undefined,
        month: monthRaw ? parseInt(monthRaw, 10) : undefined,
        turnover: turnoverRaw ? parseFloat(turnoverRaw) : undefined,
        otpCode: process.env.KRA_OTP_CODE?.trim() || undefined,
        headless,
        slowMo: headless ? 0 : 200,
    };
}

function createRunId(): string {
    return `tot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function humanDelay(minMs = 500, maxMs = 1_400): Promise<void> {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function navigationDelay(): Promise<void> {
    return humanDelay(1_500, 3_000);
}

async function ensureZipFile(zipFilePath: string): Promise<string> {
    const absolutePath = path.resolve(zipFilePath);
    const stats = await fs.stat(absolutePath).catch(() => null);

    if (!stats || !stats.isFile()) {
        throw new Error(`ZIP file not found: ${absolutePath}`);
    }

    if (path.extname(absolutePath).toLowerCase() !== '.zip') {
        throw new Error(`TOT_ZIP_PATH must point to a .zip file: ${absolutePath}`);
    }

    return absolutePath;
}

async function getOtpFromSmsService(): Promise<string> {
    const otpCode = process.env.KRA_OTP_CODE?.trim();
    if (otpCode) {
        return otpCode;
    }

    throw new Error('OTP required. Implement getOtpFromSmsService() or provide KRA_OTP_CODE in the environment.');
}

async function waitForAnySelector(page: Page, selectors: string[], timeout = 20_000): Promise<string | null> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            const found = await locator.count().then((count) => count > 0).catch(() => false);
            if (found) {
                return selector;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return null;
}

async function portalBodyText(page: Page): Promise<string> {
    return page.locator('body').innerText().catch(() => '');
}

async function findMatchingPortalMessage(page: Page, patterns: RegExp[]): Promise<string | null> {
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

    return candidates.find((candidate: string) => patterns.some((pattern) => pattern.test(candidate))) ?? null;
}

async function waitForMatchingPortalMessage(page: Page, patterns: RegExp[], timeout = 8_000): Promise<string | null> {
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

async function waitForPortalReadyWithReload(
    page: Page,
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
            await page.waitForLoadState('domcontentloaded', { timeout });
            const errorSelectors = [
                ...selectors,
                'text=An Error Occured',
                'text=session has timed out',
                'text=page re-submit',
                'text=Session Expired',
            ];
            const matchedSelector = await waitForAnySelector(page, errorSelectors, timeout);

            if (matchedSelector && (
                matchedSelector.includes('Error Occured') ||
                matchedSelector.includes('session has timed out') ||
                matchedSelector.includes('page re-submit') ||
                matchedSelector.includes('Session Expired')
            )) {
                throw new Error(`KRA displayed an error page while loading ${description}`);
            }

            if (matchedSelector) {
                return;
            }

            lastError = new Error(`${description} did not expose the expected UI controls`);
        } catch (error) {
            lastError = error as Error;
        }

        if (attempt < reloadAttempts) {
            console.warn(`[TOT] ${description} stalled; reloading page (attempt ${attempt + 1}/${reloadAttempts})`);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
            await navigationDelay();
        }
    }

    throw lastError ?? new Error(`${description} did not finish loading`);
}

function solveCaptcha(captchaText: string): number {
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

async function solveCaptchaWithGemini(screenshotPath: string): Promise<string> {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL ?? 'gemini-flash-latest';

    if (!geminiApiKey) {
        throw new Error('GEMINI_API_KEY is required for Gemini captcha extraction');
    }

    const imageBuffer = await fs.readFile(screenshotPath);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

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
                                'Do not include words, markdown, or explanations.',
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
        throw new Error(`Gemini answer mismatch: expression ${expression}, expected ${expectedAnswer}, got ${answer}`);
    }

    return answer;
}

async function solveLoginCaptcha(page: Page, runId: string): Promise<string> {
    const captchaSelectors = [
        '#loginCaptcha',
        '#captchaImg',
        '#captcha_img',
        'img[id*="captcha"]',
        'img[src*="GenerateCaptcha"]',
        'img[src*="captcha"]',
    ];
    const screenshotPath = path.join(TMP_DIR, `captcha-element-${runId}.png`);
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

        await captchaElement.screenshot({ path: screenshotPath, type: 'png' });
        usedElementScreenshot = true;
        break;
    }

    if (!usedElementScreenshot) {
        await page.screenshot({ path: screenshotPath, fullPage: false, type: 'png' });
    }

    return solveCaptchaWithGemini(screenshotPath);
}

async function selectOptionByTextPatterns(locator: Locator, patterns: RegExp[]): Promise<{ value: string; text: string }> {
    const options = await locator.evaluate((select: HTMLSelectElement): SelectOption[] =>
        Array.from(select.options).map((option: HTMLOptionElement) => ({
            value: String(option.value ?? '').trim(),
            text: String(option.textContent ?? '').trim(),
        }))
    );

    const match = options.find((option: SelectOption) => option.value && patterns.some((pattern) => pattern.test(option.text)));

    if (!match) {
        throw new Error(`No matching option found. Available options: ${options.map((option: SelectOption) => `${option.text} [${option.value}]`).join(', ')}`);
    }

    await locator.selectOption(match.value);
    return match;
}

async function submitPinAndWaitForPassword(page: Page): Promise<void> {
    const continueLink = await page.$('a[href="javascript:CheckPIN();"]');
    if (continueLink) {
        await continueLink.click();
    } else {
        await page.evaluate(() => { (globalThis as any).CheckPIN(); });
    }

    const passwordVisible = await page.waitForSelector('input[type="password"]:visible', { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);

    if (!passwordVisible) {
        const portalMessage = await findMatchingPortalMessage(page, LOGIN_FAILURE_PATTERNS).catch(() => null);
        throw new Error(`PIN validation failed: ${portalMessage ?? 'Password field did not appear after CheckPIN()'}`);
    }
}

async function handleMobileVerification(page: Page, providedOtpCode?: string): Promise<void> {
    const verificationSelector = await waitForAnySelector(page, [
        'text=Mobile Number Verification',
        'button:has-text("Send Verification Code")',
        'input[name*="otp" i]',
        'input[id*="otp" i]',
        'input[placeholder*="verification" i]',
    ], 20_000);

    if (!verificationSelector) {
        return;
    }

    console.log('[TOT] Mobile verification prompt detected');

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
    ], 30_000);

    if (!otpFieldSelector) {
        throw new Error('KRA requested mobile verification, but the OTP input field did not appear');
    }

    const otpCode = providedOtpCode ?? await getOtpFromSmsService();
    await page.locator(otpFieldSelector).first().fill(otpCode);
    await humanDelay(250, 600);

    const verifyButton = page.locator('button:has-text("Verify"), button:has-text("Submit"), input[value*="Verify" i], input[value*="Submit" i], a:has-text("Verify")').first();
    if (await verifyButton.count() > 0) {
        await verifyButton.click();
    }

    await waitForPortalReadyWithReload(page, {
        description: 'post-OTP dashboard',
        selectors: ['#homePageLink', 'a:has-text("Logout")', 'a:has-text("Returns")'],
        timeout: 30_000,
        reloadAttempts: 1,
    });
}

async function performKraLogin(page: Page, config: TotFilingConfig, runId: string): Promise<void> {
    await page.waitForSelector('#logid', { timeout: 20_000 });
    await page.fill('#logid', config.kraPin);
    await submitPinAndWaitForPassword(page);

    await humanDelay(150, 350);
    await page.fill('input[type="password"]', config.kraPassword);

    await humanDelay(150, 350);
    const captchaAnswer = await solveLoginCaptcha(page, runId);
    await page.fill('input[name="captcahText"]', captchaAnswer);

    await humanDelay(500, 1_000);
    await page.click('#loginButton');

    const loginFailureMessage = await waitForMatchingPortalMessage(page, LOGIN_FAILURE_PATTERNS, 8_000);
    if (loginFailureMessage) {
        throw new Error(loginFailureMessage);
    }

    const postLoginSelector = await waitForAnySelector(page, [
        '#homePageLink',
        'a:has-text("Logout")',
        'a:has-text("Returns")',
        'text=Mobile Number Verification',
        'button:has-text("Send Verification Code")',
    ], 30_000);

    if (!postLoginSelector) {
        throw new Error('Login succeeded, but the KRA dashboard or mobile verification prompt never appeared');
    }

    if (/Mobile Number Verification|Send Verification Code/i.test(postLoginSelector)) {
        await handleMobileVerification(page, config.otpCode);
    }
}

async function navigateToTotUploadPage(page: Page): Promise<void> {
    const returnsMenu = page.locator('a:has-text("Returns"), text=Returns').first();
    await returnsMenu.hover();

    const fileReturnLink = page.locator('a[href*="eReturns"], a:has-text("File Return")').first();
    await fileReturnLink.waitFor({ timeout: 15_000 });
    await fileReturnLink.click();

    await waitForPortalReadyWithReload(page, {
        description: 'File Return obligation page',
        selectors: ['select#regType', 'select[name="obligationId"]', 'tr:has-text("Type") select'],
        timeout: 20_000,
        reloadAttempts: 1,
    });

    const typeSelect = page.locator('tr:has-text("Type") select').first();
    await typeSelect.waitFor({ timeout: 10_000 });
    await typeSelect.selectOption({ index: 1 }).catch(() => undefined);

    const obligationSelect = page.locator('select#regType, select[name="obligationId"]').first();
    await obligationSelect.waitFor({ timeout: 10_000 });
    const obligationChoice = await selectOptionByTextPatterns(obligationSelect, TOT_OBLIGATION_PATTERNS);
    console.log(`[TOT] Selected obligation: ${obligationChoice.text} [${obligationChoice.value}]`);

    const nextButton = page.locator('#nextBtn, input[value="Next"], button:has-text("Next"), a:has-text("Next")').first();
    await nextButton.click();

    await waitForPortalReadyWithReload(page, {
        description: 'ToT upload page',
        selectors: [
            'input[type="file"]',
            'text=I Agree to Terms and Conditions',
            '#submitBtn',
            'input[value="Submit"]',
        ],
        timeout: 60_000,
        reloadAttempts: 0,
    });
}

async function uploadTotZip(page: Page, zipFilePath: string): Promise<void> {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ timeout: 20_000 });
    await fileInput.setInputFiles(zipFilePath);

    const termsCheckbox = page.locator(
        'input[type="checkbox"]:near(:text("Terms and Conditions")), input[type="checkbox"][name*="agree" i], input[type="checkbox"][id*="agree" i], input[type="checkbox"]'
    ).first();
    await termsCheckbox.check();
}

async function extractReceiptNumber(page: Page): Promise<string | null> {
    const bodyText = await portalBodyText(page);
    const receiptMatch = bodyText.match(/(?:Acknowledg(?:e)?ment|Receipt)\s*(?:Number|No\.?|#)?\s*[:\-]?\s*([A-Z0-9\-/]+)/i);
    return receiptMatch?.[1] ?? null;
}

async function waitForAcknowledgmentDownload(page: Page): Promise<{ download: Download; receiptNumber: string | null }> {
    await waitForPortalReadyWithReload(page, {
        description: 'post-submission acknowledgment page',
        selectors: [
            'text=Acknowledgment Receipt',
            'text=Acknowledgement Receipt',
            'text=Download Returns Receipt',
            'text=Receipt Number',
            'text=Acknowledgment Number',
        ],
        timeout: 60_000,
        reloadAttempts: 0,
    });

    const receiptNumber = await extractReceiptNumber(page);
    const receiptSelector = await waitForAnySelector(page, [
        'a:has-text("Acknowledgment Receipt")',
        'a:has-text("Acknowledgement Receipt")',
        'a:has-text("Download Returns Receipt")',
        '#downloadReceipt',
        'a[href*="download" i]',
        'a[onclick*="download" i]',
    ], 30_000);

    if (!receiptSelector) {
        const portalMessage = await waitForMatchingPortalMessage(page, SUBMISSION_ERROR_PATTERNS, 2_000);
        throw new Error(portalMessage ?? 'Receipt link did not appear after submission');
    }

    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        page.locator(receiptSelector).first().click(),
    ]);

    return { download, receiptNumber };
}

function isRecoverablePortalError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /session\s+(?:expired|has\s+timed\s+out)|page\s+re-submit|timeout|ERR_CONNECTION_RESET|Navigation timed out/i.test(message);
}

async function captureFailureScreenshot(page: Page | null, runId: string): Promise<void> {
    if (!page) {
        return;
    }

    try {
        const screenshotPath = path.join(TMP_DIR, `tot-failure-${runId}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.warn(`[TOT] Failure screenshot: ${screenshotPath}`);
    } catch {
        // Ignore screenshot errors so the original failure still propagates.
    }
}

async function runTotFilingWithRetry(config: TotFilingConfig): Promise<TotFilingResult> {
    const runId = createRunId();
    let zipFilePath = '';

    if (config.zipFilePath) {
        zipFilePath = await ensureZipFile(config.zipFilePath);
    } else if (config.year && config.month && config.turnover !== undefined) {
        const outputDir = path.join(TMP_DIR, 'generated-zips');
        const inputSettings: ToTReturnInput = {
            taxPayerPin: config.kraPin,
            returnPeriod: { year: config.year, month: config.month },
            turnover: config.turnover,
            returnType: 'Original'
        };
        zipFilePath = await packageToTZip(inputSettings, outputDir);
        console.log(`[TOT] Generated ZIP file for upload: ${zipFilePath}`);
    } else {
        throw new Error('No valid ZIP path or parameter configurations found.');
    }

    const submissionDialogMessages: string[] = [];
    let browserPage: Page | null = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        let context: BrowserContext | null = null;
        let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

        try {
            await fs.mkdir(TMP_DIR, { recursive: true });
            browser = await chromium.launch({
                headless: config.headless,
                slowMo: config.slowMo,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--start-maximized',
                ],
            });

            context = await browser.newContext({
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                viewport: config.headless ? { width: 1280, height: 800 } : null,
                acceptDownloads: true,
                locale: 'en-KE',
                timezoneId: 'Africa/Nairobi',
            });

            const page = await context.newPage();
            browserPage = page;

            page.on('dialog', async (dialog: Dialog) => {
                const message = dialog.message();
                submissionDialogMessages.push(message);
                console.log(`[TOT] Browser dialog: ${message}`);
                await dialog.accept();
            });

            await page.goto(KRA_PORTAL_URL, {
                waitUntil: 'domcontentloaded',
                timeout: 90_000,
            });
            await waitForPortalReadyWithReload(page, {
                description: 'KRA login page',
                selectors: ['#logid', '#loginButton', 'input[name="captcahText"]'],
                timeout: 20_000,
                reloadAttempts: 1,
            });

            await performKraLogin(page, config, runId);
            await navigationDelay();
            await navigateToTotUploadPage(page);
            await navigationDelay();
            await uploadTotZip(page, zipFilePath);
            await humanDelay(300, 700);

            const preSubmitError = await waitForMatchingPortalMessage(page, SUBMISSION_ERROR_PATTERNS, 2_000);
            if (preSubmitError) {
                throw new Error(preSubmitError);
            }

            const submitButton = page.locator('#submitBtn, input[value="Submit"], button:has-text("Submit"), a:has-text("Submit")').first();
            await submitButton.click();

            const postSubmitError = await waitForMatchingPortalMessage(page, SUBMISSION_ERROR_PATTERNS, 8_000);
            if (postSubmitError && !/receipt|acknowledg/i.test(postSubmitError)) {
                throw new Error(postSubmitError);
            }

            const { download, receiptNumber } = await waitForAcknowledgmentDownload(page);
            const tempReceiptPath = path.join(TMP_DIR, `tot-receipt-${runId}-${Date.now()}.pdf`);
            await download.saveAs(tempReceiptPath);

            const { receiptPath } = await storeReceiptLocally(tempReceiptPath, runId);
            await browser.close();

            return {
                success: true,
                message: receiptNumber
                    ? `ToT return filed successfully. Receipt Number: ${receiptNumber}`
                    : 'ToT return filed successfully.',
                receiptPath,
                receiptNumber,
                submissionDialogMessages,
            };
        } catch (error) {
            await captureFailureScreenshot(browserPage, runId);

            if (attempt < 2 && isRecoverablePortalError(error)) {
                console.warn(`[TOT] Recoverable portal failure on attempt ${attempt}: ${(error as Error).message}`);
                if (context) {
                    await context.close().catch(() => undefined);
                }
                if (browser) {
                    await browser.close().catch(() => undefined);
                }
                browserPage = null;
                continue;
            }

            if (context) {
                await context.close().catch(() => undefined);
            }
            if (browser) {
                await browser.close().catch(() => undefined);
            }

            const message = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                message,
                submissionDialogMessages,
            };
        }
    }

    return {
        success: false,
        message: 'ToT filing failed after retrying the portal session',
        submissionDialogMessages,
    };
}

async function main(): Promise<void> {
    const config = getConfig();
    const result = await runTotFilingWithRetry(config);

    if (result.success) {
        console.log(`[TOT] Success: ${result.message}`);
        if (result.receiptPath) {
            console.log(`[TOT] Receipt saved to: ${result.receiptPath}`);
        }
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    console.error(`[TOT] Failed: ${result.message}`);
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
}

main().catch((error) => {
    console.error('[TOT] Fatal error:', error);
    process.exit(1);
});