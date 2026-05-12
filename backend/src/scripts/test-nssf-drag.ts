import { chromium } from 'playwright-extra';

async function runTest(username?: string, password?: string) {
    if (!username || !password) {
        console.error('Please provide username and password as arguments: npx ts-node test-nssf-drag.ts <user> <pass>');
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    let jobLog = (msg: string) => console.log(msg);

    try {
        console.log('Navigating to login...');
        await page.goto('https://eservice.nssfkenya.co.ke/eSF24/faces/login.xhtml');
        await page.reload();

        await page.evaluate(() => {
            const forms = document.querySelectorAll('form');
            forms.forEach(f => {
                if (f.action && f.action.includes(';eSF24SESSIONID=')) {
                    f.action = f.action.split(';')[0];
                }
            });
        });

        console.log('Logging in...');
        await page.fill('input[id$="username"]', username);
        await page.fill('input[id$="password"]', password);
        await page.click('input[value="Login"]');
        await page.waitForTimeout(5000); // give it time to load or show error

        console.log('Checking login state. Taking screenshot: login-state.png');
        await page.screenshot({ path: 'login-state.png', fullPage: true });

        console.log('Navigating to e-SF24 Management...');
        const eSF24Link = page.locator('text=e-SF24 Management');
        try {
            await eSF24Link.waitFor({ state: 'visible', timeout: 10000 });
            await eSF24Link.click();
        } catch (e) {
            console.log('Failed to find e-SF24 Management menu item. Likely login failed. Look at login-state.png');
            throw e;
        }
        await page.waitForTimeout(3000);

        console.log('Navigating to Payment Order...');
        const paymentOrderLink = page.locator('a, span').filter({ hasText: 'Payment Order' }).first();
        await paymentOrderLink.click({ force: true });
        await page.waitForTimeout(4000);

        console.log('Setting Bank Code to "1"...');
        try {
            await page.evaluate(() => {
                const labels = Array.from(document.querySelectorAll('label'));
                const bankLabel = labels.find(l => l.textContent && l.textContent.includes('Bank Code'));
                if (bankLabel && bankLabel.htmlFor) {
                    const input = document.getElementById(bankLabel.htmlFor) as HTMLInputElement;
                    if (input) {
                        input.value = '1';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            });
        } catch(e) {}
        await page.waitForTimeout(2000);

        console.log('Using alternative Search mechanism instead of Drag and Drop...');
        
        let companyName = 'COMPANY';
        try {
            const empText = await page.evaluate(() => {
                const trs = Array.from(document.querySelectorAll('tr'));
                for(let tr of trs) {
                    if (tr.textContent && tr.textContent.includes('Employer Info:')) {
                        const input = tr.querySelector('input');
                        if (input) return input.value;
                    }
                }
                return '';
            });
            if (empText) {
                companyName = empText.replace(/^\S+\s+/, '').trim().replace(/[^a-zA-Z0-9_ -]/g, '');
            }
        } catch(e) {}

        console.log('Clicking the Search magnifying-glass icon on the toolbar...');
        // PrimeFaces typically uses .ui-icon-search
        const searchBtn = page.locator('.ui-toolbar button:has(.ui-icon-search)').first();
        if (await searchBtn.count() > 0) {
            await searchBtn.click();
        } else {
            // Backup
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const btn = btns.find(b => b.innerHTML.includes('ui-icon-search') || (b.title && b.title.includes('Search')));
                if (btn) btn.click();
            });
        }
        await page.waitForTimeout(3000);

        console.log('Interacting with the Search Payment Orders dialog...');
        const dialog = page.locator('.ui-dialog:visible').first();
        
        if (await dialog.isVisible()) {
            const today = new Date();
            const dd = String(today.getDate()).padStart(2, '0');
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const yyyy = today.getFullYear();
            const dateStr = `${dd}/${mm}/${yyyy}`; // Format DD/MM/YYYY
    
            console.log(`Setting Issue Dates to today: ${dateStr}...`);
            // Find all date pickers inside the active dialog
            const dateInputs = dialog.locator('input[title*="Date"], input.hasDatepicker');
            if (await dateInputs.count() >= 2) {
                await dateInputs.nth(0).fill(dateStr);
                await dateInputs.nth(0).press('Tab'); // Trigger changes
                await page.waitForTimeout(500);
                
                await dateInputs.nth(1).fill(dateStr);
                await dateInputs.nth(1).press('Tab');
                await page.waitForTimeout(500);
            } else {
                console.log('Could not find enough date inputs in dialog! Continuing fallback...');
            }
    
            console.log('Clicking Search button inside dialog...');
            const dialogSearchBtn = dialog.locator('button').filter({ hasText: /^Search$/i }).first();
            await dialogSearchBtn.click();
            await page.waitForTimeout(3000);
    
            console.log('Selecting the result row from the table...');
            const resultRow = dialog.locator('.ui-datatable-data tr').filter({ hasNotText: 'No records found' }).first();
            if (await resultRow.isVisible()) {
                await resultRow.click();
                await page.waitForTimeout(1000);
    
                console.log('Clicking Select button to apply...');
                const selectBtn = dialog.locator('button').filter({ hasText: /^Select$/i }).first();
                await selectBtn.click();
                await page.waitForTimeout(4000); // Wait for modal to close and page to update
            } else {
                console.log('No results found in search dialog. Cannot proceed.');
                await page.screenshot({ path: 'no-search-results.png', fullPage: true });
                throw new Error('No Payment Orders found for today.');
            }
        }

        console.log('Clicking Save button at the top toolbar (floppy disk icon)...');
        const saveButton = page.locator('.ui-toolbar button:has(.ui-icon-disk), button[title="Save"]').first();
        if (await saveButton.count() > 0) {
            await saveButton.click();
            await page.waitForTimeout(3000);
        } else {
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const btn = btns.find(b => b.innerHTML.includes('ui-icon-disk') || (b.title && b.title.includes('Save')));
                if (btn) btn.click();
            });
            await page.waitForTimeout(3000);
        }

        console.log('Handling the System Message OK dialog...');
        const okButton = page.locator('.ui-dialog:visible button').filter({ hasText: /^OK$/i }).first();
        if (await okButton.count() > 0) {
            console.log('Found OK button in dialog. Clicking it...');
            await okButton.click();
            await page.waitForTimeout(2000);
        }
        await page.screenshot({ path: 'after-save.png', fullPage: true });

        // Determine period dynamically for the file name (use the current MMYYYY if we can't extract it)
        const today = new Date();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        let periodSlug = `${mm}${yyyy}`;
        try {
            const tableText = await page.locator('.ui-datatable-data').innerText();
            const match = tableText.match(/(\d{1,2})\/(\d{4})/);
            if (match) {
                const month = match[1].padStart(2, '0');
                const year = match[2];
                periodSlug = `${month}${year}`;
            }
        } catch(e) {}

        console.log('Attempting to print the Payment Order...');
        // Wait for PDF response or page event
        let pdfBuffer: Buffer | null = null;
        let isPdf = false;
        
        context.on('response', async (response) => {
            const contentType = response.headers()['content-type'];
            if (contentType === 'application/pdf') {
                isPdf = true;
                console.log('Intercepted PDF response!');
                try {
                    pdfBuffer = await response.body();
                } catch (e) {
                    console.log('Could not read PDF body', e);
                }
            }
        });

        const pagePromise = context.waitForEvent('page'); // Wait for new browser window tab to pop up

        const printIconBtn = page.locator('.ui-toolbar button:has(.ui-icon-print)').first();
        if (await printIconBtn.count() > 0) {
            await printIconBtn.click();
        } else {
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const btn = btns.find(b => b.innerHTML.includes('ui-icon-print'));
                if (btn) btn.click();
            });
        }

        console.log('Waiting for the new print window to open...');
        let newPage;
        try {
            newPage = await pagePromise;
            await newPage.waitForLoadState('networkidle', { timeout: 10000 });
            await newPage.waitForTimeout(2000);
        } catch (e) {
            console.log('New print window did not open, attempting to print from main window...');
            newPage = page;
        }

        // Build file name: JAHAWI LIMITED NSSF 042026.pdf
        const safeCompanyName = companyName.substring(0, 30).trim();
        const pdfPath = `${safeCompanyName} NSSF ${periodSlug}.pdf`;
        console.log('Generating Payment Order PDF at: ', pdfPath);
        
        if (pdfBuffer) {
            console.log('Saving intercepted pristine PDF bytes...');
            require('fs').writeFileSync(pdfPath, pdfBuffer);
        } else {
            console.log('Fallback: taking a PDF screenshot of the view (might be wrapped by PDF viewer UI)');
            await newPage.emulateMedia({ media: 'print' });
            await newPage.pdf({
                path: pdfPath,
                format: 'A4',
                printBackground: true,
                margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
                // scale: 0.75,
            });
        }
        console.log('Successfully saved to:', pdfPath);

        console.log('Holding script open for 20 seconds to inspect PDF completion in background...');
        await page.waitForTimeout(20000);

    } catch (e) {
        console.error('Fatal error:', e);
    } finally {
        await browser.close();
    }
}

// @ts-ignore
runTest(process.argv[2], process.argv[3]);