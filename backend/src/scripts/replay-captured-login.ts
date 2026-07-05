import 'dotenv/config';
import got from 'got';
import { CookieJar } from 'tough-cookie';
import fs from 'fs';
import path from 'path';

async function main() {
    const captureDir = process.env.KRA_HAR_CAPTURE_DIR || 'C:\\\\Temp\\\\kra-receipts';
    const captured = JSON.parse(fs.readFileSync(path.join(captureDir, 'captured-login-requests.json'), 'utf8'));
    const loginRequest = captured.find((r: any) => r.url.includes('login.htm') && r.method === 'POST');

    if (!loginRequest) {
        console.error('No captured login POST found');
        process.exit(1);
    }

    const jar = new CookieJar();

    // First fetch base page to get cookies
    await got('https://itax.kra.go.ke/KRA-Portal/', {
        cookieJar: jar,
        headers: {
            'User-Agent': loginRequest.headers['user-agent'],
            'Sec-Ch-Ua': loginRequest.headers['sec-ch-ua'],
            'Sec-Ch-Ua-Mobile': loginRequest.headers['sec-ch-ua-mobile'],
            'Sec-Ch-Ua-Platform': loginRequest.headers['sec-ch-ua-platform'],
        },
    });

    console.log('Cookies:', await jar.getCookies('https://itax.kra.go.ke/KRA-Portal/'));

    // Replay the captured login POST
    const response = await got.post(loginRequest.url, {
        cookieJar: jar,
        body: loginRequest.postData,
        headers: {
            'Content-Type': loginRequest.headers['content-type'],
            Origin: loginRequest.headers['origin'],
            Referer: loginRequest.headers['referer'],
            'Upgrade-Insecure-Requests': loginRequest.headers['upgrade-insecure-requests'],
            'User-Agent': loginRequest.headers['user-agent'],
            'Sec-Ch-Ua': loginRequest.headers['sec-ch-ua'],
            'Sec-Ch-Ua-Mobile': loginRequest.headers['sec-ch-ua-mobile'],
            'Sec-Ch-Ua-Platform': loginRequest.headers['sec-ch-ua-platform'],
        },
    });

    console.log('Response status:', response.statusCode);
    fs.writeFileSync(path.join(captureDir, 'replay-login-response.html'), response.body);
    console.log('Response saved to', path.join(captureDir, 'replay-login-response.html'));

    if (response.body.toLowerCase().includes('malicious')) {
        console.log('REPLAY FAILED: malicious characters');
    } else if (response.body.toLowerCase().includes('welcome to itax online service area')) {
        console.log('REPLAY returned to base page (likely wrong captcha in capture)');
    } else {
        console.log('REPLAY outcome unknown');
    }
}

main().catch((e) => console.error(e.message));
