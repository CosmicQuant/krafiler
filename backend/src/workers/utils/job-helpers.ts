/**
 * job-helpers.ts
 *
 * BullMQ job lifecycle utilities: logging, progress tracking,
 * cancellation checks, and phase measurement.
 */

import { Job } from 'bullmq';
import { kraFilingQueue } from '../../queues/kraFilingQueue';
import { FilingJob, FilingStepLog } from '../../types';

// ─── Cancellation ────────────────────────────────────────────────────────────

export class JobCancelledError extends Error {
    constructor(message = 'Job cancelled by user.') {
        super(message);
        this.name = 'JobCancelledError';
    }
}

export function hasCancellationRequest(jobData?: Partial<FilingJob> | null): boolean {
    return typeof jobData?.cancelRequestedAt === 'string' && jobData.cancelRequestedAt.trim().length > 0;
}

export async function assertJobNotCancelled(
    job: Job<FilingJob>,
    context: string,
    progress?: number
): Promise<void> {
    const latestJob = await kraFilingQueue.getJob(String(job.id ?? job.data.jobId));
    const latestJobData = (latestJob?.data ?? job.data) as FilingJob;
    if (!hasCancellationRequest(latestJobData)) {
        return;
    }

    const progressValue = typeof progress === 'number'
        ? progress
        : typeof job.progress === 'number'
            ? job.progress
            : undefined;

    await appendJobLog(job, `Cancellation requested by operator. Stopping during ${context}.`, {
        progress: progressValue,
    });
    console.warn(`[Worker][${job.data.jobId}] Cancellation requested during ${context}; stopping the job.`);
    throw new JobCancelledError();
}

// ─── Logging & Progress ──────────────────────────────────────────────────────

export async function appendJobLog(
    job: Job<FilingJob>,
    message: string,
    options: {
        progress?: number;
        level?: FilingStepLog['level'];
    } = {}
): Promise<void> {
    const entry: FilingStepLog = {
        timestamp: new Date().toISOString(),
        message,
        progress: typeof options.progress === 'number' ? options.progress : null,
        level: options.level ?? 'info',
    };

    await job.log(JSON.stringify(entry));
}

export async function setJobStep(job: Job<FilingJob>, progress: number, message: string): Promise<void> {
    await assertJobNotCancelled(job, message, progress);
    await job.updateProgress(progress);
    await appendJobLog(job, message, { progress });
    console.log(`[Worker][${job.data.jobId}] ${message}`);
}

// ─── Phase Measurement ───────────────────────────────────────────────────────

async function resolveTimingContext(
    details?: string | (() => string | Promise<string>)
): Promise<string> {
    if (!details) {
        return '';
    }

    try {
        const resolved = typeof details === 'function' ? await details() : details;
        return resolved ? ` | ${resolved}` : '';
    } catch {
        return '';
    }
}

export async function measureJobPhase<T>(
    job: Job<FilingJob>,
    label: string,
    progress: number | undefined,
    action: () => Promise<T>,
    details?: string | (() => string | Promise<string>)
): Promise<T> {
    const startedAt = new Date();
    const startedMs = Date.now();
    const progressValue = typeof progress === 'number' ? progress : undefined;
    await assertJobNotCancelled(job, label, progressValue);
    const startMessage = `Timing start | ${label} | startedAt=${startedAt.toISOString()}`;
    await appendJobLog(job, startMessage, { progress: progressValue });
    console.log(`[Worker][${job.data.jobId}] ${startMessage}`);

    try {
        const result = await action();
        const endedAt = new Date();
        const durationMs = Date.now() - startedMs;
        const context = await resolveTimingContext(details);
        const endMessage = `Timing end | ${label} | startedAt=${startedAt.toISOString()} | endedAt=${endedAt.toISOString()} | durationMs=${durationMs}${context}`;
        await appendJobLog(
            job,
            endMessage,
            { progress: progressValue }
        );
        console.log(`[Worker][${job.data.jobId}] ${endMessage}`);
        return result;
    } catch (error) {
        const endedAt = new Date();
        const durationMs = Date.now() - startedMs;
        const context = await resolveTimingContext(details);
        const message = error instanceof Error ? error.message : String(error);
        const failureMessage = `Timing failure | ${label} | startedAt=${startedAt.toISOString()} | endedAt=${endedAt.toISOString()} | durationMs=${durationMs} | error=${message}${context}`;
        await appendJobLog(
            job,
            failureMessage,
            { progress: progressValue, level: 'error' }
        );
        console.warn(`[Worker][${job.data.jobId}] ${failureMessage}`);
        throw error;
    }
}
