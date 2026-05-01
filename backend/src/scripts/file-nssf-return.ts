import { chromium } from 'playwright-extra';
import * as path from 'path';

export async function fileNssfReturn(job: any, username: string, password: string, filePath: string, submissionPeriod: string) {
  const browser = await chromium.launch({ headless: false }); // Set to false to see the actions
  const context = await browser.newContext();
  const page = await context.newPage();

  async function updateProgress(step: number, message: string, progress: number, level: string = 'info') {
    if (job) {
      await job.log(JSON.stringify({ timestamp: new Date().toISOString(), message: `[Step ${step}/4] ${message}`, progress, level }));
      await job.updateProgress(progress);
    }
  }

  try {
    await updateProgress(1, 'Navigating to NSSF login page...', 10);
    console.log('Navigating to NSSF login page...');
    await page.goto('https://eservice.nssfkenya.co.ke/eSF24/faces/login.xhtml');

    // Force a reload to establish the session cookie and prevent JSF URL rewriting (which causes the 404 on login)
    await page.reload();

    // Strip the session ID from the form action just in case it's still embedded
    await page.evaluate(() => {
      const forms = document.querySelectorAll('form');
      forms.forEach(f => {
        if (f.action && f.action.includes(';eSF24SESSIONID=')) {
          f.action = f.action.split(';')[0];
        }
      });
    });

    // 1. Log in
    await updateProgress(1, 'Logging into NSSF portal...', 20);
    console.log('Logging in...');
    await page.fill('input[id$="username"]', username); // Assuming ID ends with username
    await page.fill('input[id$="password"]', password);
    await page.click('input[value="Login"]');

    // Wait for the dashboard to load
    await page.waitForTimeout(3000); 

    // 2. Click on e-SF24 Management
    await updateProgress(2, 'Navigating to e-SF24 Management...', 40);
    console.log('Navigating to e-SF24 Management...');
    await page.click('text=e-SF24 Management');
    await page.waitForTimeout(3000);

// 3. Click SF24 Actions to expand the menu
      await updateProgress(3, 'Opening SF24 Actions...', 60);
      console.log('Opening SF24 Actions...');
      
      // Click 'SF24 Actions' only if 'Create Submission Period' is not visible yet
      if (await page.locator('text="Create Submission Period"').first().isHidden()) {
          await page.click('text="SF24 Actions"');
          await page.waitForTimeout(1500); // give the menu animation time to slide down
      }

      console.log('Clicking Create Submission Period...');
      await page.locator('text="Create Submission Period"').first().click({ force: true });
      
      // Wait for the modal/dialog showing "Submission Mode:*"
      await page.waitForSelector('text=Submission Mode:*', { state: 'visible', timeout: 15000 });
      
      const visibleDialog = page.locator('div.ui-dialog:visible');
      const periodInput = visibleDialog.locator('input[type="text"]').first();
        
        console.log('Focusing and typing period:', submissionPeriod);
        await periodInput.click();
        await page.waitForTimeout(500);
        // Many PrimeFaces masks auto-format. We clear and type slowly
        await periodInput.fill('');
        await page.waitForTimeout(200);
        await periodInput.pressSequentially(submissionPeriod, { delay: 100 });
        
        console.log('Checking dropdowns for Income/Contribution types matching the SF24 file...');
        const dropdownTriggers = await visibleDialog.locator('.ui-selectonemenu-trigger').all();
        for (const trigger of dropdownTriggers) {
            await trigger.click({ force: true });
            await page.waitForTimeout(1000);
            
            const optionsPanel = page.locator('div.ui-selectonemenu-panel:visible').first();
            if (await optionsPanel.isVisible()) {
                const optionItems = await optionsPanel.locator('li.ui-selectonemenu-item').all();
                let foundMatch = false;
                
                const allTexts = await Promise.all(optionItems.map(async (i: any) => await i.textContent()));
                console.log('Available dropdown options:', allTexts.map(t => t?.trim()));

                for (const item of optionItems) {
                    const text = await item.textContent();
                    const lower = text?.toLowerCase() || '';
                    if (lower.includes('normal') || lower.includes('standard')) {
                        console.log(`Selecting correct mapped option: ${text}`);
                        await item.click({ force: true });
                        foundMatch = true;
                        break;
                    }
                }
                
                if (!foundMatch) {
                    console.log('No matching option found (not Normal/Standard), leaving default...');
                    // Press ESC to close an open PrimeFaces dropdown
                    await page.keyboard.press('Escape'); 
                }
                await page.waitForTimeout(1000);
            }
        }

    console.log('Clicking Open button...');
    const openBtn = visibleDialog.locator('text="Open"').first();
    await openBtn.evaluate((node: HTMLElement) => {
        // Native DOM click bypasses any CSS overlay problems
        node.click();
    });
    
    // Wait for the success modal that says "Creation of Submission Period"
    console.log('Waiting for success modal to appear...');
    await page.waitForTimeout(2000);
    
    const successDialog = page.locator('div.ui-dialog:visible', { hasText: 'OK' }).first();
    if (await successDialog.isVisible()) {
        console.log('Clicking OK on success modal...');
        await successDialog.locator('button', { hasText: 'OK' }).first().click({ force: true });
        await page.waitForTimeout(1500); // Give it time to close
    }
    
    // Wait for the table to update
    await page.waitForTimeout(3000);

    // 4. Click File Upload for the new period
    await updateProgress(4, 'Uploading file...', 80);
    console.log('Clicking File Upload link in table...');
    // We want the actual <a> link in the Actions column for "File Upload"
    const fileUploadLink = page.locator('a', { hasText: 'File Upload' }).filter({ hasText: /^File Upload$/i }).first();
    await fileUploadLink.click({ force: true }); 
    
    await page.waitForTimeout(3000);

    // 5. Upload File
    console.log('Uploading file...');
    // In JSF, file inputs might be tricky. Usually clicking the Choose button opens OS dialog.
    // With Playwright, we set the input[type="file"] directly.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.resolve(filePath));

    // Wait for the file to be "chosen"
    await page.waitForTimeout(2000);

    // Click Upload button (it's next to Choose)
    console.log('Clicking Upload button...');
    const uploadBtn = page.locator('button, a').filter({ hasText: /Upload/i }).first();
    await uploadBtn.click({ force: true });

    // Wait for the upload success message and the Back button
    console.log('Waiting for upload to complete...');
    await page.waitForTimeout(3000);
    
    // In the second screenshot, there is a "Back" button
    console.log('Clicking Back button...');
    const backBtn = page.locator('button, a').filter({ hasText: /^Back$/i }).first();
    await backBtn.click({ force: true });
    
    // Wait for navigation back to SF24 Submissions table
    await page.waitForTimeout(4000);
    
    // Once back, click the "Check Submission" link for the newly attached file
    console.log('Clicking Check Submission...');
    const checkSubBtn = page.locator('a').filter({ hasText: 'Check Submission' }).first();
    if (await checkSubBtn.isVisible()) {
        await checkSubBtn.click({ force: true });
        
        console.log('Waiting for "Submissions Error Check" initiated modal...');
        await page.waitForTimeout(3000); // Wait for modal to pop up
        const initiatedDialog = page.locator('div.ui-dialog:visible', { hasText: 'been initiated' }).first();
        if (await initiatedDialog.isVisible()) {
            await initiatedDialog.locator('button', { hasText: 'OK' }).first().click({ force: true });
        }

        console.log('Waiting 20 seconds for processing...');
        await updateProgress(5, 'Evaluating errors...', 90);
        await page.waitForTimeout(20000); 

        console.log('Clicking "Submission Check Progress Update"...');
        const progressUpdateBtn = page.locator('a, ui-commandlink').filter({ hasText: /Progress Update/i }).first();
        if (await progressUpdateBtn.isVisible()) {
            await progressUpdateBtn.click({ force: true });
            
            console.log('Waiting for final "State has been modified" modal...');
            await page.waitForTimeout(3000);
            const modifiedDialog = page.locator('div.ui-dialog:visible', { hasText: 'modified' }).first();
            if (await modifiedDialog.isVisible()) {
                await modifiedDialog.locator('button', { hasText: 'OK' }).first().click({ force: true });
            }
        }
    }

      // Step 6: Submit the file exactly as user clicks "Submission"
      console.log('Navigating to submit the prepared period...');
      await updateProgress(6, 'Finalizing submission...', 88);
      // Wait for table to reload with the "TO BE SUBMITTED" state
      await page.waitForTimeout(4000);
      
      const submitActionLink = page.locator('a').filter({ hasText: /^Submission$/i }).first();
      await submitActionLink.click({ force: true });
      console.log('Clicked "Submission". Waiting for page reload...');
      // Wait for the action to complete fully
      await page.waitForTimeout(5000);

      // Step 7: Proceed to Payment Order
      console.log('Navigating to Payment Order...');
      await updateProgress(7, 'Creating Payment Order...', 93);
      const paymentOrderLink = page.locator('a, span').filter({ hasText: 'Payment Order' }).first();
      if (await paymentOrderLink.isVisible()) {
          await paymentOrderLink.click({ force: true });
          await page.waitForTimeout(4000);
          
          console.log('Entering Bank Code...');
          // Using evaluate for robustness since PrimeFaces DOM can be nested deeply
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
          // Also Playwright fallback just in case: Look for input directly right of the Bank Code text
          try {
              const bankLabel = page.locator('label').filter({ hasText: /Bank Code/i }).first();
              const bankInputId = await bankLabel.getAttribute('for');
              if (bankInputId) {
                  await page.fill(`[id="${bankInputId}"]`, '1');
              }
          } catch(e) {}

          await page.waitForTimeout(2000);

          // Step 8: Search and Select Unpaid SF24 (Bypassing bugged native Drag and Drop)
          console.log('Searching and Selecting Unpaid SF24...');
          await updateProgress(8, 'Attaching SF24 to Payment Order...', 95);
          
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
          const searchBtn = page.locator('.ui-toolbar button:has(.ui-icon-search)').first();
          if (await searchBtn.count() > 0) {
              await searchBtn.click();
          } else {
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
                  console.log('No results found in search dialog. Cannot proceed with alternative method.');
              }
          }
  
          // Step 9: Save Payment Order
          console.log('Clicking Save on Payment Order...');
          const saveBtn = page.locator('.ui-toolbar button:has(.ui-icon-disk), button[title="Save"]').first();
          if (await saveBtn.count() > 0) {
              await saveBtn.click();
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

          // Step 10: Print Payment Order to PDF
          console.log('Attempting to print the Payment Order...');
          await updateProgress(9, 'Generating Payment PDF...', 98);

          const today2 = new Date();
          const mm2 = String(today2.getMonth() + 1).padStart(2, '0');
          const yyyy2 = today2.getFullYear();
          let periodSlug = `${mm2}${yyyy2}`;
          try {
              const tableText = await page.locator('.ui-datatable-data').innerText();
              const match = tableText.match(/(\d{1,2})\/(\d{4})/);
              if (match) {
                  const month = match[1].padStart(2, '0');
                  const year = match[2];
                  periodSlug = `${month}${year}`;
              }
          } catch(e) {}
  
          // Wait for PDF response or page event
          let pdfBuffer: Buffer | null = null;
          let isPdf = false;
          
          context.on('response', async (response) => {
              const contentType = response.headers()['content-type'];
              if (contentType === 'application/pdf') {
                  isPdf = true;
                  console.log('Intercepted PDF response for payment order!');
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
  
          const safeCompanyName = companyName.substring(0, 30).trim();
          const finalPdfPath = `${safeCompanyName} NSSF ${periodSlug}.pdf`;
          console.log('Saving Payment Order PDF at: ', finalPdfPath);
          
          if (pdfBuffer) {
              console.log('Saving intercepted pristine PDF bytes...');
              require('fs').writeFileSync(finalPdfPath, pdfBuffer);
          } else {
              console.log('Fallback: taking a PDF screenshot of the view (might be wrapped by PDF viewer UI)');
              await newPage.emulateMedia({ media: 'print' });
              await newPage.pdf({
                  path: finalPdfPath,
                  format: 'A4',
                  printBackground: true,
                  margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
              });
          }
      }

      console.log('File upload initiated, submitted, and Payment Order created.');
      await updateProgress(10, 'Done! Payment Order generated', 100);
      
      // Wait for user to observe before closing
      await page.waitForTimeout(10000);

    } catch (error: any) {
      if(job) {
         await job.log(JSON.stringify({ timestamp: new Date().toISOString(), message: `Execution error: ${error.message}`, progress: null, level: 'error' }));
      }
      try { 
        await page.screenshot({ path: 'nssf-stuck.png' }); 
        const links = await page.$$eval('a, div, span, button', (els) => els.map(e => e.textContent?.trim()).filter(Boolean));
        console.log('Available UI text blocks:', Array.from(new Set(links)));
      } catch(e){} 
      console.error('Error during NSSF upload:', error);
      throw error;
    } finally {
    await browser.close();
  }
}
