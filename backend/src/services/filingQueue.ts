/**
 * filingQueue.ts
 *
 * Queue abstraction layer. Bridges BullMQ and Pub/Sub.
 * Use this module instead of accessing BullMQ/Pub/Sub directly.
 */

import { publishFilingJob } from '../lib/pubsub';
import { adminDb } from '../lib/firebaseAdmin';
import * as jobStore from './jobStore';
import { FilingJob, FilingStepLog } from '../types';

const USE_PUBSUB = process.env.USE_PUBSUB === 'true';

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
    vatPreviousCredit?: number;
    sectionBWithoutPinSales?: number;
    printPrnOnly?: boolean;
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
        vatPreviousCredit: normaliseOptionalNumber(input.vatPreviousCredit),
        sectionBWithoutPinSales: normaliseOptionalNumber(input.sectionBWithoutPinSales),
        printPrnOnly: Boolean(input.printPrnOnly),
    });
}

export async function findDuplicatePendingFiling(
    input: FilingGuardInput
): Promise<{ jobId: string; state: PendingFilingState } | null> {
    if (USE_PUBSUB) {
        return findDuplicateInFirestore(input);
    }
    return findDuplicateInBullMQ(input);
}

async function findDuplicateInBullMQ(
    input: FilingGuardInput
): Promise<{ jobId: string; state: PendingFilingState } | null> {
    const { kraFilingQueue } = await import('../queues/kraFilingQueue');
    const requestedKey = buildPendingFilingKey(input);
    const pendingJobs = await kraFilingQueue.getJobs(['waiting', 'active', 'delayed'], 0, 199, true);

    for (const pendingJob of pendingJobs) {
        const pendingJobData = pendingJob.data as FilingJob;
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
            vatPreviousCredit: pendingJobData.payload.vatPreviousCredit,
            printPrnOnly: pendingJobData.payload.printPrnOnly,
        });

        if (pendingKey !== requestedKey) continue;

        const state = await pendingJob.getState();
        if (state === 'waiting' || state === 'active' || state === 'delayed') {
            return {
                jobId: String(pendingJob.id ?? pendingJobData.jobId),
                state,
            };
        }
    }

    return null;
}

async function findDuplicateInFirestore(
    input: FilingGuardInput
): Promise<{ jobId: string; state: PendingFilingState } | null> {
    const requestedKey = buildPendingFilingKey(input);

    // Query Firestore for pending jobs by userId and kraPin
    const snapshot = await adminDb
        .collection('jobs')
        .where('ownerUid', '==', input.userId)
        .where('status', 'in', ['waiting', 'active', 'processing'])
        .get();

    if (!snapshot) return null;

    for (const doc of snapshot.docs) {
        const data = doc.data() as jobStore.JobStoreDoc;
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
            vatPreviousCredit: pendingJobData.payload.vatPreviousCredit,
            printPrnOnly: pendingJobData.payload.printPrnOnly,
        });

        if (pendingKey !== requestedKey) continue;

        const state: PendingFilingState =
            data.status === 'active' || data.status === 'processing' ? 'active' :
            data.status === 'waiting' ? 'waiting' : 'delayed';

        return { jobId: doc.id, state };
    }

    return null;
}

export async function queueFilingJob(
    filingJob: FilingJob,
    ownerUid: string
): Promise<{ jobId: string; messageId?: string }> {
    if (USE_PUBSUB) {
        await jobStore.createJob(filingJob.jobId, ownerUid, filingJob, undefined, filingJob.payload.clientId);
        const messageId = await publishFilingJob(filingJob.jobId);
        return { jobId: filingJob.jobId, messageId };
    }

    const { kraFilingQueue } = await import('../queues/kraFilingQueue');
    await (kraFilingQueue.add as any)('file-return', filingJob, { jobId: filingJob.jobId });
    return { jobId: filingJob.jobId };
}

