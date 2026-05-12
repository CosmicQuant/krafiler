const fs = require('fs'); const content = \import { chromium } from 'playwright';
import path from 'path';

async function run() {
    console.log('Launching browser...');
    const browser = await chromium.launch({ headless: false, slowMo: 100, channel: 'chrome', args: ['--start-maximized', '--no-sandbox'] });
    const context = await browser.newContext({ viewport: null, acceptDownloads: true });
    const page = await context.newPage();

    console.log('Navigating to KRA Portal...');
    await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    
    await page.fill('input[name=\
logid\]', 'P052063835W');
    await page.evaluate(() => { (globalThis as any).CheckPIN(); }).catch(() => {});
    await page.waitForSelector('input[type=\password\]:visible', { timeout: 15000 });
    await page.fill('input[type=\password\]', '0724004872');
    
    console.log('Waiting for you to enter Captcha manually...');
    try {
        await page.waitForFunction(() => {
            const input = document.querySelector('input[name=\captcahText\]') as HTMLInputElement;
            return input ; input.value.trim().length >= 2;
        }, { timeout: 120000 });
        await page.waitForTimeout(500); 
        console.log('Captcha entered! Logging in...');
        await page.click('#loginButton');
    } catch(e) {}
    
    await page.waitForURL('**/login.htm**', { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(3000); 

    console.log('Injecting direct Navigation to Payment Registration...');
    await page.evaluate(() => {
        // Find the 'Payment Registration' link anywhere in the page and forcefully click it
        const links = Array.from(document.querySelectorAll('a'));
        const prLink = links.find(a => a.textContent?.trim() === 'Payment Registration');
        if (prLink) {
            prLink.click();
        } else {
            // Fallback: KRA portal puts it in a literal JS call sometimes
            if (typeof (window as any).showPaymentRegForm === 'function') {
                (window as any).showPaymentRegForm();
            } else {
                window.location.href = '/KRA-Portal/paymentRegistration.htm?actionCode=beforeLoadPRForm';
            }
        }
    });

    console.log('Waiting for Applicant Type page to load...');
    await page.waitForSelector('input[value=\Next\], #nextBtn', { timeout: 45000 }).catch(async () => {
        console.log('Refresh triggering because page stalled...');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForSelector('input[value=\Next\], #nextBtn', { timeout: 45000 }).catch(() => {});
    });

    console.log('Clicking Next on Applicant Type...');
    await page.evaluate(() => {
        const nextBtn = document.querySelector('input[value=\Next\], #nextBtn') as HTMLElement;
        if (nextBtn) nextBtn.click();
    });
    
    console.log('Waiting for Tax Form to render...');
    await page.waitForSelector('select[name=\taxHeadId\]', { timeout: 60000 }).catch(async () => {
        console.log('Tax form hung up. Refreshing...');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForSelector('select[name=\taxHeadId\]', { timeout: 60000 }).catch(() => {});
    });

    console.log('Filling out Tax Head (Income Tax)...');
    await page.locator('select[name=\taxHeadId\]').selectOption({ label: 'Income Tax' }).catch(() => {});
    await page.waitForTimeout(4000);
    
    console.log('Filling out Tax Sub Head (MRI)...');
    await page.evaluate(() => {
        const select = document.querySelector('select[name=\taxSubHeadId\]') as HTMLSelectElement;
        if (select) {
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].text.includes('MRI')) {
                    select.selectedIndex = i;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        }
    });
    await page.waitForTimeout(4000);

    console.log('Filling out Payment Type...');
    await page.locator('select[name=\paymentTypeId\]').selectOption({ label: 'Self Assessment Tax' }).catch(() => {});
    await page.waitForTimeout(2000);

    console.log('Selecting Period...');
    await page.locator('select[name=\taxPeriodYear\]').selectOption({ label: '2026' }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.locator('select[name=\taxPeriodMonth\]').selectOption({ label: 'April' }).catch(() => {});
    await page.waitForTimeout(2000);

    console.log('Adding Liability...');
    page.once('dialog', async dialog => await dialog.accept());
    
    await page.evaluate(() => {
        const radio = document.querySelector('table#submitPRForm_txRegTable tbody tr td input[type=\radio\]') as HTMLElement;
        if (radio) radio.click();
    });
    await page.waitForTimeout(1000);
    
    await page.evaluate(() => {
        const addBtn = document.querySelector('input[value=\Add\]') as HTMLElement;
        if (addBtn) addBtn.click();
    });
    await page.waitForTimeout(2000);

    console.log('Selecting Mode...');
    await page.locator('select[name=\paymentModeId\]').selectOption({ label: 'Other Payment Modes' }).catch(() => {});
    await page.waitForTimeout(2000);
    
    console.log('Clicking Submit...');
    await page.evaluate(() => {
        const submitBtn = document.querySelector('input[value=\Submit\]') as HTMLElement;
        if (submitBtn) submitBtn.click();
    });

    console.log('Downloading PRN Slip...');
    try {
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            page.click('a:has-text(\Download
Payment
Slip\)')
        ]).catch(() => [null]);
        if (download) {
            const tempPath = path.join(__dirname, '..', '..', 'tmp', 'test-prn-2.pdf');
            await download.saveAs(tempPath);
            console.log('Success! Saved PRN to: ' + tempPath);
        } else {
            console.log('No automatic download detected. Check browser.');
        }
    } catch(e) {
        console.log('Error catching download...', e);
    }
}
run().catch(console.error);\;
fs.writeFileSync('src/scripts/test-prn.ts', content);
