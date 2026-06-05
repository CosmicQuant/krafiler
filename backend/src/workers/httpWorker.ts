/**
 * httpWorker.ts
 *
 * Express handler for Cloud Tasks dispatches.
 * Receives HTTP POST from Cloud Tasks, fetches job data from Firestore,
 * and delegates to the shared processFilingJob logic.
 */

import { Request, Response, Router } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { processFilingJob } from './kraFilingWorker';
import { FirestoreJobAdapter } from './jobAdapter';
import * as jobStore from '../services/jobStore';
import { logger } from '../logger';

const router = Router();

router.post('/process-job', async (req: Request, res: Response): Promise<void> => {
    // Support both direct JSON and Pub/Sub push envelope
    let jobId: string | undefined;

    if (req.body.message?.data) {
        // Pub/Sub push format
        try {
            const decoded = Buffer.from(req.body.message.data, 'base64').toString('utf8');
            const parsed = JSON.parse(decoded);
            jobId = parsed.jobId;
        } catch {
            res.status(400).json({ error: 'Invalid Pub/Sub message format' });
            return;
        }
    } else {
        // Direct JSON (legacy Cloud Tasks or local dev)
        jobId = req.body.jobId;
    }

    if (!jobId || typeof jobId !== 'string') {
        res.status(400).json({ error: 'jobId is required' });
        return;
    }

    logger.info({ jobId }, '[HTTP Worker] Received task');

    // Mark as active
    await jobStore.updateJob(jobId, {
        status: 'active',
        message: 'Processing started',
    }).catch((err) => {
        logger.warn({ jobId, err }, 'Failed to mark job as active in Firestore');
    });

    const adapter = new FirestoreJobAdapter(jobId);

    try {
        // Load initial data
        const doc = await jobStore.getJob(jobId);
        if (!doc) {
            logger.error({ jobId }, 'Job not found in Firestore');
            res.status(404).json({ error: 'Job not found' });
            return;
        }

        adapter.data = doc.payload;
        adapter.progress = typeof doc.progress === 'number' ? doc.progress : undefined;

        const result = await processFilingJob(adapter);

        // Mark completed
        await jobStore.updateJob(jobId, {
            status: 'completed',
            progress: 100,
            message: 'Job completed successfully',
            result,
            completedAt: Timestamp.now(),
        });

        logger.info({ jobId }, '[HTTP Worker] Job completed');
        res.json({ success: true, jobId });
    } catch (err: any) {
        const isCancelled = err?.name === 'JobCancelledError';
        const status = isCancelled ? 'cancelled' : 'failed';
        const message = err?.message || String(err);

        await jobStore.updateJob(jobId, {
            status,
            message,
            error: isCancelled
                ? undefined
                : { message, code: 'FILING_ERROR', retryable: false, failedAt: Timestamp.now() },
        }).catch((updateErr) => {
            logger.error({ jobId, err: updateErr }, 'Failed to update job failure state');
        });

        logger.error({ jobId, error: message, cancelled: isCancelled }, '[HTTP Worker] Job failed');
        res.status(isCancelled ? 200 : 500).json({ success: false, error: message, cancelled: isCancelled });
    }
});

export default router;
