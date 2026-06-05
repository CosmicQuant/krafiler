/**
 * Local MRI filing test script.
 * Run with: cd backend && npx ts-node src/scripts/test-mri-local.ts
 *
 * This script launches a headed browser, logs into KRA, and walks through
 * the MRI filing flow so we can see exactly what happens at each step.
 */

import 'dotenv/config';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import path from 'path';
import fs from 'fs/promises';

chromium.use(StealthPlugin());

const KRA_PIN = 'A001141767G';
const KRA_PASSWORD = '0722935813';
const RENTAL_INCOME = 5000;
const GEMINI_API_KEY = 'AIzaSyDStvPX3EdrxdsvHQ1OTCppoVe8t8F6uss';
const TMP_DIR = path.join(process.cwd(), 'tmp', 'kra-test');

async function ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true });
}

async function solveCaptchaWithGemini(screenshotPath: string): Promise<string> {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const imageBuffer = await fs.readFile(screenshotPath);
    const base64Image = imageBuffer.toString('base64');

    const result = await model.generateContent([
        {
            inlineData: {
                data: base64Image,
                mimeType: 'image/png',
            },
        },
        {
            text: 'What is the captcha code in this image? Return ONLY the numeric or alphanumeric code, nothing else.',
        },
    ]);

    const answer = result.response.text().trim();
    console.log(`[Gemini] Captcha answer: "${answer}"`);
    return answer;
}

