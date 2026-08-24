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

    async navigateToReturns(nilReturnFlag = true): Promise<void> {
        const label = nilReturnFlag ? 'nil return' : 'file return';
        await setJobStep(this.job, 50, `Opening KRA ${label} page (HTTP)`);

        const response = await this.session.post(
            `eReturns.htm?actionCode=loadPage&nilReturnFlag=${nilReturnFlag ? 'Y' : 'N'}&amendmentFlag=N`,
            {
                operation: '',
                actionCode: '',
                flag: '',
                token_key: 'null',
            },
            { timeout: 60_000 }
        );

        const errors = parsePortalErrors(response);
        const mapped = errors.map((errorText: string) => mapPortalMessage(errorText)).find(Boolean);
        if (mapped) {
            throw mapped;
        }

        if (!parseObligationOptions(response).length) {
            throw new KraError(
                KraErrorCode.NAVIGATION_ERROR,
                `${label} page did not contain a tax obligation dropdown`,
                { rawResponse: response.slice(0, 2000) }
            );
        }

        await appendJobLog(this.job, `Navigated to ${label} obligation page via HTTP`, { progress: 52 });
    }

    async selectNilReturnObligation(taxObligationType: TaxObligationType, kraPin: string): Promise<void> {
        await this.selectObligation(taxObligationType, kraPin, { nilReturnFlag: true });
    }

    async selectReturnObligation(taxObligationType: TaxObligationType, kraPin: string): Promise<void> {
        await this.selectObligation(taxObligationType, kraPin, { nilReturnFlag: false });
    }

    private async selectObligation(
        taxObligationType: TaxObligationType,
        kraPin: string,
        options: { nilReturnFlag: boolean }
    ): Promise<void> {
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
                nilReturnFlag: options.nilReturnFlag ? 'Y' : 'N',
                autoPopulate: hiddenFields.autoPopulate ?? 'Y',
                taxpayerPin: kraPin,
                obligationId: obligation.value,
                obligationIdOthforAmnesty: hiddenFields.obligationIdOthforAmnesty ?? '4',
            },
            // KRA takes well over 45s to render the file-return page for
            // taxpayers with many pending periods (a browser just waits it out;
            // the HTTP engine used to abort with ETIMEDOUT at 45s).
            { timeout: 120_000 }
        );

        const errors = parsePortalErrors(response);
        const mapped = errors.map((errorText: string) => mapPortalMessage(errorText)).find(Boolean);
        if (mapped) {
            throw mapped;
        }

        await appendJobLog(this.job, `Proceeded to ${options.nilReturnFlag ? 'nil' : 'return'} details page via HTTP`, { progress: 64 });
    }
}
