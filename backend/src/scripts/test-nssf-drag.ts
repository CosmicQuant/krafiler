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

        console.log('Testing Drag and Drop logic...');
        // Wait up to 10 seconds for the drop zone to appear
        // The primefaces dropzone is typically the .ui-droppable container around the empty message
        const emptyMessageText = page.locator('text=/Drop Unpaid SF24s here/i').first();
        try {
            await emptyMessageText.waitFor({ state: 'visible', timeout: 10000 });
        } catch(e) {
            console.log('Drop zone empty message not found within 10 seconds.');
        }

        const dropZone = page.locator('.ui-droppable').first();
        const draggableRow = page.locator('tr.ui-draggable, tr.ui-datatable-selectable, tr').filter({ hasText: /NORMAL|STANDARD/i }).first();
        
        if (await draggableRow.isVisible()) {
            console.log('Found draggable elements. Attempting native Playwright mouse drag on the grab icon...');

            // The user noted the grab icon is the arrow on the left of the submission row.
            // Often it has a class like .ui-icon-arrow-4-diag or it's just the first cell.
            const sourceIcon = draggableRow.locator('.ui-icon').first();
            // Fallback to the first cell if no explicit icon element is found
            const targetElement = (await sourceIcon.count() > 0) ? sourceIcon : draggableRow.locator('td').first();

            const dragBox = await targetElement.boundingBox();
            const dropBox = await dropZone.boundingBox();

            if (dragBox && dropBox) {
                // Move over the center of the drag handle
                await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
                await page.mouse.down();
                await page.waitForTimeout(500);

                // Move slightly to initiate drag properly in PrimeFaces
                await page.mouse.move(dragBox.x + dragBox.width / 2 + 10, dragBox.y + dragBox.height / 2 + 10, { steps: 5 });
                await page.waitForTimeout(500);

                // Find a sturdy drop coordinate (the center of the .ui-droppable container)
                const dropX = dropBox.x + dropBox.width / 2;
                const dropY = dropBox.y + dropBox.height / 2;

                // Move over the actual droppable container's center
                await page.mouse.move(dropX, dropY, { steps: 50 });
                await page.waitForTimeout(1000); // Give jQuery time to register over
                
                await page.screenshot({ path: 'before-drop.png', fullPage: true });

                await page.mouse.up();
                console.log('Native mouse drag completed over .ui-droppable center.');
                await page.waitForTimeout(4000); // Wait for the drop ajax update

                await page.screenshot({ path: 'after-drop.png', fullPage: true });

                // Also try Playwright's native dragTo just in case that magically works on this portal version
                if (await draggableRow.isVisible()) {
                    console.log('Still not dropped. Trying Playwright locator.dragTo...');
                    try {
                        const targetDropLocator = page.locator('.ui-droppable').first();
                        await targetElement.dragTo(targetDropLocator, { force: true });
                        await page.waitForTimeout(3000);
                        await page.screenshot({ path: 'after-dragTo.png', fullPage: true });
                    } catch(e) {}
                }

                // Check if it actually dropped by seeing if "unpaid" still has the row
                const stillUnpaid = await draggableRow.isVisible();
                if (stillUnpaid) {
                    console.log('Drag and drop seems to have failed (row is still in Unpaid). Attempting jQuery UI fallback...');
                    await page.evaluate(() => {
                        const w = window as any;
                        const $ = w.jQuery;
                        if ($) {
                            const $drag = $('tr.ui-draggable').first();
                            const $drop = $('.ui-droppable').first();
                            if ($drag.length && $drop.length) {
                                let offset = $drop.offset();
                                let e1 = $.Event('mousedown', { pageX: offset.left + 10, pageY: offset.top + 10, which: 1 });
                                $drag.trigger(e1);
                                let e2 = $.Event('mousemove', { pageX: offset.left + 50, pageY: offset.top + 50 });
                                $(document).trigger(e2);
                                let e3 = $.Event('mouseup', { pageX: offset.left + 50, pageY: offset.top + 50 });
                                $(document).trigger(e3);
                            }
                        }
                    });
                    await page.waitForTimeout(4000);
                    await page.screenshot({ path: 'after-fallback-drop.png', fullPage: true });
                }

                console.log('Clicking Save button at the top toolbar (floppy disk icon)...');
                // The save button typically has class .ui-icon-disk or a parent button.
                // It is on the top toolbar: <div class="ui-toolbar-group-left"><button ...>
                const saveButton = page.locator('.ui-toolbar button:has(.ui-icon-disk), button[title="Save"]').first();
                if (await saveButton.count() > 0) {
                    await saveButton.click();
                    console.log('Save button clicked. Waiting for system message popup...');
                    await page.waitForTimeout(3000);
                } else {
                    console.log('Save button not found, falling back to a generic save click if possible...');
                    await page.evaluate(() => {
                        const btns = Array.from(document.querySelectorAll('button'));
                        const btn = btns.find(b => b.innerHTML.includes('ui-icon-disk') || (b.title && b.title.includes('Save')));
                        if (btn) btn.click();
                    });
                    await page.waitForTimeout(3000);
                }

                // Handle the "System Message: The Payment Order was successfully saved" dialog
                console.log('Looking for System Message OK button...');
                const okButton = page.locator('.ui-dialog:visible button').filter({ hasText: /^OK$/i }).first();
                if (await okButton.count() > 0) {
                    console.log('Found OK button in dialog. Clicking it...');
                    await okButton.click();
                    await page.waitForTimeout(2000);
                } else {
                    console.log('No OK button dialog found, continuing...');
                }

                await page.screenshot({ path: 'after-save.png', fullPage: true });

                console.log('Attempting to print the Payment Order...');
                // The print button usually has the text "Print" or class .ui-icon-print
                const printButton = page.locator('button').filter({ hasText: 'Print' }).first();
                if (await printButton.count() > 0) {
                    await printButton.click();
                    console.log('Print button clicked...');
                    await page.waitForTimeout(3000);
                } else {
                    // Fallback to look for print icon in buttons
                    const printIconBtn = page.locator('button:has(.ui-icon-print)').first();
                    if (await printIconBtn.count() > 0) {
                        await printIconBtn.click();
                        console.log('Print icon clicked...');
                        await page.waitForTimeout(3000);
                    } else {
                        console.log('Could not uniquely identify a Print button on the screen.');
                    }
                }

                // Wait for the popup/print screen and then use Playwright to generate a PDF.
                // We'll generate a PDF of the current newly opened/updated screen.
                console.log('Generating Payment Order PDF...');
                const pdfPath = 'NSSF_Payment_Order_' + Date.now() + '.pdf';
                await page.emulateMedia({ media: 'print' });
                await page.pdf({
                    path: pdfPath,
                    format: 'A4',
                    printBackground: true
                });
                console.log('Successfully saved to:', pdfPath);

                console.log('Holding script open for 15 seconds to inspect PDF completion...');
                await page.waitForTimeout(15000);
            } else {
                console.log('Could not get bounding box for drag or drop targets.');
            }

        } else {
            console.log('Could not find the draggable row or drop zone! Make sure an unpaid SF24 exists in the list.');
            console.log('Browser will remain open for 60 seconds for you to inspect...');
            await page.waitForTimeout(60000);
        }
        
    } catch (e) {
        console.error('Fatal error:', e);
    } finally {
        await browser.close();
    }
}

// @ts-ignore
runTest(process.argv[2], process.argv[3]);