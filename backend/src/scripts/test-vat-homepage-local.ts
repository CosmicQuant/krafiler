/**
 * test-vat-homepage-local.ts
 *
 * Local test that runs the full worker flow for current-month VAT ZIP generation.
 * Reuses the existing login, credit-brought-forward, and withholding extraction logic,
 * then exercises the new homepage VAT Transactions download path.
 *
 * Run with:
 *   cd backend
 *   npx ts-node src/scripts/test-vat-homepage-local.ts
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { processFilingJob } from '../workers/kraFilingWorker';
import { JobContext, FilingJob } from '../types';

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

const KRA_PIN = 'A003102127T';
const KRA_PASSWORD = '07239368870';

const jobId = `local-homepage-${Date.now()}`;

async function log(message: string) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${jobId}] ${message}`;
    console.log(line);
    const logPath = path.join(TMP_DIR, `${jobId}.log`);
    await fs.mkdir(TMP_DIR, { recursive: true });
    await fs.appendFile(logPath, line + '\n');
}

function createFakeJobContext(): JobContext {
    const now = new Date();
    const periodFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const periodTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const data: FilingJob = {
        jobId,
        userId: 'local-test-user',
        createdAt: new Date().toISOString(),
        payload: {
            kraPin: KRA_PIN,
            kraPassword: KRA_PASSWORD,
            periodFrom,
            periodTo,
            taxObligationType: 'vat',
            ownsRentalProperty: false,
            vatCurrentMonthDownload: true,
        },
    };

    return {
        id: jobId,
        data,
        progress: 0,
        async log(entry: string) {
            (data as any).stepLogs = (data as any).stepLogs || [];
            (data as any).stepLogs.push(entry);
            await log(entry);
        },
        async updateProgress(progress: number) { this.progress = progress; },
        async updateMessage(message: string) { await log(message); },
        async updateData(patch: Partial<FilingJob>) { Object.assign(data, patch); },
        async refresh() { /* no-op */ },
    };
}

async function main() {
    await log('Starting full worker flow for current-month VAT ZIP generation');
    await log(`Using PIN: ${KRA_PIN}`);

    // Ensure headed mode and local Chrome are preferred so the user can watch.
    process.env.PLAYWRIGHT_HEADLESS = 'false';
    process.env.KRA_BROWSER_EXECUTABLE_PATH = process.env.KRA_BROWSER_EXECUTABLE_PATH || '';

    const job = createFakeJobContext();
    const result = await processFilingJob(job);
    await log(`Result: ${JSON.stringify(result, null, 2)}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
