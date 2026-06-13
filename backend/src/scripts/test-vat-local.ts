/**
 * test-vat-local.ts
 *
 * Local VAT filing test script that mirrors the worker's prepareVatOnly flow.
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

const GEMMA4_API_KEY = process.env.GEMMA4_API_KEY ?? '';
const GEMMA4_MODEL = process.env.GEMMA4_MODEL ?? 'gemma-4-31b-it';

const KRA_PIN = 'A003102127T';
const KRA_PASSWORD = '07239368870';
const CLIENT_NAME = 'Test_Client';
const PERIOD_FROM = '2026-04-01';
const PERIOD_TO = '2026-04-30';
const VAT_PREVIOUS_CREDIT = 0;

const jobId = `local-${Date.now()}`;

async function log(message: string) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${jobId}] ${message}`;
    console.log(line);
    const logPath = path.join(TMP_DIR, `${jobId}.log`);
    await fs.mkdir(TMP_DIR, { recursive: true });
    await fs.appendFile(logPath, line + '\n');
}

async function solveCaptchaWithGemma4(screenshotPath: string): Promise<string> {
    const imageBuffer = await fs.readFile(screenshotPath);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMMA4_MODEL)}:generateContent?key=${encodeURIComponent(GEMMA4_API_KEY)}`;

    // Try up to 3 times with better prompts
    for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: 'You are solving a KRA iTax login captcha. The image shows a simple arithmetic math problem with two numbers and an operator (+ or -).\n\nCRITICAL INSTRUCTIONS:\n1. Look at the image and identify the arithmetic expression\n2. Solve the math problem\n3. Return ONLY the final numeric answer as a plain number\n4. Do NOT include any explanation, text, or formatting\n5. Do NOT describe the image or the problem\n6. Just return the number, nothing else\n\nExample: if the image shows "24 - 11", return "13"\nExample: if the image shows "68 + 13", return "81"' },
                        { inline_data: { mime_type: 'image/png', data: imageBuffer.toString('base64') } },
                    ],
                }],
                generationConfig: { maxOutputTokens: 100, temperature: 0 },
            }),
        });

        if (!response.ok) {
            throw new Error(`Gemma 4 request failed (${response.status}): ${await response.text()}`);
        }

        const payload = await response.json();
        const parts = payload.candidates?.[0]?.content?.parts ?? [];
        
        // Log all parts for debugging
        await log(`Gemma 4 response parts: ${JSON.stringify(parts)}`);
        
        // Try non-thought parts first
        let rawText = parts.filter((p: any) => !p.thought && typeof p.text === 'string').map((p: any) => p.text).join(' ').trim();
        
        // If no answer, try thought parts
        if (!rawText) {
            rawText = parts.filter((p: any) => p.thought && typeof p.text === 'string').map((p: any) => p.text).join(' ').trim();
        }
        
        // If still no answer, just use all parts
        if (!rawText) {
            rawText = parts.map((p: any) => p.text).join(' ').trim();
        }

        // Try to parse a math expression from the text and calculate it ourselves
        // Sometimes Gemma 4 returns the expression like "24 - 11" instead of the answer
        const expressionMatch = rawText.match(/(\d+)\s*([+\-×x*])\s*(\d+)/);
        if (expressionMatch) {
            const a = parseInt(expressionMatch[1], 10);
            const op = expressionMatch[2];
            const b = parseInt(expressionMatch[3], 10);
            let answer: number;
            if (op === '+' || op === '×' || op === 'x' || op === '*') {
                answer = a + b;
            } else if (op === '-') {
                answer = a - b;
            } else {
                answer = 0;
            }
            await log(`Gemma 4 parsed expression: ${a} ${op} ${b} = ${answer} (attempt ${attempt})`);
            return String(answer);
        }

        // Extract the first number from the text (the answer should be the first thing if it followed instructions)
        const numbers = rawText.match(/^\d{1,4}/);
        if (numbers && numbers.length > 0) {
            const answer = numbers[0];
            await log(`Gemma 4 solved captcha: ${answer} (attempt ${attempt})`);
            return answer;
        }
        
        await log(`Gemma 4 attempt ${attempt} returned invalid: "${rawText}"`);
    }

    throw new Error(`Gemma 4 failed to solve captcha after 3 attempts`);
}

async function launchBrowser() {
    const launchOptions = {
        headless: false,
        slowMo: 0,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
        ],
    };
    const contextOptions = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: null,
        acceptDownloads: true,
        locale: 'en-KE',
        timezoneId: 'Africa/Nairobi',
    };
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const exe of candidates) {
        try {
            await fs.access(exe);
            await log(`Launching browser: ${exe}`);
            const context = await chromium.launchPersistentContext(
                path.join(TMP_DIR, 'browser-profile'),
                { ...launchOptions, ...contextOptions, executablePath: exe }
            );
            await log('Browser launched');
            const page = context.pages()[0] ?? (await context.newPage());
            return { browserContext: context, page, close: async () => context.close() };
        } catch { continue; }
    }
    throw new Error('No local browser found');
}

async function performKraLogin(page: any, kraPin: string, kraPassword: string): Promise<void> {
    await log('Waiting for login page...');
    await page.waitForSelector('#logid', { timeout: 15_000 });
    await log('Login page ready');

    await log('Entering PIN...');
    await page.fill('#logid', kraPin);

    await log('Clicking Continue...');
    const continueBtn = await page.$('a[href="javascript:CheckPIN();"]');
    if (continueBtn) {
        await continueBtn.click();
    } else {
        await page.evaluate(() => { (globalThis as any).CheckPIN(); });
    }

    await log('Waiting for password field...');
    const passwordVisible = await page.waitForSelector('input[type="password"]:visible', { timeout: 30_000 }).then(() => true).catch(() => false);
    if (!passwordVisible) {
        throw new Error('Password section did not appear after CheckPIN()');
    }
    await log('Password field appeared');

    await log('Entering password...');
    await page.fill('input[type="password"]', kraPassword);

    await log('Solving captcha...');
    await page.waitForSelector('input[name="captcahText"]', { timeout: 10_000 });

    let captchaAnswer = '';
    const screenPath = path.join(TMP_DIR, `captcha-${jobId}.png`);

    // Try DOM text first
    try {
        const bodyText = await page.evaluate(() => document.body.innerText || '');
        const match = bodyText.match(/(\d+)\s*([+\-×x*])\s*(\d+)\s*\?/);
        if (match) {
            const a = parseInt(match[1], 10);
            const op = match[2];
            const b = parseInt(match[3], 10);
            if (op === '+' || op === '×' || op === 'x' || op === '*') {
                captchaAnswer = String(a + b);
            } else if (op === '-') {
                captchaAnswer = String(a - b);
            }
            await log(`DOM arithmetic captcha: ${a} ${op} ${b} = ${captchaAnswer}`);
        }
    } catch { /* continue to screenshot */ }

    // Screenshot + Gemma 4 fallback
    if (!captchaAnswer) {
        const el = await page.$('#loginCaptcha, #captchaImg, img[src*="captcha"], img[src*="GenerateCaptcha"]');
        if (el) {
            const box = await el.boundingBox();
            if (box && box.width >= 10 && box.height >= 10) {
                await el.screenshot({ path: screenPath, type: 'png' });
            } else {
                await page.screenshot({ path: screenPath, type: 'png' });
            }
        } else {
            await page.screenshot({ path: screenPath, type: 'png' });
        }
        await log(`Captcha screenshot saved: ${screenPath}`);

        try {
            captchaAnswer = await solveCaptchaWithGemma4(screenPath);
            await log(`Gemma 4 solved captcha: ${captchaAnswer}`);
        } catch (e: any) {
            throw new Error(`Captcha solving failed: ${e.message}`);
        }
    }

    await page.fill('input[name="captcahText"]', captchaAnswer);
    await log('Submitting login...');
    await page.click('#loginButton');

    // Wait for dashboard
    const dashboardSelectors = [
        'a[href="eReturns.htm"]',
        'a[href="logout.htm"]',
        'a[href="javascript:logout()"]',
        '#logout',
        'text=Dashboard',
        'text=Returns',
    ];
    const deadline = Date.now() + 18_000;
    while (Date.now() < deadline) {
        for (const sel of dashboardSelectors) {
            const visible = await page.locator(sel).first().isVisible().catch(() => false);
            if (visible) {
                await log('Dashboard detected, login successful');
                return;
            }
        }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('Post-login dashboard did not appear');
}

