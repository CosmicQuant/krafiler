import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { parseFormFields, parsePortalErrors } from '../parsers';
import { KraError, KraErrorCode, mapPortalMessage } from '../errors';
import { KraHttpSession } from '../session/KraHttpSession';
import { prepareVatReturnArtifacts, PreparedVatReturnArtifacts } from '../../../scripts/vat-return-generator';
import { uploadFile } from '../../../lib/cloudStorage';
import * as jobStore from '../../../services/jobStore';
import { VatCreditExtractor } from './VatCreditExtractor';

export interface VatPrepareInput {
    kraPin: string;
    clientName: string;
    periodFrom: string;
    periodTo: string;
    vatPreviousCredit: number;
    withholdingAmount?: number;
    sectionBWithoutPinSales?: number;
    /** When true, download current-month VAT transactions from the homepage via downloadTimsInvoices
     *  instead of from the eReturns page via downloadAmendmentForms. */
    currentMonthDownload?: boolean;
}

export interface VatPrepareResult {
    generatedZipUrl: string;
    generatedZipLabel: string;
    sourcePackageUrl: string;
    sourcePackageLabel: string;
    sourcePackageGcsPath?: string;
    generatedZipGcsPath?: string;
    vatSummary: any;
    autoPopulationSucceeded: boolean;
}

/**
 * Builds a multipart/form-data body manually to match the browser's exact format.
 *
 * The `form-data` npm library omits `filename=""` when the filename is empty
 * (falsy check), but KRA's server requires the `filename` attribute on file
 * inputs even when empty. This builder produces the exact same format as the
 * browser, including `filename=""` for empty file inputs.
 */
