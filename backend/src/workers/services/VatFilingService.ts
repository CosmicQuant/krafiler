import { Page } from 'playwright';
import { JobContext, FilingJob } from '../../types';
import { resolveUploadArtifactPath, selectUploadFile, waitForFileInputSelection, ensureDeclarationAccepted, downloadVatAutoPopulatedReturn, downloadVatTransactionsFromHomepage } from '../utils/filing-helpers';
import { appendJobLog } from '../utils/job-helpers';

export interface VatPrepareResult {
    vatSummary: {
        inputVat: number;
        outputVat: number;
        previousCredit: number;
        payableVat: number;
        netVatBalance: number;
    };
    generatedZipUrl: string;
    generatedZipLabel: string;
    sourcePackageUrl: string;
    sourcePackageLabel: string;
}

export class VatFilingService {
    private page: Page;
    private job: JobContext;

    constructor(page: Page, job: JobContext) {
        this.page = page;
        this.job = job;
    }

    async prepareFromPortal(options: { kraPin: string; clientName: string; periodFrom: string; periodTo: string; previousCredit: number; withholdingAmount?: number; sectionBWithoutPinSales?: number }): Promise<VatPrepareResult> {
        const sourceZipPath = await downloadVatAutoPopulatedReturn(this.page, this.job, options.kraPin);

        try {
            const artifacts = await import('../../scripts/vat-return-generator').then((mod) =>
                mod.prepareVatReturnArtifacts({
                    sourceZipPath,
                    clientName: options.clientName,
                    taxpayerPin: options.kraPin,
                    periodFrom: options.periodFrom,
                    periodTo: options.periodTo,
                    previousCredit: options.previousCredit,
                    withholdingAmount: options.withholdingAmount,
                    sectionBWithoutPinSales: options.sectionBWithoutPinSales,
                })
            );

            await appendJobLog(this.job, `Prepared VAT upload ZIP ${artifacts.generatedZipLabel}`, { progress: 78 });
            return artifacts;
        } catch (error: any) {
            await appendJobLog(this.job, `VAT artifact preparation failed: ${error.message}`, {
                progress: 75,
                level: 'error',
            });
            throw error;
        }
    }

    async prepareCurrentMonthFromHomepage(options: { kraPin: string; clientName: string; periodFrom: string; periodTo: string; previousCredit: number; withholdingAmount?: number; sectionBWithoutPinSales?: number }): Promise<VatPrepareResult> {
        const sourceZipPath = await downloadVatTransactionsFromHomepage(this.page, this.job, options.kraPin);

        try {
            const artifacts = await import('../../scripts/vat-return-generator').then((mod) =>
                mod.prepareVatReturnArtifacts({
                    sourceZipPath,
                    clientName: options.clientName,
                    taxpayerPin: options.kraPin,
                    periodFrom: options.periodFrom,
                    periodTo: options.periodTo,
                    previousCredit: options.previousCredit,
                    withholdingAmount: options.withholdingAmount,
                    sectionBWithoutPinSales: options.sectionBWithoutPinSales,
                })
            );

            await appendJobLog(this.job, `Prepared current-month VAT ZIP ${artifacts.generatedZipLabel}`, { progress: 78 });
            return artifacts;
        } catch (error: any) {
            await appendJobLog(this.job, `Current-month VAT artifact preparation failed: ${error.message}`, {
                progress: 75,
                level: 'error',
            });
            throw error;
        }
    }

    async upload(vatZipUrl: string): Promise<void> {
        const zipPath = await resolveUploadArtifactPath(vatZipUrl, this.job.data.jobId, 'vat');
        const fileName = zipPath.split(/[\\/]/).pop() ?? 'vat.zip';
        await appendJobLog(this.job, `Resolved VAT ZIP on disk: ${zipPath}`, { progress: 68 });

        const fileInput = this.page.locator('input[type="file"]').first();
        await fileInput.waitFor({ timeout: 20_000 });
        const uploadMethod = await selectUploadFile(this.page, fileInput, zipPath);
        const selectedValue = await waitForFileInputSelection(fileInput, fileName, 3_000);

        if (!selectedValue.toLowerCase().includes(fileName.toLowerCase())) {
            const snapshot = await import('../utils/portal-helpers').then((mod) => mod.snapshotPageControls(this.page));
            await appendJobLog(this.job, `VAT attachment did not stick after ${uploadMethod.method} binding. Page snapshot: ${snapshot}`, {
                progress: 69,
                level: 'error',
            });
            throw new Error(`KRA did not acknowledge VAT ZIP selection for ${fileName}`);
        }

        await ensureDeclarationAccepted(this.page);
        await appendJobLog(this.job, `Selected VAT ZIP ${fileName} using ${uploadMethod.method} and accepted the declaration`, { progress: 70 });
    }
}