async function extractVatCreditBroughtForward(page: any, browserContext: any): Promise<number> {
    await log('Navigating to View Filed Returns to extract credit brought forward...');

    // Hover Returns menu and click View Filed Return
    const returnsMenu = page.locator('a:has-text("Returns")').first();
    await returnsMenu.hover();
    await page.waitForTimeout(1_500);

    await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of Array.from(links)) {
            if (link.textContent?.includes('View Filed Return')) {
                link.click();
                break;
            }
        }
    });
    await page.waitForTimeout(5_000);
    await log('Clicked View Filed Return');

    // Select VAT from Tax Obligation dropdown
    const allSelects = await page.locator('select').all();
    let obligationSelect: any = null;
    for (const sel of allSelects) {
        const isDisabled = await sel.isDisabled().catch(() => true);
        if (isDisabled) continue;
        try {
            const options = await sel.evaluate((el: HTMLSelectElement) => Array.from(el.options).map(o => o.text));
            if (options.some((o: string) => o.includes('Value Added Tax'))) {
                obligationSelect = sel;
                break;
            }
        } catch { continue; }
    }
    if (!obligationSelect) {
        throw new Error('Could not find Tax Obligation dropdown with VAT option');
    }
    await obligationSelect.selectOption({ label: 'Value Added Tax (VAT)' });
    await log('Selected VAT from Tax Obligation dropdown');
    await page.waitForTimeout(1_000);

    // Set up dialog handler BEFORE clicking — KRA shows "Do you want to view returns?"
    let dialogHandled = false;
    page.on('dialog', async (dialog: any) => {
        dialogHandled = true;
        const msg = dialog.message();
        await log(`KRA dialog: "${msg}" (type: ${dialog.type()})`);
        if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
            await dialog.accept();
            await log('Accepted dialog');
        } else {
            await dialog.dismiss();
        }
    });

    // Click Consult button via JavaScript
    await page.evaluate(() => {
        const btn = document.querySelector('input[value="Consult"]') as HTMLInputElement;
        if (btn) {
            btn.focus();
            btn.click();
            return true;
        }
        return false;
    });
    await log('Clicked Consult button via JS');
    await page.waitForTimeout(5_000);

    // Remove dialog handler
    page.removeAllListeners('dialog');

    if (dialogHandled) {
        await log('Dialog handled, waiting for table to load...');
    } else {
        await log('No dialog appeared, waiting for table to load...');
    }

    // Wait for table to load with retry logic
    let tableFound = false;
    let tableCount = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
        await page.waitForTimeout(5_000);
        tableCount = await page.locator('table').count();
        if (tableCount > 0) {
            tableFound = true;
            await log(`Found ${tableCount} table(s) on page after ${(attempt + 1) * 5}s`);
            break;
        }
        await log(`Table not found yet, waiting... (attempt ${attempt + 1}/10)`);
    }

    if (!tableFound) {
        // Take screenshot for debugging
        const debugPath = path.join(TMP_DIR, `vat-table-missing-${jobId}.png`);
        await page.screenshot({ path: debugPath, fullPage: true });
        await log(`Table missing screenshot: ${debugPath}`);
        throw new Error('No filed returns table found after clicking Consult');
    }

    // Click View on most recent filing (first row) — scope to table only
    await log('Looking for View links in filed returns table...');
    const viewLinks = await page.locator('table a:has-text("View"), table input[value="View"], table a[href*="view"]').all();
    if (viewLinks.length === 0) {
        throw new Error('No View links found in filed returns table');
    }
    await log(`Found ${viewLinks.length} View link(s) in table`);

    // Listen for new window BEFORE clicking View
    await log('Clicking View on most recent filing...');
    const newPagePromise = browserContext.waitForEvent('page', { timeout: 30_000 });
    await viewLinks[0].click({ force: true });
    await log('Waiting for new window to open...');
    const newPage = await newPagePromise;
    await newPage.waitForLoadState('domcontentloaded', { timeout: 30_000 });
    await log(`New window opened: ${newPage.url()}`);
    await newPage.waitForTimeout(3_000);

    // Use new page for credit extraction
    page = newPage;

    // Scroll to bottom and find credit value
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2_000);

    // Take screenshot of the new window for debugging
    const creditScreenshotPath = path.join(TMP_DIR, `vat-credit-${jobId}.png`);
    await page.screenshot({ path: creditScreenshotPath, fullPage: true });
    await log(`Credit extraction screenshot saved: ${creditScreenshotPath}`);

    const creditRow = page.locator('tr:has-text("Net VAT Payable / Credit Carried Forward")').first();
    let creditValue: number | null = null;

    if (await creditRow.count() > 0) {
        // Get all cells in the row
        const cells = await creditRow.locator('td').all();
        if (cells.length > 0) {
            // The value is in the LAST cell (rightmost column - Amount)
            const lastCell = cells[cells.length - 1];
            const text = await lastCell.textContent();
            await log(`Credit row last cell text: "${text}"`);
            const match = text?.match(/-?\d{1,3}(,\d{3})*(\.\d+)?/);
            if (match) {
                creditValue = parseFloat(match[0].replace(/,/g, ''));
                await log(`Extracted raw credit value from last cell: ${creditValue}`);
            }
        }
    } else {
        await log('Credit row not found, trying fallback selectors...');
        // Try alternative selectors
        const altRow = page.locator('td:has-text("Net VAT Payable / Credit Carried Forward")').first();
        if (await altRow.count() > 0) {
            const parentRow = altRow.locator('..');
            const cells = await parentRow.locator('td').all();
            if (cells.length > 0) {
                const lastCell = cells[cells.length - 1];
                const text = await lastCell.textContent();
                const match = text?.match(/-?\d{1,3}(,\d{3})*(\.\d+)?/);
                if (match) {
                    creditValue = parseFloat(match[0].replace(/,/g, ''));
                }
            }
        }
    }

    if (creditValue === null) {
        throw new Error('Could not extract credit carried forward value');
    }

    // Only use negative values as credit (positive means payable, not credit)
    const credit = creditValue < 0 ? Math.abs(creditValue) : 0;

    await log(`Extracted credit carried forward: KES ${credit}`);

    // Close new window and switch back to original page
    await newPage.close();
    await log('Closed new window, switched back to original page');

    return credit;
}

