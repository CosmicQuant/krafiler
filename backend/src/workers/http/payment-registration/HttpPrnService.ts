import fs from 'fs/promises';
import path from 'path';
import { KraHttpSession } from '../session/KraHttpSession';
import { HttpLoginService } from '../navigation/HttpLoginService';
import { CaptureContext } from '../capture';
import { KraError, KraErrorCode } from '../errors';
import { PaymentRegistrationNavigator } from './PaymentRegistrationNavigator';
import { TaxFormInteractor } from './TaxFormInteractor';
import { parsePrnSuccessPage } from './PrnSuccessParser';
import type { JobContext } from '../../../types';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { storeReceiptLocally } from '../../../utils/storage';
import { uploadFile, receiptPath as gcsReceiptPath } from '../../../lib/cloudStorage';

export interface HttpPrnInput {
    kraPin: string;
    kraPassword: string;
    taxObligationType: string;
    periodFrom: string;
    periodTo: string;
    clientId?: string;
    clientName?: string;
    otpCode?: string;
    userId?: string;
    jobId?: string;
}

export interface HttpPrnResult {
    prnNumber: string;
    searchCode: string;
    receiptPath: string;
    receiptGcsPath?: string;
    receiptUrl?: string;
    noticeId: string;
}

/**
 * Pure HTTP PRN generator for ToT and MRI.
 * Assumes the return has already been filed, so a liability exists for the period.
 */
export class HttpPrnService {
    private session: KraHttpSession;
    private job: JobContext;

    constructor(options: { session?: KraHttpSession; job: JobContext }) {
        this.session = options.session ?? new KraHttpSession({ timeout: 60_000 });
        this.job = options.job;
    }

    async execute(input: HttpPrnInput): Promise<HttpPrnResult> {
        await this.log('Starting HTTP PRN generation', 72);

        // Skip login if the session is already authenticated (e.g., subsequent PRN types
        // in a multi-PRN flow like PAYE + NITA + AHL share the same session).
        if (!this.session.isAuthenticated()) {
            const loginService = new HttpLoginService(this.session, this.job);
            const loginResult = await loginService.execute(input.kraPin, input.kraPassword, input.otpCode);

            if (loginResult.passwordExpired) {
                throw new KraError(KraErrorCode.PASSWORD_EXPIRED, 'Password expired — falling back to Playwright', { retryable: false });
            }
            if (loginResult.mobileVerificationRequired) {
                throw new KraError(KraErrorCode.MOBILE_VERIFICATION_REQUIRED, 'Mobile verification required — falling back to Playwright', { retryable: false });
            }

            await this.log('Logged in via HTTP', 74);
        } else {
            await this.log('Session already authenticated, skipping login', 74);
        }

        const navigator = new PaymentRegistrationNavigator(this.session);
        const { html: taxFormHtml, dwrIds } = await navigator.navigateToTaxForm(input.kraPin);
        await this.log('Reached Payment Registration Tax Form', 76);

        const interactor = new TaxFormInteractor(this.session, navigator.getDwrService());
        const selection = await interactor.selectTaxAndLiability(
            taxFormHtml,
            input.taxObligationType,
            input.periodFrom,
            input.periodTo,
            dwrIds,
            input.kraPin
        );
        await this.log(`Selected liability: ${selection.liabilityPayload.amountPaid} KES`, 78);

        const submitFields = this.buildSubmitPayload(selection, input.kraPin, input.periodFrom, input.periodTo);
        const submitBody = this.buildMultipartBodyFromHarTemplate(submitFields);

        const successHtml = await this.session.client.postRaw(
            'paymentRegistration.htm?actionCode=saveObligationDetail',
            Buffer.from(submitBody, 'utf-8'),
            {
                step: 'prn-saveObligationDetail',
                headers: {
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    Referer: 'https://itax.kra.go.ke/KRA-Portal/paymentRegistration.htm?actionCode=loadPRForm',
                    'Content-Type': `multipart/form-data; boundary=${submitBody.boundary}`,
                    Origin: 'https://itax.kra.go.ke',
                    'Upgrade-Insecure-Requests': '1',
                },
            }
        );
        await this.log('Submitted Payment Registration', 80);

        const success = parsePrnSuccessPage(successHtml);
        await this.log(`PRN generated: ${success.prnNumber}`, 90);

        const { receiptPath, receiptGcsPath } = await this.downloadReceipt(success.pdfUrl, input);
        await this.log(`PRN PDF saved to ${receiptPath}`, 95);

        return {
            prnNumber: success.prnNumber,
            searchCode: success.searchCode,
            receiptPath,
            receiptGcsPath,
            noticeId: success.noticeId,
        };
    }

