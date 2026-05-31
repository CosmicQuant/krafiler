import path from 'path';
import fs from 'fs/promises';
import { Page } from 'playwright';
import { JobContext } from '../../types';
import { appendJobLog } from '../utils/job-helpers';
import { ensureDeclarationAccepted } from '../utils/filing-helpers';

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

export class TotFilingService {
    private page: Page;
    private job: JobContext;

    constructor(page: Page, job: JobContext) {
        this.page = page;
        this.job = job;
    }

    async upload(totYear: number, totMonth: number, totTurnover: number): Promise<void> {
        if (!Number.isFinite(totYear) || !Number.isFinite(totMonth) || !Number.isFinite(totTurnover)) {
            throw new Error('Turnover Tax filing requires totYear, totMonth, and totTurnover in the queued job payload');
        }

        const outputDir = path.join(TMP_DIR, 'generated-zips');
        await fs.mkdir(outputDir, { recursive: true });

        await appendJobLog(this.job, `Generating TOT ZIP for ${totMonth}/${totYear} with turnover ${totTurnover}`, { progress: 68 });

        const { packageToTZip } = await import('../../scripts/kra-tot-generator');
        const resolvedZipPath = await packageToTZip({
            taxPayerPin: this.job.data.payload.kraPin,
            returnPeriod: { year: totYear, month: totMonth },
            turnover: totTurnover,
            returnType: 'Original' as const,
        }, outputDir);

        const fileInput = this.page.locator('input[type="file"]').first();
        await fileInput.waitFor({ timeout: 20_000 });
        await fileInput.setInputFiles(resolvedZipPath);

        await ensureDeclarationAccepted(this.page);
        await appendJobLog(this.job, `Uploaded TOT ZIP file ${path.basename(resolvedZipPath)} and accepted the declaration`, { progress: 70 });
    }
}
