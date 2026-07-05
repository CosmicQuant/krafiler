/**
 * kra-http-nil-return-test.ts
 *
 * End-to-end HTTP state-machine test for PAYE nil return filing.
 * Uses captured flow from file-paye-nil-existing-flow.ts.
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { KraHttpSession } from '../workers/http/session/KraHttpSession';
import { HttpLoginService } from '../workers/http/navigation/HttpLoginService';
import { ReturnsNavigator } from '../workers/http/navigation/ReturnsNavigator';
import { NilReturnSubmitter } from '../workers/http/filing/NilReturnSubmitter';
import { BinaryDownloader } from '../workers/http/download/BinaryDownloader';

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

function createJobContext(jobId: string) {
    const logs: any[] = [];
    return {
        data: { jobId, userId: 'test', payload: {} },
        progress: 0,
        message: '',
        async log(entry: string) { logs.push(JSON.parse(entry)); console.log(`[JobLog] ${entry}`); },
        async updateProgress(p: number) { this.progress = p; },
        async updateMessage(m: string) { this.message = m; console.log(`[JobStep] ${m}`); },
        async updateData(data: any) { Object.assign(this.data, data); },
        async refresh() {},
        get logs() { return logs; },
    } as any;
}

async function main(): Promise<void> {
    const kraPin = process.env.KRA_PIN?.trim() || 'P051699440T';
    const kraPassword = process.env.KRA_PASSWORD?.trim() || 'Quriah1!';
    const periodFrom = process.env.PERIOD_FROM?.trim() || '2026-06-01';
    const periodTo = process.env.PERIOD_TO?.trim() || '2026-06-30';
    const runId = `http-nil-${Date.now()}`;
    const job = createJobContext(runId);

    console.log('[HTTPNil] Starting HTTP nil return test');
    console.log(`[HTTPNil] PIN: ${kraPin}`);
    console.log(`[HTTPNil] Period: ${periodFrom} to ${periodTo}`);

    const session = new KraHttpSession({ timeout: 60_000 });

    try {
        const loginService = new HttpLoginService(session, job);
        const loginResult = await loginService.execute(kraPin, kraPassword);
        if (!loginResult.success) {
            throw new Error(`Login failed: ${loginResult.message}`);
        }
        console.log('[HTTPNil] Login successful');

        const navigator = new ReturnsNavigator(session, job);
        await navigator.navigateToReturns();
        await navigator.selectNilReturnObligation('paye', kraPin);
        console.log('[HTTPNil] Navigated to nil return details page');

        const submitter = new NilReturnSubmitter(session, job);
        const result = await submitter.submit({
            periodFrom,
            periodTo,
            ownsRentalProperty: false,
            taxObligationType: 'paye',
            kraPin,
        });
        console.log('[HTTPNil] Submission result:', JSON.stringify(result, null, 2));

        // Save last response for inspection
        if (session.lastResponse) {
            const respPath = path.join(TMP_DIR, `${runId}_submit_response.html`);
            await fs.writeFile(respPath, session.lastResponse);
            console.log(`[HTTPNil] Submit response saved to: ${respPath}`);
        }

        if (!result.success || !result.downloadUrl) {
            throw new Error('Submission did not return a download URL');
        }

        const receiptPath = path.join(TMP_DIR, `${runId}_receipt.pdf`);
        const downloader = new BinaryDownloader(session);
        await downloader.downloadPdf(result.downloadUrl, receiptPath);
        console.log(`[HTTPNil] Receipt downloaded to: ${receiptPath}`);

        const stats = await fs.stat(receiptPath);
        console.log(`[HTTPNil] Receipt size: ${stats.size} bytes`);

        const buf = await fs.readFile(receiptPath);
        if (!buf.toString('ascii', 0, 4).startsWith('%PDF')) {
            throw new Error('Downloaded file is not a PDF');
        }
        console.log('[HTTPNil] Receipt validated as PDF');
        console.log('[HTTPNil] SUCCESS');
    } catch (err: any) {
        console.error('[HTTPNil] FAILED:', err.message);
        if (session.lastResponse) {
            const debugPath = path.join(TMP_DIR, `${runId}_last_response.html`);
            await fs.writeFile(debugPath, session.lastResponse);
            console.log(`[HTTPNil] Last response saved to: ${debugPath}`);
        }
        process.exit(1);
    }
}

main();
