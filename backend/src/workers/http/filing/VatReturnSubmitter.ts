import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import FormData from 'form-data';
import { loadHtml } from '../parsers';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { parseFormFields, parsePortalErrors, parseSubmissionResult } from '../parsers';
import { KraError, KraErrorCode, mapPortalMessage } from '../errors';
import { BaseHttpFilingService, FilingReceiptResult } from './BaseHttpFilingService';
import { resolveUploadArtifactPath } from '../../utils/filing-helpers';

export interface VatUploadInput {
    kraPin: string;
    periodFrom: string;
    periodTo: string;
    vatZipUrl: string;
}

/**
 * HTTP-based VAT return filing service.
 *
 * Flow:
 *   1. The upload form is already loaded by ReturnsNavigator.selectReturnObligation.
 *   2. Resolve the generated VAT ZIP from URL/local path.
 *   3. Build a multipart/form-data body with the ZIP file attached.
 *   4. POST to eReturns.htm?actionCode=excelUpload.
 *   5. Parse receipt or error from the KRA response.
 */
export class VatReturnSubmitter extends BaseHttpFilingService {
    protected obligationLabel(): string {
        return 'VAT';
    }

    async file(input: Record<string, unknown>): Promise<FilingReceiptResult> {
        const vatInput: VatUploadInput = {
            kraPin: String(input.kraPin),
            periodFrom: String(input.periodFrom),
            periodTo: String(input.periodTo),
            vatZipUrl: String(input.vatZipUrl),
        };

        await setJobStep(this.job, 70, 'Preparing VAT return upload (HTTP)');

        const periodFrom = this.formatPortalDate(vatInput.periodFrom);
        const periodTo = this.formatPortalDate(vatInput.periodTo);

        await appendJobLog(this.job, `VAT filing period ${periodFrom} - ${periodTo}`, { progress: 72 });

        // Resolve the VAT ZIP file on disk (download from URL if needed).
        const jobId = this.job.data.jobId;
        const zipPath = await resolveUploadArtifactPath(vatInput.vatZipUrl, jobId, 'vat');
        const fileName = path.basename(zipPath);
        await appendJobLog(this.job, `Resolved VAT ZIP on disk: ${zipPath}`, { progress: 74 });

        if (!await fsp.access(zipPath).then(() => true).catch(() => false)) {
            throw new KraError(
                KraErrorCode.VALIDATION_ERROR,
                `VAT ZIP file not found on disk: ${zipPath}`,
            );
        }

        // Parse hidden/visible fields from the upload form page.
        const formHtml = this.session.lastResponse ?? '';
        const fields = parseFormFields(formHtml, 'form[action*="eReturns.htm"], form#command, form[name="excelUploadReturns"]');

        await this.session.snapshotHtml('form-load');
        await this.session.snapshotFormFields('form-load', 'excelUploadReturns', {
            periodFrom,
            periodTo,
            obligationId: fields.obligationId,
            obligationName: fields.obligationName,
        });

        const returnTypeValue = this.resolveReturnTypeValue(formHtml, fields.cmbReturnType);

        // Build multipart body matching the KRA VAT upload form.
        const form = new FormData();

        const monthValue = periodFrom.slice(3, 5);
        const yearValue = periodFrom.slice(6, 10);

        const baseFields: Record<string, string> = {
            ...fields,
            token_key: this.session.requireToken(),
            amendmentFlag: fields.amendmentFlag ?? 'N',
            obligationId: fields.obligationId ?? '9',
            obligationName: fields.obligationName ?? 'Value Added Tax (VAT)',
            taxpayerPin: vatInput.kraPin,
            autoPopulate: fields.autoPopulate ?? 'Y',
            nilReturnFlag: 'N',
            cmbReturnType: returnTypeValue,
            txtPeriodFrom: periodFrom,
            txtPeriodTo: periodTo,
            months: monthValue,
            years: yearValue,
            procFrmDt: periodFrom,
            procToDt: periodTo,
        };

        // Remove control names that must be submitted specially.
        delete baseFields['file[0]'];
        delete baseFields['sfile[1]'];
        delete baseFields['sbmt_btn'];
        delete baseFields['btnSubmit'];
        delete baseFields['chkTermsAndCond'];

        for (const [key, value] of Object.entries(baseFields)) {
            if (value !== undefined && value !== null) {
                form.append(key, String(value));
            }
        }

        // File upload and visible controls.
        form.append('file[0]', fs.createReadStream(zipPath), { filename: fileName, contentType: 'application/zip' });
        form.append('chkTermsAndCond', 'on');
        form.append('sbmt_btn', 'Submit');

        await setJobStep(this.job, 80, 'Uploading VAT return (HTTP)');
        await appendJobLog(this.job, `Submitting VAT ZIP ${fileName} to KRA`, { progress: 82 });

        const submitResponse = await this.session.postMultipart(
            'eReturns.htm?actionCode=excelUpload',
            form,
            {
                timeout: 120_000,
                headers: {
                    ...form.getHeaders(),
                    Referer: 'https://itax.kra.go.ke/KRA-Portal/eReturns.htm',
                },
            }
        );

        await this.session.snapshotHtml('post-submit');

        const errors = parsePortalErrors(submitResponse);
        const mapped = errors.map((e) => mapPortalMessage(e)).find(Boolean);
        if (mapped) {
            throw mapped;
        }

        const result = parseSubmissionResult(submitResponse);

        if (!result.success) {
            throw new KraError(
                KraErrorCode.VALIDATION_ERROR,
                `VAT submission failed: ${result.message ?? 'Unknown KRA response'}`,
                { rawResponse: submitResponse.slice(0, 4000) }
            );
        }

        await appendJobLog(this.job, `VAT submitted successfully. Receipt: ${result.receiptNumber ?? 'N/A'}`, { progress: 90 });

        return {
            receiptNumber: result.receiptNumber,
            downloadUrl: result.downloadUrl,
            noticeId: result.noticeId,
        };
    }

    private formatPortalDate(isoDate: string): string {
        const [year, month, day] = isoDate.split('-');
        if (!year || !month || !day) {
            throw new Error(`Invalid ISO date provided: "${isoDate}"`);
        }
        return `${day}/${month}/${year}`;
    }

    private resolveReturnTypeValue(formHtml: string, currentValue?: string): string {
        if (currentValue && currentValue.trim()) {
            return currentValue.trim();
        }

        const $ = loadHtml(formHtml);
        const originalOption = $('select[name="cmbReturnType"] option, select#cmbReturnType option')
            .filter((_, el) => /original/i.test($(el).text()))
            .first();

        const value = originalOption.attr('value')?.trim();
        if (value) {
            return value;
        }

        return '1';
    }
}
