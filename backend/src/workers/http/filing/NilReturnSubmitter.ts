import { TaxObligationType } from '../../../types';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { parsePortalErrors, parseSubmissionResult, parseFormFields } from '../parsers';
import { KraError, KraErrorCode, mapPortalMessage } from '../errors';
import { DwrService } from '../dwr';
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

        // The period fields may be empty text boxes on annual returns (e.g. Non-Resident Individual).
        // Verify they exist in the form HTML rather than requiring a pre-filled value.
        const hasPeriodFrom = /name=["']txtPeriodFrom["']/i.test(response);
        const hasPeriodTo = /name=["']txtPeriodTo["']/i.test(response);
        if (!hasPeriodFrom || !hasPeriodTo) {
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

        // For first returns after rollout (notably Income Tax Non-Resident Individual),
        // KRA requires a DWR handshake before accepting the nil-return submission.
        // The form contains hidden errorCd/errorMsg/isFirstRet fields, but the server
        // only accepts the submission after FetchTrpDtls.callProcAjax has been invoked.
        const dwrResult = await this.maybeTriggerRolloutHandshake(fields, nilInput, periodFrom);

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
            errorCd: dwrResult?.errorCd ?? fields.errorCd ?? '',
            errorMsg: dwrResult?.errorMsg ?? fields.errorMsg ?? '',
            isFirstRet: dwrResult?.isFirstRet ?? fields.isFirstRet ?? 'N',
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

        // KRA uses `isProperty` (Y/N) for the rental-property question on nil returns.
        if (/name=["']isProperty["']/i.test(response)) {
            payload.isProperty = nilInput.ownsRentalProperty === true ? 'Y' : 'N';
        }
        // Legacy form field name kept for backwards compatibility.
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

    private async maybeTriggerRolloutHandshake(
        fields: Record<string, string>,
        nilInput: NilReturnInput,
        periodFrom: string
    ): Promise<{ errorCd?: string; errorMsg?: string; isFirstRet?: string } | undefined> {
        const errorCd = fields.errorCd;
        const isFirstRet = fields.isFirstRet;

        // Only trigger the DWR handshake when the form indicates a first-return
        // rollout confirmation is required (errorCd=4002 / isFirstRet=Y).
        if (errorCd !== '4002' && isFirstRet !== 'Y') {
            return undefined;
        }

        await appendJobLog(this.job, 'Triggering KRA first-return rollout DWR handshake (HTTP)', { progress: 72 });

        try {
            const dwr = new DwrService(this.session.client);
            const page = '/KRA-Portal/eReturns.htm?actionCode=initPage';
            const session = await dwr.pageLoaded(page);
            const result = await dwr.callProcAjax({
                kraPin: nilInput.kraPin,
                obligationId: fields.obligationId,
                periodFrom,
                returnType: fields.cmbReturnType || 'Original',
                branchType: fields.cmbBrnchType || null,
                windowName: session.windowName,
                scriptSessionId: session.scriptSessionId,
                page,
            });

            await appendJobLog(this.job, `DWR handshake complete: errorCd=${result.errorCd ?? 'none'}, isFirstRet=${result.isFirstRtnAfterRollOut ?? result.isFirstRet ?? 'N'}`, { progress: 74 });

            return {
                errorCd: result.errorCd,
                errorMsg: result.errorMsg,
                isFirstRet: result.isFirstRet ?? (result.isFirstRtnAfterRollOut === 'Y' ? 'Y' : 'N'),
            };
        } catch (err: any) {
            // Do not fail the whole filing because of a DWR handshake error;
            // the hidden form fields may already be sufficient for some flows.
            await appendJobLog(this.job, `DWR handshake attempt failed, continuing with form fields: ${err.message}`, { progress: 74, level: 'warn' });
            return undefined;
        }
    }
}
