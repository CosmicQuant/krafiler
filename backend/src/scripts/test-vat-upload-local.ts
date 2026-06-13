/**
 * test-vat-upload-local.ts
 *
 * Local VAT filing (upload) test script.
 * Uses visible Chrome to file a VAT return with an existing ZIP.
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

const KRA_PIN = 'P052262687K';
const KRA_PASSWORD = '0720470947';
const VAT_ZIP_PATH = 'C:\\Users\\ADMIN\\Downloads\\13-06-2026_12-43-05_P052262687K_VAT.zip';
const PERIOD_FROM = '2026-05-01';
const PERIOD_TO = '2026-05-31';

const jobId = `local-upload-${Date.now()}`;

async function log(message: string) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${jobId}] ${message}`;
    console.log(line);
    const logPath = path.join(TMP_DIR, `${jobId}.log`);
    await fs.mkdir(TMP_DIR, { recursive: true });
    await fs.appendFile(logPath, line + '\n');
}

async function screenshot(page: any, name: string) {
    const p = path.join(TMP_DIR, `${jobId}_${name}.png`);
    await page.screenshot({ path: p, fullPage: true });
    await log(`Screenshot: ${p}`);
    return p;
}

async function solveCaptchaWithGemma4(screenshotPath: string): Promise<string> {
    const imageBuffer = await fs.readFile(screenshotPath);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMMA4_MODEL)}:generateContent?key=${encodeURIComponent(GEMMA4_API_KEY)}`;

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
        await log(`Gemma 4 response parts: ${JSON.stringify(parts)}`);

        let rawText = parts.filter((p: any) => !p.thought && typeof p.text === 'string').map((p: any) => p.text).join(' ').trim();
        if (!rawText) {
            rawText = parts.filter((p: any) => p.thought && typeof p.text === 'string').map((p: any) => p.text).join(' ').trim();
        }
        if (!rawText) {
            rawText = parts.map((p: any) => p.text).join(' ').trim();
        }

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
            '--disable-blink-features=AutomationControlled',
        ],
    };

    const context = await chromium.launchPersistentContext(
        path.join(TMP_DIR, 'browser-profile'),
        launchOptions as any
    );
    const page = context.pages()[0] || await context.newPage();
    return { browser: context, context, page };
}

async function login(page: any) {
    await log('Navigating to KRA portal');
    await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2000);

    await log('Entering PIN');
    await page.waitForSelector('#logid', { timeout: 15_000 });
    await page.fill('#logid', KRA_PIN);

    await log('Clicking Continue (CheckPIN)');
    const continueSelectors = [
        'a[href="javascript:CheckPIN();"]',
        'a:has-text("Continue")',
        'input[value="Continue"]',
        'button:has-text("Continue")',
        'img[src*="continue"]',
        'img[alt*="Continue"]',
    ];
    let continueClicked = false;
    for (const sel of continueSelectors) {
        const el = await page.$(sel);
        if (el) {
            await el.click().catch(() => {});
            continueClicked = true;
            await log(`Clicked Continue with selector: ${sel}`);
            break;
        }
    }
    if (!continueClicked) {
        // Fallback: call CheckPIN via JS
        await page.evaluate(() => { (globalThis as any).CheckPIN && (globalThis as any).CheckPIN(); });
    }

    await page.waitForTimeout(2500);

    await log('Checking for password field');
    const passwordVisible = await page.waitForSelector('input[type="password"]:visible', { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);

    if (!passwordVisible) {
        await screenshot(page, 'no_password_field');
        throw new Error('Password field did not appear after CheckPIN');
    }

    await log('Entering password');
    await page.fill('input[type="password"]', KRA_PASSWORD);
    await screenshot(page, 'before_captcha');

    // Try DOM text captcha first
    let captchaAnswer = '';
    try {
        const stampText = await page.$eval(
            '#securityStamp, .security-stamp, [id*="stamp"], img[src*="SecurityStamp"]',
            (el: any) => el.textContent?.trim() ?? ''
        );
        const match = stampText.match(/(\d+)\s*([+\-×x*])\s*(\d+)/);
        if (match) {
            const a = parseInt(match[1], 10);
            const op = match[2];
            const b = parseInt(match[3], 10);
            captchaAnswer = (op === '+' || op === '×' || op === 'x' || op === '*') ? String(a + b) : String(a - b);
            await log(`DOM arithmetic captcha: ${a} ${op} ${b} = ${captchaAnswer}`);
        }
    } catch {}

    const captchaPath = path.join(TMP_DIR, `${jobId}_captcha.png`);
    if (!captchaAnswer) {
        const captchaSelectors = ['#loginCaptcha', '#captchaImg', '#captcha_img', 'img[id*="captcha"]', 'img[src*="GenerateCaptcha"]', 'img[src*="captcha"]'];
        let found = false;
        for (const selector of captchaSelectors) {
            const captchaImg = await page.$(selector);
            if (captchaImg) {
                const box = await captchaImg.boundingBox();
                if (box && box.width >= 10 && box.height >= 10) {
                    await captchaImg.screenshot({ path: captchaPath, type: 'png' });
                    found = true;
                    await log(`Captcha screenshot (${selector}): ${captchaPath}`);
                    break;
                }
            }
        }
        if (!found) {
            await screenshot(page, 'no_captcha_img');
            throw new Error('Captcha image not found');
        }
        captchaAnswer = await solveCaptchaWithGemma4(captchaPath);
    }

    await log(`Captcha answer: ${captchaAnswer}`);
    await page.fill('input[name="captcahText"]', captchaAnswer);
    await screenshot(page, 'after_captcha');

    await log('Submitting login');
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
    const deadline = Date.now() + 30_000;
    let dashboardDetected = false;
    while (Date.now() < deadline) {
        for (const sel of dashboardSelectors) {
            const visible = await page.locator(sel).first().isVisible().catch(() => false);
            if (visible) {
                dashboardDetected = true;
                await log('Dashboard detected, login successful');
                break;
            }
        }
        if (dashboardDetected) break;
        await new Promise(r => setTimeout(r, 250));
    }

    await screenshot(page, 'post_login');
    await log(`Post-login URL: ${page.url()}`);

    if (!dashboardDetected) {
        const errorText = await page.$eval('#errorDiv, .error-message, [id*="error"]', (el: any) => el.textContent?.trim()).catch(() => '');
        throw new Error(`Dashboard did not appear after login${errorText ? ` - ${errorText}` : ''}`);
    }

    // Wait a moment for the dashboard to fully load
    await page.waitForTimeout(3000);
}

async function navigateToVatReturn(page: any) {
    await log('Hovering over Returns menu and clicking File Return');
    await page.hover('a:has-text("Returns"), a[href*="Returns"], a:has-text("File Return")');
    await page.waitForTimeout(500);

    // Try clicking File Return from the dropdown
    const clickedFileReturn = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const fileReturn = links.find(l => (l.textContent || '').trim().toLowerCase() === 'file return');
        if (fileReturn) {
            (fileReturn as HTMLElement).click();
            return true;
        }
        return false;
    });

    if (!clickedFileReturn) {
        // Fallback: direct URL
        await log('File Return link not found, falling back to direct URL');
        await page.goto('https://itax.kra.go.ke/KRA-Portal/eReturns.htm?actionCode=loadPage&amendmentFlag=N', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }

    await page.waitForTimeout(3000);
    await screenshot(page, 'ereturns_page');

    await log('Selecting VAT obligation');
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
    await page.waitForTimeout(1500);
    await screenshot(page, 'after_obligation_select');

    await log('Clicking Next');
    await page.evaluate(() => {
        const nextBtn = Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], button'))
            .find(el => (el.getAttribute('value') || '').toLowerCase() === 'next' || (el.textContent || '').toLowerCase().includes('next')) as HTMLElement;
        if (nextBtn) nextBtn.click();
    });
    await page.waitForTimeout(4000);
    await screenshot(page, 'after_next');

    // Handle the "Do you want to file return for this period?" dialog if it appears
    const dialog = await page.$('text=/do you want to file|are you sure/i').catch(() => null);
    if (dialog) {
        await log('Dialog detected, clicking OK/Yes');
        await page.click('input[value="OK"], input[value="Yes"], button:has-text("OK"), button:has-text("Yes")').catch(() => {});
        await page.waitForTimeout(1500);
    }
}

async function uploadAndFile(page: any) {
    await log('Waiting for file input');
    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 20_000 });
    await log(`Uploading ZIP: ${VAT_ZIP_PATH}`);
    await fileInput.setInputFiles(VAT_ZIP_PATH);
    await page.waitForTimeout(2000);
    await screenshot(page, 'after_zip_upload');

    await log('Accepting declaration');
    const declarationCheckbox = await page.$('input[type="checkbox"]');
    if (declarationCheckbox) {
        await declarationCheckbox.check();
    }
    await page.waitForTimeout(500);

    // Set up dialog handler BEFORE clicking submit
    page.on('dialog', async (dialog: any) => {
        const msg = dialog.message();
        await log(`KRA dialog: "${msg}" (type: ${dialog.type()})`);
        if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
            await dialog.accept();
            await log('Accepted dialog');
        } else {
            await dialog.dismiss();
        }
    });

    await log('Clicking Submit');
    const submitPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
    await page.evaluate(() => {
        const btn = document.querySelector('#btnSubmit') as HTMLElement;
        if (btn) { btn.click(); return; }
        const alt = document.querySelector('input[value="Submit"], button[type="submit"]') as HTMLElement;
        if (alt) alt.click();
    });
    await submitPromise;
    await page.waitForTimeout(4000);
    await screenshot(page, 'after_submit');

    // Handle any post-submit confirmation via JS click
    const yesClicked = await page.evaluate(() => {
        const selectors = [
            'a[onclick*="accepted"]',
            'input[value="Yes"]',
            'button',
            'a'
        ];
        for (const sel of selectors) {
            const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
            const yesBtn = els.find(el => (el.textContent || '').trim().toLowerCase() === 'yes');
            if (yesBtn) { yesBtn.click(); return true; }
        }
        return false;
    });
    if (yesClicked) {
        await log('Clicked Yes confirmation');
        await page.waitForTimeout(4000);
        await screenshot(page, 'after_yes');
    }

    // Check for KRA validation errors on the summary page
    const errorText = await page.$eval('.error-message, #errorDiv, [id*="error"], .errormessage', (el: any) => el.textContent?.trim()).catch(() => '');
    const summaryError = await page.locator('text=/error description|error|failed|not declared/i').first().textContent().catch(() => '');
    if (errorText || summaryError) {
        await log(`KRA validation error: ${errorText || summaryError}`);
        throw new Error(`KRA rejected the VAT return: ${errorText || summaryError}`);
    }

    await log('Waiting for receipt page');
    await page.waitForTimeout(5000);
    await screenshot(page, 'receipt_page');
}

async function downloadReceipt(page: any) {
    await log('Locating receipt download link');

    const links = await page.$$eval('a', (els: HTMLAnchorElement[]) =>
        els.map(el => ({
            id: el.id,
            href: el.getAttribute('href') || '',
            onclick: el.getAttribute('onclick') || '',
            text: (el.textContent || '').trim(),
            className: el.className || '',
        }))
    );
    await log(`Receipt page links: ${JSON.stringify(links, null, 2)}`);

    const downloadLink = links.find((l: any) =>
        !l.className.toLowerCase().includes('mainmenu') &&
        !l.className.toLowerCase().includes('nav') &&
        (l.onclick.toLowerCase().includes('download') ||
         l.href.toLowerCase().includes('download') ||
         l.text.toLowerCase().includes('download') ||
         l.text.toLowerCase().includes('receipt'))
    );

    if (!downloadLink) {
        await log('No download link found on receipt page');
        throw new Error('Could not locate the receipt download link on the KRA receipt page');
    }

    await log(`Found download link: ${JSON.stringify(downloadLink)}`);

    const receiptPath = path.join(TMP_DIR, `${jobId}_receipt.pdf`);

    // Intercept PDF response
    const pdfResponsePromise = new Promise<any>((resolve) => {
        const handler = async (response: any) => {
            const contentType = (await response.headerValue('content-type') || '').toLowerCase();
            const url = response.url().toLowerCase();
            if (contentType.includes('pdf') || url.includes('.pdf') || url.includes('downloadreturnsreceipt')) {
                page.off('response', handler);
                resolve(response);
            }
        };
        page.on('response', handler);
        setTimeout(() => {
            page.off('response', handler);
            resolve(null);
        }, 60_000);
    });

    let selector = '';
    if (downloadLink.id) {
        selector = `#${downloadLink.id}`;
    } else if (downloadLink.onclick) {
        selector = `a[onclick="${downloadLink.onclick}"]`;
    } else if (downloadLink.href) {
        selector = `a[href="${downloadLink.href}"]`;
    } else {
        selector = `a:has-text("${downloadLink.text.slice(0, 30)}")`;
    }

    await log(`Clicking download selector: ${selector}`);
    await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) el.click();
    }, selector);

    const pdfResponse = await pdfResponsePromise;
    if (pdfResponse) {
        const buffer = await pdfResponse.body();
        await fs.writeFile(receiptPath, buffer);
        await log(`Receipt downloaded: ${receiptPath}`);
        return receiptPath;
    }

    throw new Error('No PDF response detected after clicking receipt link');
}

async function main() {
    await log('Starting local VAT upload test');
    await log(`PIN: ${KRA_PIN}, ZIP: ${VAT_ZIP_PATH}`);

    if (!GEMMA4_API_KEY) {
        await log('WARNING: GEMMA4_API_KEY not set in environment');
    }

    const { context, page } = await launchBrowser();

    try {
        await login(page);
        await navigateToVatReturn(page);
        await uploadAndFile(page);
        const receiptPath = await downloadReceipt(page);
        await log(`SUCCESS - Receipt saved to: ${receiptPath}`);
    } catch (err: any) {
        await log(`FAILED: ${err.message}`);
        await screenshot(page, 'failure');
        throw err;
    } finally {
        await context.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
