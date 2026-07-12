import * as cheerio from 'cheerio';
import { KraHttpSession } from '../session/KraHttpSession';
import { DwrService } from '../dwr/DwrService';
import { KraError, KraErrorCode } from '../errors';

export interface PaymentRegistrationForm {
    html: string;
    tokenKey: string;
    dwrIds: { windowName: string; scriptSessionId: string };
}

/**
 * Navigates from the authenticated dashboard to the Payment Registration Tax Form.
 * Handles the Applicant Type page and the DWR pageLoaded handshake.
 */
export class PaymentRegistrationNavigator {
    private session: KraHttpSession;
    private dwr: DwrService;

    constructor(session: KraHttpSession, dwr?: DwrService) {
        this.session = session;
        this.dwr = dwr ?? new DwrService(session.client);
    }

    getDwrService(): DwrService {
        return this.dwr;
    }

    async navigateToTaxForm(kraPin: string): Promise<PaymentRegistrationForm> {
        // 1. Fetch the Applicant Type pre-form.
        const beforeLoadHtml = await this.session.get('paymentRegistration.htm?actionCode=beforeLoadPRForm', {
            step: 'prn-beforeLoadPRForm',
        });
        this.session.updateToken(beforeLoadHtml, 'beforeLoadPRForm');

        const beforeLoad$ = cheerio.load(beforeLoadHtml);
        const tokenKey = beforeLoad$('input[name="token_key"]').val()?.toString() ?? this.session.requireToken();

        // Hidden fields required by KRA's prePaymentRegForm.
        const hiddenFields = this.extractPreFormFields(beforeLoad$);

        // 2. Submit Applicant Type and reach the Tax Form.
        const loadFormBody: Record<string, string> = {
            ...hiddenFields,
            token_key: tokenKey,
            applicantTypeDropDown: 'T',
            taxpayerPin: kraPin,
            applicantType: 'T',
            paymentFor: 'Self',
            clientPin: kraPin,
            agentPin: '',
            agentPinForSubAgent: '',
            subAgentPin: '',
        };

        const taxFormHtml = await this.session.post('paymentRegistration.htm?actionCode=loadPRForm', loadFormBody, {
            step: 'prn-loadPRForm',
        });
        this.session.updateToken(taxFormHtml, 'loadPRForm');

        // 3. DWR pageLoaded handshake on the Tax Form.
        const dwrIds = await this.dwr.pageLoaded('/KRA-Portal/paymentRegistration.htm?actionCode=loadPRForm');

        if (!taxFormHtml.includes('cmbTaxHead') && !taxFormHtml.includes('paymentdetailDTO')) {
            throw new KraError(
                KraErrorCode.UNKNOWN,
                'Payment Registration Tax Form did not load after Applicant Type submission',
                { context: { pageSnippet: taxFormHtml.slice(0, 500) } }
            );
        }

        return {
            html: taxFormHtml,
            tokenKey: this.session.tokenKey ?? tokenKey,
            dwrIds,
        };
    }

    private extractPreFormFields($: cheerio.CheerioAPI): Record<string, string> {
        const fields: Record<string, string> = {};
        $('input[type="hidden"]').each((_: number, el: any) => {
            const name = $(el).attr('name');
            const value = $(el).val()?.toString() ?? '';
            if (name) {
                fields[name] = value;
            }
        });
        return fields;
    }
}