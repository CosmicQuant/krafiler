import * as cheerio from 'cheerio';
import { KraHttpSession } from '../session/KraHttpSession';
import { DwrService } from '../dwr/DwrService';
import { KraError, KraErrorCode } from '../errors';
import { LiabilityRow, parseLiabilityDwrResponse, parseLiabilityTableHtml, selectLiabilityRow, buildLiabilityPayload, SelectedLiabilityPayload } from './LiabilitySelector';

export interface TaxPayerDetails {
    taxPayerId?: string;
    taxPayerName?: string;
    taxPayerFullAddr?: string;
    taxPayerEmail?: string;
    taxPayerMobile?: string;
    taxPayerRegWith?: string;
    pinNo?: string;
}

export interface TaxFormSelection {
    tokenKey: string;
    taxPayerId: string;
    taxPayerName: string;
    taxPayerAddress: string;
    taxPayerEmail: string;
    taxPayerMobile: string;
    taxPayerRegWith: string;
    taxHeadValue: string;
    taxSubHeadValue: string;
    paymentTypeValue: string;
    selectedPeriodYear: string;
    selectedPeriodMonth: string;
    liabilityPayload: SelectedLiabilityPayload;
    taxPayerDetails: TaxPayerDetails;
}

const TAX_TYPE_CONFIG: Record<string, { headValue: string; headLabelRegex: RegExp; subHeadLabelRegex: RegExp; obligationType: string; defaultTaxTypeLabel: string }> = {
    turnover_tax: {
        headValue: 'IT',
        headLabelRegex: /^Income Tax$/i,
        subHeadLabelRegex: /Turnover Tax/i,
        obligationType: 'IT',
        defaultTaxTypeLabel: '(0107) Income Tax - Turnover Tax',
    },
    monthly_rental_income: {
        headValue: 'IT',
        headLabelRegex: /^Income Tax$/i,
        subHeadLabelRegex: /Rent Income/i,
        obligationType: 'IT',
        defaultTaxTypeLabel: '(0111) Income Tax - Rent Income',
    },
};

export class TaxFormInteractor {
    private session: KraHttpSession;
    private dwr: DwrService;

    constructor(session: KraHttpSession, dwr?: DwrService) {
        this.session = session;
        this.dwr = dwr ?? new DwrService(session.client);
    }

