/**
 * job-helpers.ts
 *
 * Job lifecycle utilities: logging, progress tracking,
 * cancellation checks, and phase measurement.
 *
 * Works with Firestore-backed job adapters.
 */

import { JobContext, FilingJob, FilingStepLog } from '../../types';
import { logger } from '../../logger';

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
    job: JobContext,
    context: string,
    progress?: number
): Promise<void> {
    await job.refresh();
    if (!hasCancellationRequest(job.data)) {
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
    logger.warn({ jobId: job.id ?? job.data.jobId, context }, `Cancellation requested during ${context}; stopping the job.`);
    throw new JobCancelledError();
}

// ─── Logging & Progress ──────────────────────────────────────────────────────

export async function appendJobLog(
    job: JobContext,
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

export async function setJobStep(job: JobContext, progress: number, message: string): Promise<void> {
    await assertJobNotCancelled(job, message, progress);
    await job.updateProgress(progress);
    await job.updateMessage(message);
    await appendJobLog(job, message, { progress });
    logger.info({ jobId: job.id ?? job.data.jobId, progress }, message);
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
    job: JobContext,
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
    logger.info({ jobId: job.id ?? job.data.jobId, phase: label }, `Timing start`);

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
        logger.info({ jobId: job.id ?? job.data.jobId, phase: label, durationMs }, `Timing end${context}`);
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
        logger.error({ jobId: job.id ?? job.data.jobId, phase: label, durationMs, err: error }, `Timing failure${context}`);
        throw error;
    }
}