async function extractVatWithholding(page: any): Promise<number> {
    await log('Navigating to Reprint VAT Withholding Certificate...');

    // Parse period to get month and year
    const periodDate = new Date(PERIOD_FROM);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const targetMonth = monthNames[periodDate.getMonth()];
    const targetYear = String(periodDate.getFullYear());

    await log(`Looking for withholding for ${targetMonth} ${targetYear}`);

    // Hover Certificates menu
    const certificatesMenu = page.locator('a:has-text("Certificates")').first();
    await certificatesMenu.hover();
    await page.waitForTimeout(1_500);

    // Click Reprint VAT Withholding Certificate
    await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of Array.from(links)) {
            if (link.textContent?.includes('Reprint VAT Withholding Certificate')) {
                link.click();
                break;
            }
        }
    });
    await page.waitForTimeout(5_000);
    await log('Clicked Reprint VAT Withholding Certificate');

    // Take screenshot to see the page state
    const debugPath = path.join(TMP_DIR, `vat-withholding-debug-${jobId}.png`);
    await page.screenshot({ path: debugPath, fullPage: true });
    await log(`Withholding page screenshot: ${debugPath}`);

    // Select Month and Year from dropdowns - use Playwright locators
    let monthSelected = false;
    let yearSelected = false;

    // Try to find month dropdown by looking for options with month names
    for (let i = 0; i < 5; i++) {
        const select = page.locator('select').nth(i);
        const count = await select.count();
        if (count === 0) continue;

        const options = await select.evaluate((el: HTMLSelectElement) =>
            Array.from(el.options).map(o => ({ text: o.text, value: o.value }))
        );

        // Check if this is a month dropdown
        const hasMonths = options.some((o: any) => monthNames.some(m => o.text.includes(m) || o.value.includes(m)));
        if (hasMonths && !monthSelected) {
            await select.selectOption({ label: targetMonth });
            await log(`Selected month: ${targetMonth} (dropdown index ${i})`);
            monthSelected = true;
            continue;
        }

        // Check if this is a year dropdown
        const hasYears = options.some((o: any) => /^\d{4}$/.test(o.text) || /^\d{4}$/.test(o.value));
        if (hasYears && !yearSelected) {
            await select.selectOption({ label: targetYear });
            await log(`Selected year: ${targetYear} (dropdown index ${i})`);
            yearSelected = true;
        }
    }

    if (!monthSelected || !yearSelected) {
        await log('WARNING: Could not detect month/year dropdowns, trying fallback selectors');
        // Try specific selectors
        const monthSel = page.locator('select[name*="month" i], select[id*="month" i], select[name*="mon" i]').first();
        const yearSel = page.locator('select[name*="year" i], select[id*="year" i], select[name*="yr" i]').first();

        if (await monthSel.count() > 0 && !monthSelected) {
            await monthSel.selectOption({ label: targetMonth });
            await log(`Selected month via fallback: ${targetMonth}`);
            monthSelected = true;
        }
        if (await yearSel.count() > 0 && !yearSelected) {
            await yearSel.selectOption({ label: targetYear });
            await log(`Selected year via fallback: ${targetYear}`);
            yearSelected = true;
        }
    }

    await page.waitForTimeout(1_000);

    if (!monthSelected || !yearSelected) {
        await log('ERROR: Failed to select month or year, reloading page and retrying...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(3_000);
        // Return 0 and let the main flow continue
        return 0;
    }

    // Set up dialog handler BEFORE clicking Consult
    let dialogHandled = false;
    page.on('dialog', async (dialog: any) => {
        dialogHandled = true;
        const msg = dialog.message();
        await log(`KRA withholding dialog: "${msg}" (type: ${dialog.type()})`);
        if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
            await dialog.accept();
            await log('Accepted dialog');
        } else {
            await dialog.dismiss();
        }
    });

    // Click Consult button
    await page.evaluate(() => {
        const btn = document.querySelector('input[value="Consult"]') as HTMLInputElement;
        if (btn) {
            btn.focus();
            btn.click();
            return true;
        }
        return false;
    });
    await log('Clicked Consult button for withholding');

    // Wait for navigation to complete
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(5_000);

    // Remove dialog handler
    page.removeAllListeners('dialog');

    if (dialogHandled) {
        await log('Dialog handled, waiting for results...');
    } else {
        await log('No dialog appeared, waiting for results...');
    }
    await page.waitForTimeout(10_000);

    // Check for "Records Not Found"
    const pageText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
    if (pageText.includes('Records Not Found')) {
        await log('No withholding records found for this period');
        return 0;
    }

    // Try to extract Total VAT Withholding Amount from DOM
    let withholdingAmount: number | null = null;

    // Look for text containing "Total VAT Withholding Amount"
    const totalMatch = pageText.match(/Total VAT Withholding Amount\s*[:\-]?\s*([\d,]+\.?\d*)/i);
    if (totalMatch) {
        withholdingAmount = parseFloat(totalMatch[1].replace(/,/g, ''));
        await log(`Extracted withholding amount from DOM: ${withholdingAmount}`);
    }

    if (withholdingAmount === null) {
        // Fallback: screenshot + Gemma 4
        const screenshotPath = path.join(TMP_DIR, `vat-withholding-${jobId}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await log(`Withholding screenshot saved: ${screenshotPath}`);

        try {
            const imageBuffer = await fs.readFile(screenshotPath);
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMMA4_MODEL)}:generateContent?key=${encodeURIComponent(GEMMA4_API_KEY)}`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: 'Find the "Total VAT Withholding Amount" value in this screenshot. Return ONLY the numeric value. If no records found, return "0".' },
                            { inline_data: { mime_type: 'image/png', data: imageBuffer.toString('base64') } },
                        ],
                    }],
                    generationConfig: { maxOutputTokens: 50, temperature: 0 },
                }),
            });
            if (!response.ok) {
                await log(`Gemma 4 request failed: ${response.status}`);
            } else {
                const payload = await response.json();
                const parts = payload.candidates?.[0]?.content?.parts ?? [];
                const rawText = parts.filter((p: any) => !p.thought && typeof p.text === 'string').map((p: any) => p.text).join(' ').trim();
                const match = rawText.match(/\d{1,3}(,\d{3})*(\.\d+)?/);
                if (match) {
                    withholdingAmount = parseFloat(match[0].replace(/,/g, ''));
                    await log(`Extracted withholding amount from Gemma 4: ${withholdingAmount}`);
                }
            }
        } catch (e: any) {
            await log(`Gemma 4 error: ${e.message}`);
        }
    }

    if (withholdingAmount === null) {
        withholdingAmount = 0;
        await log('Could not extract withholding amount, defaulting to 0');
    }

    await log(`Total VAT Withholding Amount: KES ${withholdingAmount}`);
    return withholdingAmount;
}

