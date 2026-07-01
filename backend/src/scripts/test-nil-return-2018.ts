/**
 * test-nil-return-2018.ts
 *
 * Local, headed Playwright test script for filing a KRA nil return for 2018.
 *
 * Uses the same login flow as the production worker (`kraFilingWorker.ts`) and
 * the standalone TOT script (`file-kra-tot-return.ts`), but runs in a visible
 * Chrome window so you can watch every step.
 *
 * Run from the repo root:
 *   cd backend
 *   npx ts-node src/scripts/test-nil-return-2018.ts
 *
 * Env vars (optional - defaults are provided for the test PIN/password):
 *   KRA_PIN=A009694974S
 *   KRA_PASSWORD=9775792
 *   GEMMA4_API_KEY=...          # auto-solves login captcha; omit to enter manually
 *   GEMMA4_MODEL=gemma-4-31b-it
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import readline from 'readline';
import { chromium } from 'playwright';
import type { BrowserContext, Dialog, Page } from 'playwright';
import { execSync } from 'child_process';

const KRA_PORTAL_URL = 'https://itax.kra.go.ke/KRA-Portal/';
const NIL_RETURN_PAGE_URL = 'https://itax.kra.go.ke/KRA-Portal/eReturns.htm?actionCode=loadNilReturnPage';
const NIL_RETURN_SUBMIT_URL = 'https://itax.kra.go.ke/KRA-Portal/eReturns.htm?actionCode=fileNilReturnRequest';

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

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

const SUBMISSION_ERROR_PATTERNS = [
    /period\s+already\s+filed/i,
    /already\s+submitted/i,
    /session\s+has\s+timed\s+out/i,
    /session\s+expired/i,
    /page\s+re-submit/i,
];

type TestConfig = {
    kraPin: string;
    kraPassword: string;
    year: number;
    otpCode?: string;
};

function getConfig(): TestConfig {
    const kraPin = process.env.KRA_PIN?.trim() || 'A009694974S';
    const kraPassword = process.env.KRA_PASSWORD?.trim() || '9775792';
    const yearRaw = process.env.NIL_YEAR?.trim() || '2018';

    return {
        kraPin,
        kraPassword,
        year: parseInt(yearRaw, 10),
        otpCode: process.env.KRA_OTP_CODE?.trim() || undefined,
    };
}

function createRunId(): string {
    return `nil-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function killStaleChromium(): void {
    try {
        if (process.platform === 'win32') {
            execSync('taskkill /F /IM chrome.exe /T 2>nul || exit 0', { stdio: 'ignore' });
        } else {
            execSync('pkill -f "chrome --remote-debugging-pipe" 2>/dev/null || true', { stdio: 'ignore' });
        }
    } catch {
        // ignore cleanup failures
    }
}

async function launchBrowser(headless: boolean) {
    const baseOptions = {
        headless,
        slowMo: 200,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--start-maximized', '--disable-blink-features=AutomationControlled'],
    };

    // Prefer locally installed Google Chrome if available
    try {
        return await chromium.launch({ ...baseOptions, channel: 'chrome' as any });
    } catch (chromeErr: any) {
        console.log(`[NilReturn] Installed Chrome not available (${chromeErr.message}); falling back to bundled Chromium.`);
        return chromium.launch(baseOptions);
    }
}

function humanDelay(minMs = 500, maxMs = 1_400): Promise<void> {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function navigationDelay(): Promise<void> {
    return humanDelay(1_500, 3_000);
}

async function waitForAnySelector(page: Page, selectors: string[], timeout = 20_000): Promise<string | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const selector of selectors) {
            const found = await page.locator(selector).first().count().then((c) => c > 0).catch(() => false);
            if (found) return selector;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return null;
}

async function findMatchingPortalMessage(page: Page, patterns: RegExp[]): Promise<string | null> {
    const candidates = await page.evaluate(() => {
        const texts = new Set<string>();
        const selectors = ['#errorDiv', '.error-message', '.ui-message-error', '.ui-messages-error', '[id*="error"]', '[class*="error"]', 'font[color="red"]'];
        for (const selector of selectors) {
            document.querySelectorAll(selector).forEach((el) => {
                const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
                if (text) texts.add(text);
            });
        }
        (document.body?.innerText ?? '')
            .split(/\r?\n/)
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .forEach((line) => texts.add(line));
        return Array.from(texts);
    });
    return candidates.find((candidate) => patterns.some((pattern) => pattern.test(candidate))) ?? null;
}

async function waitForPortalReadyWithReload(
    page: Page,
    options: { description: string; selectors: string[]; timeout?: number; reloadAttempts?: number }
): Promise<void> {
    const { description, selectors, timeout = 20_000, reloadAttempts = 1 } = options;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= reloadAttempts; attempt += 1) {
        try {
            await page.waitForLoadState('domcontentloaded', { timeout });
            const errorSelectors = [...selectors, 'text=An Error Occured', 'text=session has timed out', 'text=page re-submit', 'text=Session Expired'];
            const matched = await waitForAnySelector(page, errorSelectors, timeout);

            if (matched && (matched.includes('Error Occured') || matched.includes('session has timed out') || matched.includes('page re-submit') || matched.includes('Session Expired'))) {
                throw new Error(`KRA displayed an error page while loading ${description}`);
            }
            if (matched) return;
            lastError = new Error(`${description} did not expose the expected UI controls`);
        } catch (error) {
            lastError = error as Error;
        }

        if (attempt < reloadAttempts) {
            console.warn(`[NilReturn] ${description} stalled; reloading page (attempt ${attempt + 1}/${reloadAttempts})`);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
            await navigationDelay();
        }
    }

    throw lastError ?? new Error(`${description} did not finish loading`);
}

function solveCaptcha(captchaText: string): number {
    const match = captchaText.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);
    if (!match) throw new Error(`Unable to parse captcha text: "${captchaText}"`);
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

async function promptForCaptchaAnswer(screenshotPath: string): Promise<string> {
    console.log(`\n[NilReturn] Captcha screenshot saved to: ${screenshotPath}`);
    console.log('[NilReturn] Please look at the visible Chrome window, read the Security Stamp arithmetic captcha, and type the answer below.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question('Captcha answer: ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function solveCaptchaWithGemma4(screenshotPath: string): Promise<string> {
    const gemma4ApiKey = process.env.GEMMA4_API_KEY;
    const gemma4Model = process.env.GEMMA4_MODEL ?? 'gemma-4-31b-it';

    if (!gemma4ApiKey) {
        throw new Error('GEMMA4_API_KEY is required for Gemma 4 captcha extraction');
    }

    const imageBuffer = await fs.readFile(screenshotPath);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(gemma4Model)}:generateContent?key=${encodeURIComponent(gemma4ApiKey)}`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
            generationConfig: { temperature: 0, maxOutputTokens: 32 },
        }),
    });

    if (!response.ok) {
        throw new Error(`Gemma 4 request failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const answerParts = parts.filter((p: any) => !p.thought && typeof p.text === 'string');
    const rawText = answerParts.length > 0 ? answerParts[answerParts.length - 1].text : '';

    const match = rawText.match(/expression\s*=\s*(\d+)\s*([\+\-\*\/])\s*(\d+)\s*;\s*answer\s*=\s*(-?\d+)/i);
    if (!match) {
        throw new Error(`Gemma 4 returned an unexpected captcha format: "${rawText}"`);
    }

    const expression = `${match[1]} ${match[2]} ${match[3]}`;
    const answer = match[4].trim();
    const expectedAnswer = String(solveCaptcha(expression));

    if (answer !== expectedAnswer) {
        throw new Error(`Gemma 4 answer mismatch: expression ${expression}, expected ${expectedAnswer}, got ${answer}`);
    }

    return answer;
}

async function solveLoginCaptcha(page: Page, runId: string): Promise<string> {
    // First try to read the stamp text directly from the DOM (sometimes rendered as text)
    try {
        const stampText = await page.$eval(
            '#securityStamp, .security-stamp, [id*="stamp"], img[src*="SecurityStamp"]',
            (el: any) => (el.textContent ?? '').trim()
        );
        if (stampText) {
            const match = stampText.match(/(\d+)\s*([+\-×x*])\s*(\d+)/);
            if (match) {
                const a = parseInt(match[1], 10);
                const op = match[2];
                const b = parseInt(match[3], 10);
                let answer = '';
                if (op === '+' || op === '×' || op === 'x' || op === '*') answer = String(a + b);
                else if (op === '-') answer = String(a - b);
                console.log(`[NilReturn] DOM arithmetic captcha: ${a} ${op} ${b} = ${answer}`);
                return answer;
            }
        }
    } catch {
        // fall through to screenshot
    }

    const captchaSelectors = ['#loginCaptcha', '#captchaImg', '#captcha_img', 'img[id*="captcha"]', 'img[src*="GenerateCaptcha"]', 'img[src*="captcha"]'];
    const screenshotPath = path.join(TMP_DIR, `captcha-element-${runId}.png`);
    let usedElementScreenshot = false;

    for (const selector of captchaSelectors) {
        const captchaElement = await page.$(selector);
        if (!captchaElement) continue;
        const box = await captchaElement.boundingBox();
        if (!box || box.width < 10 || box.height < 10) continue;
        await captchaElement.screenshot({ path: screenshotPath, type: 'png' });
        usedElementScreenshot = true;
        console.log(`[NilReturn] Captcha element screenshot saved via ${selector}: ${screenshotPath}`);
        break;
    }

    if (!usedElementScreenshot) {
        await page.screenshot({ path: screenshotPath, fullPage: false, type: 'png' });
        console.log(`[NilReturn] Captcha element not found; fell back to viewport screenshot: ${screenshotPath}`);
    }

    if (process.env.GEMMA4_API_KEY) {
        return solveCaptchaWithGemma4(screenshotPath);
    }

    return promptForCaptchaAnswer(screenshotPath);
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

async function performKraLogin(page: Page, config: TestConfig, runId: string): Promise<void> {
    console.log(`[NilReturn] Logging in with PIN ${config.kraPin}`);

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

    const postLoginSelector = await Promise.race([
        waitForAnySelector(page, [
            '#homePageLink',
            'a:has-text("Logout")',
            'a:has-text("Returns")',
            'text=Mobile Number Verification',
            'button:has-text("Send Verification Code")',
            'text=YOUR PASSWORD HAS EXPIRED!',
            'text=Change Password',
            'text=FIRST TIME LOGIN!',
        ], 20_000),
        waitForMatchingPortalMessage(page, LOGIN_FAILURE_PATTERNS, 20_000).then((msg) => {
            if (msg) throw new Error(msg);
            return null;
        }),
    ]);

    if (!postLoginSelector) {
        console.log('[NilReturn] Login taking too long; reloading KRA dashboard...');
        try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
        } catch {
            console.log('[NilReturn] Reload also timed out, continuing...');
        }

        const finalSelector = await waitForAnySelector(page, [
            '#homePageLink',
            'a:has-text("Logout")',
            'a:has-text("Returns")',
            'text=Mobile Number Verification',
            'button:has-text("Send Verification Code")',
        ], 15_000);

        if (!finalSelector) {
            throw new Error('Login succeeded, but the KRA dashboard or mobile verification prompt never appeared even after reload');
        }
    }

    if (postLoginSelector?.includes('PASSWORD HAS EXPIRED') || postLoginSelector?.includes('Change Password') || postLoginSelector?.includes('FIRST TIME LOGIN')) {
        throw new Error('KRA is requesting a password change. Automated password reset is not enabled in this test script.');
    }

    if (postLoginSelector?.includes('Mobile Number Verification') || postLoginSelector?.includes('Send Verification Code')) {
        await handleMobileVerification(page, config.otpCode);
    }

    console.log('[NilReturn] Login appears successful');
}

async function waitForMatchingPortalMessage(page: Page, patterns: RegExp[], timeout = 8_000): Promise<string | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const message = await findMatchingPortalMessage(page, patterns).catch(() => null);
        if (message) return message;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
}

async function handleMobileVerification(page: Page, providedOtpCode?: string): Promise<void> {
    console.log('[NilReturn] Mobile verification prompt detected');

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

    const otpCode = providedOtpCode ?? await promptForOtp();
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

async function promptForOtp(): Promise<string> {
    console.log('\n[NilReturn] KRA is asking for a mobile verification OTP.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question('Enter OTP: ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function navigateToNilReturnPage(page: Page): Promise<void> {
    console.log('[NilReturn] Navigating to File Nil Return page...');

    // Try direct URL first (matches the user's Python example)
    await page.goto(NIL_RETURN_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await navigationDelay();

    // If the page shows an error or redirects to dashboard, try clicking through the menu
    const currentUrl = page.url();
    if (!currentUrl.includes('eReturns.htm') || (await findMatchingPortalMessage(page, [/session has timed out/i, /page re-submit/i]))) {
        console.log('[NilReturn] Direct URL did not land on nil return page; trying Returns menu...');
        await page.goto(KRA_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await waitForPortalReadyWithReload(page, {
            description: 'KRA dashboard',
            selectors: ['#homePageLink', 'a:has-text("Logout")', 'a:has-text("Returns")'],
            timeout: 20_000,
            reloadAttempts: 1,
        });

        const returnsMenu = page.locator('#returns, a:has-text("Returns"), td:has-text("Returns") a, li:has-text("Returns") a').first();
        if (await returnsMenu.count() > 0) {
            await returnsMenu.hover();
            await page.waitForTimeout(1_500);
        }

        const nilReturnLink = page.locator('a[href*="nilReturn" i], a[href*="NilReturn" i], a:has-text("File Nil Return"), a:has-text("Nil Return")').filter({ visible: true }).first();
        if (await nilReturnLink.count() > 0) {
            await nilReturnLink.click();
        } else {
            await page.evaluate(() => {
                if (typeof (window as any).nilReturn === 'function') {
                    (window as any).nilReturn();
                } else if (typeof (window as any).showNilReturns === 'function') {
                    (window as any).showNilReturns();
                } else {
                    const el = document.querySelector('a[href*="nilReturn" i]') as HTMLElement;
                    if (el) el.click();
                }
            });
        }

        await page.waitForURL(/eReturns\.htm/, { timeout: 15_000 }).catch(() => undefined);
    }

    await waitForPortalReadyWithReload(page, {
        description: 'File Nil Return page',
        selectors: ['select[name="obligationId"]', 'select#regType', 'input[name="token_key"]', '#dwnlod_btn_tims'],
        timeout: 20_000,
        reloadAttempts: 1,
    });
}

async function fileNilReturnFor2018(page: Page, config: TestConfig): Promise<{ success: boolean; message: string; rawResponse?: string }> {
    console.log('[NilReturn] Extracting token_key from nil return page...');

    const tokenInput = await page.$('input[name="token_key"]');
    const token = tokenInput ? await tokenInput.getAttribute('value') : null;
    if (!token) {
        throw new Error('Could not find token_key on the nil return page');
    }
    console.log(`[NilReturn] token_key: ${token.slice(0, 16)}...`);

    // Inspect the obligation dropdown to pick the right value
    const obligationSelect = await page.$('select[name="obligationId"], select#obligationId, select#regType');
    const options = obligationSelect
        ? await obligationSelect.evaluate((sel: HTMLSelectElement) =>
            Array.from(sel.options).map((o) => ({ value: o.value, text: o.textContent ?? '' }))
          )
        : [];
    console.log('[NilReturn] Available obligations:', JSON.stringify(options, null, 2));

    // Default to "2" (Income Tax Resident Individual) per the user's example; fallback to first real option
    let obligationId = '2';
    const incomeTaxOption = options.find((o: any) => /Income Tax Resident Individual/i.test(o.text));
    if (incomeTaxOption) {
        obligationId = incomeTaxOption.value;
    } else if (options.length > 0) {
        obligationId = options.find((o: any) => o.value)?.value ?? options[0].value;
    }

    // Build the 2018 period strings in DD/MM/YYYY format (KRA usually expects this)
    const year = config.year;
    const periodFrom = `01/01/${year}`;
    const periodTo = `31/12/${year}`;

    const payload: Record<string, string> = {
        token_key: token,
        obligationId,
        taxpayerPin: config.kraPin,
        years: String(year),
        txtPeriodFrom: periodFrom,
        txtPeriodTo: periodTo,
        nilReturnFlag: 'Y',
        isFirstRet: 'N',
    };

    console.log('[NilReturn] Submitting nil return payload:', JSON.stringify(payload, null, 2));

    // The user's example uses requests; with Playwright we can either fill the form or POST via fetch.
    // Filling the visible form is safer because it preserves any JS state. Try that first.
    try {
        await page.selectOption('select[name="obligationId"], select#obligationId, select#regType', obligationId);
    } catch {
        console.log('[NilReturn] Could not select obligation via standard selector; will include it in POST body');
    }

    // Use page.request.fetch to keep the same browser context/cookies
    const response = await page.request.fetch(NIL_RETURN_SUBMIT_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': NIL_RETURN_PAGE_URL,
        },
        data: new URLSearchParams(payload).toString(),
    });

    const status = response.status();
    const body = await response.text();
    console.log(`[NilReturn] Submission HTTP status: ${status}`);

    // Check for common KRA error messages in the response body
    const lowerBody = body.toLowerCase();
    const errorMatch = SUBMISSION_ERROR_PATTERNS.find((pattern) => pattern.test(body));

    if (errorMatch) {
        return { success: false, message: `KRA rejected the submission: ${errorMatch.source}`, rawResponse: body };
    }

    if (lowerBody.includes('success') || lowerBody.includes('acknowledgement') || lowerBody.includes('receipt')) {
        return { success: true, message: 'Nil return submission appears successful', rawResponse: body };
    }

    return { success: false, message: 'Unexpected response; inspect rawResponse', rawResponse: body };
}

async function main(): Promise<void> {
    const config = getConfig();
    const runId = createRunId();
    let context: BrowserContext | null = null;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

    console.log('[NilReturn] ==================================================');
    console.log(`[NilReturn] Test run: ${runId}`);
    console.log(`[NilReturn] Filing nil return for year ${config.year}`);
    console.log(`[NilReturn] PIN: ${config.kraPin}`);
    console.log('[NilReturn] Chrome will be visible (headless=false)');
    console.log('[NilReturn] ==================================================');

    try {
        await fs.mkdir(TMP_DIR, { recursive: true });

        // Make sure no previous headed Chromium instance is holding the profile lock.
        console.log('[NilReturn] Cleaning up any stale Chromium processes...');
        killStaleChromium();
        await new Promise((resolve) => setTimeout(resolve, 1_000));

        const contextOptions = {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: null,
            acceptDownloads: true,
            locale: 'en-KE',
            timezoneId: 'Africa/Nairobi',
        };

        browser = await launchBrowser(false);
        context = await browser.newContext(contextOptions);

        const page = await context.newPage();
        page.on('dialog', async (dialog: Dialog) => {
            console.log(`[NilReturn] Browser dialog: ${dialog.message()}`);
            await dialog.accept();
        });

        await page.goto(KRA_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await waitForPortalReadyWithReload(page, {
            description: 'KRA login page',
            selectors: ['#logid', '#loginButton', 'input[name="captcahText"]'],
            timeout: 20_000,
            reloadAttempts: 1,
        });

        await performKraLogin(page, config, runId);
        await navigationDelay();
        await navigateToNilReturnPage(page);

        const result = await fileNilReturnFor2018(page, config);
        console.log('\n[NilReturn] ==================================================');
        console.log(`[NilReturn] Result: ${result.success ? 'SUCCESS' : 'FAILURE'}`);
        console.log(`[NilReturn] Message: ${result.message}`);
        console.log('[NilReturn] ==================================================\n');

        if (result.rawResponse) {
            const responseDumpPath = path.join(TMP_DIR, `nil-return-response-${runId}.html`);
            await fs.writeFile(responseDumpPath, result.rawResponse);
            console.log(`[NilReturn] Raw response saved to: ${responseDumpPath}`);
        }

        // Keep the browser open briefly so the user can inspect the final page
        console.log('[NilReturn] Browser will stay open for 60 seconds. Press Ctrl+C to close early.');
        await new Promise((resolve) => setTimeout(resolve, 60_000));
    } catch (error: any) {
        console.error('[NilReturn] Test failed:', error.message);
        console.error(error.stack);
        process.exitCode = 1;
    } finally {
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
    }
}

main();
