/**
 * filingQueue.ts
 *
 * Pub/Sub-only queue abstraction for filing jobs.
 * All job state is backed by Firestore.
 */

import { publishFilingJob } from '../lib/pubsub';
import * as jobStore from './jobStore';
import { FilingJob, FilingStepLog } from '../types';

type PendingFilingState = 'waiting' | 'active' | 'delayed';

interface FilingGuardInput {
    userId: string;
    kraPin: string;
    clientName?: string;
    periodFrom: string;
    periodTo: string;
    taxObligationType: string;
    ownsRentalProperty: boolean;
    rentalIncomeAmount?: number;
    totYear?: number;
    totMonth?: number;
    totTurnover?: number;
    payeZipUrl?: string;
    vatZipUrl?: string;
    prepareVatOnly?: boolean;
    vatCurrentMonthDownload?: boolean;
    vatPreviousCredit?: number;
    sectionBWithoutPinSales?: number;
    printPrnOnly?: boolean;
    nitaAmount?: number;
    housingLevyAmount?: number;
}

function normaliseOptionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildPendingFilingKey(input: FilingGuardInput): string {
    return JSON.stringify({
        userId: input.userId.trim(),
        kraPin: input.kraPin.trim().toUpperCase(),
        clientName: input.clientName?.trim() ?? '',
        periodFrom: input.periodFrom.trim(),
        periodTo: input.periodTo.trim(),
        taxObligationType: input.taxObligationType,
        ownsRentalProperty: Boolean(input.ownsRentalProperty),
        rentalIncomeAmount: normaliseOptionalNumber(input.rentalIncomeAmount),
        totYear: normaliseOptionalNumber(input.totYear),
        totMonth: normaliseOptionalNumber(input.totMonth),
        totTurnover: normaliseOptionalNumber(input.totTurnover),
        payeZipUrl: input.payeZipUrl?.trim() ?? '',
        vatZipUrl: input.vatZipUrl?.trim() ?? '',
        prepareVatOnly: Boolean(input.prepareVatOnly),
        vatCurrentMonthDownload: Boolean(input.vatCurrentMonthDownload),
        vatPreviousCredit: normaliseOptionalNumber(input.vatPreviousCredit),
        printPrnOnly: Boolean(input.printPrnOnly),
        nitaAmount: normaliseOptionalNumber(input.nitaAmount),
        housingLevyAmount: normaliseOptionalNumber(input.housingLevyAmount),
    });
}

export async function findDuplicatePendingFiling(
    input: FilingGuardInput
): Promise<{ jobId: string; state: PendingFilingState } | null> {
    const requestedKey = buildPendingFilingKey(input);

    const snapshot = await jobStore.getPendingJobsByUser(input.userId);

    for (const { id, doc } of snapshot) {
        const data = doc;
        const pendingJobData = data.payload;
        if (!pendingJobData?.payload) continue;

        const pendingKey = buildPendingFilingKey({
            userId: pendingJobData.userId,
            kraPin: pendingJobData.payload.kraPin,
            clientName: pendingJobData.payload.clientName,
            periodFrom: pendingJobData.payload.periodFrom,
            periodTo: pendingJobData.payload.periodTo,
            taxObligationType: pendingJobData.payload.taxObligationType,
            ownsRentalProperty: pendingJobData.payload.ownsRentalProperty,
            rentalIncomeAmount: pendingJobData.payload.rentalIncomeAmount,
            totYear: pendingJobData.payload.totYear,
            totMonth: pendingJobData.payload.totMonth,
            totTurnover: pendingJobData.payload.totTurnover,
            payeZipUrl: pendingJobData.payload.payeZipUrl,
            vatZipUrl: pendingJobData.payload.vatZipUrl,
            prepareVatOnly: pendingJobData.payload.prepareVatOnly,
            vatCurrentMonthDownload: pendingJobData.payload.vatCurrentMonthDownload,
            vatPreviousCredit: pendingJobData.payload.vatPreviousCredit,
            printPrnOnly: pendingJobData.payload.printPrnOnly,
            nitaAmount: pendingJobData.payload.nitaAmount,
            housingLevyAmount: pendingJobData.payload.housingLevyAmount,
        });

        if (pendingKey !== requestedKey) continue;

        const state: PendingFilingState =
            data.status === 'active' || data.status === 'processing' ? 'active' :
            data.status === 'waiting' ? 'waiting' : 'delayed';

        return { jobId: id, state };
    }

    return null;
}

