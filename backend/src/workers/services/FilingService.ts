/**
 * FilingService.ts
 *
 * Domain-specific logic for handling forms and uploading the specific
 * zip files required by different tax obligations.
 */

import { Page } from 'playwright';
import { Job } from 'bullmq';
import { FilingJob, TaxObligationType, JobResult } from '../../types';
import { setJobStep, appendJobLog, waitForPortalReadyWithReload, humanDelay } from '../utils';

export class FilingService {
    private page: Page;
    private job: Job<FilingJob>;

    constructor(page: Page, job: Job<FilingJob>) {
        this.page = page;
        this.job = job;
    }

    async processFiling(): Promise<void> {
        const { taxObligationType } = this.job.data.payload;

        await setJobStep(this.job, 45, `Processing form data for ${taxObligationType}...`);

        if (this.job.data.payload.isNil) {
             await this.processNilReturn();
             return;
        }

        // Wait for the common form fields to load
        await waitForPortalReadyWithReload(this.page, this.job, {
            description: 'Tax Filing Form',
            selectors: ['select[name="returnPeriodFrom"]', 'input[type="file"]', 'input[name="fileUpload"]']
        });

        // Set period if needed
        const periodSelector = 'input[name="returnPeriodFrom"]'; // Can vary, usually auto-filled or selected via calendar
        if (this.job.data.payload.periodFrom && await this.page.locator(periodSelector).count() > 0) {
            // Simplified for demonstration; KRA usually requires complex calendar clicks
            await this.page.fill(periodSelector, this.job.data.payload.periodFrom);
        }

        // Branch based on tax obligation
        // (Note: in a real refactoring, these would be separated into strategy classes if they grow large)
        switch (taxObligationType) {
            case 'vat':
                await this.uploadZip('VAT', this.job.data.payload.vatZipUrl);
                break;
            case 'paye':
                await this.uploadZip('PAYE', this.job.data.payload.payeZipUrl);
                break;
            case 'turnover_tax':
                await this.uploadZip('TOT', undefined); // No zip url for TOT in payload yet
                break;
            case 'monthly_rental_income':
                await this.processMri();
                break;
            default:
                throw new Error(`Filing strategy for ${taxObligationType} is not implemented.`);
        }
    }

    private async processNilReturn(): Promise<void> {
        // Nil returns usually go through a different menu: Returns -> File Nil Return
        throw new Error('Nil Return filing strategy not fully implemented in refactor.');
    }

    private async uploadZip(type: string, fileUrl?: string): Promise<void> {
        if (!fileUrl) {
             throw new Error(`${type} filing requires a zipped excel file buffer URL.`);
        }

        await setJobStep(this.job, 60, `Uploading ${type} ZIP file...`);

        // Convert byte array back to Buffer if it came through JSON
        // In reality, download from fileUrl. We'll use a dummy buffer here.
        const buffer = Buffer.from('dummy file content');

        const fileChooserPromise = this.page.waitForEvent('filechooser');
        await this.page.click('input[type="file"], input[name="fileUpload"]');
        const fileChooser = await fileChooserPromise;

        await fileChooser.setFiles({
            name: `${type}_Return.zip`,
            mimeType: 'application/zip',
            buffer: buffer
        });

        await humanDelay(500, 1000);

        // Check for agreement checkbox
        const agreeCheckbox = this.page.locator('input[type="checkbox"][name*="agree"]');
        if (await agreeCheckbox.count() > 0) {
             await agreeCheckbox.check();
        }

        await setJobStep(this.job, 75, 'Submitting file...');
        await this.page.click('button:has-text("Submit"), input[value="Submit"]');

        // Handle dialog confirm
        this.page.once('dialog', async (dialog) => {
            await appendJobLog(this.job, `Accepted submission dialog: ${dialog.message()}`);
            await dialog.accept();
        });
    }

    private async processMri(): Promise<void> {
         // MRI is often a web-form directly instead of a zip file.
         throw new Error('MRI web-form strategy not fully implemented in refactor.');
    }
}
