import 'dotenv/config';
import { chromium } from 'playwright';

async function main() {
    const kraPin = process.env.KRA_TEST_PIN;
    const kraPassword = process.env.KRA_TEST_PASSWORD;

    if (!kraPin || !kraPassword) {
        console.error('Set KRA_TEST_PIN and KRA_TEST_PASSWORD environment variables');
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: false, slowMo: 500 });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://itax.kra.go.ke/KRA-Portal/');

    // Enter PIN and click Continue
    await page.fill('input#logid', kraPin);
    await page.click('a.btn:has-text("Continue")');

    // Wait for password field
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });

    // Fill password
    await page.fill('input[type="password"]', kraPassword);

    // Extract form values and run encryption in browser context
    const browserCrypto = await page.evaluate(() => {
        const generator = (document.getElementById('generator') as HTMLInputElement).value;
        const modulus = (document.getElementById('modulus') as HTMLInputElement).value;
        const senderIntrmKey = (document.getElementById('senderIntrmKey') as HTMLInputElement).value;
        const passwordEl = document.getElementById('xxZTT9p2wQ') as HTMLInputElement;
        const password = passwordEl.value;
        const loginIdEl = document.getElementById('userName') as HTMLInputElement;
        const loginId = loginIdEl.value;

        // @ts-ignore
        const secretNoClient = generateSecretNoClient();
        // @ts-ignore
        const rcpntIntrmKey = createRecipientInterimKey(generator, modulus, senderIntrmKey);
        // @ts-ignore
        const sharedSecretKey = createSharedSecretKey(senderIntrmKey, secretNoClient, modulus);
        // @ts-ignore
        const encryptedPwd = AESEncryptCtr(password, sharedSecretKey, '256');
        // @ts-ignore
        const cryptpwd = hex_sha1(password + loginId);

        return {
            generator,
            modulus,
            senderIntrmKey,
            secretNoClient,
            rcpntIntrmKey,
            sharedSecretKey,
            encryptedPwd,
            cryptpwd,
            loginId,
        };
    });

    console.log('Browser crypto:', JSON.stringify(browserCrypto, null, 2));

    await browser.close();
}

main().catch((e) => console.error(e.message));
