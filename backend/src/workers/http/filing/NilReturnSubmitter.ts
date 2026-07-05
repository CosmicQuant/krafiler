import { TaxObligationType } from '../../../types';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { parsePortalErrors, parseSubmissionResult, parseFormFields } from '../parsers';
import { KraError, KraErrorCode, mapPortalMessage } from '../errors';
import { BaseHttpFilingService, FilingReceiptResult } from './BaseHttpFilingService';

export interface NilReturnInput {
    periodFrom: string; // ISO YYYY-MM-DD
    periodTo: string;   // ISO YYYY-MM-DD
    ownsRentalProperty?: boolean;
    taxObligationType: TaxObligationType;
    kraPin: string;
}

export class NilReturnSubmitter extends BaseHttpFilingService {
    protected obligationLabel(): string {
        return 'Nil';
    }

    async file(input: Record<string, unknown>): Promise<FilingReceiptResult> {
        const nilInput: NilReturnInput = {
            periodFrom: String(input.periodFrom),
            periodTo: String(input.periodTo),
            ownsRentalProperty: input.ownsRentalProperty === true,
            taxObligationType: String(input.taxObligationType) as TaxObligationType,
            kraPin: String(input.kraPin),
        };

        await setJobStep(this.job, 70, 'Filling nil return details (HTTP)');

        const response = this.session.lastResponse ?? '';
        const fields = parseFormFields(response, 'form#command, form[name="frmNilReturn"], form[action*="eReturns.htm"]');

        if (!fields.txtPeriodFrom || !fields.txtPeriodTo) {
            throw new KraError(
                KraErrorCode.VALIDATION_ERROR,
                'Could not locate period fields on the nil return form',
                { rawResponse: response.slice(0, 2000) }
            );
        }

        const periodFrom = this.formatPortalDate(nilInput.periodFrom);
        const periodTo = this.formatPortalDate(nilInput.periodTo);
        const monthValue = periodFrom.slice(3, 5);
        const yearValue = periodFrom.slice(6, 10);

        const payload: Record<string, string> = {
            ...fields,
            token_key: this.session.requireToken(),
            obligationId: fields.obligationId,
            obligationName: fields.obligationName,
            isAgent: fields.isAgent ?? '',
            agentPin: fields.agentPin ?? '',
            nilReturnFlag: 'Y',
            amendmentFlag: fields.amendmentFlag ?? 'N',
            taxpayerPin: nilInput.kraPin,
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
            txtPin: nilInput.kraPin,
            branchRegDate: fields.branchRegDate ?? 'Select',
            txtPeriodFrom: periodFrom,
            txtPeriodTo: periodTo,
        };

        // Remove fields that should not be submitted based on captured Playwright flow.
        delete payload.btnSubmit;

        // Only include rental-property answer if the form actually contains the field.
        // If the UI does not pass a value, default to false (No).
        if ('ownsRentalProperty' in fields) {
            payload.ownsRentalProperty = nilInput.ownsRentalProperty === true ? 'Yes' : 'No';
        }

        await appendJobLog(this.job, `Submitting nil return for ${nilInput.periodFrom} to ${nilInput.periodTo}`, { progress: 80 });

        const submitResponse = await this.session.post(
            'eReturns.htm?actionCode=fileNilReturn',
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
                `Nil return submission failed: ${result.message ?? 'Unknown KRA response'}`,
                { rawResponse: submitResponse.slice(0, 4000) }
            );
        }

        await appendJobLog(this.job, `Nil return submitted successfully. Receipt: ${result.receiptNumber ?? 'N/A'}`, { progress: 90 });

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
}
