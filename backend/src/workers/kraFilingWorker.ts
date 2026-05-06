/**
 * kraFilingWorker.ts
 *
 * Primary BullMQ worker orchestrator for KRA portal automated filing.
 * Delegates actual interactions to domain-specific services (POM layer).
 */

import { Job } from 'bullmq';
import { FilingJob, JobResult } from '../types';
import {
    BrowserService,
    LoginService,
    NavigationService,
    FilingService,
    ReceiptService
} from './services';
import { measureJobPhase, setJobStep, captureFailureDiagnostics } from './utils';
import { logger } from '../logger';
import { db } from '../db/kysely';

export default async function processFilingJob(job: Job<FilingJob>): Promise<JobResult> {
    const startedAt = new Date().toISOString();
    const startTimeMs = Date.now();
    logger.info({ jobId: job.id ?? job.data.jobId, obligation: job.data.payload.taxObligationType }, 'Starting filing orchestrator');
    await setJobStep(job, 0, 'Initializing worker context...');

    const browserService = new BrowserService(job);
    let page;

    try {
        // Phase 1: Browser Launch
        page = await measureJobPhase(
            job,
            'BrowserLaunch',
            5,
            () => browserService.launch()
        );

        // Phase 2: Portal Login & Authentication
        const loginService = new LoginService(page, job);
        await measureJobPhase(
            job,
            'PortalLogin',
            10,
            () => loginService.login()
        );

        // Phase 3: Navigation
        const navigationService = new NavigationService(page, job);
        await measureJobPhase(
            job,
            'Navigation',
            35,
            async () => {
                await navigationService.navigateToReturns();
                await navigationService.selectObligation();
            }
        );

        // Phase 4: Form Processing & Upload
        const filingService = new FilingService(page, job);
        await measureJobPhase(
            job,
            'FormFiling',
            45,
            () => filingService.processFiling()
        );

        // Phase 5: Verification & Extraction
        const receiptService = new ReceiptService(page, job);
        const result = await measureJobPhase(
            job,
            'ReceiptExtraction',
            85,
            () => receiptService.extractReceipt()
        );

        // Record success to job history
        const completedAt = new Date().toISOString();
        await db.insertInto('job_history').values({
            jobId: String(job.id ?? job.data.jobId),
            clientPin: job.data.payload.kraPin,
            taxObligation: job.data.payload.taxObligationType,
            status: 'completed',
            receiptPath: result.receiptPath ?? null,
            receiptNumber: result.receiptNumber ?? null,
            startedAt,
            completedAt,
            durationMs: Date.now() - startTimeMs
        }).execute();

        return result;

    } catch (error) {
        logger.error({ jobId: job.id ?? job.data.jobId, err: error }, 'Error processing job');
        
        // Capture diagnostics if we have a page and an error occurred
        await captureFailureDiagnostics(page, job, error);

        // Record failure to job history
        const completedAt = new Date().toISOString();
        const errorMessage = error instanceof Error ? error.message : String(error);
        await db.insertInto('job_history').values({
            jobId: String(job.id ?? job.data.jobId),
            clientPin: job.data.payload.kraPin,
            taxObligation: job.data.payload.taxObligationType,
            status: 'failed',
            errorMessage,
            startedAt,
            completedAt,
            durationMs: Date.now() - startTimeMs
        }).execute();

        return {
            status: 'failed',
            error: errorMessage
        };
    } finally {
        await browserService.close();
    }
}
