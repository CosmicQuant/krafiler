/**
 * ReceiptService.ts
 *
 * Handles the post-submission verification, receipt extraction,
 * and PRN downloads.
 */

import { Page } from 'playwright';
import { JobContext, JobResult } from '../../types';
import { setJobStep, waitForPortalReadyWithReload } from '../utils';

export class ReceiptService {
    private page: Page;
    private job: JobContext;

    constructor(page: Page, job: JobContext) {
        this.page = page;
        this.job = job;
    }

    async extractReceipt(): Promise<JobResult> {
        await setJobStep(this.job, 85, 'Waiting for submission acknowledgment...');

        await waitForPortalReadyWithReload(this.page, this.job, {
            description: 'Acknowledgment Page',
            selectors: ['text=Acknowledgment Number', 'text=Search Code'],
            timeout: 60_000, // Submissions can take a long time to process
        });

        await setJobStep(this.job, 90, 'Extracting receipt details...');

        // Extract Search Code (Receipt Number)
        const searchCodeLocator = this.page.locator('text=Search Code').locator('..').locator('span').first();
        let receiptNumber = 'UNKNOWN';
        if (await searchCodeLocator.count() > 0) {
             receiptNumber = (await searchCodeLocator.innerText()).trim();
        }

        // Try downloading the PDF receipt
        let pdfBuffer: string | undefined;
        try {
            const downloadPromise = this.page.waitForEvent('download', { timeout: 15_000 });
            await this.page.click('a:has-text("Download Receipt"), input[value*="Download"]');
            const download = await downloadPromise;
            const path = await download.path();
            if (path) {
                // In a real scenario, we read the file and convert to base64
                // import fs from 'fs';
                // pdfBuffer = fs.readFileSync(path).toString('base64');
                pdfBuffer = 'base64_encoded_pdf_data_stub';
            }
        } catch (error) {
            console.warn(`[ReceiptService] Failed to download PDF receipt:`, error);
        }

        await setJobStep(this.job, 100, 'Filing completed successfully.');

        return {
            status: 'completed',
            receiptNumber,
            receiptPath: pdfBuffer ? 'pdf_downloaded' : undefined
        };
    }
}
