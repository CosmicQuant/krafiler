import 'dotenv/config';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { KraHttpSession } from '../workers/http/session/KraHttpSession';
import { HttpLoginService } from '../workers/http/navigation/HttpLoginService';
import { ReturnsNavigator } from '../workers/http/navigation/ReturnsNavigator';
import { VatReturnSubmitter } from '../workers/http/filing/VatReturnSubmitter';
import type { JobContext } from '../types';

async function main() {
    const kraPin = process.argv[2] ?? '';
    const kraPassword = process.argv[3] ?? '';
    const periodFrom = process.argv[4] ?? '2026-06-01';
    const periodTo = process.argv[5] ?? '2026-06-30';
    const vatZipPath = process.argv[6] ?? '';

    if (!kraPin || !kraPassword || !vatZipPath) {
        console.error('Usage: npx ts-node src/scripts/test-http-vat-upload.ts <pin> <password> <periodFrom> <periodTo> <vatZipPath>');
        console.error('  vatZipPath: local path to the generated VAT return ZIP to upload');
        process.exit(1);
    }

    if (!fs.existsSync(vatZipPath)) {
        console.error(`VAT ZIP not found: ${vatZipPath}`);
        process.exit(1);
    }

    const jobId = `test-http-vat-upload-${Date.now()}`;
    const job = {
        id: jobId,
        data: {
            jobId,
            userId: 'test-user',
            payload: {
                kraPin,
                taxObligationType: 'vat',
                periodFrom,
                periodTo,
                vatZipUrl: vatZipPath,
                clientId: 'test-client',
            },
        },
        progress: 0,
        log: async (entry: string) => console.log('[job log]', entry.substring(0, 150)),
        updateProgress: async (p: number) => { console.log('[progress]', p); },
        updateMessage: async (m: string) => { console.log('[message]', m); },
        updateData: async () => {},
        refresh: async () => {},
    } as unknown as JobContext;

    const session = new KraHttpSession({ timeout: 60_000 });

    try {
        // Step 1: Login
        console.log('--- Step 1: Login ---');
        const loginService = new HttpLoginService(session, job);
        const loginResult = await loginService.execute(kraPin, kraPassword);
        console.log('Login result:', { passwordExpired: loginResult.passwordExpired, mobileVerificationRequired: loginResult.mobileVerificationRequired });

        // Step 2: Navigate to returns and select VAT obligation
        console.log('--- Step 2: Navigate to returns ---');
        const navigator = new ReturnsNavigator(session, job);
        await navigator.navigateToReturns(false);
        await navigator.selectReturnObligation('vat', kraPin);

        // Step 3: Upload VAT ZIP
        console.log('--- Step 3: Upload VAT return ---');
        const submitter = new VatReturnSubmitter(session, job);
        const result = await submitter.execute({
            kraPin,
            periodFrom,
            periodTo,
            vatZipUrl: vatZipPath,
        });

        console.log('\n=== VAT Upload Result ===');
        console.log('Receipt Number:', result.receiptNumber);
        console.log('Receipt Path:', result.receiptPath);
    } catch (err: any) {
        console.error('VAT upload failed:', err.message);
        if (err.context) {
            console.error('Context:', JSON.stringify(err.context, null, 2));
        }
        if (err.rawResponse) {
            console.error('Raw response snippet:', err.rawResponse.slice(0, 500));
        }
        process.exit(1);
    }
}

main();
