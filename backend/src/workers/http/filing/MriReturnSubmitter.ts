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

        const rentalAmount = mriInput.rentalIncomeAmount;
        const taxOnRent = Math.round(rentalAmount * 0.075 * 100) / 100;

        const periodFrom = this.formatPortalDate(mriInput.periodFrom);
        const periodTo = this.formatPortalDate(mriInput.periodTo);

        // Build payload matching the exact HAR-captured successful submission.
        const taxPayerName = fields['mRISimplificationDto.taxpayerName'] || '';
        const taxPayerAdd = fields['mRISimplificationDto.taxpayerAdd'] || '';
        const taxPayerId = fields['mRISimplificationDto.taxpayerId'] || '';
        const landLordEmail = fields['landLordWEmail'] || '';
        const originalHidPropertyDetailList = fields['hidPropertyDetailList'] || '';
        const hidPropertyDetailList = originalHidPropertyDetailList && originalHidPropertyDetailList.trim() !== ''
            ? originalHidPropertyDetailList
            : JSON.stringify([{ landId: '', rengId: '', rent: rentalAmount, liability: taxOnRent }]);

        // fieldsToSkip is a multi-value field (appears twice in the form for taxpayerName and taxpayerAdd).
        const fieldsToSkipValues = ['mRISimplificationDto.taxpayerName', 'mRISimplificationDto.taxpayerAdd'];

        const payload: Record<string, string[]> = {
            errorCd: [''],
            errorMsg: [''],
            'mRISimplificationDto.taxpayerId': [taxPayerId],
            obligationId: [fields.obligationId || '33'],
            amendmentFlag: ['N'],
            taxpayerPin: [mriInput.kraPin],
            fieldsToSkip: fieldsToSkipValues,
            'mRISimplificationDto.taxPayerPIN': [mriInput.kraPin],
            'mRISimplificationDto.taxpayerName': [taxPayerName],
            'mRISimplificationDto.taxpayerAdd': [taxPayerAdd],
            landLordWEmail: [landLordEmail],
            'mRISimplificationDto.typeOfRtn': ['Original'],
            'mRISimplificationDto.rtnPeriodFrom': [periodFrom],
            'mRISimplificationDto.rtnPeriodTo': [periodTo],
            hidPropertyDetailList: [hidPropertyDetailList],
            hidPropertyDetailDTOList: ['[object Object]'],
            mriRentAmount_0: [String(rentalAmount)],
            totalAmountTobePaid: [String(taxOnRent)],
            taxPercent: ['10'],
            totNoOfP: ['1'],
            'mRISimplificationDto.totNumofPropt': ['1'],
            'mRISimplificationDto.totRentalInc': [String(rentalAmount)],
            'mRISimplificationDto.taxOnRentInc': [String(taxOnRent)],
            'mRISimplificationDto.rentwhtCreditd': ['0.00'],
            'mRISimplificationDto.crdSelfAssesPmt': ['0.00'],
            'mRISimplificationDto.taxDue': [String(taxOnRent)],
            token_key: [this.session.requireToken()],
        };

        await appendJobLog(this.job, `Submitting MRI return for ${periodFrom} to ${periodTo} with rental income ${rentalAmount}`, { progress: 80 });

        // The MRI form declares enctype="multipart/form-data" and the browser submits
        // with checkedCreditsDtlList=undefined (literal string "undefined").
        const boundary = `----WebKitFormBoundary${Date.now().toString(36)}`;
        const crlf = '\r\n';
        const multipartParts: string[] = [];

        for (const [name, values] of Object.entries(payload)) {
            const arr = Array.isArray(values) ? values : [values];
            for (const val of arr) {
                multipartParts.push(`--${boundary}`);
                multipartParts.push(`Content-Disposition: form-data; name="${name}"`);
                multipartParts.push('');
                multipartParts.push(String(val));
            }
        }

        // Empty file upload part (mirrors browser behavior — sfile[1] with empty filename).
        multipartParts.push(`--${boundary}`);
        multipartParts.push(`Content-Disposition: form-data; name="sfile[1]"; filename=""`);
        multipartParts.push(`Content-Type: application/octet-stream`);
        multipartParts.push('');
        multipartParts.push('');

        multipartParts.push(`--${boundary}--`);
        multipartParts.push('');

        const multipartBody = multipartParts.join(crlf);

        const submitResponse = await this.session.client.postRaw(
            'eReturns.htm?actionCode=saveMRISimplification&checkedCreditsDtlList=undefined',
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
