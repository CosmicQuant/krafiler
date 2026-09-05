import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { parsePortalErrors, parseSubmissionResult, parseFormFields } from '../parsers';
import { KraError, KraErrorCode, mapPortalMessage } from '../errors';
import { BaseHttpFilingService, FilingReceiptResult } from './BaseHttpFilingService';
import { DwrService } from '../dwr/DwrService';

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

        // Establish a DWR session via __System.pageLoaded, exactly as the browser does
        // when the MRI form loads. This gives us valid windowName + scriptSessionId
        // for the fetchDataForMRIReturnsAjax call.
        const page = '/KRA-Portal/eReturns.htm?actionCode=initPage';
        const dwr = new DwrService(this.session.client);
        let windowName = '';
        let scriptSessionId = '';
        try {
            const dwrSession = await dwr.pageLoaded(page);
            windowName = dwrSession.windowName;
            scriptSessionId = dwrSession.scriptSessionId;
            await appendJobLog(this.job, `DWR session established: window=${windowName.slice(0, 16)}..., script=${scriptSessionId.slice(0, 16)}...`, { progress: 74 });
        } catch (dwrInitErr: any) {
            await appendJobLog(this.job, `DWR pageLoaded failed: ${dwrInitErr.message}. Will attempt fetchDataForMRIReturnsAjax without session.`, { progress: 74, level: 'warn' });
        }

        // The browser calls fetchDataForMRIReturnsAjax via DWR to fetch property
        // details. KRA's property DTO uses different field names than the
        // submission — the browser's MRISimplification.js maps them when
        // building the hidden field:
        //   landId <- treLandlordPropertyRegHdrId
        //   rengId <- trePropertyRegDtlId
        // The form's hidPropertyDetailList is an EMPTY hidden input (populated
        // by JS at runtime), so the DWR response is the ONLY source of these
        // IDs. Submitting without them makes KRA accept the return but record
        // the gross rent as 0 — so if they cannot be fetched we abort instead
        // of silently filing a zero-rent return.
        let hidPropertyDetailList = '';
        try {
            const dwrResponse = await dwr.fetchDataForMRIReturnsAjax({
                kraPin: mriInput.kraPin,
                periodFrom,
                periodTo,
                returnType: 'Original',
                totNumofPropt: '1',
                totRentalInc: String(rentalAmount),
                taxOnRentInc: String(taxOnRent),
                rentwhtCreditd: '0.00',
                crdSelfAssesPmt: '0.00',
                taxDue: String(taxOnRent),
                taxpayerId: taxPayerId,
                windowName,
                scriptSessionId,
                page,
            });

            await appendJobLog(this.job, `DWR fetchDataForMRIReturnsAjax response (first 500): ${dwrResponse.slice(0, 500)}`, { progress: 76, level: 'info' });

            // DWR returns JavaScript like:
            //   dwr.engine.remote.handleCallback("1","0",{...mriPropertyDtlDTOs:[{...treLandlordPropertyRegHdrId:267224,trePropertyRegDtlId:72535...}]...})
            const hdrMatches = dwrResponse.match(/treLandlordPropertyRegHdrId:"?(\d+)"?/g) || [];
            const dtlMatches = dwrResponse.match(/trePropertyRegDtlId:"?(\d+)"?/g) || [];

            if (hdrMatches.length === 0 || dtlMatches.length === 0) {
                throw new KraError(
                    KraErrorCode.VALIDATION_ERROR,
                    'KRA returned no registered rental property for this taxpayer (mriPropertyDtlDTOs is empty). ' +
                        'The MRI return was NOT submitted — register the rental property on the KRA portal first, then retry.',
                    { retryable: false, rawResponse: dwrResponse.slice(0, 2000) }
                );
            }

            const landId = hdrMatches[0]?.match(/(\d+)/)?.[1] ?? '';
            const rengId = dtlMatches[0]?.match(/(\d+)/)?.[1] ?? '';
            if (!landId || !rengId) {
                throw new KraError(
                    KraErrorCode.VALIDATION_ERROR,
                    'Could not parse property registration IDs from the KRA property response. The MRI return was NOT submitted — KRA would record the rent as 0 without them.',
                    { retryable: false, rawResponse: dwrResponse.slice(0, 2000) }
                );
            }
            hidPropertyDetailList = JSON.stringify([{ landId, rengId, rent: rentalAmount, liability: taxOnRent }]);
            await appendJobLog(this.job, `Fetched property details: landId=${landId}, rengId=${rengId}`, { progress: 76 });

            if (hdrMatches.length > 1) {
                await appendJobLog(
                    this.job,
                    `Taxpayer has ${hdrMatches.length} registered properties; attaching the full rental amount to the first property.`,
                    { progress: 77, level: 'warn' }
                );
            }
        } catch (dwrErr: any) {
            if (dwrErr instanceof KraError) {
                throw dwrErr;
            }
            throw new KraError(
                KraErrorCode.PORTAL_UNAVAILABLE,
                `Could not fetch rental property details from KRA (DWR: ${dwrErr.message}). The MRI return was NOT submitted — KRA would record the rent as 0 without the property registration IDs. Please retry.`,
                { retryable: true }
            );
        }

        // fieldsToSkip is a multi-value field (appears twice in the form for taxpayerName and taxpayerAdd).
        const fieldsToSkipValues = ['mRISimplificationDto.taxpayerName', 'mRISimplificationDto.taxpayerAdd'];

        // Note: token_key is NOT included — it's outside form#MriSimplication and
        // the browser does not submit it (confirmed by HAR capture).
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
