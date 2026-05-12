const fs = require('fs');

const code = `import { chromium } from 'playwright-extra';
import path from 'path';

export async function fileNssfReturn(job: any, username: string, password: string, filePath: string, submissionPeriod: string) {
  const browser = await chromium.launch({ headless: false }); // Set to false to see the actions
  const context = await browser.newContext();
  const page = await context.newPage();

  async function updateProgress(step: number, message: string, progress: number, level: string = 'info') {
    if (job) {
      await job.log(JSON.stringify({ timestamp: new Date().toISOString(), message: \`[Step \${step}/4] \${message}\`, progress, level }));
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

    // 3. Click Create Submission Period
    await updateProgress(3, 'Creating submission period...', 60);
    console.log('Creating Submission Period...');
    await page.click('text=Create Submission Period');
    await page.waitForSelector('text=Submission Mode:*');
    
    const periodInput = page.locator('div.ui-dialog').locator('input[type="text"]');
    await periodInput.fill(submissionPeriod);

    // Click Open
    await page.click('div.ui-dialog >> text=Open');
    
    // Wait for the modal to close and the table to update
    await page.waitForTimeout(3000);

    // 4. Click File Upload for the new period
    await updateProgress(4, 'Uploading file...', 80);
    console.log('Clicking File Upload...');
    // We want the most recent "File Upload" link, which should be in the top row.
    await page.click('text=File Upload >> nth=0'); 
    
    await page.waitForTimeout(3000);

    // 5. Upload File
    console.log('Uploading file...');
    // In JSF, file inputs might be tricky. Usually clicking the Choose button opens OS dialog.
    // With Playwright, we set the input[type="file"] directly.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.resolve(filePath));

    // Wait for the file to be "chosen"
    await page.waitForTimeout(2000);

    // Click Upload button
    await page.click('text=Upload');

    console.log('File upload initiated. Check the UI for completion.');
    await updateProgress(4, 'File uploaded!', 100);
    
    // Wait for user to observe before closing
    await page.waitForTimeout(10000);

  } catch (error: any) {
    if(job) {
       await job.log(JSON.stringify({ timestamp: new Date().toISOString(), message: \`Execution error: \${error.message}\`, progress: null, level: 'error' }));
    }
    console.error('Error during NSSF upload:', error);
    throw error;
  } finally {
    await browser.close();
  }
}
`;
fs.writeFileSync('backend/src/scripts/file-nssf-return.ts', code);
