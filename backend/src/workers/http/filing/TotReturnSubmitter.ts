import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import FormData from 'form-data';
import { loadHtml } from '../parsers';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { packageToTZip, ToTReturnInput as ZipToTInput } from '../../../scripts/kra-tot-generator';
import { parseFormFields, parsePortalErrors, parseSubmissionResult } from '../parsers';
import { KraError, KraErrorCode, mapPortalMessage } from '../errors';
import { BaseHttpFilingService, FilingReceiptResult } from './BaseHttpFilingService';

export interface TotReturnInput {
    kraPin: string;
    periodFrom: string;
    periodTo: string;
    totYear: number;
    totMonth: number;
    totTurnover: number;
}

/**
 * Capture-driven TOT HTTP filing service.
 *
 * Flow:
 *   1. Parse the TOT upload form loaded by ReturnsNavigator.
 *   2. Build the TOT XML ZIP locally.
 *   3. Build a multipart/form-data body matching the real KRA TOT form.
 *   4. POST to eReturns.htm?actionCode=excelUpload.
 *   5. Parse receipt or error from the KRA response.
 */
export class TotReturnSubmitter extends BaseHttpFilingService {
    protected obligationLabel(): string {
        return 'Turnover Tax';
    }

    async file(input: Record<string, unknown>): Promise<FilingReceiptResult> {
        const totInput: TotReturnInput = {
            kraPin: String(input.kraPin),
            periodFrom: String(input.periodFrom),
            periodTo: String(input.periodTo),
            totYear: Number(input.totYear),
            totMonth: Number(input.totMonth),
            totTurnover: Number(input.totTurnover),
        };

        if (!Number.isFinite(totInput.totYear) || !Number.isFinite(totInput.totMonth) || !Number.isFinite(totInput.totTurnover)) {
            throw new Error('Turnover Tax filing requires totYear, totMonth, and totTurnover in the queued job payload');
        }

        await setJobStep(this.job, 70, 'Preparing Turnover Tax return (HTTP)');

        const periodFrom = this.formatPortalDate(totInput.periodFrom);
        const periodTo = this.formatPortalDate(totInput.periodTo);

        await appendJobLog(this.job, `TOT period ${periodFrom} - ${periodTo}, turnover KES ${totInput.totTurnover}`, { progress: 72 });

        // Parse hidden/visible fields from the form page already loaded by the navigator.
        const formHtml = this.session.lastResponse ?? '';
        const fields = parseFormFields(formHtml, 'form[action*="eReturns.htm"], form#command, form[name="excelUploadReturns"]');

        await this.session.snapshotHtml('form-load');
        await this.session.snapshotFormFields('form-load', 'excelUploadReturns', {
            periodFrom,
            periodTo,
            obligationId: fields.obligationId,
            obligationName: fields.obligationName,
        });

        if (!fields.txtPeriodFrom || !fields.txtPeriodTo) {
            throw new KraError(
                KraErrorCode.VALIDATION_ERROR,
                'Could not locate TOT period fields on the upload form',
                { rawResponse: formHtml.slice(0, 2000) }
            );
        }

        const returnTypeValue = this.resolveReturnTypeValue(formHtml, fields.cmbReturnType);

        // Build the TOT XML ZIP locally.
        const tempDir = process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp');
        const zipOutputDir = path.join(tempDir, 'kra-tot-returns', this.job.data.jobId);
        await fsp.mkdir(zipOutputDir, { recursive: true });

        const zipInput: ZipToTInput = {
            taxPayerPin: totInput.kraPin,
            returnPeriod: { year: totInput.totYear, month: totInput.totMonth },
            turnover: totInput.totTurnover,
            returnType: 'Original',
        };

        const zipPath = await packageToTZip(zipInput, zipOutputDir);
        await appendJobLog(this.job, `Generated TOT ZIP: ${path.basename(zipPath)}`, { progress: 76 });

        // Build multipart body matching the captured KRA TOT form.
        const form = new FormData();

        const monthValue = periodFrom.slice(3, 5);
        const yearValue = periodFrom.slice(6, 10);
        const quarterValue = String(Math.ceil(parseInt(monthValue, 10) / 3));

        // Start from parsed form fields, override with computed/constant values.
        const baseFields: Record<string, string> = {
            ...fields,
            token_key: this.session.requireToken(),
            amendmentFlag: fields.amendmentFlag ?? 'N',
            obligationId: fields.obligationId ?? '8',
            obligationName: fields.obligationName ?? 'Turnover Tax',
            taxpayerPin: totInput.kraPin,
            autoPopulate: fields.autoPopulate ?? 'Y',
            nilReturnFlag: 'N',
            cmbReturnType: returnTypeValue,
            txtPeriodFrom: periodFrom,
            txtPeriodTo: periodTo,
            months: monthValue,
            years: yearValue,
            quarters: quarterValue,
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
        form.append('file[0]', fs.createReadStream(zipPath), { filename: path.basename(zipPath), contentType: 'application/zip' });
        form.append('chkTermsAndCond', 'on');
        form.append('sbmt_btn', 'Submit');

        await setJobStep(this.job, 80, 'Uploading Turnover Tax return (HTTP)');
        await appendJobLog(this.job, `Submitting TOT ZIP to KRA`, { progress: 82 });

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
                `TOT submission failed: ${result.message ?? 'Unknown KRA response'}`,
                { rawResponse: submitResponse.slice(0, 4000) }
            );
        }

        await appendJobLog(this.job, `TOT submitted successfully. Receipt: ${result.receiptNumber ?? 'N/A'}`, { progress: 90 });

        return {
            receiptNumber: result.receiptNumber,
            downloadUrl: result.downloadUrl,
            noticeId: result.noticeId,
        };
    }

    private resolveReturnTypeValue(formHtml: string, currentValue?: string): string {
        // Prefer the currently selected value if it looks like an original return.
        if (currentValue && currentValue.trim()) {
            return currentValue.trim();
        }

        // Otherwise look for an option whose text contains "Original".
        const $ = loadHtml(formHtml);
        const originalOption = $('select[name="cmbReturnType"] option, select#cmbReturnType option')
            .filter((_: number, el: any) => /original/i.test($(el).text()))
            .first();

        const value = originalOption.attr('value')?.trim();
        if (value) {
            return value;
        }

        // Final fallback observed in captures.
        return '1';
    }
}
