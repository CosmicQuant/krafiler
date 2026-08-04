import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { parsePortalErrors, parseSubmissionResult, parseFormFields } from '../parsers';
import { KraError, KraErrorCode, mapPortalMessage } from '../errors';
import { BaseHttpFilingService, FilingReceiptResult } from './BaseHttpFilingService';

export interface MriFilingInput {
    kraPin: string;
    periodFrom: string;
    periodTo: string;
    rentalIncomeAmount: number;
}

/**
 * HTTP-based MRI (Monthly Rental Income) return filing service.
 *
 * Flow:
 *   1. The return form is already loaded by ReturnsNavigator.selectReturnObligation.
 *   2. Parse form fields from the page.
 *   3. Fill in the rental income amount (mriRentAmount_0).
 *   4. Submit via POST to eReturns.htm?actionCode=fileNilReturn with nilReturnFlag=N.
 *   5. Parse receipt or error from the KRA response.
 *
 * MRI uses the same form action as nil returns (fileNilReturn) but with
 * nilReturnFlag=N and the rental income amount filled in.
 */
export class MriReturnSubmitter extends BaseHttpFilingService {
    protected obligationLabel(): string {
        return 'MRI';
    }

    async file(input: Record<string, unknown>): Promise<FilingReceiptResult> {
        const mriInput: MriFilingInput = {
            kraPin: String(input.kraPin),
            periodFrom: String(input.periodFrom),
            periodTo: String(input.periodTo),
            rentalIncomeAmount: Number(input.rentalIncomeAmount ?? 0),
        };

        if (!Number.isFinite(mriInput.rentalIncomeAmount) || mriInput.rentalIncomeAmount <= 0) {
            throw new KraError(
                KraErrorCode.VALIDATION_ERROR,
                'MRI filing requires a positive rental income amount',
                { retryable: false }
            );
        }

        await setJobStep(this.job, 70, 'Filling MRI return details (HTTP)');

        const response = this.session.lastResponse ?? '';
        const fields = parseFormFields(response, 'form#MriSimplication');

        if (!fields.obligationId) {
            await appendJobLog(this.job, `Warning: obligationId not found in parsed form fields. Available keys: ${Object.keys(fields).join(', ')}`, { progress: 75, level: 'warn' });
        }

        const periodFrom = this.formatPortalDate(mriInput.periodFrom);
        const periodTo = this.formatPortalDate(mriInput.periodTo);

        // Build payload from the actual MRI Simplification form fields.
        // The form uses mRISimplificationDto.* field names, not the nil-return field names.
        const payload: Record<string, string> = {
            ...fields,
            token_key: this.session.requireToken(),
            // Override the rental income and period with our values
            'mRISimplificationDto.totRentalInc': String(mriInput.rentalIncomeAmount),
            'mRISimplificationDto.rtnPeriodFrom': periodFrom,
            'mRISimplificationDto.rtnPeriodTo': periodTo,
            // Ensure total number of properties is set (default 1)
            'mRISimplificationDto.totNumofPropt': fields['mRISimplificationDto.totNumofPropt'] || '1',
        };

        // Remove button fields — browsers don't submit type="button" inputs
        delete payload.btnSubmit;
        delete payload.prevBtn;
        delete payload.back_btn;
        delete payload.nextBtn;
        delete payload.goBtn;
        // Remove file input — not needed for standard filing
        delete payload['sfile[1]'];

        await appendJobLog(this.job, `Submitting MRI return for ${periodFrom} to ${periodTo} with rental income ${mriInput.rentalIncomeAmount}`, { progress: 80 });

        // The MRI form declares enctype="multipart/form-data", so we must send
        // a multipart body — KRA rejects URL-encoded submissions with the dashboard page.
        const boundary = `----WebKitFormBoundary${Date.now().toString(36)}`;
        const multipartLines: string[] = [];
        for (const [name, value] of Object.entries(payload)) {
            multipartLines.push(`--${boundary}`);
            multipartLines.push(`Content-Disposition: form-data; name="${name}"`);
            multipartLines.push('');
            multipartLines.push(String(value));
        }
        multipartLines.push(`--${boundary}--`);
        multipartLines.push('');
        const multipartBody = multipartLines.join('\r\n');

        const submitResponse = await this.session.client.postRaw(
            'eReturns.htm?actionCode=saveMRISimplification&checkedCreditsDtlList=',
            Buffer.from(multipartBody, 'utf-8'),
            {
                step: 'form-submit',
                headers: {
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    Referer: 'https://itax.kra.go.ke/KRA-Portal/eReturns.htm?actionCode=initPage',
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    Origin: 'https://itax.kra.go.ke',
                    'Upgrade-Insecure-Requests': '1',
                },
                timeout: 60_000,
            }
        );
        this.session.lastResponse = submitResponse;

        const errors = parsePortalErrors(submitResponse);
        const mapped = errors.map((e) => mapPortalMessage(e)).find(Boolean);
        if (mapped) {
            throw mapped;
        }

        const result = parseSubmissionResult(submitResponse);

        if (!result.success) {
            throw new KraError(
                KraErrorCode.VALIDATION_ERROR,
                `MRI submission failed: ${result.message ?? 'Unknown KRA response'}`,
                { rawResponse: submitResponse.slice(0, 4000) }
            );
        }

        await appendJobLog(this.job, `MRI return submitted successfully. Receipt: ${result.receiptNumber ?? 'N/A'}`, { progress: 90 });

        return {
            receiptNumber: result.receiptNumber,
            downloadUrl: result.downloadUrl,
            noticeId: result.noticeId,
        };
    }
}