async function delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    await ensureDir(TMP_DIR);

    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    console.log('Launching local Chrome...');
    const browser = await chromium.launch({
        headless: true,
        executablePath: chromePath,
        slowMo: 300,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
        ],
    });
    const context = await browser.newContext({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1400, height: 950 },
        locale: 'en-KE',
        timezoneId: 'Africa/Nairobi',
    });
    const page = await context.newPage();

    try {
        // ── 1. Navigate to KRA portal ─────────────────────────────────────────
        console.log('\n[Step 1] Navigating to KRA portal...');
        await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await delay(2000);

        // ── 2. Fill PIN ───────────────────────────────────────────────────────
        console.log('[Step 2] Filling PIN...');
        await page.waitForSelector('#logid', { timeout: 15_000 });
        await page.fill('#logid', KRA_PIN);

        // ── 3. Click Continue / CheckPIN ──────────────────────────────────────
        console.log('[Step 3] Clicking Continue (CheckPIN)...');
        const continueBtn = await page.$('a[href="javascript:CheckPIN();"]');
        if (continueBtn) {
            await continueBtn.click();
        } else {
            await page.evaluate(() => { (globalThis as any).CheckPIN(); });
        }
        await delay(2000);

        // ── 4. Fill password ──────────────────────────────────────────────────
        console.log('[Step 4] Filling password...');
        await page.waitForSelector('input[type="password"]', { timeout: 15_000 });
        await page.fill('input[type="password"]', KRA_PASSWORD);

        // ── 5. Solve captcha ──────────────────────────────────────────────────
        // KRA uses an arithmetic "Security Stamp" captcha. Parse the math expression.
        console.log('[Step 5] Solving arithmetic captcha (Security Stamp)...');
        let captchaAnswer = '';

        const stampText = await page.$eval('#securityStamp, .security-stamp, [id*="stamp"], img[src*="SecurityStamp"]', (el) => el.textContent?.trim() ?? '').catch(() => '');

        if (stampText) {
            // Parse arithmetic expression like "114 + 12?" or "187 - 11?"
            const match = stampText.match(/(\d+)\s*([+\-×x*])\s*(\d+)/);
            if (match) {
                const a = parseInt(match[1], 10);
                const op = match[2];
                const b = parseInt(match[3], 10);
                if (op === '+' || op === '×' || op === 'x' || op === '*') {
                    captchaAnswer = String(a + b);
                } else if (op === '-') {
                    captchaAnswer = String(a - b);
                }
                console.log(`  Arithmetic captcha: ${a} ${op} ${b} = ${captchaAnswer}`);
            } else {
                console.warn(`  Could not parse arithmetic captcha: "${stampText}"`);
            }
        }

        // Fallback to Gemini if we can't parse the arithmetic
        if (!captchaAnswer) {
            const captchaElement = await page.$('#captcha_img, #loginCaptcha, #captchaImg, img[src*="captcha"]');
            if (captchaElement) {
                const captchaPath = path.join(TMP_DIR, `captcha-${Date.now()}.png`);
                await captchaElement.screenshot({ path: captchaPath });
                captchaAnswer = await solveCaptchaWithGemini(captchaPath);
                console.log(`  Gemini captcha answer: ${captchaAnswer}`);
            } else {
                console.warn('  No captcha element found!');
            }
        }

        if (captchaAnswer) {
            await page.fill('input[name="captcahText"], input[name*="security"], input[name*="stamp"]', captchaAnswer);
            console.log(`  Filled captcha answer: ${captchaAnswer}`);
        }

        // ── 6. Submit login ───────────────────────────────────────────────────
        console.log('[Step 6] Submitting login...');
        await page.click('#loginButton');
        await delay(5000);

        // Check where we are
        const currentUrl = page.url();
        console.log(`After login URL: ${currentUrl}`);

        // Handle mobile verification if needed
        const mobileVerify = await page.$('text=Mobile Number Verification, text=Verify Your Mobile Number');
        if (mobileVerify) {
            console.log('[WARN] Mobile verification required! Please enter OTP manually.');
            console.log('Waiting 60 seconds for manual OTP entry...');
            await delay(60_000);
        }

        // Handle password change if needed
        const passwordChange = await page.$('text=YOUR PASSWORD HAS EXPIRED!, text=Change Password');
        if (passwordChange) {
            throw new Error('Password has expired — needs reset before filing');
        }

        // ── 7. Navigate to Returns menu ───────────────────────────────────────────
        console.log('[Step 7] Navigating to Returns → File Return...');
        const dashboardPath = path.join(TMP_DIR, `dashboard-${Date.now()}.png`);
        await page.screenshot({ path: dashboardPath, fullPage: true });
        console.log(`  Dashboard screenshot: ${dashboardPath}`);

        // Check if on My Ledger and navigate to dashboard first
        if (page.url().includes('My%20Ledger') || page.url().includes('My Ledger')) {
            await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await delay(2000);
        }

        // Print all link elements so we can see the Returns menu structure
        const links = await page.$$eval('a', (els) =>
            els.map((el) => ({
                text: (el.textContent ?? '').trim(),
                href: el.getAttribute('href') ?? '',
                id: el.id,
                className: el.className,
            })).filter((l) => l.text.length > 0)
        );
        console.log('  Links on dashboard:', JSON.stringify(links.slice(0, 30), null, 2));

        // Strategy 1: Find Returns menu and click File Return
        try {
            const returnsMenu = page.locator('#returns, a:has-text("Returns"), td:has-text("Returns") a, li:has-text("Returns") a').first();
            if (await returnsMenu.count() > 0) {
                await returnsMenu.click();
                console.log('  Clicked Returns menu');
                await delay(2000);

                const filingLink = page.locator('a[href*="showEReturns"], a.mainMenu[href*="showEReturns"], a:has-text("File Return")').filter({ visible: true }).first();
                if (await filingLink.count() > 0) {
                    await filingLink.click();
                    console.log('  Clicked File Return');
                    await delay(5000);
                } else {
                    throw new Error('File Return link not visible after clicking Returns');
                }
            } else {
                throw new Error('Returns menu not found');
            }
        } catch {
            // Strategy 2: Direct JS evaluation
            console.log('  Trying JS fallback for showEReturns...');
            await page.evaluate(() => {
                if (typeof (window as any).showEReturns === 'function') {
                    (window as any).showEReturns();
                } else {
                    const el = document.querySelector('a[href*="showEReturns"]') as HTMLElement;
                    if (el) el.click();
                }
            });
            await delay(5000);
        }

        // Wait for eReturns page
        try {
            await page.waitForURL(/eReturns\.htm/, { timeout: 15_000 });
            console.log(`  On eReturns page: ${page.url()}`);
        } catch {
            console.warn('  URL did not change to eReturns, continuing anyway...');
        }

        // ── 8. Select return type and obligation ──────────────────────────────
        console.log('[Step 8] Selecting return type and obligation...');

        // Return type (usually pre-selected as "Self")
        const typeSelect = await page.$('select');
        if (typeSelect) {
            const isDisabled = await typeSelect.evaluate((el: HTMLSelectElement) => el.disabled);
            if (!isDisabled) {
                await page.selectOption('select', { label: 'Self' });
                console.log('Selected return type: Self');
            } else {
                console.log('Return type is locked by KRA (pre-selected)');
            }
        }

        // Select MRI obligation
        const obligationSelect = page.locator('select#regType, select[name="obligationId"]').first();
        if (await obligationSelect.count() > 0) {
            // Print all options so we can see the exact text
            const options = await obligationSelect.evaluate((sel: HTMLSelectElement) =>
                Array.from(sel.options).map((opt) => ({ value: opt.value, text: opt.text.trim() }))
            );
            console.log('  Obligation options:', JSON.stringify(options, null, 2));

            // Find MRI option by partial match
            const mriOption = options.find((o: any) => /rent|mri|rental income/i.test(o.text));
            if (mriOption) {
                await obligationSelect.selectOption({ value: mriOption.value });
                console.log(`  Selected obligation: ${mriOption.text} (${mriOption.value})`);
            } else {
                console.warn('  Could not find MRI option in dropdown');
            }
        }

        await delay(1000);

        // Click Next (obligation selection page uses btnSubmit)
        console.log('Clicking Next after obligation selection...');
        await page.locator('#btnSubmit:visible, #nextBtn:visible, input[value="Next"]:visible, button:has-text("Next"):visible').last().click();
        await delay(5000);

        // ── 9. Section A — dates are pre-filled, just click Next ──────────────
        console.log('\n[Step 9] Section A — checking pre-filled dates...');
        const fromField = await page.$('#txtPeriodFrom');
        const toField = await page.$('#txtPeriodTo');
        if (fromField) {
            const fromVal = await fromField.evaluate((el: HTMLInputElement) => el.value);
            console.log(`  Period From (pre-filled): ${fromVal}`);
        }
        if (toField) {
            const toVal = await toField.evaluate((el: HTMLInputElement) => el.value);
            console.log(`  Period To (pre-filled):   ${toVal}`);
        }

        console.log('  Dates are pre-filled — clicking Next...');
        await page.locator('#btnSubmit:visible, #nextBtn:visible, input[value="Next"]:visible, button:has-text("Next"):visible').last().click();
        await delay(5000);

        // ── 10. Section B — fill rental income ────────────────────────────────
        console.log('\n[Step 10] Section B — filling rental income amount...');

        const sectionBPath = path.join(TMP_DIR, `section-b-${Date.now()}.png`);
        await page.screenshot({ path: sectionBPath, fullPage: true });
        console.log(`  Screenshot saved: ${sectionBPath}`);

        // Find all visible inputs and print them
        const visibleInputs = await page.$$eval('input:visible, textarea:visible', (els) =>
            els
                .filter((el) => {
                    const input = el as HTMLInputElement;
                    return !input.disabled && !input.readOnly;
                })
                .filter((el) => {
                    const input = el as HTMLInputElement;
                    return !['hidden', 'submit', 'button', 'radio', 'checkbox', 'password'].includes(input.type.toLowerCase());
                })
                .map((el) => {
                    const input = el as HTMLInputElement;
                    return {
                        id: input.id,
                        name: input.name,
                        placeholder: input.getAttribute('placeholder'),
                        type: input.type,
                        value: input.value,
                        label: input.id ? document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() : '',
                        rowText: input.closest('tr, td, div, fieldset')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 100) ?? '',
                    };
                })
        );
        console.log('  Visible input fields:', JSON.stringify(visibleInputs, null, 2));

        // Target the exact MRI rental income field
        const rentalLoc = page.locator('input#mriRentAmount_0, input[name="mriRentAmount_0"], [id*="RentAmount" i]:visible').first();
        const rentalCount = await rentalLoc.count().catch(() => 0);
        if (rentalCount > 0) {
            await rentalLoc.fill(String(RENTAL_INCOME));
            await rentalLoc.blur();
            console.log(`  Filled rental income: ${RENTAL_INCOME}`);
        } else if (visibleInputs.length > 0) {
            const candidate = visibleInputs.find((i) =>
                !i.value &&
                !i.name.toLowerCase().includes('date') &&
                !i.id.toLowerCase().includes('date') &&
                !i.name.toLowerCase().includes('pin') &&
                !i.id.toLowerCase().includes('pin')
            );
            if (candidate) {
                const loc = candidate.id
                    ? page.locator(`[id="${candidate.id}"]`).first()
                    : candidate.name
                        ? page.locator(`[name="${candidate.name}"]`).first()
                        : page.locator('input:visible').first();
                await loc.fill(String(RENTAL_INCOME));
                await loc.evaluate((el: HTMLElement) => (el as HTMLInputElement).blur());
                console.log(`  Filled rental income into field: ${candidate.name || candidate.id}`);
            } else {
                console.warn('  Could not auto-detect rental income field. Please fill manually.');
                console.log('  Waiting 30 seconds for manual entry...');
                await delay(30_000);
            }
        }

        // Click Next
        console.log('  Clicking Next after filling rental income...');
        await page.locator('#btnSubmit:visible, #nextBtn:visible, input[value="Next"]:visible, button:has-text("Next"):visible').last().click();
        await delay(5000);

        // ── 11. Section C — Submit ────────────────────────────────────────────
        console.log('\n[Step 11] Section C — looking for Submit button...');
        const sectionCPath = path.join(TMP_DIR, `section-c-${Date.now()}.png`);
        await page.screenshot({ path: sectionCPath, fullPage: true });
        console.log(`  Screenshot saved: ${sectionCPath}`);

        // Set up dialog handler before clicking Submit (KRA shows confirm dialog)
        page.on('dialog', async (dialog) => {
            console.log(`  [Dialog] ${dialog.type()}: "${dialog.message()}"`);
            if (dialog.type() === 'confirm') {
                await dialog.accept();
                console.log('  [Dialog] Accepted confirm dialog');
            } else {
                await dialog.dismiss();
            }
        });

        const submitLoc = page.locator('input[value="Submit"], button:has-text("Submit"), #submitBtn, #btnSubmit').filter({ visible: true }).first();
        if (await submitLoc.count() > 0) {
            console.log('  Found Submit button — clicking...');
            await submitLoc.click();
            await delay(5000);
        } else {
            console.warn('  No Submit button found. Current page HTML saved for inspection.');
            const html = await page.content();
            await fs.writeFile(path.join(TMP_DIR, 'section-c-html.html'), html);
        }

        // ── 12. Declaration / Acceptance ──────────────────────────────────────
        console.log('\n[Step 12] Checking for declaration page...');
        const declarationCheckbox = page.locator('input[type="checkbox"]').filter({ visible: true }).first();
        const acceptLoc = page.locator('input[value="Accept"], button:has-text("Accept")').filter({ visible: true }).first();

        if (await declarationCheckbox.count() > 0 && await acceptLoc.count() > 0) {
            console.log('  Found declaration checkbox and Accept button');
            await declarationCheckbox.check();
            await delay(500);
            await acceptLoc.click();
            await delay(5000);
        } else if (await acceptLoc.count() > 0) {
            console.log('  Found Accept button only — clicking...');
            await acceptLoc.click();
            await delay(5000);
        }

        // MRI confirmation uses a "Yes" link instead of checkbox+Accept
        const yesLoc = page.locator('a:has-text("Yes"), a.btn:has-text("Yes"), a[onclick*="accepted"]').filter({ visible: true }).first();
        if (await yesLoc.count() > 0) {
            console.log('  Found Yes confirmation button — clicking...');
            await yesLoc.click();
            await delay(5000);
        }

        // ── 13. Download receipt ──────────────────────────────────────────────
        console.log('\n[Step 13] Looking for receipt download...');
        const receiptPath = path.join(TMP_DIR, `receipt-page-${Date.now()}.png`);
        await page.screenshot({ path: receiptPath, fullPage: true });
        console.log(`  Screenshot saved: ${receiptPath}`);

        const receiptLoc = page.locator('a:has-text("Download Returns Receipt"), a:has-text("Receipt"), a:has-text("Download"), button:has-text("Download"), input[value*="Receipt"]').filter({ visible: true }).first();
        if (await receiptLoc.count() > 0) {
            console.log('  Found receipt download link!');
            const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
            await receiptLoc.click();
            const download = await downloadPromise;
            const receiptFilePath = path.join(TMP_DIR, `receipt-${Date.now()}.pdf`);
            await download.saveAs(receiptFilePath);
            console.log(`  Receipt downloaded to: ${receiptFilePath}`);
        } else {
            console.log('  No receipt link found on current page.');
            const finalHtml = await page.content();
            await fs.writeFile(path.join(TMP_DIR, 'final-page-html.html'), finalHtml);
        }

        console.log('\n=== TEST COMPLETE ===');
        await delay(3000);
        await browser.close();

    } catch (err) {
        console.error('\n[ERROR]', err);
        const errorPath = path.join(TMP_DIR, `error-${Date.now()}.png`);
        await page.screenshot({ path: errorPath, fullPage: true });
        console.log(`Error screenshot saved: ${errorPath}`);
        await browser.close();
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
