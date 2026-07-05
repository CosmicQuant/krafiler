import 'dotenv/config';
import { KraHttpSession } from '../workers/http/session/KraHttpSession';
import { HttpLoginService } from '../workers/http/navigation/HttpLoginService';
import { loadKraLoginCrypto } from '../workers/http/crypto/kraLoginCrypto';

async function main() {
    const kraPin = process.env.KRA_TEST_PIN;
    const kraPassword = process.env.KRA_TEST_PASSWORD;
    const otpCode = process.env.KRA_TEST_OTP;

    if (!kraPin || !kraPassword) {
        console.error('Set KRA_TEST_PIN and KRA_TEST_PASSWORD environment variables');
        process.exit(1);
    }

    // Pre-load crypto so any fetch/parse errors happen before we hit the portal.
    await loadKraLoginCrypto();

    const session = new KraHttpSession({ timeout: 60_000, debug: true });
    const jobLogs: string[] = [];
    const job: any = {
        id: 'login-test',
        data: {},
        progress: undefined,
        log: async (entry: string) => {
            jobLogs.push(entry);
            console.log('[JOB LOG]', entry);
        },
        updateProgress: async (progress: number) => {
            job.progress = progress;
        },
        updateMessage: async () => Promise.resolve(),
        updateData: async () => Promise.resolve(),
        refresh: async () => Promise.resolve(),
    };

    const loginService = new HttpLoginService(session, job);

    // Capture base page for debugging if login fails before submission.
    try {
        const basePage = await session.get('', { timeout: 60_000 });
        const fs = await import('fs');
        const path = require('path');
        const captureDir = process.env.KRA_HAR_CAPTURE_DIR || 'C:\\\\Temp\\\\kra-receipts';
        fs.mkdirSync(captureDir, { recursive: true });
        fs.writeFileSync(path.join(captureDir, 'login-base-page.html'), basePage);
        console.log('Base page saved to', path.join(captureDir, 'login-base-page.html'));
    } catch (e) {
        console.error('Failed to capture base page:', e);
    }

    // Patch session.post to log the form body for debugging.
    const originalPost = session.post.bind(session);
    session.post = async (path: string, body: any, options?: any) => {
        const fs = await import('fs');
        const p = require('path');
        const captureDir = process.env.KRA_HAR_CAPTURE_DIR || 'C:\\\\Temp\\\\kra-receipts';
        fs.mkdirSync(captureDir, { recursive: true });
        fs.writeFileSync(p.join(captureDir, 'login-post-body.json'), JSON.stringify({ path, body }, null, 2));
        console.log('POST body saved to', p.join(captureDir, 'login-post-body.json'));
        return originalPost(path, body, options);
    };

    try {
        const result = await loginService.execute(kraPin, kraPassword, otpCode);
        console.log('Login result:', JSON.stringify(result, null, 2));
        if (result.success) {
            console.log('HTTP login succeeded');
            const fs = await import('fs');
            const path = require('path');
            const captureDir = process.env.KRA_HAR_CAPTURE_DIR || 'C:\\\\Temp\\\\kra-receipts';
            fs.mkdirSync(captureDir, { recursive: true });
            fs.writeFileSync(path.join(captureDir, 'login-success-response.html'), session.lastResponse || '');
            console.log('Success response saved to', path.join(captureDir, 'login-success-response.html'));
        } else {
            console.log('HTTP login did not succeed:', result.message);
            process.exit(1);
        }
    } catch (err: any) {
        console.error('HTTP login failed:', err.message);
        if (err.rawResponse) {
            console.error('Raw response snippet:', err.rawResponse.slice(0, 1000));
        }
        // Save the last response for debugging even on failure.
        try {
            const fs = await import('fs');
            const path = require('path');
            const captureDir = process.env.KRA_HAR_CAPTURE_DIR || 'C:\\\\Temp\\\\kra-receipts';
            fs.mkdirSync(captureDir, { recursive: true });
            fs.writeFileSync(path.join(captureDir, 'login-response.html'), session.lastResponse || '');
            console.log('Last response saved to', path.join(captureDir, 'login-response.html'));
        } catch {}
        process.exit(1);
    }
}

main();
