import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';

chromium.use(StealthPlugin());

const KRA_PIN = 'P051784007D';
const KRA_PASSWORD = '0720470947';

interface PrnConfig {
    taxType: string;
    headLabel: string;
    subHeadLabel: string;
    paymentType: string;
    fileName: string;
}

const PRN_CONFIGS: PrnConfig[] = [
    { taxType: 'paye', headLabel: 'Income Tax', subHeadLabel: 'PAYE', paymentType: 'Self Assessment', fileName: 'PAYE' },
    { taxType: 'nita', headLabel: 'Agency Revenue', subHeadLabel: 'NITA Levy', paymentType: 'Self Assessment', fileName: 'NITA' },
    { taxType: 'affordable_housing', headLabel: 'Agency Revenue', subHeadLabel: 'Housing Levy', paymentType: 'Self Assessment', fileName: 'AHL' },
];

async function generatePRN(page: any, config: PrnConfig, index: number): Promise<string | null> {
    console.log(`\n========== PRN ${index + 1}/${PRN_CONFIGS.length}: ${config.fileName} ==========`);

    // Navigate to Payment Registration
    console.log('[PRN] Navigating to Payment Registration...');
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
    await page.waitForTimeout(8000);

    // Check if already on Tax Form
    const alreadyOnTaxForm = await page.evaluate(() => !!document.querySelector('select#cmbTaxHead'));
    if (!alreadyOnTaxForm) {
        console.log('[PRN] Clicking Next...');
        const nextSelectors = [
            'input[value="Next"]', '#btnSubmit', '#btnNext',
            'input[type="button"][value="Next"]',
            'button:has-text("Next")', 'a:has-text("Next")',
            'input[name="btnNext"]', 'input[name="submitBtn"]',
            'input[id*="next"]', 'button[id*="next"]',
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
            await page.evaluate(() => {
                const allInputs = Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], button, a'));
                for (const el of allInputs) {
                    if (el.getAttribute('value') === 'Next' || el.textContent?.trim() === 'Next') {
                        (el as HTMLElement).click();
                        return true;
                    }
                }
                return false;
            });
        }
        await page.waitForTimeout(10000);
    } else {
        console.log('[PRN] Already on Tax Form page');
    }

    // Verify Tax Form
    const hasTaxHead = await page.evaluate(() => !!document.querySelector('select#cmbTaxHead'));
    if (!hasTaxHead) {
        console.log('⚠️ Tax Form NOT found!');
        await page.screenshot({ path: `prn_${config.fileName}_no_taxform.png`, fullPage: true });
        return null;
    }

    // Fill Tax Head
    console.log(`[PRN] Setting Tax Head: ${config.headLabel}`);
    await page.evaluate((label: string) => {
        const select = document.querySelector('select#cmbTaxHead') as HTMLSelectElement;
        if (select) {
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].text.includes(label)) {
                    select.selectedIndex = i;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        }
    }, config.headLabel);
    await page.waitForTimeout(3000);

    // Fill Tax Sub Head
    console.log(`[PRN] Setting Tax Sub Head: ${config.subHeadLabel}`);
    const subHeadMatched = await page.evaluate((label: string) => {
        const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
        if (select) {
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].text.includes(label)) {
                    select.selectedIndex = i;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
        }
        return false;
    }, config.subHeadLabel);
    console.log(`Sub-head matched: ${subHeadMatched}`);
    await page.waitForTimeout(3000);

    // Fill Payment Type
    console.log(`[PRN] Setting Payment Type: ${config.paymentType}`);
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

    // Select Tax Period Year and Month
    console.log('[PRN] Setting Tax Period (Year 2026, Month May)...');
    await page.evaluate(() => {
        const yearSelect = document.querySelector('select#cmbTaxPeriodYear') as HTMLSelectElement;
        if (yearSelect) {
            for (let i = 0; i < yearSelect.options.length; i++) {
                if (yearSelect.options[i].text === '2026') {
                    yearSelect.selectedIndex = i;
                    yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        }
    });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
        const monthSelect = document.querySelector('select#cmbTaxPeriodMonth') as HTMLSelectElement;
        if (monthSelect) {
            for (let i = 0; i < monthSelect.options.length; i++) {
                if (monthSelect.options[i].text === 'May') {
                    monthSelect.selectedIndex = i;
                    monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        }
    });
    await page.waitForTimeout(3000);

    // Wait for liability table to appear after period selection
    console.log('[PRN] Waiting for liability table...');
    await page.waitForTimeout(3000);
    const hasLiabilities = await page.evaluate(() => {
        const table = document.getElementById('LiablibilityTbl');
        return !!table && table.style.display !== 'none';
    });
    console.log(`Liabilities table: ${hasLiabilities}`);
    if (!hasLiabilities) {
        console.log('[PRN] No liabilities table found. Taking debug screenshot...');
        await page.screenshot({ path: `prn_${config.fileName}_no_liabilities.png`, fullPage: true });
    }

    if (hasLiabilities) {
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

        // Click Add
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

        // Check for "Entered amount should be greater than 0" alert and set amount
        console.log('[PRN] Checking for amount input in obligation table...');
        const amountSet = await page.evaluate(() => {
            const amountInput = document.getElementById('in_taxObligationTable_11') as HTMLInputElement
                || document.querySelector('input[name*="amount"], input[id*="amount"], input[id*="Amount"]') as HTMLInputElement;
            if (amountInput) {
                amountInput.value = '1000';
                amountInput.dispatchEvent(new Event('change', { bubbles: true }));
                amountInput.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            return false;
        });
        console.log(`Amount input set: ${amountSet}`);
        if (amountSet) {
            await page.waitForTimeout(2000);
            // Re-click Add after setting amount
            await page.evaluate(() => {
                const addLink = document.getElementById('a_taxObligationTable') as HTMLElement;
                if (addLink) addLink.click();
            });
            await page.waitForTimeout(3000);
        }
    } else {
        console.log('⚠️ No liabilities table found — this may be normal if no liabilities exist');
    }

    // Payment Mode
    console.log('[PRN] Setting Payment Mode: Other Payment Modes');
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

    // Submit
    console.log('[PRN] Clicking Submit...');
    await page.evaluate(() => {
        const submitBtn = document.querySelector('input[value="Submit"]') as HTMLElement;
        if (submitBtn) submitBtn.click();
    });
    await page.waitForTimeout(5000);

    // Download PRN
    console.log('[PRN] Downloading...');
    try {
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            page.evaluate(() => {
                const aTags = Array.from(document.querySelectorAll('a'));
                const dl = aTags.find(a => a.textContent && a.textContent.includes('Download Payment Slip'));
                if (dl) dl.click();
            })
        ]);
        const tempPath = path.join(__dirname, '..', '..', 'tmp', `test-prn-${config.fileName}-${Date.now()}.pdf`);
        await download.saveAs(tempPath);
        console.log(`✅ ${config.fileName} PRN downloaded!`);
        console.log(`   Saved to: ${tempPath}`);
        return tempPath;
    } catch (e) {
        console.log(`❌ ${config.fileName} PRN download failed:`, e);
        await page.screenshot({ path: `prn_${config.fileName}_fail.png`, fullPage: true });
        return null;
    }
}

