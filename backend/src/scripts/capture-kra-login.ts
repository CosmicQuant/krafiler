import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function main() {
    const kraPin = process.env.KRA_TEST_PIN;
    const kraPassword = process.env.KRA_TEST_PASSWORD;

    if (!kraPin || !kraPassword) {
        console.error('Set KRA_TEST_PIN and KRA_TEST_PASSWORD environment variables');
        process.exit(1);
    }

    const captureDir = process.env.KRA_HAR_CAPTURE_DIR || 'C:\\\\Temp\\\\kra-receipts';
    fs.mkdirSync(captureDir, { recursive: true });

    const browser = await chromium.launch({ headless: false, slowMo: 500 });
    const context = await browser.newContext();
    const page = await context.newPage();

    const requests: any[] = [];

    page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().includes('login.htm')) {
            requests.push({
                url: request.url(),
                method: request.method(),
                headers: request.headers(),
                postData: request.postData(),
            });
        }
    });

    await page.goto('https://itax.kra.go.ke/KRA-Portal/');
    console.log('Loaded base page. Enter PIN and click Continue manually, then solve captcha and click Login.');
    console.log('Press Ctrl+C when done to save captured requests.');

    await page.waitForTimeout(60_000);

    fs.writeFileSync(path.join(captureDir, 'captured-login-requests.json'), JSON.stringify(requests, null, 2));
    console.log('Captured requests saved to', path.join(captureDir, 'captured-login-requests.json'));

    await browser.close();
}

main();