    /**
     * Parse the Tax Form HTML, run the DWR cascade to populate the liability table,
     * and build the payload fields needed for the final submission.
     */
    async selectTaxAndLiability(
        html: string,
        taxObligationType: string,
        periodFrom: string,
        periodTo: string,
        dwrIds: { windowName: string; scriptSessionId: string },
        kraPin: string
    ): Promise<TaxFormSelection> {
        const $ = cheerio.load(html);

        const tokenKey = $('input[name="token_key"]').val()?.toString() ?? this.session.requireToken();
        const taxPayerNameFromHtml = $('input[name="paymentdetailDTO.taxPayerFirstName"]').val()?.toString() ?? '';
        const taxPayerAddressFromHtml = $('input[name="paymentdetailDTO.taxPayerFullAddr"]').val()?.toString() ?? '';
        const taxPayerEmailFromHtml = $('input[name="paymentdetailDTO.emailId"]').val()?.toString() ?? '';

        const config = TAX_TYPE_CONFIG[taxObligationType];
        if (!config) {
            throw new KraError(KraErrorCode.UNKNOWN, `No PRN tax-form config for obligation type: ${taxObligationType}`);
        }

        const taxHeadValue = this.resolveSelectValue($, '#cmbTaxHead', config.headLabelRegex) ?? config.headValue;

        // The internal KRA taxpayer ID is returned by a DWR call, not present
        // in the initial HTML. Try the validation-free variant first, then the
        // standard FetchTaxPayerDetail fallback.
        const fetchWithoutValidationResponse = await this.dwr.fetchTaxpayerDetailWithoutValidation({
            kraPin,
            windowName: dwrIds.windowName,
            scriptSessionId: dwrIds.scriptSessionId,
        });

        let taxPayerId = parseTaxPayerIdFromDwrResponse(fetchWithoutValidationResponse);

        // Always call the standard FetchTaxPayerDetail as well; it populates
        // taxpayer name/email/address/mobile fields that the final submit form
        // requires. The validation-free call only returns the internal ID.
        const fetchTaxpayerResponse = await this.dwr.fetchTaxPayerDetail({
            kraPin,
            windowName: dwrIds.windowName,
            scriptSessionId: dwrIds.scriptSessionId,
        });
        const taxPayerDetails = parseTaxPayerDetailsFromDwrResponse(fetchTaxpayerResponse);

        if (!taxPayerId) {
            taxPayerId = taxPayerDetails.taxPayerId || parseTaxPayerIdFromDwrResponse(fetchTaxpayerResponse);
        }

        if (!taxPayerId) {
            // Last resort: fall back to the PIN. KRA's DWR methods generally
            // accept either the internal taxpayer ID or the PIN.
            taxPayerId = extractPinFromHtml($) ?? kraPin;
        }

        // The sub-head obligation ID is returned in the FetchTaxPayerDetail
        // DWR response inside itObligationsMapList (for Income Tax sub-heads).
        // Each entry is {key: obligationId, value: "(0107) Income Tax - Turnover Tax"}.
        // The browser uses these to populate the cmbTaxSubHead dropdown when
        // Tax Head = Income Tax is selected.
        const taxSubHeadValue = resolveSubHeadFromDwrResponse(fetchTaxpayerResponse, config.subHeadLabelRegex)
            ?? await this.resolveSubHeadValue(html, dwrIds, taxPayerId, config.subHeadLabelRegex);

        if (!taxSubHeadValue) {
            throw new KraError(
                KraErrorCode.UNKNOWN,
                `Could not resolve Tax Sub Head value for ${taxObligationType}`,
                { context: { availableOptions: this.listSelectOptions($, '#cmbTaxSubHead') } }
            );
        }

        const paymentTypeValue = this.resolveSelectValue($, '#cmbPaymentType', /Self Assessment/i) ?? 'SAT';

        const { year, month } = parsePeriodRange(periodFrom, periodTo);

        // DWR cascade.

        await this.dwr.getObligationRollOutDateDtls({
            subHeadId: taxSubHeadValue,
            taxPayerId,
            windowName: dwrIds.windowName,
            scriptSessionId: dwrIds.scriptSessionId,
        });

        await this.dwr.fetchTaxPeriod({
            subHeadId: taxSubHeadValue,
            taxPayerId,
            windowName: dwrIds.windowName,
            scriptSessionId: dwrIds.scriptSessionId,
        });

        const liabilityResponse = await this.dwr.fetchTotalLiabilityDetailsWeb({
            taxPayerId,
            subHeadId: taxSubHeadValue,
            windowName: dwrIds.windowName,
            scriptSessionId: dwrIds.scriptSessionId,
        });

        await this.dwr.fetchObligationDetail({
            taxPayerId,
            subHeadId: taxSubHeadValue,
            periodFrom: formatDateDdMmYyyy(periodFrom),
            periodTo: formatDateDdMmYyyy(periodTo),
            windowName: dwrIds.windowName,
            scriptSessionId: dwrIds.scriptSessionId,
        });

        // Re-fetch rollout date as browser does.
        await this.dwr.getObligationRollOutDateDtls({
            subHeadId: taxSubHeadValue,
            taxPayerId,
            windowName: dwrIds.windowName,
            scriptSessionId: dwrIds.scriptSessionId,
        });

        await this.dwr.getSelectedMonthOfSelectedYearWeb({
            date: '01/06/2024',
            subHeadId: taxSubHeadValue,
            windowName: dwrIds.windowName,
            scriptSessionId: dwrIds.scriptSessionId,
        }).catch((err: any) => {
            // This call is not always required; log and continue.
            console.warn('[TaxFormInteractor] getSelectedMonthOfSelectedYearWeb failed:', err.message);
        });

        let rows = parseLiabilityDwrResponse(liabilityResponse);
        if (rows.length === 0) {
            rows = parseLiabilityTableHtml(html);
        }

        const targetPeriodLabel = `${month} ${year}`;
        const selectedRow = selectLiabilityRow(rows, targetPeriodLabel);
        const liabilityPayload = buildLiabilityPayload(selectedRow, config.defaultTaxTypeLabel, config.obligationType);

        const taxPayerName = taxPayerDetails.taxPayerName || taxPayerNameFromHtml;
        const taxPayerAddress = taxPayerDetails.taxPayerFullAddr || taxPayerAddressFromHtml;
        const taxPayerEmail = taxPayerDetails.taxPayerEmail || taxPayerEmailFromHtml;

        return {
            tokenKey,
            taxPayerId,
            taxPayerName,
            taxPayerAddress,
            taxPayerEmail,
            taxPayerMobile: taxPayerDetails.taxPayerMobile ?? '',
            taxPayerRegWith: taxPayerDetails.taxPayerRegWith ?? '',
            taxHeadValue,
            taxSubHeadValue,
            paymentTypeValue,
            selectedPeriodYear: String(year),
            selectedPeriodMonth: month,
            liabilityPayload,
            taxPayerDetails,
        };
    }

