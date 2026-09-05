import { JobContext, NilReturnPayload } from '../../../types';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { adminDb } from '../../../lib/firebaseAdmin';
import { KraHttpSession } from '../session/KraHttpSession';
import { HttpLoginService } from '../navigation/HttpLoginService';
import { ReturnsNavigator } from '../navigation/ReturnsNavigator';
import { CaptureContext, CaptureOptions, CaptureUploader } from '../capture';
import { BaseHttpFilingService, FilingExecuteResult } from './BaseHttpFilingService';
import { NilReturnSubmitter } from './NilReturnSubmitter';
import { TotReturnSubmitter } from './TotReturnSubmitter';
import { VatReturnSubmitter } from './VatReturnSubmitter';
import { MriReturnSubmitter } from './MriReturnSubmitter';
import { PayeReturnSubmitter } from './PayeReturnSubmitter';
import { VatPrepareService, VatPrepareResult } from './VatPrepareService';
import { HttpPrnService } from '../payment-registration/HttpPrnService';
import { KraError, KraErrorCode } from '../errors';
import { computeFullHousingLevyForPeriod, computeNitaLevyForPeriod } from '../../../services/payrollLevyAmounts';

export interface HttpFilingOrchestratorResult extends FilingExecuteResult {
    credentialUpdate: null;
    prnPath?: string;
    prnResults?: Array<{ taxType?: string; prnPath?: string; prnGcsPath?: string }>;
    vatPrepareResult?: VatPrepareResult;
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

            const isNil = this.payload.isNil === true;
            const isPrnOnly = this.payload.printPrnOnly === true;

            // PRN-only jobs: HttpPrnService handles login itself, so skip the
            // orchestrator login to avoid double-login (the second GET to the
            // base page returns the dashboard, not the login form).
            if (!isPrnOnly) {
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
            }

