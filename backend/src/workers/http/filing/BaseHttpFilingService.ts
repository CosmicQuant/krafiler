import path from 'path';
import { JobContext } from '../../../types';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { storeReceiptLocally } from '../../../utils/storage';
import { uploadFile, receiptPath as gcsReceiptPath } from '../../../lib/cloudStorage';
import { KraHttpSession } from '../session/KraHttpSession';
import { BinaryDownloader } from '../download/BinaryDownloader';

export interface FilingReceiptResult {
    receiptNumber: string | null;
    downloadUrl?: string | null;
    noticeId?: string | null;
}

export interface FilingExecuteResult {
    receiptPath?: string;
    receiptNumber: string | null;
}

/**
 * Common interface for all per-obligation HTTP filing services.
 *
 * The orchestrator handles login and navigation; each concrete service only
 * needs to implement the obligation-specific form loading/submission logic
 * and optionally download a receipt.
 */
export abstract class BaseHttpFilingService {
    protected session: KraHttpSession;
    protected job: JobContext;

    constructor(session: KraHttpSession, job: JobContext) {
        this.session = session;
        this.job = job;
    }

    /**
     * Main entry point. Orchestrates the obligation-specific filing and receipt download.
     */
    async execute(input: Record<string, unknown>): Promise<FilingExecuteResult> {
        await appendJobLog(this.job, `Starting ${this.obligationLabel()} filing via HTTP`, { progress: 65 });

        const filingResult = await this.file(input);

        if (!filingResult) {
            throw new Error(`${this.obligationLabel()} filing service returned no result`);
        }

        await appendJobLog(this.job, `${this.obligationLabel()} return submitted. Receipt: ${filingResult.receiptNumber ?? 'N/A'}`, { progress: 90 });

        const receiptPath = await this.downloadReceipt(filingResult);

        return {
            receiptPath,
            receiptNumber: filingResult.receiptNumber,
        };
    }

    /**
     * Human-readable label for logs, e.g. "PAYE Nil" or "Turnover Tax".
     */
    protected abstract obligationLabel(): string;

    /**
     * Obligation-specific filing logic. Must return the receipt number and/or
     * a download URL/noticeId so the base class can fetch the receipt.
     */
    protected abstract file(input: Record<string, unknown>): Promise<FilingReceiptResult>;

    /**
     * Optional hook to run before filing. Default no-op.
     */
    protected async beforeFile(_input: Record<string, unknown>): Promise<void> {
        // no-op
    }

    /**
     * Downloads the receipt PDF when the filing result provides enough information.
     */
    protected async downloadReceipt(result: FilingReceiptResult): Promise<string | undefined> {
        const receiptDownloadUrl = result.downloadUrl ??
            (result.noticeId ? `/KRA-Portal/eCerificate.htm?actionCode=loadReceipt&noticeId=${result.noticeId}` : null);

        if (!receiptDownloadUrl) {
            await appendJobLog(this.job, 'No receipt download URL available', { progress: 94, level: 'info' });
            return undefined;
        }

        await setJobStep(this.job, 94, 'Downloading receipt (HTTP)');

        const jobId = this.job.data.jobId;
        const kraPin = String(this.job.data.payload.kraPin ?? 'unknown');
        const taxObligationType = String(this.job.data.payload.taxObligationType ?? 'unknown');
        const receiptDateStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        const receiptFileName = `${receiptDateStr}_${kraPin}_${taxObligationType}_Receipt.pdf`;
        const tempDir = process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp');
        const tempReceiptPath = path.join(tempDir, 'kra-receipts', receiptFileName);

        const downloader = new BinaryDownloader(this.session);
        await downloader.downloadPdf(receiptDownloadUrl, tempReceiptPath);

        const stored = await storeReceiptLocally(tempReceiptPath, jobId);
        const receiptPath = stored.relativePath.replace(/\\/g, '/');
        await appendJobLog(this.job, `Receipt stored at ${receiptPath}`, { progress: 94 });

        try {
            const userId = this.job.data.userId || 'dev-user';
            const clientId = this.job.data.payload.clientId || 'unknown';
            const receiptGcsPath = gcsReceiptPath(userId, clientId, jobId, path.basename(stored.receiptPath));
            await uploadFile(stored.receiptPath, receiptGcsPath, { contentType: 'application/pdf' });
            await appendJobLog(this.job, `Receipt uploaded to Cloud Storage: ${receiptGcsPath}`, { progress: 94 });
        } catch (uploadErr: any) {
            console.error(`[Worker][${jobId}] Failed to upload receipt to GCS:`, uploadErr.message);
            await appendJobLog(this.job, `Receipt upload to Cloud Storage failed: ${uploadErr.message}`, { progress: 94, level: 'info' });
        }

        return receiptPath;
    }
}
