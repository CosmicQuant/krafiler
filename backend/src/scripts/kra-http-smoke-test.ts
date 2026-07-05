/**
 * kra-http-smoke-test.ts
 *
 * Smoke test for the HTTP state machine.
 * Fetches the KRA login page, extracts token_key and CAPTCHA URL, and downloads
 * the CAPTCHA image to verify the HTTP client + cookie jar + parser stack.
 *
 * Run with:
 *   cd backend && npx ts-node src/scripts/kra-http-smoke-test.ts
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { KraHttpSession } from '../workers/http/session/KraHttpSession';
import { parseCaptchaImageUrl, parseTokenKey } from '../workers/http/parsers';

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

async function main(): Promise<void> {
    const session = new KraHttpSession({ timeout: 60_000 });

    console.log('[Smoke] Fetching KRA portal base page to establish session...');
    const basePage = await session.get('', { timeout: 60_000 });
    console.log('[Smoke] Base page length:', basePage.length);

    const baseHtmlPath = path.join(TMP_DIR, `smoke-base-${Date.now()}.html`);
    await fs.writeFile(baseHtmlPath, basePage);
    console.log('[Smoke] Base page saved to:', baseHtmlPath);

    let tokenKey = parseTokenKey(basePage);
    let captchaUrl = parseCaptchaImageUrl(basePage, 'https://itax.kra.go.ke/KRA-Portal/');
    let loginPage = basePage;

    if (!tokenKey || !captchaUrl) {
        console.log('[Smoke] Login form not in base page, trying login.htm...');
        loginPage = await session.get('login.htm', { timeout: 60_000 });
        tokenKey = parseTokenKey(loginPage) ?? tokenKey;
        captchaUrl = parseCaptchaImageUrl(loginPage, 'https://itax.kra.go.ke/KRA-Portal/') ?? captchaUrl;
    }

    console.log('[Smoke] token_key:', tokenKey);
    console.log('[Smoke] Login page length:', loginPage.length);

    const htmlPath = path.join(TMP_DIR, `smoke-login-${Date.now()}.html`);
    await fs.writeFile(htmlPath, loginPage);
    console.log('[Smoke] Login page saved to:', htmlPath);

    console.log('[Smoke] CAPTCHA URL:', captchaUrl);

    if (!captchaUrl) {
        throw new Error('CAPTCHA URL not found');
    }

    console.log('[Smoke] Downloading CAPTCHA image...');
    const captchaBuffer = await session.getBuffer(captchaUrl, { timeout: 15_000 });
    console.log('[Smoke] CAPTCHA bytes:', captchaBuffer.length);

    await fs.mkdir(TMP_DIR, { recursive: true });
    const captchaPath = path.join(TMP_DIR, `smoke-captcha-${Date.now()}.png`);
    await fs.writeFile(captchaPath, captchaBuffer);
    console.log('[Smoke] CAPTCHA saved to:', captchaPath);

    console.log('[Smoke] Done.');
}

main().catch((err) => {
    console.error('[Smoke] Failed:', err);
    process.exit(1);
});
