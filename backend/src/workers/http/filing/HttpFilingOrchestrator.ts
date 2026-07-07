import { JobContext, NilReturnPayload } from '../../../types';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { KraHttpSession } from '../session/KraHttpSession';
import { HttpLoginService } from '../navigation/HttpLoginService';
import { ReturnsNavigator } from '../navigation/ReturnsNavigator';
import { CaptureContext, CaptureOptions, CaptureUploader } from '../capture';
import { BaseHttpFilingService, FilingExecuteResult } from './BaseHttpFilingService';
import { NilReturnSubmitter } from './NilReturnSubmitter';
import { TotReturnSubmitter } from './TotReturnSubmitter';
import { HttpPrnService } from '../prn/HttpPrnService';
import { KraError, KraErrorCode } from '../errors';

export interface HttpFilingOrchestratorResult extends FilingExecuteResult {
    credentialUpdate: null;
}

function shouldCapture(payload: NilReturnPayload): boolean {
    const globalEnabled = process.env.KRA_CAPTURE_ENABLED === 'true';
    const payloadEnabled = (payload as any).capture === true;
    return globalEnabled || payloadEnabled;
}

/**
 * Runs the common HTTP filing flow for any supported obligation:
 *   1. Login
 *   2. Navigate to Returns
 *   3. Select obligation
 *   4. Delegate to obligation-specific service
 *   5. Download receipt
 */
export class HttpFilingOrchestrator {
    private job: JobContext;
    private payload: NilReturnPayload;
    private captureContext?: CaptureContext;

    constructor(job: JobContext) {
        this.job = job;
        this.payload = job.data.payload;
    }

    async run(): Promise<HttpFilingOrchestratorResult> {
        const captureOptions: CaptureOptions = {
            enabled: shouldCapture(this.payload),
            screenshots: process.env.KRA_CAPTURE_SCREENSHOTS === 'true',
        };

        if (captureOptions.enabled) {
            this.captureContext = new CaptureContext({
                jobId: this.job.data.jobId,
                userId: this.job.data.userId,
                clientId: this.payload.clientId,
                taxObligationType: this.payload.taxObligationType,
                isNil: this.payload.isNil,
                kraPin: this.payload.kraPin,
                options: captureOptions,
                uploader: new CaptureUploader(),
            });
            await appendJobLog(this.job, 'Capture enabled for this filing run', { progress: 5 });
        }

        const session = new KraHttpSession({
            timeout: 60_000,
            captureContext: this.captureContext,
        });

        try {
            await appendJobLog(this.job, 'Using HTTP state machine for filing', { progress: 5 });

            const loginService = new HttpLoginService(session, this.job);
            const loginResult = await loginService.execute(
                this.payload.kraPin,
                this.payload.kraPassword || '',
                this.payload.otpCode
            );

            if (loginResult.passwordExpired) {
                await appendJobLog(this.job, 'Password expired; falling back to Playwright for credential reset', { progress: 42, level: 'warn' });
                throw new KraError(KraErrorCode.PASSWORD_EXPIRED, 'Password expired — falling back to Playwright', { retryable: false });
            }

            if (loginResult.mobileVerificationRequired) {
                await appendJobLog(this.job, 'Mobile verification required; falling back to Playwright', { progress: 42, level: 'warn' });
                throw new KraError(KraErrorCode.MOBILE_VERIFICATION_REQUIRED, 'Mobile verification required — falling back to Playwright', { retryable: false });
            }

            const isNil = this.payload.isNil === true;

            // PRN-only jobs bypass Returns navigation and go straight to Payment Registration.
            if (this.payload.printPrnOnly === true) {
                if (this.payload.taxObligationType !== 'turnover_tax' && this.payload.taxObligationType !== 'monthly_rental_income') {
                    throw new KraError(
                        KraErrorCode.UNKNOWN,
                        `HTTP PRN generation is not yet supported for ${this.payload.taxObligationType}`
                    );
                }

                const prnService = new HttpPrnService({ session, job: this.job });
                const prnResult = await prnService.execute({
                    kraPin: this.payload.kraPin,
                    kraPassword: this.payload.kraPassword || '',
                    taxObligationType: this.payload.taxObligationType,
                    periodFrom: this.payload.periodFrom,
                    periodTo: this.payload.periodTo,
                    clientId: this.payload.clientId,
                    clientName: this.payload.clientName,
                    otpCode: this.payload.otpCode,
                    userId: this.job.data.userId,
                    jobId: this.job.data.jobId,
                });

                await setJobStep(this.job, 100, `PRN ${prnResult.prnNumber} generated successfully via HTTP`);
                await this.finalizeCapture('success');

                return {
                    receiptPath: prnResult.receiptPath,
                    receiptNumber: prnResult.prnNumber,
                    credentialUpdate: null,
                };
            }

            const navigator = new ReturnsNavigator(session, this.job);
            await navigator.navigateToReturns(isNil);
            if (isNil) {
                await navigator.selectNilReturnObligation(this.payload.taxObligationType, this.payload.kraPin);
            } else {
                await navigator.selectReturnObligation(this.payload.taxObligationType, this.payload.kraPin);
            }

            const service = this.resolveService(this.payload.taxObligationType, session, this.job);
            const input = this.buildServiceInput();
            const result = await service.execute(input);

            await setJobStep(this.job, 100, `${this.payload.taxObligationType} return filed successfully via HTTP`);
            await this.finalizeCapture('success');

            return {
                ...result,
                credentialUpdate: null,
            };
        } catch (err: any) {
            await this.finalizeCapture('failure');
            throw err;
        }
    }

    private resolveService(
        taxObligationType: string,
        session: KraHttpSession,
        job: JobContext
    ): BaseHttpFilingService {
        switch (taxObligationType) {
            case 'paye':
            case 'income_tax_resident_individual':
            case 'income_tax_non_resident_individual':
            case 'income_tax_company':
            case 'vat':
            case 'monthly_rental_income':
            case 'excise_duty':
                return new NilReturnSubmitter(session, job);
            case 'turnover_tax':
                return new TotReturnSubmitter(session, job);
            default:
                throw new Error(`No HTTP filing service implemented for obligation type: ${taxObligationType}`);
        }
    }

    private buildServiceInput(): Record<string, unknown> {
        return {
            kraPin: this.payload.kraPin,
            periodFrom: this.payload.periodFrom,
            periodTo: this.payload.periodTo,
            ownsRentalProperty: this.payload.ownsRentalProperty,
            taxObligationType: this.payload.taxObligationType,
            rentalIncomeAmount: this.payload.rentalIncomeAmount,
            totYear: this.payload.totYear,
            totMonth: this.payload.totMonth,
            totTurnover: this.payload.totTurnover,
            otpCode: this.payload.otpCode,
            vatZipUrl: this.payload.vatZipUrl,
            payeZipUrl: this.payload.payeZipUrl,
            prepareVatOnly: this.payload.prepareVatOnly,
            vatPreviousCredit: this.payload.vatPreviousCredit,
            sectionBWithoutPinSales: this.payload.sectionBWithoutPinSales,
        };
    }

    private async finalizeCapture(outcome: 'success' | 'failure' | 'cancelled'): Promise<void> {
        if (!this.captureContext) return;
        try {
            await this.captureContext.finalize(outcome);
        } catch (err: any) {
            console.error(`[HttpFilingOrchestrator] Failed to finalize capture:`, err.message);
        }
    }
}