            // PRN-only jobs bypass Returns navigation and go straight to Payment Registration.
            if (isPrnOnly) {
                const supportedPrnTypes = [
                    'turnover_tax',
                    'monthly_rental_income',
                    'income_tax_resident_individual',
                    'income_tax_non_resident_individual',
                    'income_tax_company',
                    'paye',
                    'vat',
                    'capital_gains_tax',
                    'digital_asset_tax',
                    'advance_tax',
                    'withholding',
                    'excise_duty',
                    'nita',
                    'affordable_housing',
                ];
                if (!supportedPrnTypes.includes(this.payload.taxObligationType)) {
                    throw new KraError(
                        KraErrorCode.UNKNOWN,
                        `HTTP PRN generation is not yet supported for ${this.payload.taxObligationType}`
                    );
                }

                // PAYE PRN requests generate 3 PRNs: PAYE, NITA, AHL.
                // Other tax types generate a single PRN.
                const prnTaxTypes: Array<{ taxType: string; label: string }> = [];
                if (this.payload.taxObligationType === 'paye') {
                    prnTaxTypes.push(
                        { taxType: 'paye', label: 'PAYE' },
                        { taxType: 'nita', label: 'NITA Levy' },
                        { taxType: 'affordable_housing', label: 'Housing Levy' },
                    );
                } else {
                    prnTaxTypes.push({ taxType: this.payload.taxObligationType, label: this.payload.taxObligationType });
                }

                const allPrnResults: Array<{ taxType?: string; prnPath?: string; prnGcsPath?: string; error?: string }> = [];
                let hasAtLeastOneSuccess = false;

                // Load once for the PAYE+NITA+AHL case. Fall back to payload amounts if available.
                let clientAmounts: { nitaAmount?: number; housingLevyAmount?: number } = {};
                if (this.payload.clientId) {
                    try {
                        const clientDoc = await adminDb.collection('clients').doc(this.payload.clientId).get();
                        if (clientDoc.exists) {
                            const clientData = clientDoc.data() as any;
                            clientAmounts = {
                                nitaAmount: clientData?.amounts?.nitaAmount ?? this.payload.nitaAmount,
                                housingLevyAmount: clientData?.amounts?.housingLevyAmount ?? this.payload.housingLevyAmount,
                            };
                        }
                    } catch (err) {
                        console.warn(`[HTTP Filing] Could not load client amounts for PRN:`, (err as Error).message);
                    }
                }

                for (const prnConfig of prnTaxTypes) {
                    try {
                        await appendJobLog(this.job, `Generating PRN for ${prnConfig.label}...`, { progress: 80 });

                        // NOTE: amounts.housingLevyAmount stores the FULL statutory
                        // AHL remittance (3% = 1.5% employee + 1.5% employer),
                        // matching the P10 XML declaration. Use it as-is — do NOT
                        // double it again here.
                        //
                        // The payroll run for the period is the AUTHORITATIVE source
                        // (Σ employee ahlDeduction × 2) — client-doc amounts and
                        // payload values can be stale from before the full-statutory
                        // change, so prefer the run whenever it exists.
                        let amount: number | undefined;
                        if (prnConfig.taxType === 'nita') {
                            amount = (await computeNitaLevyForPeriod(this.payload.clientId, this.payload.periodFrom))
                                ?? (clientAmounts.nitaAmount ?? this.payload.nitaAmount);
                        } else if (prnConfig.taxType === 'affordable_housing') {
                            amount = (await computeFullHousingLevyForPeriod(this.payload.clientId, this.payload.periodFrom))
                                ?? (clientAmounts.housingLevyAmount ?? this.payload.housingLevyAmount);
                        }

                        const prnService = new HttpPrnService({ session, job: this.job });
                        const prnResult = await prnService.execute({
                            kraPin: this.payload.kraPin,
                            kraPassword: this.payload.kraPassword || '',
                            taxObligationType: prnConfig.taxType as any,
                            periodFrom: this.payload.periodFrom,
                            periodTo: this.payload.periodTo,
                            clientId: this.payload.clientId,
                            clientName: this.payload.clientName,
                            otpCode: this.payload.otpCode,
                            userId: this.job.data.userId,
                            jobId: this.job.data.jobId,
                            amount,
                        });

                        allPrnResults.push({
                            taxType: prnConfig.taxType,
                            prnPath: prnResult.receiptPath,
                            prnGcsPath: prnResult.receiptGcsPath,
                        });
                        hasAtLeastOneSuccess = true;

                        await appendJobLog(this.job, `PRN ${prnResult.prnNumber} generated for ${prnConfig.label}`, { progress: 85 });
                    } catch (prnErr: any) {
                        // Don't fail the entire job if one PRN type fails (e.g., no PAYE liability but NITA/AHL exist).
                        const errMsg = prnErr instanceof Error ? prnErr.message : String(prnErr);
                        await appendJobLog(this.job, `PRN generation failed for ${prnConfig.label}: ${errMsg}`, { progress: 85, level: 'warn' });
                        console.warn(`[HTTP Filing] PRN failed for ${prnConfig.taxType}:`, errMsg);
                        allPrnResults.push({
                            taxType: prnConfig.taxType,
                            error: errMsg,
                        });
                    }
                }

                if (!hasAtLeastOneSuccess) {
                    const firstError = allPrnResults.find((r) => r.error)?.error || 'All PRN generations failed';
                    throw new KraError(KraErrorCode.VALIDATION_ERROR, firstError, { retryable: false });
                }

                const successfulPrns = allPrnResults.filter((r) => !r.error);
                await setJobStep(this.job, 100, `${successfulPrns.length}/${prnTaxTypes.length} PRN(s) generated successfully via HTTP`);
                await this.finalizeCapture('success');

                return {
                    receiptPath: successfulPrns[0]?.prnPath ?? '',
                    receiptNumber: null,
                    credentialUpdate: null,
                    prnPath: successfulPrns[0]?.prnGcsPath ?? successfulPrns[0]?.prnPath,
                    prnResults: allPrnResults,
                };
            }