export async function queueNssfJob(
    filingJob: FilingJob,
    ownerUid: string
): Promise<{ jobId: string; messageId?: string }> {
    if (USE_PUBSUB) {
        await jobStore.createJob(filingJob.jobId, ownerUid, filingJob, undefined, filingJob.payload.clientId);
        const messageId = await publishFilingJob(filingJob.jobId);
        return { jobId: filingJob.jobId, messageId };
    }

    const { kraFilingQueue } = await import('../queues/kraFilingQueue');
    await (kraFilingQueue.add as any)('nssf-return', filingJob, { jobId: filingJob.jobId });
    return { jobId: filingJob.jobId };
}

export async function cancelFilingJob(jobId: string): Promise<{
    success: boolean;
    state: string;
    message: string;
}> {
    if (!USE_PUBSUB) {
        const { kraFilingQueue } = await import('../queues/kraFilingQueue');
        const job = await kraFilingQueue.getJob(jobId);
        if (!job) {
            return { success: false, state: 'not_found', message: `No job found with ID: ${jobId}` };
        }

        const queueState = await job.getState();
        if (queueState === 'completed') {
            return { success: false, state: 'completed', message: 'This job has already completed.' };
        }

        if (queueState === 'waiting' || queueState === 'delayed') {
            const removed = await kraFilingQueue.remove(jobId, { removeChildren: true });
            if (removed === 1) {
                return { success: true, state: 'cancelled', message: 'Job cancelled before processing started.' };
            }
        }

        const currentData = job.data as FilingJob;
        if (!currentData.cancelRequestedAt) {
            await job.updateData({ ...currentData, cancelRequestedAt: new Date().toISOString() });
            await job.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                message: 'Cancellation requested by operator.',
                progress: job.progress,
                level: 'info',
            }));
        }

        return { success: true, state: 'cancelling', message: 'Cancellation requested. The active filing will stop at the next safe checkpoint.' };
    }

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
    if (!USE_PUBSUB) {
        const { kraFilingQueue } = await import('../queues/kraFilingQueue');
        const job = await kraFilingQueue.getJob(jobId);
        if (!job) return null;

        const queueState = await job.getState();
        const jobLogsResult = await kraFilingQueue.getJobLogs(jobId, 0, 199, true);
        const stepLogs: FilingStepLog[] = jobLogsResult.logs.map((raw: string) => {
            try {
                const parsed = JSON.parse(raw) as Partial<FilingStepLog>;
                return {
                    timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString(),
                    message: typeof parsed.message === 'string' ? parsed.message : raw,
                    progress: typeof parsed.progress === 'number' ? parsed.progress : null,
                    level: parsed.level === 'error' ? 'error' : 'info',
                } as FilingStepLog;
            } catch {
                return {
                    timestamp: new Date().toISOString(),
                    message: raw,
                    progress: null,
                    level: 'info',
                } as FilingStepLog;
            }
        });

        return {
            jobId,
            state: queueState,
            progress: typeof job.progress === 'number' ? job.progress : null,
            attemptsMade: job.attemptsMade,
            failedReason: job.failedReason ?? null,
            stepLogs,
            lastStep: stepLogs.length > 0 ? stepLogs[stepLogs.length - 1] : null,
            credentialUpdate: job.data.credentialUpdate ?? null,
            result: job.returnvalue ?? null,
            processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
            finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        };
    }

    const doc = await jobStore.getJob(jobId);
    if (!doc) return null;

    const logs = await jobStore.getJobLogs(jobId, 200);

    return {
        jobId,
        state: doc.status,
        progress: doc.progress,
        attemptsMade: 1,
        failedReason: doc.error?.message ?? null,
        stepLogs: logs,
        lastStep: logs.length > 0 ? logs[logs.length - 1] : null,
        credentialUpdate: doc.payload.credentialUpdate ?? null,
        result: doc.result ?? null,
        processedOn: doc.startedAt ? doc.startedAt.toDate().toISOString() : null,
        finishedOn: doc.completedAt ? doc.completedAt.toDate().toISOString() : null,
    };
}
