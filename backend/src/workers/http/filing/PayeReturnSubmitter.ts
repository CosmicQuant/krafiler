import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import FormData from 'form-data';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { parseFormFields, parsePortalErrors, parseSubmissionResult } from '../parsers';
import { KraError, KraErrorCode, mapPortalMessage } from '../errors';
import { BaseHttpFilingService, FilingReceiptResult } from './BaseHttpFilingService';
import { resolveUploadArtifactPath } from '../../utils/filing-helpers';

export interface PayeUploadInput {
    kraPin: string;
    periodFrom: string;
    periodTo: string;
    payeZipUrl: string;
}

/**
 * HTTP-based PAYE return filing service.
 *
 * Flow (same as ToT/VAT upload):
 *   1. The upload form is already loaded by ReturnsNavigator.selectReturnObligation.
 *   2. Resolve the PAYE ZIP file from URL/local path.
 *   3. Build a multipart/form-data body with the ZIP file attached.
 *   4. POST to eReturns.htm?actionCode=excelUpload.
 *   5. Parse receipt or error from the KRA response.
 */
export class PayeReturnSubmitter extends BaseHttpFilingService {
    protected obligationLabel(): string {
        return 'PAYE';
    }

    async file(input: Record<string, unknown>): Promise<FilingReceiptResult> {
        const payeInput: PayeUploadInput = {
            kraPin: String(input.kraPin),
            periodFrom: String(input.periodFrom),
            periodTo: String(input.periodTo),
            payeZipUrl: String(input.payeZipUrl ?? (input as any).payeFileUrl),
        };

        if (!payeInput.payeZipUrl) {
            throw new KraError(
                KraErrorCode.VALIDATION_ERROR,
                'PAYE filing requires a payeZipUrl in the payload',
                { retryable: false }
            );
        }

        await setJobStep(this.job, 70, 'Preparing PAYE return upload (HTTP)');

        const periodFrom = this.formatPortalDate(payeInput.periodFrom);
        const periodTo = this.formatPortalDate(payeInput.periodTo);

        await appendJobLog(this.job, `PAYE filing period ${periodFrom} - ${periodTo}`, { progress: 72 });

        // Resolve the PAYE ZIP file on disk.
        const jobId = this.job.data.jobId;
        const zipPath = await resolveUploadArtifactPath(payeInput.payeZipUrl, jobId, 'paye');
        const fileName = path.basename(zipPath);
        await appendJobLog(this.job, `Resolved PAYE ZIP on disk: ${zipPath}`, { progress: 74 });

        if (!await fsp.access(zipPath).then(() => true).catch(() => false)) {
            throw new KraError(
                KraErrorCode.VALIDATION_ERROR,
                `PAYE ZIP file not found on disk: ${zipPath}`,
            );
        }

        // Parse form fields from the upload page.
        const formHtml = this.session.lastResponse ?? '';
        const fields = parseFormFields(formHtml, 'form[action*="eReturns.htm"], form#command, form[name="excelUploadReturns"]');

        const monthValue = periodFrom.slice(3, 5);
        const yearValue = periodFrom.slice(6, 10);

        const form = new FormData();

        const baseFields: Record<string, string> = {
            ...fields,
            token_key: this.session.requireToken(),
            amendmentFlag: fields.amendmentFlag ?? 'N',
            obligationId: fields.obligationId ?? '7',
            obligationName: fields.obligationName ?? 'Pay As You Earn',
            taxpayerPin: payeInput.kraPin,
            autoPopulate: fields.autoPopulate ?? 'Y',
            nilReturnFlag: 'N',
            cmbReturnType: fields.cmbReturnType ?? 'Original',
            txtPeriodFrom: periodFrom,
            txtPeriodTo: periodTo,
            months: monthValue,
            years: yearValue,
            procFrmDt: periodFrom,
            procToDt: periodTo,
        };

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

        form.append('file[0]', fs.createReadStream(zipPath), { filename: fileName, contentType: 'application/zip' });
        form.append('chkTermsAndCond', 'on');
        form.append('sbmt_btn', 'Submit');

        await setJobStep(this.job, 80, 'Uploading PAYE return (HTTP)');
        await appendJobLog(this.job, `Submitting PAYE ZIP ${fileName} to KRA`, { progress: 82 });

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
                `PAYE submission failed: ${result.message ?? 'Unknown KRA response'}`,
                { rawResponse: submitResponse.slice(0, 4000) }
            );
        }

        await appendJobLog(this.job, `PAYE submitted successfully. Receipt: ${result.receiptNumber ?? 'N/A'}`, { progress: 90 });

        return {
            receiptNumber: result.receiptNumber,
            downloadUrl: result.downloadUrl,
            noticeId: result.noticeId,
        };
    }
}