export async function queueFilingJob(
    filingJob: FilingJob,
    ownerUid: string
): Promise<{ jobId: string; messageId?: string }> {
    await jobStore.createJob(filingJob.jobId, ownerUid, filingJob, undefined, filingJob.payload.clientId);
    const messageId = await publishFilingJob(filingJob.jobId);
    return { jobId: filingJob.jobId, messageId };
}

export async function queueNssfJob(
    filingJob: FilingJob,
    ownerUid: string
): Promise<{ jobId: string; messageId?: string }> {
    await jobStore.createJob(filingJob.jobId, ownerUid, filingJob, undefined, filingJob.payload.clientId);
    const messageId = await publishFilingJob(filingJob.jobId);
    return { jobId: filingJob.jobId, messageId };
}

export async function cancelFilingJob(jobId: string): Promise<{
    success: boolean;
    state: string;
    message: string;
}> {
    const doc = await jobStore.getJob(jobId);
    if (!doc) {
        return { success: false, state: 'not_found', message: `No job found with ID: ${jobId}` };
    }

    if (doc.status === 'completed') {
        return { success: false, state: 'completed', message: 'This job has already completed.' };
    }

    if (doc.status === 'waiting') {
        await jobStore.updateJob(jobId, {
            status: 'cancelled',
            cancelledAt: new Date().toISOString(),
        });
        return { success: true, state: 'cancelled', message: 'Job cancelled before processing started.' };
    }

    await jobStore.updateJob(jobId, {
        cancelRequestedAt: new Date().toISOString(),
    });

    return { success: true, state: 'cancelling', message: 'Cancellation requested. The active filing will stop at the next safe checkpoint.' };
}

export interface JobStatusResult {
    jobId: string;
    state: string;
    progress: number | null;
    message?: string | null;
    attemptsMade?: number;
    failedReason?: string | null;
    stepLogs: FilingStepLog[];
    lastStep: FilingStepLog | null;
    credentialUpdate: any | null;
    result: any | null;
    processedOn: string | null;
    finishedOn: string | null;
}

export async function getFilingJobStatus(jobId: string): Promise<JobStatusResult | null> {
    const doc = await jobStore.getJob(jobId);
    if (!doc) return null;

    const logs = await jobStore.getJobLogs(jobId, 200);

    // failedReason must surface the REAL error (e.g. the actual KRA portal message),
    // never a generic placeholder. The worker writes the error in different shapes:
    //   - httpWorker failure handler: error = <string> (raw error message)
    //   - NSSF failure handler:       error = <string> (error-type code),
    //                                  errorMessage = <raw message>, userMessage = <friendly>
    //   - legacy/object form:         error = { message: <string> }
    const failedReason = doc.status === 'failed'
        ? (doc.userMessage
            ?? (doc.error && typeof doc.error === 'object' ? doc.error.message : null)
            ?? (typeof doc.error === 'string' && doc.error ? doc.error : null)
            ?? doc.errorMessage
            ?? doc.message
            ?? null)
        : null;

    return {
        jobId,
        state: doc.status,
        progress: doc.progress,
        message: doc.message ?? null,
        attemptsMade: 1,
        failedReason,
        stepLogs: logs,
        lastStep: logs.length > 0 ? logs[logs.length - 1] : null,
        credentialUpdate: doc.payload.credentialUpdate ?? null,
        result: doc.result ?? null,
        processedOn: doc.startedAt ? doc.startedAt.toDate().toISOString() : null,
        finishedOn: doc.completedAt ? doc.completedAt.toDate().toISOString() : null,
    };
}
