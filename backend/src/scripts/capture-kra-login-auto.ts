import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import got from 'got';
import { solveCaptchaWithGemma4Buffer } from '../workers/utils/captcha';

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
        if (request.url().includes('login.htm') || request.url().includes('GenerateCaptchaServlet') || request.url().includes('/dwr/')) {
            requests.push({
                url: request.url(),
                method: request.method(),
                headers: request.headers(),
                postData: request.postData(),
            });
        }
    });

    await page.goto('https://itax.kra.go.ke/KRA-Portal/');

    // Step 1: Enter PIN and click Continue
    await page.fill('input#logid', kraPin);
    await page.click('a.btn:has-text("Continue")');

    // Wait for the password fields to appear (successDiv becomes visible)
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });

    // Step 2: Solve captcha automatically
    const captchaSrc = await page.getAttribute('img#captcha_img', 'src');
    if (!captchaSrc) {
        throw new Error('Captcha image not found');
    }
    const captchaUrl = captchaSrc.startsWith('http') ? captchaSrc : `https://itax.kra.go.ke${captchaSrc}`;
    const captchaBuffer = await got(captchaUrl, { responseType: 'buffer' }).then(r => r.body as Buffer);
    const captchaAnswer = await solveCaptchaWithGemma4Buffer(captchaBuffer, { job: { log: async () => {}, updateProgress: async () => {} } as any });
    console.log('Captcha answer:', captchaAnswer);
    await page.fill('input#captcahText', captchaAnswer);

    // Step 3: Fill password
    await page.fill('input[type="password"]', kraPassword);

    // Step 4: Click login
    await page.click('a#loginButton');

    await page.waitForTimeout(10_000);

    const pageHtml = await page.content();
    fs.writeFileSync(path.join(captureDir, 'capture-login-page-result.html'), pageHtml);
    console.log('Page result saved to', path.join(captureDir, 'capture-login-page-result.html'));

    fs.writeFileSync(path.join(captureDir, 'captured-login-requests.json'), JSON.stringify(requests, null, 2));
    console.log('Captured requests saved to', path.join(captureDir, 'captured-login-requests.json'));

    await browser.close();
}

main();
