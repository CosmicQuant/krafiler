/**
 * file-paye-nil-april-2026.ts
 *
 * Playwright script to file a PAYE nil return for April 2026 and capture network traffic.
 * Measures total end-to-end time.
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { chromium } from 'playwright';
import type { BrowserContext, Dialog, Page } from 'playwright';
import { solveCaptchaWithGemma4Buffer } from '../workers/utils/captcha';

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

function getConfig() {
    return {
        kraPin: process.env.KRA_PIN?.trim() || 'P051699440T',
        kraPassword: process.env.KRA_PASSWORD?.trim() || 'Quriah1!',
        otpCode: process.env.KRA_OTP_CODE?.trim() || undefined,
    };
}

function createRunId(): string {
    return `paye-nil-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function launchBrowser(headless: boolean) {
    const baseOptions = {
        headless,
        slowMo: 200,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--start-maximized', '--disable-blink-features=AutomationControlled'],
    };
    try {
        return await chromium.launch({ ...baseOptions, channel: 'chrome' as any });
    } catch {
        return chromium.launch(baseOptions);
    }
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

async function waitForMatchingPortalMessage(page: Page, patterns: RegExp[], timeout = 8_000): Promise<string | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const message = await findMatchingPortalMessage(page, patterns).catch(() => null);
        if (message) return message;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
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
            console.warn(`[PAYENil] ${description} stalled; reloading page (attempt ${attempt + 1}/${reloadAttempts})`);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
            await new Promise((resolve) => setTimeout(resolve, 1_500));
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

async function solveLoginCaptcha(page: Page, runId: string): Promise<string> {
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
        console.log(`[PAYENil] Captcha element screenshot saved via ${selector}: ${screenshotPath}`);
        break;
    }
    if (!usedElementScreenshot) {
        await page.screenshot({ path: screenshotPath, fullPage: false, type: 'png' });
        console.log(`[PAYENil] Captcha element not found; fell back to viewport screenshot: ${screenshotPath}`);
    }

    const imageBuffer = await fs.readFile(screenshotPath);
    const answer = await solveCaptchaWithGemma4Buffer(imageBuffer, {
        job: { log: async (entry: string) => console.log('[CAPTCHA]', entry), updateProgress: async () => {} } as any,
    });
    return answer;
}

async function performKraLogin(page: Page, config: ReturnType<typeof getConfig>, runId: string): Promise<void> {
    console.log(`[PAYENil] Logging in with PIN ${config.kraPin}`);
    await page.waitForSelector('#logid', { timeout: 20_000 });
    await page.fill('#logid', config.kraPin);

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

    await page.fill('input[type="password"]', config.kraPassword);
    const captchaAnswer = await solveLoginCaptcha(page, runId);
    console.log(`[PAYENil] CAPTCHA answer: ${captchaAnswer}`);
    await page.fill('input[name="captcahText"]', captchaAnswer);
    await page.click('#loginButton');

    const postLoginSelector = await Promise.race([
        waitForAnySelector(page, [
            '#homePageLink',
            'a:has-text("Logout")',
            'a:has-text("Returns")',
            'text=Mobile Number Verification',
            'button:has-text("Send Verification Code")',
            'text=YOUR PASSWORD HAS EXPIRED!',
            'text=FIRST TIME LOGIN!',
        ], 20_000),
        waitForMatchingPortalMessage(page, LOGIN_FAILURE_PATTERNS, 20_000).then((msg) => {
            if (msg) throw new Error(msg);
            return null;
        }),
    ]);

    if (!postLoginSelector) {
        throw new Error('Login succeeded, but the KRA dashboard never appeared');
    }

    if (postLoginSelector?.includes('PASSWORD HAS EXPIRED') || postLoginSelector?.includes('FIRST TIME LOGIN')) {
        throw new Error('KRA is requesting a password change.');
    }

    if (postLoginSelector?.includes('Mobile Number Verification') || postLoginSelector?.includes('Send Verification Code')) {
        // Minimal OTP handling - not expected for this test
        throw new Error('Mobile verification required; provide KRA_OTP_CODE');
    }

    console.log('[PAYENil] Login appears successful');
}

async function filePayeNilReturn(page: Page, config: ReturnType<typeof getConfig>, runId: string) {
    console.log('[PAYENil] Navigating to File Nil Return page...');
    await page.goto(NIL_RETURN_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    await waitForPortalReadyWithReload(page, {
        description: 'File Nil Return page',
        selectors: ['select[name="obligationId"]', 'select#regType', 'input[name="token_key"]', '#dwnlod_btn_tims'],
        timeout: 20_000,
        reloadAttempts: 1,
    });

    const tokenInput = await page.$('input[name="token_key"]');
    const token = tokenInput ? await tokenInput.getAttribute('value') : null;
    if (!token) {
        throw new Error('Could not find token_key on the nil return page');
    }
    console.log(`[PAYENil] token_key: ${token.slice(0, 16)}...`);

    const obligationSelect = await page.$('select[name="obligationId"], select#obligationId, select#regType');
    const options = obligationSelect
        ? await obligationSelect.evaluate((sel: HTMLSelectElement) =>
            Array.from(sel.options).map((o) => ({ value: o.value, text: o.textContent ?? '' }))
          )
        : [];
    console.log('[PAYENil] Available obligations:', JSON.stringify(options, null, 2));

    const payeOption = options.find((o: any) => /paye/i.test(o.text));
    if (!payeOption) {
        throw new Error('PAYE obligation not found in dropdown');
    }
    const obligationId = payeOption.value;
    console.log(`[PAYENil] Selected PAYE obligation: ${obligationId} - ${payeOption.text}`);

    // Inspect form fields to determine period input format
    const formHtml = await page.evaluate(() => document.querySelector('form')?.outerHTML ?? '');
    const formFieldsPath = path.join(TMP_DIR, `paye-nil-form-${runId}.html`);
    await fs.writeFile(formFieldsPath, formHtml);
    console.log(`[PAYENil] Form HTML saved to: ${formFieldsPath}`);

    const periodFrom = '01/04/2026';
    const periodTo = '30/04/2026';

    const payload: Record<string, string> = {
        token_key: token,
        obligationId,
        taxpayerPin: config.kraPin,
        years: '2026',
        txtPeriodFrom: periodFrom,
        txtPeriodTo: periodTo,
        nilReturnFlag: 'Y',
        isFirstRet: 'N',
    };

    // Add any other visible form fields we discover
    const allInputs = await page.$$eval('input, select, textarea', (elements) =>
        elements.map((el) => ({ name: (el as any).name, id: el.id, value: (el as any).value, tag: el.tagName }))
    );
    console.log('[PAYENil] All form fields:', JSON.stringify(allInputs, null, 2));

    console.log('[PAYENil] Submitting nil return payload:', JSON.stringify(payload, null, 2));

    try {
        await page.selectOption('select[name="obligationId"], select#obligationId, select#regType', obligationId);
    } catch {
        console.log('[PAYENil] Could not select obligation via standard selector; will include it in POST body');
    }

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
    console.log(`[PAYENil] Submission HTTP status: ${status}`);

    const lowerBody = body.toLowerCase();
    const errorPatterns = [
        /period\s+already\s+filed/i,
        /already\s+submitted/i,
        /session\s+has\s+timed\s+out/i,
        /session\s+expired/i,
        /page\s+re-submit/i,
    ];
    const errorMatch = errorPatterns.find((pattern) => pattern.test(body));

    if (errorMatch) {
        return { success: false, message: `KRA rejected the submission: ${errorMatch.source}`, rawResponse: body };
    }

    if (lowerBody.includes('success') || lowerBody.includes('acknowledgement') || lowerBody.includes('receipt') || lowerBody.includes('submitted successfully')) {
        return { success: true, message: 'Nil return submission appears successful', rawResponse: body };
    }

    return { success: false, message: 'Unexpected response; inspect rawResponse', rawResponse: body };
}

async function main(): Promise<void> {
    const config = getConfig();
    const runId = createRunId();
    let context: BrowserContext | null = null;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    const requests: any[] = [];
    const startTime = Date.now();

    console.log('[PAYENil] ==================================================');
    console.log(`[PAYENil] Test run: ${runId}`);
    console.log(`[PAYENil] Filing PAYE nil return for April 2026`);
    console.log(`[PAYENil] PIN: ${config.kraPin}`);
    console.log('[PAYENil] ==================================================');

    try {
        await fs.mkdir(TMP_DIR, { recursive: true });
        browser = await launchBrowser(false);
        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: null,
            acceptDownloads: true,
            locale: 'en-KE',
            timezoneId: 'Africa/Nairobi',
        });

        const page = await context.newPage();
        page.on('dialog', async (dialog: Dialog) => {
            console.log(`[PAYENil] Browser dialog: ${dialog.message()}`);
            await dialog.accept();
        });

        // Capture all network requests
        page.on('request', (request) => {
            requests.push({
                url: request.url(),
                method: request.method(),
                headers: request.headers(),
                postData: request.postData(),
                timestamp: Date.now() - startTime,
            });
        });

        await page.goto(KRA_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await waitForPortalReadyWithReload(page, {
            description: 'KRA login page',
            selectors: ['#logid', '#loginButton', 'input[name="captcahText"]'],
            timeout: 20_000,
            reloadAttempts: 1,
        });

        await performKraLogin(page, config, runId);
        await new Promise((resolve) => setTimeout(resolve, 2_000));

        const result = await filePayeNilReturn(page, config, runId);
        const totalMs = Date.now() - startTime;
        const totalSeconds = (totalMs / 1000).toFixed(2);

        console.log('\n[PAYENil] ==================================================');
        console.log(`[PAYENil] Result: ${result.success ? 'SUCCESS' : 'FAILURE'}`);
        console.log(`[PAYENil] Message: ${result.message}`);
        console.log(`[PAYENil] Total time: ${totalSeconds}s (${totalMs}ms)`);
        console.log('[PAYENil] ==================================================\n');

        const responseDumpPath = path.join(TMP_DIR, `paye-nil-response-${runId}.html`);
        await fs.writeFile(responseDumpPath, result.rawResponse ?? '<no response>');
        console.log(`[PAYENil] Raw response saved to: ${responseDumpPath}`);

        const requestsDumpPath = path.join(TMP_DIR, `paye-nil-requests-${runId}.json`);
        await fs.writeFile(requestsDumpPath, JSON.stringify(requests, null, 2));
        console.log(`[PAYENil] Captured network requests saved to: ${requestsDumpPath}`);

        console.log('[PAYENil] Browser will stay open for 30 seconds.');
        await new Promise((resolve) => setTimeout(resolve, 30_000));
    } catch (error: any) {
        const totalMs = Date.now() - startTime;
        console.error(`[PAYENil] Test failed after ${(totalMs / 1000).toFixed(2)}s:`, error.message);
        console.error(error.stack);
        const requestsDumpPath = path.join(TMP_DIR, `paye-nil-requests-${runId}.json`);
        await fs.writeFile(requestsDumpPath, JSON.stringify(requests, null, 2)).catch(() => undefined);
        console.log(`[PAYENil] Captured network requests saved to: ${requestsDumpPath}`);
        process.exitCode = 1;
    } finally {
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
    }
}

main();
