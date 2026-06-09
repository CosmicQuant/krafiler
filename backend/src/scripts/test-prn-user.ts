import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';

chromium.use(StealthPlugin());

const KRA_PIN = 'P051784007D';
const KRA_PASSWORD = '0720470947';
const TAX_TYPE = 'paye';

async function run() {
    console.log('=== PRN Test Script ===');
    console.log(`PIN: ${KRA_PIN}`);
    console.log(`Tax Type: ${TAX_TYPE}`);
    console.log('Launching Chrome with visible window...\n');

    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const executablePath = candidates.find(p => fs.existsSync(p));
    if (!executablePath) {
        throw new Error('No Chrome or Edge found!');
    }

    const KRA_BROWSER_PROFILE_DIR = path.join(__dirname, '..', '..', 'tmp', 'kra-browser-profile');
    if (!fs.existsSync(KRA_BROWSER_PROFILE_DIR)) {
        fs.mkdirSync(KRA_BROWSER_PROFILE_DIR, { recursive: true });
    }

    const context = await chromium.launchPersistentContext(KRA_BROWSER_PROFILE_DIR, {
        headless: false,
        executablePath,
        args: ['--start-maximized', '--no-sandbox'],
        viewport: null,
        acceptDownloads: true
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    // Setup global dialog handler
    page.on('dialog', async dialog => {
        console.log(`[Dialog] ${dialog.type()}: ${dialog.message()}`);
        await dialog.accept().catch(() => {});
    });

    // --- LOGIN ---
    console.log('Step 1: Navigating to KRA Portal...');
    await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);

    console.log('Step 2: Filling PIN...');
    await page.waitForSelector('#logid', { timeout: 15000 });
    await page.fill('#logid', KRA_PIN);

    console.log('Step 3: Clicking CheckPIN...');
    const continueFound = await page.$('a[href="javascript:CheckPIN();"]');
    if (continueFound) {
        await continueFound.click();
    } else {
        await page.evaluate(() => { (globalThis as any).CheckPIN(); }).catch(() => {});
    }

    console.log('Step 4: Waiting for Password field...');
    await page.waitForSelector('input[type="password"]:visible', { timeout: 18000 });
    await page.fill('input[type="password"]', KRA_PASSWORD);

    console.log('Step 5: Waiting for CAPTCHA (manual input)...');
    await page.waitForSelector('input[name="captcahText"]', { timeout: 10000 }).catch(() => {});
    try {
        await page.waitForFunction(() => {
            const input = document.querySelector('input[name="captcahText"]') as HTMLInputElement;
            return input && input.value.trim().length >= 2;
        }, { timeout: 120000 });
        await page.waitForTimeout(1000);
        console.log('CAPTCHA filled! Clicking login...');
        await page.click('#loginButton');
    } catch(e) {
        console.log('CAPTCHA timeout or skipped');
    }

    console.log('Step 6: Waiting for Dashboard...');
    try {
        await page.waitForSelector('a:has-text("Payments"), a[href*="paymentRegistration"]', { timeout: 30000 });
    } catch(e) {
        console.log('Dashboard load timeout, reloading...');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForSelector('a:has-text("Payments"), a[href*="paymentRegistration"]', { timeout: 30000 }).catch(() => {});
    }
    await page.waitForTimeout(3000);

    // --- NAVIGATE TO PAYMENT REGISTRATION ---
    console.log('Step 7: Navigating to Payment Registration...');
    await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const payments = links.find(l => l.textContent && l.textContent.trim() === 'Payments');
        if (payments) {
            payments.dispatchEvent(new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true }));
        }
    });
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const pr = links.find(l => l.textContent && l.textContent.trim() === 'Payment Registration');
        if (pr) pr.click();
        else if (typeof (window as any).showPaymentRegForm === 'function') {
            (window as any).showPaymentRegForm();
        }
    });
    console.log('Clicked Payment Registration, waiting for page load...');
    await page.waitForTimeout(8000);

    // --- APPLICANT TYPE STEP ---
    console.log('Step 8: Looking for Next button on Applicant Type page...');
    const nextSelectors = [
        'input[value="Next"]',
        '#btnSubmit',
        '#btnNext',
        'input[type="button"][value="Next"]',
        'button:has-text("Next")',
        'a:has-text("Next")',
        'input[name="btnNext"]',
        'input[name="submitBtn"]',
        'input[id*="next"]',
        'button[id*="next"]',
    ];
    let nextBtnFound = false;
    for (const sel of nextSelectors) {
        const btn = await page.$(sel);
        if (btn) {
            console.log(`✓ Found Next button: ${sel}`);
            await btn.click();
            nextBtnFound = true;
            break;
        }
    }
    if (!nextBtnFound) {
        console.log('✗ Next button not found with selectors, trying JS fallback...');
        const found = await page.evaluate(() => {
            const allInputs = Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], button, a'));
            for (const el of allInputs) {
                if (el.getAttribute('value') === 'Next' || el.textContent?.trim() === 'Next') {
                    (el as HTMLElement).click();
                    return true;
                }
            }
            return false;
        });
        console.log(`JS fallback result: ${found}`);
    }
    await page.waitForTimeout(10000);

    // --- CHECK TAX FORM ---
    console.log('Step 9: Checking if Tax Form rendered...');
    const hasTaxHead = await page.evaluate(() => !!document.querySelector('select#cmbTaxHead'));
    console.log(`Tax Head select found: ${hasTaxHead}`);

    if (!hasTaxHead) {
        console.log('⚠️ Tax Form NOT found! Taking screenshot and dumping HTML...');
        await page.screenshot({ path: 'prn_test_no_taxform.png', fullPage: true });
        const html = await page.content().catch(() => '');
        fs.writeFileSync('prn_test_no_taxform.html', html);
        console.log('Screenshot: prn_test_no_taxform.png');
        console.log('HTML: prn_test_no_taxform.html');
        console.log('\n❌ Test stopped — Tax Form did not render');
        await context.close();
        process.exit(1);
    }

    // --- FILL TAX FORM ---
    console.log('Step 10: Filling Tax Head (Income Tax)...');
    await page.evaluate(() => {
        const select = document.querySelector('select#cmbTaxHead') as HTMLSelectElement;
        if (select) {
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].text.includes('Income Tax')) {
                    select.selectedIndex = i;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        }
    });
    await page.waitForTimeout(3000);

    console.log('Step 11: Filling Tax Sub Head (PAYE)...');
    const subHeadMatched = await page.evaluate(() => {
        const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
        if (select) {
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].text.includes('PAYE')) {
                    select.selectedIndex = i;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
        }
        return false;
    });
    console.log(`PAYE sub-head matched: ${subHeadMatched}`);
    await page.waitForTimeout(3000);

    console.log('Step 12: Filling Payment Type (Self Assessment)...');
    await page.evaluate(() => {
        const select = document.querySelector('select#cmbPaymentType') as HTMLSelectElement;
        if (select) {
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].text.includes('Self Assessment')) {
                    select.selectedIndex = i;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        }
    });
    await page.waitForTimeout(3000);

    // --- LIABILITY SELECTION ---
    console.log('Step 13: Searching for liabilities table...');
    const hasLiabilities = await page.evaluate(() => {
        const table = document.getElementById('LiablibilityTbl');
        return !!table && table.style.display !== 'none';
    });
    console.log(`Liabilities table visible: ${hasLiabilities}`);

    if (hasLiabilities) {
        console.log('Step 14: Selecting liability radio...');
        await page.evaluate(() => {
            const radio = document.getElementById('liabilityRadio_0') as HTMLInputElement
                || document.querySelector('#LiablibilityTbl input[name="liabilityRadio"]') as HTMLInputElement;
            if (radio) {
                radio.checked = true;
                radio.click();
                radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await page.waitForTimeout(2000);

        console.log('Step 15: Clicking Add...');
        const addResult = await page.evaluate(() => {
            const addLink = document.getElementById('a_taxObligationTable') as HTMLElement;
            const table = document.getElementById('taxObligationTable') as HTMLTableElement;
            const rowsBefore = table?.rows.length ?? 0;
            if (addLink) {
                addLink.click();
                return { clicked: true, rowsBefore };
            }
            return { clicked: false, rowsBefore };
        });
        console.log(`Add clicked: ${addResult.clicked}, rows before: ${addResult.rowsBefore}`);
        await page.waitForTimeout(3000);
    } else {
        console.log('⚠️ No liabilities table found — this may be normal if no liabilities exist');
    }

    // --- PAYMENT MODE ---
    console.log('Step 16: Selecting Payment Mode (Other Payment Modes)...');
    await page.evaluate(() => {
        const select = document.querySelector('select#cmbPaymentMode, select[name="paymentModeId"]') as HTMLSelectElement;
        if (select) {
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].text.includes('Other Payment Modes')) {
                    select.selectedIndex = i;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        }
    });
    await page.waitForTimeout(2000);

    // --- SUBMIT ---
    console.log('Step 17: Clicking Submit...');
    await page.evaluate(() => {
        const submitBtn = document.querySelector('input[value="Submit"]') as HTMLElement;
        if (submitBtn) submitBtn.click();
    });
    await page.waitForTimeout(5000);

    // --- DOWNLOAD PRN ---
    console.log('Step 18: Attempting PRN download...');
    try {
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            page.evaluate(() => {
                const aTags = Array.from(document.querySelectorAll('a'));
                const dl = aTags.find(a => a.textContent && a.textContent.includes('Download Payment Slip'));
                if (dl) dl.click();
            })
        ]);
        const tempPath = path.join(__dirname, '..', '..', 'tmp', 'test-prn-result.pdf');
        await download.saveAs(tempPath);
        console.log(`\n✅ PRN downloaded successfully!`);
        console.log(`Saved to: ${tempPath}`);
    } catch (e) {
        console.log('\n❌ PRN download failed:', e);
        await page.screenshot({ path: 'prn_test_final.png', fullPage: true }).catch(() => {});
        const html = await page.content().catch(() => '');
        fs.writeFileSync('prn_test_final.html', html);
        console.log('Screenshot: prn_test_final.png');
        console.log('HTML: prn_test_final.html');
    }

    console.log('\nClosing browser...');
    await context.close();
    console.log('Test complete!');
    process.exit(0);
}

run().catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
});