function buildMultipartBody(
    fields: Array<{ name: string; value: string }>,
    fileInputs: Array<{ name: string }>,
): { body: Buffer; contentType: string } {
    const boundary = `----WebKitFormBoundary${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const parts: Buffer[] = [];

    for (const field of fields) {
        parts.push(
            Buffer.from(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="${field.name}"\r\n\r\n` +
                `${field.value}\r\n`,
                'utf8',
            ),
        );
    }

    for (const fileInput of fileInputs) {
        parts.push(
            Buffer.from(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="${fileInput.name}"; filename=""\r\n` +
                `Content-Type: application/octet-stream\r\n\r\n` +
                `\r\n`,
                'utf8',
            ),
        );
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

    return {
        body: Buffer.concat(parts),
        contentType: `multipart/form-data; boundary=${boundary}`,
    };
}

/**
 * HTTP-based VAT auto-populated return downloader and ZIP generator.
 *
 * Flow (replicates the Playwright `downloadVatAutoPopulatedReturn`):
 *   1. The upload page is already loaded by ReturnsNavigator.selectReturnObligation.
 *   2. Parse hidden form fields from that page.
 *   3. Set dwnloadtims=downloadTims (equivalent to clicking #dwnlod_btn_tims).
 *   4. POST multipart to eReturns.htm?actionCode=downloadAmendmentForms.
 *   5. Response is a ZIP (application/octet-stream) — save to disk.
 *   6. Process with prepareVatReturnArtifacts() (pure Node.js).
 *   7. Upload generated + source ZIPs to GCS, return signed URLs.
 */
export class VatPrepareService {
    private session: KraHttpSession;
    private job: any;

    constructor(session: KraHttpSession, job: any) {
        this.session = session;
        this.job = job;
    }

    async execute(input: VatPrepareInput): Promise<VatPrepareResult> {
        // ── Extract credit brought forward and withholding tax before downloading ZIP ──
        const creditExtractor = new VatCreditExtractor(this.session, this.job);
        const portalCredit = await creditExtractor.extractCreditBroughtForward();
        const portalWithholding = await creditExtractor.extractWithholding(input.periodFrom);

        // Use portal-extracted values if available, otherwise fall back to payload values.
        const effectivePreviousCredit = portalCredit !== 0 ? portalCredit : input.vatPreviousCredit;
        const effectiveWithholding = portalWithholding !== 0 ? portalWithholding : input.withholdingAmount;

        if (portalCredit !== 0 || portalWithholding !== 0) {
            await appendJobLog(this.job, `Using portal-extracted credit: KES ${effectivePreviousCredit} (credit: ${portalCredit}, withholding: ${effectiveWithholding})`, { progress: 70 });
        }

        // ── Download the VAT source ZIP ──
        let zipBuffer: Buffer;
        if (input.currentMonthDownload) {
            zipBuffer = await this.downloadCurrentMonthZip(input.kraPin);
        } else {
            // ── Re-navigate to eReturns and select VAT obligation (credit extraction navigated away) ──
            await setJobStep(this.job, 72, 'Downloading VAT auto-populated return (HTTP)');

            const navigator = new (await import('../navigation/ReturnsNavigator')).ReturnsNavigator(this.session, this.job);
            await navigator.navigateToReturns(false);
            await navigator.selectReturnObligation('vat', input.kraPin);

            zipBuffer = await this.downloadAutoPopulatedZip(input, this.session.lastResponse ?? '');
        }

        // Verify the response is actually a ZIP, not an HTML error page.
        const isZip = zipBuffer.length >= 4 &&
            zipBuffer[0] === 0x50 && zipBuffer[1] === 0x4B &&
            zipBuffer[2] === 0x03 && zipBuffer[3] === 0x04;

        if (!isZip) {
            const preview = zipBuffer.slice(0, 1000).toString('utf8');
            const errors = parsePortalErrors(preview);
            const mapped = errors.map((e: string) => mapPortalMessage(e)).find(Boolean);
            if (mapped) throw mapped;

            throw new KraError(
                KraErrorCode.VALIDATION_ERROR,
                `VAT download did not return a valid ZIP archive. Response preview: ${preview.slice(0, 500)}`,
                { rawResponse: preview.slice(0, 2000) }
            );
        }

        await appendJobLog(this.job, `Downloaded VAT source ZIP: ${zipBuffer.length} bytes`, { progress: 74 });

        // Save source ZIP to temp dir.
        const tempDir = process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp');
        const sourceZipDir = path.join(tempDir, 'kra-vat-source', this.job.data.jobId);
        await fsp.mkdir(sourceZipDir, { recursive: true });
        const sourceZipPath = path.join(sourceZipDir, `${Date.now()}_${input.kraPin}_VAT_source.zip`);
        await fsp.writeFile(sourceZipPath, zipBuffer);

        await appendJobLog(this.job, `Saved VAT source ZIP to ${sourceZipPath}`, { progress: 75 });

        // Process the source ZIP into a VAT return ZIP.
        await setJobStep(this.job, 76, 'Generating VAT return package from auto-populated data');
        const artifacts = await prepareVatReturnArtifacts({
            sourceZipPath,
            clientName: input.clientName,
            taxpayerPin: input.kraPin,
            periodFrom: input.periodFrom,
            periodTo: input.periodTo,
            previousCredit: effectivePreviousCredit,
            withholdingAmount: effectiveWithholding,
            sectionBWithoutPinSales: input.sectionBWithoutPinSales,
        });

        await appendJobLog(this.job, `Prepared VAT upload ZIP: ${artifacts.generatedZipLabel}`, { progress: 80 });

        // Upload source + generated ZIPs to GCS so the frontend can download them.
        const jobId = this.job.data.jobId;
        const userId = this.job.data.userId || 'dev-user';
        const clientId = this.job.data.payload?.clientId || 'unknown';

        let sourcePackageGcsPath: string | undefined;
        let generatedZipGcsPath: string | undefined;

        try {
            sourcePackageGcsPath = `vat/${userId}/${clientId}/${jobId}/${artifacts.sourcePackageLabel}`;
            await uploadFile(artifacts.sourcePackagePath, sourcePackageGcsPath, { contentType: 'application/zip' });
            await appendJobLog(this.job, `Uploaded VAT source ZIP to Cloud Storage: ${sourcePackageGcsPath}`, { progress: 82 });
        } catch (uploadErr: any) {
            console.error(`[VatPrepareService] Failed to upload source ZIP to GCS:`, uploadErr.message);
            await appendJobLog(this.job, `VAT source ZIP upload to Cloud Storage failed: ${uploadErr.message}`, { progress: 82, level: 'info' });
        }

        try {
            generatedZipGcsPath = `vat/${userId}/${clientId}/${jobId}/${artifacts.generatedZipLabel}`;
            await uploadFile(artifacts.generatedZipPath, generatedZipGcsPath, { contentType: 'application/zip' });
            await appendJobLog(this.job, `Uploaded VAT generated ZIP to Cloud Storage: ${generatedZipGcsPath}`, { progress: 84 });
        } catch (uploadErr: any) {
            console.error(`[VatPrepareService] Failed to upload generated ZIP to GCS:`, uploadErr.message);
            await appendJobLog(this.job, `VAT generated ZIP upload to Cloud Storage failed: ${uploadErr.message}`, { progress: 84, level: 'info' });
        }

        // Store GCS paths in the job for the worker to persist to the client doc.
        try {
            await jobStore.updateJob(jobId, {
                'artifacts.vatSourceZipGcsPath': sourcePackageGcsPath,
                'artifacts.vatGeneratedZipGcsPath': generatedZipGcsPath,
            } as any);
        } catch (storeErr: any) {
            console.error(`[VatPrepareService] Failed to update job store:`, storeErr.message);
        }

        return {
            generatedZipUrl: artifacts.generatedZipUrl,
            generatedZipLabel: artifacts.generatedZipLabel,
            sourcePackageUrl: artifacts.sourcePackageUrl,
            sourcePackageLabel: artifacts.sourcePackageLabel,
            sourcePackageGcsPath,
            generatedZipGcsPath,
            vatSummary: artifacts.vatSummary,
            autoPopulationSucceeded: artifacts.autoPopulationSucceeded,
        };
    }

    /**
     * Download the auto-populated VAT return ZIP from the eReturns page.
     * Requires the upload form HTML (from ReturnsNavigator.selectReturnObligation).
     */
    private async downloadAutoPopulatedZip(input: VatPrepareInput, formHtml: string): Promise<Buffer> {
        const fields = parseFormFields(
            formHtml,
            'form[action*="eReturns.htm"], form#command, form[name="excelUploadReturns"]'
        );

        await this.session.snapshotHtml('form-load');
        await this.session.snapshotFormFields('form-load', 'excelUploadReturns', {
            obligationId: fields.obligationId,
            obligationName: fields.obligationName,
            autoPopulate: fields.autoPopulate,
            txtPeriodFrom: fields.txtPeriodFrom,
            txtPeriodTo: fields.txtPeriodTo,
        });

        const periodFromPortal = this.formatPortalDate(input.periodFrom);
        const periodToPortal = this.formatPortalDate(input.periodTo);

        const baseFields: Record<string, string> = {
            ...fields,
            token_key: this.session.requireToken(),
            taxpayerPin: input.kraPin,
            dwnloadtims: 'downloadTims',
            procFrmDt: periodFromPortal,
            procToDt: periodToPortal,
            txtPeriodFrom: periodFromPortal,
            txtPeriodTo: periodToPortal,
        };

        delete baseFields['file[0]'];
        delete baseFields['sfile[1]'];

        const fieldOrder = [
            'token_key', 'amendmentFlag', 'obligationId', 'obligationIdOthforAmnesty',
            'obligationName', 'taxpayerPin', 'dwnloadtims', 'dwnloadexcise', 'dwnloaditr',
            'dwnloaditnr', 'dwnloaditc', 'dwnloaditp', 'isAgent', 'agentPin',
            'toDtWithoutYear', 'quarters', 'months', 'years', 'URL_TO_DOWNLOAD', 'type',
            'updateRolloutdate', 'procFrmDt', 'procToDt', 'errorCd', 'errorMsg',
            'isFirstRet', 'isDormant', 'isMig', 'autoPopulate', 'cmbReturnType',
            'branchRegDate', 'txtPeriodFrom', 'txtPeriodTo', 'termsAndCond',
        ];

        const fieldList: Array<{ name: string; value: string }> = [];
        for (const key of fieldOrder) {
            if (key in baseFields) {
                fieldList.push({ name: key, value: String(baseFields[key]) });
            }
        }
        const typeIdx = fieldList.findIndex((f) => f.name === 'updateRolloutdate');
        if (typeIdx >= 0) {
            fieldList.splice(typeIdx, 0, { name: 'type', value: '' });
        }

        const { body: multipartBody, contentType: multipartContentType } = buildMultipartBody(
            fieldList,
            [{ name: 'file[0]' }, { name: 'sfile[1]' }],
        );

        await appendJobLog(this.job, `Requesting VAT auto-populated return for ${input.kraPin} (${periodFromPortal} - ${periodToPortal})`, { progress: 72 });

        return this.session.postMultipartBuffer(
            'eReturns.htm?actionCode=downloadAmendmentForms',
            multipartBody,
            {
                timeout: 120_000,
                headers: {
                    'Content-Type': multipartContentType,
                    Referer: 'https://itax.kra.go.ke/KRA-Portal/eReturns.htm?actionCode=initPage',
                },
            }
        );
    }

    /**
     * Download current-month VAT transactions ZIP from the iTax homepage.
     * Replicates the Playwright `downloadTimsInvoices()` JS function:
     *   1. Navigate to the homepage (login.htm).
     *   2. Parse the loginAdminForm hidden fields.
     *   3. POST to eReturns.htm?actionCode=downloadTimsInvoices with those fields.
     *   4. Response is a ZIP.
     */
    private async downloadCurrentMonthZip(kraPin: string): Promise<Buffer> {
        await setJobStep(this.job, 72, 'Downloading current-month VAT transactions from homepage (HTTP)');

        // Navigate to the homepage (the authenticated dashboard lives at login.htm).
        const homepageHtml = await this.session.get('login.htm', { timeout: 30_000 });

        const { parseFormFields: parseFields } = await import('../parsers');
        const homeFields = parseFields(homepageHtml, 'form[name="loginAdminForm"], form#loginAdminForm');

        // The downloadTimsInvoices JS submits loginAdminForm with its existing fields
        // plus the action set to eReturns.htm?actionCode=downloadTimsInvoices.
        const today = new Date();
        const day = String(today.getDate()).padStart(2, '0');
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const year = today.getFullYear();
        const dateFrom = `01/${month}/${year}`;
        const dateTo = `${day}/${month}/${year}`;

        const formFields: Record<string, string> = {
            ...homeFields,
            token_key: this.session.requireToken(),
            pinNo: kraPin,
            dwnloadtims: 'downloadTims',
            isVatRegistered: homeFields.isVatRegistered || '1',
            chkDashBoardFromDtNm: dateFrom,
            chkDashBoardToDtNm: dateTo,
        };

        await appendJobLog(this.job, `Requesting current-month VAT transactions for ${kraPin}`, { progress: 72 });

        // The loginAdminForm uses application/x-www-form-urlencoded, not multipart.
        return this.session.postMultipartBuffer(
            'eReturns.htm?actionCode=downloadTimsInvoices',
            this.buildUrlencodedBody(formFields),
            {
                timeout: 120_000,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Referer: 'https://itax.kra.go.ke/KRA-Portal/login.htm',
                },
            }
        );
    }

    private buildUrlencodedBody(fields: Record<string, string>): Buffer {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined && value !== null) {
                params.append(key, String(value));
            }
        }
        return Buffer.from(params.toString(), 'utf8');
    }

    private formatPortalDate(isoDate: string): string {
        const [year, month, day] = isoDate.split('-');
        if (!year || !month || !day) {
            throw new Error(`Invalid ISO date provided: "${isoDate}"`);
        }
        return `${day}/${month}/${year}`;
    }
}
