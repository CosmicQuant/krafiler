import 'dotenv/config';
import got from 'got';
import { CookieJar } from 'tough-cookie';
import fs from 'fs';
import path from 'path';
import { solveCaptchaWithGemma4Buffer } from '../workers/utils/captcha';

async function main() {
    const captureDir = process.env.KRA_HAR_CAPTURE_DIR || 'C:\\\\Temp\\\\kra-receipts';
    fs.mkdirSync(captureDir, { recursive: true });

    const jar = new CookieJar();
    await got('https://itax.kra.go.ke/KRA-Portal/', {
        cookieJar: jar,
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const captchaUrl = `https://itax.kra.go.ke/KRA-Portal/GenerateCaptchaServlet.do?sourcePage=LOGIN&rand=${Math.random() * 1000}`;
    const captchaBuffer = await got(captchaUrl, {
        cookieJar: jar,
        responseType: 'buffer',
        headers: {
            'User-Agent': 'Mozilla/5.0',
            Referer: 'https://itax.kra.go.ke/KRA-Portal/',
        },
    }).then((r) => r.body as Buffer);

    const filename = `captcha-${Date.now()}.png`;
    fs.writeFileSync(path.join(captureDir, filename), captchaBuffer);
    console.log('Captcha saved to', path.join(captureDir, filename));

    const answer = await solveCaptchaWithGemma4Buffer(captchaBuffer, {
        job: { log: async () => {}, updateProgress: async () => {} } as any,
    });
    console.log('Gemma4 answer:', answer);
}

main().catch((e) => console.error(e.message));