    /**
     * Build the final saveObligationDetail payload overrides.
     * The HAR submit template supplies the complete form structure; we only
     * override the fields that are session/taxpayer/period-specific so that
     * empty values from the live HTML cannot accidentally wipe template defaults.
     */
    private buildSubmitPayload(
        selection: Awaited<ReturnType<TaxFormInteractor['selectTaxAndLiability']>>,
        kraPin: string,
        periodFrom: string,
        periodTo: string
    ): Record<string, string> {
        const details = selection.taxPayerDetails;
        const pin = details.pinNo || kraPin;

        return {
            token_key: selection.tokenKey,
            currServerDate: this.todayDdMmYyyy(),
            serverDate: this.todayDdMmYyyy(),
            sessionFlag: '1',
            initialLoginPin: pin,
            'paymentdetailDTO.pinNo': pin,
            'paymentdetailDTO.taxPayerId': selection.taxPayerId,
            'paymentdetailDTO.taxPayerFirstName': selection.taxPayerName,
            'paymentdetailDTO.taxPayerFullAddr': selection.taxPayerAddress,
            'paymentdetailDTO.emailId': selection.taxPayerEmail,
            'paymentdetailDTO.mobileNumber': selection.taxPayerMobile,
            'paymentdetailDTO.taxPayerRegWith': selection.taxPayerRegWith,
            hidPinNo: pin,
            hidLogedInPinNo: pin,
            hidTaxPeriod: this.formatHidTaxPeriod(periodFrom, periodTo),
            cmbTaxHead: selection.taxHeadValue,
            cmbTaxSubHead: selection.taxSubHeadValue,
            cmbPaymentType: selection.paymentTypeValue,
            cmbTaxPeriod: '-1',
            cmbTaxPeriodYear: '-1',
            cmbIncomeType: '-1',
            actualLiabilityAmount_0: selection.liabilityPayload.actualLiabilityAmount,
            hidActualLiabilityAmount: selection.liabilityPayload.actualLiabilityAmount,
            hidAmountPaid: selection.liabilityPayload.amountPaid,
            start_taxObligationTable: '3',
            counter_taxObligationTable: '1',
            start_row_taxObligationTable: '1',
            taxObligationTable_1: selection.liabilityPayload.taxObligationTableEncoded,
            taxObligationTable_1_1: 'Delete',
            'paymentdetailDTO.totalAmountTobePaid': selection.liabilityPayload.totalAmountToBePaid || selection.liabilityPayload.amountPaid,
            'paymentdetailDTO.obligationId': selection.liabilityPayload.obligationId ?? '',
            'paymentdetailDTO.paymentMode': 'OPM',
            'paymentdetailDTO.bankCd': '-1',
            'paymentdetailDTO.bankIdRTGS': '-1',
            'paymentdetailDTO.branchIdRTGS': '-1',
            'paymentdetailDTO.beneAccIdRTGS': '-1',
            // amountPaid is intentionally left blank; KRA uses the table row amount.
            amountPaid: '',
            // For Agency Revenue (NITA/AHL), this is the actual payable amount.
            'paymentdetailDTO.totalamountPayableOTR': (selection.liabilityPayload as any).totalamountPayableOTR ?? '0',
            prnNo: '',
            paidAmount: '',
            changeAmount: '',
        };
    }

