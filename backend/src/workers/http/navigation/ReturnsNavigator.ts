import { JobContext } from '../../../types';
import { TaxObligationType } from '../../../types';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { KraHttpSession } from '../session/KraHttpSession';
import { findObligationValue, parseObligationOptions, parsePortalErrors, parseFormFields } from '../parsers';
import { TAX_OBLIGATION_PATTERNS } from '../../constants/selectors';
import { KraError, KraErrorCode, mapPortalMessage } from '../errors';

export class ReturnsNavigator {
    private session: KraHttpSession;
    private job: JobContext;

    constructor(session: KraHttpSession, job: JobContext) {
        this.session = session;
        this.job = job;
    }

    async navigateToReturns(): Promise<void> {
        await setJobStep(this.job, 50, 'Opening KRA Nil Return page (HTTP)');

        // The browser nil-return menu triggers loadPage with nilReturnFlag=Y.
        const response = await this.session.post(
            'eReturns.htm?actionCode=loadPage&nilReturnFlag=Y&amendmentFlag=N',
            {
                operation: '',
                actionCode: '',
                flag: '',
                token_key: 'null',
            },
            { timeout: 45_000 }
        );

        const errors = parsePortalErrors(response);
        const mapped = errors.map((errorText: string) => mapPortalMessage(errorText)).find(Boolean);
        if (mapped) {
            throw mapped;
        }

        if (!parseObligationOptions(response).length) {
            throw new KraError(
                KraErrorCode.NAVIGATION_ERROR,
                'Nil return page did not contain a tax obligation dropdown',
                { rawResponse: response.slice(0, 2000) }
            );
        }

        await appendJobLog(this.job, 'Navigated to nil return obligation page via HTTP', { progress: 52 });
    }

    async selectNilReturnObligation(taxObligationType: TaxObligationType, kraPin: string): Promise<void> {
        await setJobStep(this.job, 60, `Selecting ${taxObligationType} tax obligation (HTTP)`);

        const obligation = findObligationValue(
            this.session.lastResponse ?? '',
            TAX_OBLIGATION_PATTERNS[taxObligationType]
        );

        if (!obligation) {
            const available = parseObligationOptions(this.session.lastResponse ?? '').map((o) => `${o.text} [${o.value}]`).join(', ');
            throw new KraError(
                KraErrorCode.VALIDATION_ERROR,
                `Could not find tax obligation for ${taxObligationType}. Available: ${available}`,
                { rawResponse: (this.session.lastResponse ?? '').slice(0, 2000) }
            );
        }

        await appendJobLog(this.job, `Selected obligation: ${obligation.text} [${obligation.value}]`, { progress: 62 });

        // Capture any hidden fields from the obligation page (selfId, isTaxRepresentative, autoPopulate, etc.)
        const hiddenFields = parseFormFields(this.session.lastResponse ?? '', 'form#command, form[name="frmNilReturn"], form[action*="eReturns.htm"]');

        const response = await this.session.post(
            'eReturns.htm?actionCode=initPage',
            {
                ...hiddenFields,
                token_key: this.session.requireToken(),
                fileUploadBean_selfId: kraPin,
                'fileUploadBean.selfId': kraPin,
                isAgent: hiddenFields.isAgent ?? '',
                isSubAgent: hiddenFields.isSubAgent ?? '',
                isTaxRepresentative: hiddenFields.isTaxRepresentative ?? 'N',
                formType: hiddenFields.formType ?? '',
                obligationName: obligation.text,
                amendmentFlag: 'N',
                nilReturnFlag: 'Y',
                autoPopulate: hiddenFields.autoPopulate ?? 'Y',
                taxpayerPin: kraPin,
                obligationId: obligation.value,
                obligationIdOthforAmnesty: hiddenFields.obligationIdOthforAmnesty ?? '4',
            },
            { timeout: 45_000 }
        );

        const errors = parsePortalErrors(response);
        const mapped = errors.map((errorText: string) => mapPortalMessage(errorText)).find(Boolean);
        if (mapped) {
            throw mapped;
        }

        await appendJobLog(this.job, 'Proceeded to nil return details page via HTTP', { progress: 64 });
    }
}
