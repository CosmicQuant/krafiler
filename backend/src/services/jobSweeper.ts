/**
 * jobSweeper.ts
 *
 * Marks filing jobs stuck in 'active'/'processing' status for over 45 minutes
 * as failed. When the worker crashes or its Cloud Run instance is replaced
 * mid-job, the job document stays 'active' forever — which blocks subsequent
 * filings for the same return via the duplicate-pending guard (409).
 *
 * A healthy job refreshes `updatedAt` on every progress/message update, so
 * 45 minutes without an update means the job is dead (no worker is processing
 * it and Pub/Sub will not redeliver — delivery attempts are capped at 1).
 */

import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../logger';

const JOBS_COLLECTION = 'jobs';
export const STALE_ACTIVE_MS = 45 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export async function sweepStalledJobs(): Promise<number> {
    const cutoffMs = Date.now() - STALE_ACTIVE_MS;
    // Single-field equality query (automatic index) — staleness is filtered in
    // memory to avoid requiring a composite index on (status, updatedAt).
    const snapshot = await adminDb
        .collection(JOBS_COLLECTION)
        .where('status', 'in', ['active', 'processing'])
        .get();

    let swept = 0;
    for (const doc of snapshot.docs) {
        const data = doc.data() as any;
        const updatedAtMs = data.updatedAt?.toMillis?.() ?? 0;
        if (!updatedAtMs || updatedAtMs >= cutoffMs) {
            continue; // Still fresh — a worker may legitimately be processing it.
        }

        const message =
            'This filing job stopped updating because the filing worker restarted or crashed mid-run. ' +
            'Its final state on the KRA portal could not be confirmed — please verify on the KRA portal ' +
            'before retrying, then re-run the filing if it was not submitted.';

        await doc.ref.update({
            status: 'failed',
            error: message,
            userMessage: message,
            message: 'Job stalled (no progress for 45 minutes) — marked failed. Please retry.',
            completedAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        swept += 1;
        logger.warn(
            { jobId: doc.id, lastUpdateAgeMs: Date.now() - updatedAtMs },
            '[JobSweeper] Marked stalled active job as failed'
        );
    }

    if (swept > 0) {
        logger.info({ swept }, '[JobSweeper] Sweep complete — stalled jobs failed');
    }
    return swept;
}

/** Starts the periodic sweep; returns a stop function (mainly for tests). */
export function startJobSweeper(): () => void {
    const runSweep = () => {
        sweepStalledJobs().catch((err) => {
            logger.error({ err }, '[JobSweeper] Sweep failed');
        });
    };
    // Run once shortly after boot (catches jobs orphaned by a previous crash),
    // then periodically.
    const bootTimer = setTimeout(runSweep, 15_000);
    const interval = setInterval(runSweep, SWEEP_INTERVAL_MS);
    bootTimer.unref();
    interval.unref();
    return () => {
        clearTimeout(bootTimer);
        clearInterval(interval);
    };
}
