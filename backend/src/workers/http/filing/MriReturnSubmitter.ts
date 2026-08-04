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
        const fields = parseFormFields(response, 'form#MriSimplication, form#command, form[name="frmNilReturn"], form[action*="eReturns.htm"]');

        const periodFrom = this.formatPortalDate(mriInput.periodFrom);
        const periodTo = this.formatPortalDate(mriInput.periodTo);
        const monthValue = periodFrom.slice(3, 5);
        const yearValue = periodFrom.slice(6, 10);

        const payload: Record<string, string> = {
            ...fields,
            token_key: this.session.requireToken(),
            obligationId: fields.obligationId,
            obligationName: fields.obligationName ?? 'Rent Income',
            isAgent: fields.isAgent ?? '',
            agentPin: fields.agentPin ?? '',
            nilReturnFlag: 'N',
            amendmentFlag: fields.amendmentFlag ?? 'N',
            taxpayerPin: mriInput.kraPin,
            quarters: fields.quarters ?? '',
            months: monthValue,
            years: yearValue,
            toDtWithoutYear: fields.toDtWithoutYear ?? '',
            spouseTaxPayerId: fields.spouseTaxPayerId ?? '',
            updateRolloutdate: fields.updateRolloutdate ?? 'N',
            brnchLogin: fields.brnchLogin ?? 'N',
            procFrmDt: periodFrom,
            procToDt: periodTo,
            errorCd: fields.errorCd ?? '',
            errorMsg: fields.errorMsg ?? '',
            isFirstRet: fields.isFirstRet ?? 'N',
            isDormant: fields.isDormant ?? '',
            isMig: fields.isMig ?? '',
            autoPopulate: fields.autoPopulate ?? 'Y',
            cmbReturnType: fields.cmbReturnType ?? 'Original',
            txtPin: mriInput.kraPin,
            branchRegDate: fields.branchRegDate ?? 'Select',
            txtPeriodFrom: periodFrom,
            txtPeriodTo: periodTo,
            mriRentAmount_0: String(mriInput.rentalIncomeAmount),
        };

        delete payload.btnSubmit;

        await appendJobLog(this.job, `Submitting MRI return for ${periodFrom} to ${periodTo} with rental income ${mriInput.rentalIncomeAmount}`, { progress: 80 });

        const submitResponse = await this.session.post(
            'eReturns.htm?actionCode=saveMRISimplification&checkedCreditsDtlList=',
            payload,
            { timeout: 60_000 }
        );

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