    private async downloadReceipt(pdfUrl: string, input: HttpPrnInput): Promise<{ receiptPath: string; receiptGcsPath?: string }> {
        const pdfBuffer = await this.session.client.getBuffer(pdfUrl, {
            step: 'prn-downloadPdf',
            headers: {
                Accept: 'application/pdf,application/octet-stream,*/*',
            },
        });

        if (pdfBuffer.length < 1000) {
            throw new KraError(KraErrorCode.UNKNOWN, 'Downloaded PRN PDF is too small; likely an error page');
        }

        const tmpDir = path.join(process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'), 'kra-receipts');
        const fileName = `${input.kraPin}_${input.taxObligationType}_${input.periodFrom}_PRN.pdf`;
        const localPath = path.join(tmpDir, fileName);

        await fs.mkdir(path.dirname(localPath), { recursive: true });
        await fs.writeFile(localPath, pdfBuffer);

        const jobId = input.jobId ?? 'prn-fallback';
        const stored = await storeReceiptLocally(localPath, jobId);

        let receiptGcsPath: string | undefined;

        if (input.userId && input.clientId) {
            try {
                const destination = gcsReceiptPath(input.userId, input.clientId, jobId, fileName);
                await uploadFile(stored.receiptPath, destination, { contentType: 'application/pdf' });
                receiptGcsPath = destination;
            } catch {
                // GCS upload is best-effort; local copy is sufficient.
            }
        }

        return { receiptPath: stored.receiptPath, receiptGcsPath };
    }

    private buildMultipartBodyFromHarTemplate(overrides: Record<string, string>): string & { boundary: string } {
        const candidates = [
            path.join(__dirname, 'har-submit-template.json'),
            path.join(process.cwd(), 'src', 'workers', 'http', 'payment-registration', 'har-submit-template.json'),
            path.join(process.cwd(), 'dist', 'workers', 'http', 'payment-registration', 'har-submit-template.json'),
        ];
        const templatePath = candidates.find((p) => require('fs').existsSync(p));
        if (!templatePath) {
            throw new KraError(KraErrorCode.UNKNOWN, 'HAR submit template not found; falling back to generated form body');
        }
        const template = JSON.parse(require('fs').readFileSync(templatePath, 'utf-8')) as {
            boundary: string;
            fields: [string, string][];
        };

        const fields: [string, string][] = template.fields.map(([name, value]) => {
            if (Object.prototype.hasOwnProperty.call(overrides, name)) {
                return [name, overrides[name]];
            }
            return [name, value];
        });

        // Add any override fields that are not in the template.
        const templateNames = new Set(template.fields.map(([name]) => name));
        for (const [name, value] of Object.entries(overrides)) {
            if (!templateNames.has(name)) {
                fields.push([name, value]);
            }
        }

        const boundary = template.boundary;
        const lines: string[] = [];
        for (const [name, value] of fields) {
            lines.push(`--${boundary}`);
            lines.push(`Content-Disposition: form-data; name="${name}"`);
            lines.push('');
            lines.push(value);
        }
        lines.push(`--${boundary}--`);
        lines.push('');
        const body = lines.join('\r\n');
        return Object.assign(body, { boundary });
    }

    private todayDdMmYyyy(): string {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        return `${day}/${month}/${year}`;
    }

    private formatHidTaxPeriod(periodFrom: string, periodTo: string): string {
        const from = new Date(periodFrom);
        const to = new Date(periodTo);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
            return '';
        }
        const fmt = (d: Date) => `${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`;
        return `${fmt(from)}-${fmt(to)}`;
    }

    private async log(message: string, progress?: number): Promise<void> {
        if (this.job) {
            if (progress !== undefined) {
                await setJobStep(this.job, progress, message);
            } else {
                await appendJobLog(this.job, message);
            }
        }
    }
}