            // VAT prepare-only jobs (both prepareVatOnly and vatCurrentMonthDownload):
            // login → extract credit/withholding → download ZIP → generate return ZIP.
            // VatPrepareService handles its own navigation (credit extraction navigates away from eReturns).
            const isVatPrepareOnly = this.payload.taxObligationType === 'vat' && (this.payload as any).prepareVatOnly === true && (this.payload as any).vatCurrentMonthDownload !== true;
            const isVatCurrentMonth = this.payload.taxObligationType === 'vat' && (this.payload as any).vatCurrentMonthDownload === true;
            if (isVatPrepareOnly || isVatCurrentMonth) {
                const vatPrepareService = new VatPrepareService(session, this.job);
                const vatResult = await vatPrepareService.execute({
                    kraPin: this.payload.kraPin,
                    clientName: this.payload.clientName ?? this.payload.kraPin,
                    periodFrom: this.payload.periodFrom,
                    periodTo: this.payload.periodTo,
                    vatPreviousCredit: Number((this.payload as any).vatPreviousCredit ?? 0) || 0,
                    withholdingAmount: Number((this.payload as any).withholdingAmount ?? 0) || undefined,
                    sectionBWithoutPinSales: Number((this.payload as any).sectionBWithoutPinSales ?? 0) || undefined,
                    currentMonthDownload: isVatCurrentMonth,
                });

                await setJobStep(this.job, 100, isVatCurrentMonth ? 'Current-month VAT preparation completed via HTTP' : 'VAT preparation completed via HTTP');
                await this.finalizeCapture('success');

                return {
                    receiptPath: '',
                    receiptNumber: null,
                    credentialUpdate: null,
                    vatPrepareResult: vatResult,
                };
            }

            // VAT upload jobs: login → navigate → select VAT obligation → upload generated ZIP → parse receipt.
            const isVatUpload = this.payload.taxObligationType === 'vat' && !!(this.payload as any).vatZipUrl && !(this.payload as any).prepareVatOnly && !(this.payload as any).vatCurrentMonthDownload;
            if (isVatUpload) {
                const navigator = new ReturnsNavigator(session, this.job);
                await navigator.navigateToReturns(false);
                await navigator.selectReturnObligation('vat', this.payload.kraPin);

                const vatSubmitter = new VatReturnSubmitter(session, this.job);
                const input = this.buildServiceInput();
                const result = await vatSubmitter.execute(input);

                await setJobStep(this.job, 100, 'VAT return filed successfully via HTTP');
                await this.finalizeCapture('success');

                return {
                    ...result,
                    credentialUpdate: null,
                };
            }

            // PAYE upload jobs: login → navigate → select PAYE obligation → upload ZIP → parse receipt.
            const isPayeUpload = this.payload.taxObligationType === 'paye' && !!(this.payload as any).payeZipUrl && !isPrnOnly;
            if (isPayeUpload) {
                const navigator = new ReturnsNavigator(session, this.job);
                await navigator.navigateToReturns(false);
                await navigator.selectReturnObligation('paye', this.payload.kraPin);

                const payeSubmitter = new PayeReturnSubmitter(session, this.job);
                const input = this.buildServiceInput();
                const result = await payeSubmitter.execute(input);

                await setJobStep(this.job, 100, 'PAYE return filed successfully via HTTP');
                await this.finalizeCapture('success');

                return {
                    ...result,
                    credentialUpdate: null,
                };
            }

            // MRI filing jobs (non-nil): login → navigate → select MRI obligation → fill rental amount → submit.
            const isMriFiling = this.payload.taxObligationType === 'monthly_rental_income' && !isNil && !isPrnOnly;
            if (isMriFiling) {
                const navigator = new ReturnsNavigator(session, this.job);
                await navigator.navigateToReturns(false);
                await navigator.selectReturnObligation('monthly_rental_income', this.payload.kraPin);

                const mriSubmitter = new MriReturnSubmitter(session, this.job);
                const input = this.buildServiceInput();
                const result = await mriSubmitter.execute(input);

                await setJobStep(this.job, 100, 'MRI return filed successfully via HTTP');
                await this.finalizeCapture('success');

                return {
                    ...result,
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

            const service = this.resolveService(this.payload.taxObligationType, session, this.job, isNil);
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
        job: JobContext,
        isNil: boolean
    ): BaseHttpFilingService {
        // Nil returns for ALL tax types use the same NilReturnSubmitter flow.
        // Non-nil TOT needs zip upload, but nil TOT is just a nil return like any other.
        if (isNil) {
            return new NilReturnSubmitter(session, job);
        }
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
