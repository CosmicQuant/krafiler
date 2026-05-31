import { Page } from 'playwright';
import { JobContext } from '../../types';
import { generatePRNSlip, PrnConfig } from '../../utils/kra-prn-generator';
import { storeReceiptLocally } from '../../utils/storage';
import { appendJobLog, setJobStep } from '../utils/job-helpers';

export class PrnService {
    private page: Page;
    private job: JobContext;

    constructor(page: Page, job: JobContext) {
        this.page = page;
        this.job = job;
    }

    async generate(config: PrnConfig): Promise<{ prnPath?: string; error?: string }> {
        await setJobStep(this.job, 80, `Generating Payment Slip (PRN) for ${config.taxType}...`);

        const prnDateStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        const prnFileName = `${prnDateStr}_${this.job.data.payload.kraPin}_${config.taxType}_PRN.pdf`;
        const tempPrnPath = process.platform === 'win32'
            ? `C:\\Temp\\kra-receipts\\${prnFileName}`
            : `/tmp/kra-receipts/${prnFileName}`;

        const prnResult = await generatePRNSlip(this.page, config, tempPrnPath);
        if (!prnResult.success || !prnResult.filePath) {
            const errorMessage = prnResult.error || 'Unknown PRN generation error';
            await appendJobLog(this.job, `PRN generation failed: ${errorMessage}`, { progress: 82, level: 'error' });
            return { error: errorMessage };
        }

        const { relativePath } = await storeReceiptLocally(prnResult.filePath, this.job.data.jobId);
        const prnPath = relativePath.replace(/\\/g, '/');
        await appendJobLog(this.job, `PRN generated and stored at ${prnPath}`, { progress: 90 });
        return { prnPath };
    }
}