    private resolveSelectValue($: cheerio.CheerioAPI, selector: string, labelRegex: RegExp): string | undefined {
        const options = $(`${selector} option`);
        for (let i = 0; i < options.length; i++) {
            const opt = options.eq(i);
            const text = opt.text().trim();
            const value = opt.attr('value');
            if (labelRegex.test(text) && value !== undefined && value !== '-1') {
                return value;
            }
        }
        return undefined;
    }

    private listSelectOptions($: cheerio.CheerioAPI, selector: string): string[] {
        return $(`${selector} option`)
            .map((_, opt) => `${$(opt).attr('value')}:${$(opt).text().trim()}`)
            .get();
    }

    /**
     * Tax Sub Head options are populated by the browser when Tax Head is
     * selected. The obligation IDs are returned by the FetchTaxPayerDetail
     * DWR call inside itObligationsMapList. resolveSubHeadFromDwrResponse
     * above extracts the correct sub-head ID directly from the DWR response.
     * This fallback reads the HTML select (for cases where KRA pre-rendered
     * options) or uses hardcoded values as a last resort.
     */
    private async resolveSubHeadValue(
        html: string,
        _dwrIds: { windowName: string; scriptSessionId: string },
        _taxPayerId: string,
        labelRegex: RegExp
    ): Promise<string | undefined> {
        const $ = cheerio.load(html);
        const value = this.resolveSelectValue($, '#cmbTaxSubHead', labelRegex);
        if (value) {
            return value;
        }

        // Fallback values captured from KRA portal (see KRA_TAX_HEAD_REFERENCE.md).
        if (labelRegex.test('Turnover Tax')) {
            return '8';
        }
        if (labelRegex.test('Rent Income')) {
            return '33';
        }

        return undefined;
    }
}

function parsePeriodRange(periodFrom: string, periodTo: string): { year: number; month: string } {
    const fromDate = new Date(periodFrom);
    if (Number.isNaN(fromDate.getTime())) {
        throw new KraError(KraErrorCode.UNKNOWN, `Invalid periodFrom date: ${periodFrom}`);
    }
    const year = fromDate.getFullYear();
    const month = fromDate.toLocaleString('default', { month: 'long' });
    return { year, month };
}

function formatDateDdMmYyyy(isoDate: string): string {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) {
        return isoDate;
    }
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

function extractPinFromHtml($: cheerio.CheerioAPI): string | undefined {
    return (
        $('input[name="initialLoginPin"]').val()?.toString() ??
        $('input[name="paymentdetailDTO.pinNo"]').val()?.toString() ??
        $('input[name="hidLogedInPinNo"]').val()?.toString() ??
        undefined
    );
}

