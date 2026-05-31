/**
 * cloudTasks.ts
 *
 * Cloud Tasks queue integration for the KRAFILER filing pipeline.
 *
 * Bridge mode: when USE_CLOUD_TASKS=true, jobs are queued via Cloud Tasks
 * instead of BullMQ. The worker receives HTTP POST dispatches from Cloud Tasks.
 */

import { v2 } from '@google-cloud/tasks';
import { logger } from '../logger';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'taxpulse-498006';
const REGION = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
const QUEUE_NAME = process.env.CLOUD_TASKS_QUEUE || 'krafiler-filing-queue';
const WORKER_URL = process.env.WORKER_URL || `http://localhost:3001/process-job`;
const SERVICE_ACCOUNT_EMAIL = process.env.WORKER_SERVICE_ACCOUNT || '';

let clientInstance: v2.CloudTasksClient | null = null;

function getClient(): v2.CloudTasksClient {
    if (!clientInstance) {
        clientInstance = new v2.CloudTasksClient();
    }
    return clientInstance;
}

function queuePath(): string {
    return getClient().queuePath(PROJECT_ID, REGION, QUEUE_NAME);
}

/**
 * Enqueue a filing job as a Cloud Task.
 * Returns the Cloud Task name (for cancellation tracking).
 */
export async function enqueueFilingJob(jobId: string): Promise<string> {
    const client = getClient();
    const parent = queuePath();

    const task = {
        httpRequest: {
            httpMethod: 'POST' as const,
            url: WORKER_URL,
            headers: {
                'Content-Type': 'application/json',
                'X-Cloudtasks-Taskname': jobId,
            },
            body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
            ...(SERVICE_ACCOUNT_EMAIL
                ? {
                    oidcToken: {
                        serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
                    },
                }
                : {}),
        },
    };

    const [response] = await client.createTask({ parent, task });
    const taskName = response.name ?? '';
    logger.info({ jobId, taskName }, 'Cloud Task created');
    return taskName;
}

/**
 * Cancel a Cloud Task by name.
 */
export async function cancelTask(taskName: string): Promise<void> {
    if (!taskName) return;
    const client = getClient();
    await client.deleteTask({ name: taskName });
    logger.info({ taskName }, 'Cloud Task cancelled');
}

/**
 * List tasks in the queue (optionally filtered by state).
 */
export async function listQueueTasks(
    _filter?: string
): Promise<Array<{ name: string; status: string; scheduleTime?: Date }>> {
    const client = getClient();
    const parent = queuePath();
    const response = await client.listTasks({ parent });
    const tasks: any[] = (response as any)[0] || [];
    return tasks.map((t: any) => ({
        name: t.name ?? '',
        status: t.status ?? 'unknown',
        scheduleTime: t.scheduleTime ? new Date(t.scheduleTime) : undefined,
    }));
}

/**
 * Ensure the Cloud Tasks queue exists.
 * Call this once at startup (idempotent).
 */
export async function ensureQueueExists(): Promise<void> {
    const client = getClient();
    const queuePathStr = client.queuePath(PROJECT_ID, REGION, QUEUE_NAME);

    try {
        await client.getQueue({ name: queuePathStr });
        logger.info({ queue: QUEUE_NAME }, 'Cloud Tasks queue already exists');
    } catch (err: any) {
        if (err?.code === 5 || err?.message?.includes('not found')) {
            await client.createQueue({
                parent: client.locationPath(PROJECT_ID, REGION),
                queue: {
                    name: queuePathStr,
                    rateLimits: {
                        maxDispatchesPerSecond: 0.016, // ~1 per minute
                        maxConcurrentDispatches: 1,
                    },
                    retryConfig: {
                        maxAttempts: 1,
                        minBackoff: { seconds: 60 },
                    },
                },
            });
            logger.info({ queue: QUEUE_NAME }, 'Cloud Tasks queue created');
        } else {
            throw err;
        }
    }
}