async function run() {
    console.log('=== Multi-PRN Test Script ===');
    console.log(`PIN: ${KRA_PIN}`);
    console.log(`PRNs to generate: ${PRN_CONFIGS.map(c => c.fileName).join(', ')}\n`);

    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const executablePath = candidates.find(p => fs.existsSync(p));
    if (!executablePath) throw new Error('No Chrome or Edge found!');

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

    // Global dialog handler
    page.on('dialog', async (dialog: any) => {
        console.log(`[Dialog] ${dialog.type()}: ${dialog.message()}`);
        await dialog.accept().catch(() => {});
    });

    // --- LOGIN ---
    console.log('Step 1: Login...');
    await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);

    await page.waitForSelector('#logid', { timeout: 15000 });
    await page.fill('#logid', KRA_PIN);

    const continueFound = await page.$('a[href="javascript:CheckPIN();"]');
    if (continueFound) await continueFound.click();
    else await page.evaluate(() => { (globalThis as any).CheckPIN(); }).catch(() => {});

    await page.waitForSelector('input[type="password"]:visible', { timeout: 18000 });
    await page.fill('input[type="password"]', KRA_PASSWORD);

    await page.waitForSelector('input[name="captcahText"]', { timeout: 10000 }).catch(() => {});
    try {
        await page.waitForFunction(() => {
            const input = document.querySelector('input[name="captcahText"]') as HTMLInputElement;
            return input && input.value.trim().length >= 2;
        }, { timeout: 120000 });
        await page.waitForTimeout(1000);
        await page.click('#loginButton');
    } catch(e) {
        console.log('CAPTCHA timeout or skipped');
    }

    await page.waitForSelector('a:has-text("Payments"), a[href*="paymentRegistration"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // --- GENERATE ALL PRNs ---
    const results: Record<string, string | null> = {};
    for (let i = 0; i < PRN_CONFIGS.length; i++) {
        const config = PRN_CONFIGS[i];
        const result = await generatePRN(page, config, i);
        results[config.fileName] = result;
        if (i < PRN_CONFIGS.length - 1) {
            console.log(`\n--- Waiting 5s before next PRN ---`);
            await page.waitForTimeout(5000);
        }
    }

    console.log('\n========== RESULTS ==========');
    for (const [name, path] of Object.entries(results)) {
        console.log(`${name}: ${path ? '✅ ' + path : '❌ FAILED'}`);
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