/**
 * Parse taxpayer details from the FetchTaxPayerDetail DWR response.
 * KRA returns a JS callback whose third argument is a paymentdetailDTO-like object.
 */
function parseTaxPayerDetailsFromDwrResponse(response: string): TaxPayerDetails {
    const callbackMatch = response.match(/dwr\.engine\.remote\.handleCallback\("\d+","\d+",([\s\S]+?)\);\s*$/m);
    if (!callbackMatch) {
        return {};
    }

    const payload = callbackMatch[1].trim();
    const extract = (name: string): string | undefined => {
        const re = new RegExp(`${name}\\s*:\\s*(?:"([^"]*)"|([0-9.]+|null|null:[^,\\\]\\]]*))`);
        const m = payload.match(re);
        if (!m) return undefined;
        const value = m[1] ?? m[2] ?? '';
        return value === 'null' ? undefined : value;
    };

    return {
        taxPayerId: extract('taxPayerId'),
        taxPayerName: extract('taxPayerFirstName') || extract('taxpayerName') || extract('taxPayerName'),
        taxPayerFullAddr: extract('taxPayerFullAddr') || extract('taxpayerFullAddr'),
        taxPayerEmail: extract('emailId') || extract('taxPayerEmail') || extract('taxpayerEmail'),
        taxPayerMobile: extract('mobileNumber') || extract('taxPayerMobile') || extract('taxpayerMobile'),
        taxPayerRegWith: extract('taxPayerRegWith') || extract('taxpayerRegWith'),
        pinNo: extract('pinNo'),
    };
}

/**
 * Parse the internal KRA taxpayer ID from the FetchTaxPayerDetail DWR response.
 * KRA returns a JS callback whose third argument is an object with taxPayerId.
 */
function parseTaxPayerIdFromDwrResponse(response: string): string | undefined {
    const callbackMatch = response.match(/dwr\.engine\.remote\.handleCallback\("\d+","\d+",([\s\S]+?)\);\s*$/m);
    if (!callbackMatch) {
        return undefined;
    }

    const payload = callbackMatch[1].trim();
    const patterns = [
        /taxPayerId:(\d+)/i,
        /taxpayerId:(\d+)/i,
        /taxPayerId:\s*"([^"]+)"/i,
        /taxpayerId:\s*"([^"]+)"/i,
        /:"(\d{5,})"/, // generic numeric id fallback
    ];

    for (const pattern of patterns) {
        const match = payload.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }

    return undefined;
}

/**
 * Parse the itObligationsMapList from the FetchTaxPayerDetail DWR response.
 * KRA returns Income Tax sub-head obligations as an array of {key, value} pairs
 * inside itObligationsMapList, where key is the obligationId (sub-head value)
 * and value is the label like "(0107) Income Tax - Turnover Tax".
 *
 * The browser uses these to populate the cmbTaxSubHead dropdown when Tax Head
 * = Income Tax. We replicate this by finding the entry whose value matches the
 * target sub-head label regex.
 */
function resolveSubHeadFromDwrResponse(response: string, labelRegex: RegExp): string | undefined {
    const callbackMatch = response.match(/dwr\.engine\.remote\.handleCallback\("\d+","\d+",([\s\S]+?)\);\s*$/m);
    if (!callbackMatch) {
        return undefined;
    }
    const payload = callbackMatch[1].trim();

    // Find itObligationsMapList array and extract key/value pairs.
    // Pattern: itObligationsMapList:[{key:7,value:"(0107) Income Tax - ..."},{...}]
    const listMatch = payload.match(/itObligationsMapList:\[([\s\S]*?)\]\s*[,}]/);
    if (!listMatch) {
        return undefined;
    }

const listText = listMatch[1];
    // KRA format: {value:"(0107) Income Tax - Turnover Tax",key:"8"} —
    // value appears before key, and key may be quoted or unquoted.
    const entryRegex = /\{value:"([^"]*)",key:"?(\d+)"?\}/g;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(listText)) !== null) {
        const label = match[1];
        const key = match[2];
        if (labelRegex.test(label)) {
            return key;
        }
    }

    return undefined;
}