async function downloadVatAutoPopulatedReturn(page: any, kraPin: string): Promise<string> {
    // Set up dialog handler BEFORE clicking
    let dialogAccepted = false;
    const dialogHandler = async (dialog: any) => {
        const message = dialog.message();
        await log(`KRA download dialog: "${message}" (type: ${dialog.type()})`);
        if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
            await dialog.accept();
            dialogAccepted = true;
            await log('Accepted download dialog');
        } else {
            await dialog.dismiss();
        }
    };
    page.on('dialog', dialogHandler);

    const sourceZipPath = path.join(TMP_DIR, `${Date.now()}_${kraPin}_VAT_source.zip`);

    // Try native browser download capture first
    let download: any = null;
    try {
        const trigger = page.locator('#dwnlod_btn_tims').first();
        [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            trigger.click({ force: true }).catch(() => trigger.click()),
        ]);
        await download.saveAs(sourceZipPath);
        await log(`Downloaded VAT package: ${sourceZipPath}`);
        page.off('dialog', dialogHandler);
        return sourceZipPath;
    } catch (primaryErr: any) {
        await log(`Primary download capture failed: ${primaryErr.message}. Trying JS fallback...`);
    }

    // Fallback: trigger via JS and capture response
    let capturedBuffer: Buffer | null = null;
    let capturedFilename = `${Date.now()}_${kraPin}_VAT_source.zip`;
    let captured = false;

    const responseHandler = async (response: any) => {
        const url = response.url();
        const headers = response.headers();
        const cd = headers['content-disposition'] || '';
        if (!cd.includes('attachment') && !url.includes('downloadAmendmentForm')) return;
        try {
            const buffer = await response.body();
            capturedBuffer = buffer;
            const filenameMatch = cd.match(/filename="([^"]+)"/);
            if (filenameMatch) {
                capturedFilename = filenameMatch[1].replace(/[:\/\\*?"<>|]/g, '_');
            }
            captured = true;
            await log(`Captured VAT download response: ${buffer.length} bytes`);
        } catch {}
    };
    page.on('response', responseHandler);

    try {
        await page.evaluate(() => {
            if (typeof (window as any).downloadAmendmentForm === 'function') {
                (window as any).downloadAmendmentForm('N');
            } else {
                const btn = document.querySelector('#dwnlod_btn_tims') as HTMLElement;
                if (btn) {
                    const onclick = btn.getAttribute('onclick');
                    if (onclick) {
                        const fn = new Function(onclick);
                        fn.call(btn);
                    } else {
                        btn.click();
                    }
                }
            }
        });
        await log('Triggered VAT download via JS fallback');

        const deadline = Date.now() + 30_000;
        while (!captured && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (jsErr: any) {
        page.off('response', responseHandler);
        page.off('dialog', dialogHandler);
        throw new Error(`VAT download JS fallback failed: ${jsErr.message}`);
    }

    page.off('response', responseHandler);
    page.off('dialog', dialogHandler);

    if (!captured || !capturedBuffer) {
        throw new Error('VAT download capture failed after both attempts');
    }

    const finalBuffer = capturedBuffer as Buffer;
    const fallbackPath = path.join(TMP_DIR, capturedFilename);
    await fs.writeFile(fallbackPath, finalBuffer);
    await log(`Downloaded VAT package via fallback: ${fallbackPath} (${finalBuffer.length} bytes)`);
    return fallbackPath;
}

async function runLocalVatTest() {
    await fs.mkdir(TMP_DIR, { recursive: true });
    await log('=== Local VAT Test Started ===');

    const { browserContext, page, close } = await launchBrowser();

    try {
        await log('Navigating to KRA portal...');
        await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await log('KRA portal loaded');

        await performKraLogin(page, KRA_PIN, KRA_PASSWORD);
        await log('Login successful');
        await page.waitForTimeout(3000);

        // Extract credit brought forward
        const creditBroughtForward = await extractVatCreditBroughtForward(page, browserContext);
        await log(`Credit brought forward from portal: KES ${creditBroughtForward}`);

        // Extract VAT withholding for the period
        const withholdingAmount = await extractVatWithholding(page);
        await log(`VAT withholding for period: KES ${withholdingAmount}`);

        // Navigate to eReturns
        await log('Hovering over Returns menu...');
        const returnsMenu = page.locator('a:has-text("Returns")').first();
        await returnsMenu.hover();
        await page.waitForTimeout(1000);

        await log('Clicking File Return...');
        await page.evaluate(() => {
            const links = document.querySelectorAll('a');
            for (const link of Array.from(links)) {
                if (link.textContent?.includes('File Return')) {
                    link.click();
                    break;
                }
            }
        });
        await page.waitForTimeout(3000);
        await log(`Current URL after File Return: ${page.url()}`);

        // Select VAT obligation
        await log('Selecting VAT obligation from dropdown...');
        const allSelects = await page.locator('select').all();
        let taxObligationSelect: any = null;
        for (const sel of allSelects) {
            const isDisabled = await sel.isDisabled().catch(() => true);
            if (isDisabled) continue;
            const options = await sel.evaluate((el: HTMLSelectElement) => Array.from(el.options).map(o => o.text));
            if (options.some((o: string) => o.includes('Value Added Tax'))) {
                taxObligationSelect = sel;
                break;
            }
        }
        if (!taxObligationSelect) {
            throw new Error('Could not find the Tax Obligation dropdown with VAT option');
        }
        await taxObligationSelect.selectOption({ label: 'Value Added Tax (VAT)' });
        await log('VAT obligation selected');
        await page.waitForTimeout(1000);

        // Click Next
        await log('Clicking Next...');
        const nextBtn = page.locator('input[name="nextBtn"], input[type="button"][value*="Next" i], button:has-text("Next")').first();
        if (await nextBtn.count() === 0) {
            throw new Error('Next button not found');
        }
        await nextBtn.click();
        await page.waitForTimeout(3000);

        // Wait for download button
        await log('Waiting for VAT return form...');
        await page.waitForSelector('#dwnlod_btn_tims', { timeout: 20_000 });
        await log('VAT return form loaded');

        // Download
        await log('Downloading auto-populated VAT return...');
        const sourceZipPath = await downloadVatAutoPopulatedReturn(page, KRA_PIN);
        await log(`Downloaded VAT package: ${sourceZipPath}`);

        await close();
        await log('Browser closed');

        // Generate VAT ZIP
        await log('Generating VAT ZIP...');
        const effectivePreviousCredit = (creditBroughtForward + withholdingAmount) !== 0
            ? (creditBroughtForward + withholdingAmount)
            : VAT_PREVIOUS_CREDIT;
        await log(`Effective previous credit (credit + withholding): KES ${effectivePreviousCredit}`);
        const { prepareVatReturnArtifacts } = await import('../scripts/vat-return-generator');
        const artifacts = await prepareVatReturnArtifacts({
            sourceZipPath,
            clientName: CLIENT_NAME,
            taxpayerPin: KRA_PIN,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            previousCredit: effectivePreviousCredit,
        });

        await log(`VAT ZIP generated: ${artifacts.generatedZipPath}`);
        await log(`Summary: inputVat=${artifacts.summary.inputVat}, outputVat=${artifacts.summary.outputVat}, netVatBalance=${artifacts.summary.netVatBalance}`);

        const outputDir = path.join(TMP_DIR, 'vat-output');
        await fs.mkdir(outputDir, { recursive: true });
        const finalZipPath = path.join(outputDir, `${jobId}_VAT_Generated.zip`);
        await fs.copyFile(artifacts.generatedZipPath, finalZipPath);
        await log(`Final ZIP: ${finalZipPath}`);

        console.log('\n✅ Local VAT test completed successfully!');
        console.log(`Generated ZIP: ${finalZipPath}`);
        console.log(`Source ZIP: ${sourceZipPath}`);
        console.log(`Log: ${path.join(TMP_DIR, `${jobId}.log`)}`);

    } catch (error: any) {
        await log(`ERROR: ${error.message}`);
        console.error('\n❌ Local VAT test failed:', error.message);
        try {
            const failScreenshot = path.join(TMP_DIR, `failure-${jobId}.png`);
            await page.screenshot({ path: failScreenshot, fullPage: true });
            console.log(`Screenshot: ${failScreenshot}`);
        } catch {}
        try { await close(); } catch {}
        process.exit(1);
    }
}

runLocalVatTest().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
