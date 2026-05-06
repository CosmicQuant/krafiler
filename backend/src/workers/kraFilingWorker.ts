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
import { measureJobPhase, setJobStep } from './utils';

export default async function processFilingJob(job: Job<FilingJob>): Promise<JobResult> {
    console.log(`[Worker][${job.data.jobId}] Starting filing orchestrator for obligation: ${job.data.payload.taxObligationType}`);
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

        return result;

    } catch (error) {
        console.error(`[Worker][${job.data.jobId}] Error processing job:`, error);
        return {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error)
        };
    } finally {
        await browserService.close();
    }
}
