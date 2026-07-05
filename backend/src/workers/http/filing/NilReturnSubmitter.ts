import { JobContext, TaxObligationType } from '../../../types';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { KraHttpSession } from '../session/KraHttpSession';
import { parsePortalErrors, parseSubmissionResult, parseFormFields } from '../parsers';
import { KraError, KraErrorCode, mapPortalMessage } from '../errors';

export interface NilReturnInput {
    periodFrom: string; // ISO YYYY-MM-DD
    periodTo: string;   // ISO YYYY-MM-DD
    ownsRentalProperty?: boolean;
    taxObligationType: TaxObligationType;
    kraPin: string;
}

export class NilReturnSubmitter {
    private session: KraHttpSession;
    private job: JobContext;

    constructor(session: KraHttpSession, job: JobContext) {
        this.session = session;
        this.job = job;
    }

    async submit(input: NilReturnInput): Promise<{
        success: boolean;
        receiptNumber: string | null;
        downloadUrl: string | null;
        noticeId: string | null;
    }> {
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

        const periodFrom = this.formatPortalDate(input.periodFrom);
        const periodTo = this.formatPortalDate(input.periodTo);
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
            taxpayerPin: input.kraPin,
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
            txtPin: input.kraPin,
            branchRegDate: fields.branchRegDate ?? 'Select',
            txtPeriodFrom: periodFrom,
            txtPeriodTo: periodTo,
        };

        // Remove fields that should not be submitted based on captured Playwright flow.
        delete payload.btnSubmit;

        // Only include rental-property answer if the form actually contains the field.
        // If the UI does not pass a value, default to false (No).
        if ('ownsRentalProperty' in fields) {
            payload.ownsRentalProperty = input.ownsRentalProperty === true ? 'Yes' : 'No';
        }

        await appendJobLog(this.job, `Submitting nil return for ${input.periodFrom} to ${input.periodTo}`, { progress: 80 });

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
            success: true,
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
