import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';

chromium.use(StealthPlugin());

async function run() {
    console.log('Launching Local System Chrome via Persistent Context just like normal pipeline...');
    
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    let executablePath = candidates.find(p => fs.existsSync(p));

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

    console.log('Navigating to KRA Portal...');
    await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    
    // --- EXACT LOGIN MATCHING KRA_FILING_WORKER ---
    console.log('Filling PIN...');
    await page.waitForSelector('#logid', { timeout: 15_000 });
    await page.fill('#logid', 'P052063835W');
    
    console.log('Clicking CheckPIN()...');
    const continueFound = await page.$('a[href="javascript:CheckPIN();"]');
    if (continueFound) {
        await continueFound.click();
    } else {
        await page.evaluate(() => { (globalThis as any).CheckPIN(); }).catch(() => {});
    }

    console.log('Waiting for Password Field...');
    await page.waitForSelector('input[type="password"]:visible', { timeout: 18_000 });
    await page.fill('input[type="password"]', '0724004872');
    
    console.log('Waiting for Captcha... PLEASE TYPE MANUALLY!');
    await page.waitForSelector('input[name="captcahText"]', { timeout: 10_000 }).catch(() => {});
    
    try {
        await page.waitForFunction(() => {
            const input = document.querySelector('input[name="captcahText"]') as HTMLInputElement;
            return input && input.value.trim().length >= 2;
        }, { timeout: 120_000 });
        
        await page.waitForTimeout(1000); 
        console.log('Captcha entered! Initiating login...');
        await page.click('#loginButton');
    } catch(e) {}
    
    console.log('Waiting for Dashboard to load...');
    try {
        await page.waitForSelector('a:has-text("Payments"), a[href*="paymentRegistration"]', { timeout: 30000 });
    } catch(e) {
        console.log('Dashboard took too long to load. Reloading page...');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForSelector('a:has-text("Payments"), a[href*="paymentRegistration"]', { timeout: 30000 }).catch(() => {});
    }
    
    // Setup dialog handler for any alerts going forward
    page.on('dialog', async dialog => {
        console.log(`Alert appeared: ${dialog.message()} - Accepting...`);
        await dialog.accept().catch(() => {});
    });

    // --- NAVIGATE TO PAYMENT REGISTRATION EXACTLY LIKE KRAFILINGWORKER ---
    console.log('Hovering over Payments menu and clicking Payment Registration...');
    try {
        await page.waitForTimeout(2000);
    console.log("Taking screenshot before add...");
    await page.screenshot({ path: "backend/add_btn_debug.png" }); // Give dashboard extra time
        
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const payments = links.find(l => l.textContent && l.textContent.trim() === 'Payments');
            if (payments) {
                payments.dispatchEvent(new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true }));
            }
        });
        await page.waitForTimeout(1000); // Wait for dropdown to be visible
        
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const pr = links.find(l => l.textContent && l.textContent.trim() === 'Payment Registration');
            if (pr) pr.click();
            else if (typeof (window as any).showPaymentRegForm === 'function') {
                (window as any).showPaymentRegForm();
            }
        });
        
        // Instead of strict navigation waiting, wait for the Next button to appear in the DOM
        console.log('Successfully clicked Payment Registration Menu! Waiting for page loads...');
        await page.waitForTimeout(5000);
    } catch(e: any) {
        console.log(`Menu sequence failed entirely: ${e.message}. Proceeding...`);
    }

    console.log('Clicking Next on Applicant Type...');
    try {
        const nextSelector = `input[value="Next"], #btnSubmit, #btnNext, input[type="button"][value="Next"]`;
        await page.waitForSelector(nextSelector, { timeout: 30_000 });
        
        // Disconnect strict wait to avoid context destruction issues
        await page.evaluate(() => {
            const nextBtn = document.querySelector('input[value="Next"], #btnSubmit, #btnNext, input[type="button"][value="Next"]') as HTMLElement;
            if (nextBtn) {
                console.log("Found Next button, clicking via JS...");
                nextBtn.click();
            } else {
                console.log("No Next btn found");
            }
        });
        
        // Give KRA plenty of time to post back and render the payment grid
        console.log('Waiting 10 seconds for KRA backend POST to resolve the Form...');
        await page.waitForTimeout(10000);
    } catch (e) {
        console.log('Next button not found or failed. Proceeding...');
    }
    
    console.log('Waiting for Tax Form to render...');
    try {
        // Wait for the KRA backend to attach the main selectors to the active frame
        const taxHeadSelector = 'select#cmbTaxHead';
        await page.waitForFunction((sel: string) => {
            return !!document.querySelector(sel);
        }, taxHeadSelector, { timeout: 60_000 });
    } catch(e) {
        console.log('Timeout waiting for Tax Form to render. Reloading page to try again...');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        try {
            const taxHeadSelector = 'select#cmbTaxHead';
            await page.waitForFunction((sel: string) => {
                return !!document.querySelector(sel);
            }, taxHeadSelector, { timeout: 60_000 });
        } catch (e2) {
            console.log('Second timeout waiting for Tax Form to render. Taking a screenshot and dumping HTML... ');
            await page.screenshot({ path: 'frontend_timeout.png' }).catch(() => {});
            const frames = page.frames();
            console.log(`There are ${frames.length} frames on the page.`);
            let html = await page.content().catch(() => '');
            require('fs').writeFileSync('frontend_dump.html', html);
            console.log('Saved form HTML to frontend_dump.html!');
            throw new Error('Failed to load Tax Form after reload.');
        }
    }

    console.log('Filling out Tax Head (Income Tax)...');
    try {
        await page.locator('select#cmbTaxHead').selectOption({ label: 'Income Tax' });
    } catch(e: any) {
        console.log('Failed to set Income Tax using Locators: ' + e.message);
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
            } else {
                console.log('No Tax Head select found in DOM!');
            }
        });
    }
    await page.waitForTimeout(3000);
    
    console.log('Filling out Tax Sub Head (MRI)...');
    await page.evaluate(() => {
        const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
        if (select) {
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].text.includes('Rent Income (MRI)')) {
                    select.selectedIndex = i;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        }
    });
    // Fallback locator
    await page.locator('select#cmbTaxSubHead').selectOption({ label: '(0111) Income Tax - Rent Income (MRI)' }).catch(() => {});
    await page.waitForTimeout(3000);

    console.log('Filling out Payment Type...');
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
    // Fallback locator
    await page.locator('select#cmbPaymentType').selectOption({ label: 'Self Assessment Tax' }).catch(() => {});
    await page.waitForTimeout(3000);

    console.log('Selecting Period (2026/April)...');
    await page.locator('select#cmbTaxPeriodYear').selectOption({ label: '2026' }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.locator('select#cmbTaxPeriodMonth').selectOption({ label: 'April' }).catch(() => {});
    await page.waitForTimeout(2000);

    console.log('Adding Liability...');
    // We already have a global dialog handler set at line 72, do NOT add page.once('dialog') here or it crashes!
    
    try {
        const addBtnLocator = page.locator('input[value="Add"]:visible, a.subbuttonHome:has-text("Add"):visible, button:has-text("Add"):visible').first();
        await addBtnLocator.click({ timeout: 5000 });
        console.log('Clicked visible Add button successfully.');
    } catch (e: any) {
        console.log('Could not click visible Add button:', e.message);
    }
    
    await page.waitForTimeout(3000);

    console.log('Selecting Payment Mode (Other)...');
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
    // Fallback locator
    await page.locator('select#cmbPaymentMode, select[name="paymentModeId"]').selectOption({ label: 'Other Payment Modes' }).catch(() => {});
    await page.waitForTimeout(3000);
    
    console.log('Clicking Submit...');
    await page.evaluate(() => {
        const submitBtn = document.querySelector('input[value="Submit"]') as HTMLElement;
        if (submitBtn) submitBtn.click();
    });

    console.log('Downloading PRN Slip... Be ready to check downloads folder.');
    try {
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            page.click('a:has-text("Download Payment Slip")')
        ]);
        const tempPath = path.join(__dirname, '..', '..', 'tmp', 'test-prn.pdf');
        await download.saveAs(tempPath);
        console.log('Success! Saved PRN to: ' + tempPath);
    } catch(e) {
        console.log('Failed to auto-download PRN.', e);
        await page.screenshot({ path: 'frontend_prn_fail.png' }).catch(() => {});
        const html = await page.content().catch(() => '');
        require('fs').writeFileSync('frontend_prn_fail.html', html);
        console.log('Dumped failure screenshot and HTML to frontend_prn_fail.png / html');
    }

    console.log('Closing browser context...');
    await context.close();
    console.log('Exiting process...');
    process.exit(0);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
