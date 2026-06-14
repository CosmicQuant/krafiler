import { Page } from 'playwright';
import { JobContext } from '../../types';
import { generatePRNSlip, PrnConfig } from '../../utils/kra-prn-generator';
import { storeReceiptLocally } from '../../utils/storage';
import { uploadBuffer, receiptPath as gcsReceiptPath } from '../../lib/cloudStorage';
import { appendJobLog, setJobStep } from '../utils/job-helpers';
import * as fs from 'fs/promises';

export class PrnService {
    private page: Page;
    private job: JobContext;

    constructor(page: Page, job: JobContext) {
        this.page = page;
        this.job = job;
    }

    async generate(config: PrnConfig): Promise<{ prnPath?: string; prnGcsPath?: string; error?: string }> {
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

        // Read the PRN PDF into memory before moving it, then store locally for backward compatibility.
        let prnBuffer: Buffer;
        try {
            prnBuffer = await fs.readFile(prnResult.filePath);
        } catch (readErr: any) {
            console.error(`[PRN] Failed to read generated PRN file:`, readErr.message);
            await appendJobLog(this.job, `PRN read failed: ${readErr.message}`, { progress: 90, level: 'error' });
            return { error: `PRN file could not be read: ${readErr.message}` };
        }

        const { relativePath } = await storeReceiptLocally(prnResult.filePath, this.job.data.jobId);
        const prnPath = relativePath.replace(/\\/g, '/');

        // Upload to Cloud Storage so the file persists in Cloud Run
        let prnGcsPath: string | undefined;
        try {
            const userId = this.job.data.userId || 'dev-user';
            const clientId = this.job.data.payload.clientId || 'unknown';
            const jobId = this.job.data.jobId;
            prnGcsPath = gcsReceiptPath(userId, clientId, jobId, prnFileName);
            await uploadBuffer(prnBuffer, prnGcsPath, { contentType: 'application/pdf' });
            await appendJobLog(this.job, `PRN uploaded to Cloud Storage: ${prnGcsPath}`, { progress: 90 });
        } catch (uploadErr: any) {
            console.error(`[PRN] Failed to upload PRN to GCS:`, uploadErr.message);
            await appendJobLog(this.job, `PRN upload to Cloud Storage failed: ${uploadErr.message}`, { progress: 90, level: 'info' });
        }

        await appendJobLog(this.job, `PRN generated and stored at ${prnPath}`, { progress: 90 });
        return { prnPath, prnGcsPath };
    }
}
