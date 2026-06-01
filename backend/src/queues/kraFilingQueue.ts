/**
 * kraFilingQueue.ts
 *
 * Exports a shared BullMQ Queue and the Redis connection instance.
 * Both the Express API (producer) and the worker (consumer) import from here
 * so they share identical queue/connection configuration.
 *
 * NOTE: When USE_CLOUD_TASKS=true, Redis is not instantiated to avoid
 * connection errors in production. The dummy queue object is safe because
 * BullMQ paths are never executed in Cloud Tasks mode.
 */

import { Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { FilingJob } from '../types';

import { logger } from '../logger';

export const KRA_QUEUE_NAME = 'kra-filing-queue';

const USE_CLOUD_TASKS = process.env.USE_CLOUD_TASKS === 'true';

function createRedisConnection(): IORedis {
    const conn = new IORedis({
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    });

    conn.on('error', (err: Error) => {
        logger.error({ err }, '[Redis] Connection error');
    });

    conn.on('connect', () => {
        logger.info('[Redis] Connected successfully');
    });

    return conn;
}

/**
 * Shared Redis connection.
 * `maxRetriesPerRequest: null` is required by BullMQ.
 */
export const redisConnection = USE_CLOUD_TASKS ? null as any : createRedisConnection();

function createQueue(): Queue<FilingJob> {
    return new Queue<FilingJob>(KRA_QUEUE_NAME, {
        connection: redisConnection as any,
        defaultJobOptions: {
            attempts: 1,
            keepLogs: 200,
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 50 },
        },
    });
}

function createDummyQueue(): Queue<FilingJob> {
    // Return a minimal stub that satisfies the type but never actually talks to Redis.
    // getJob() is called by kraFilingWorker for cancellation checks; returning null is safe
    // because cancellation in Cloud Tasks mode is handled via Firestore jobStore.
    return {
        getJob: async () => null as unknown as Job<FilingJob>,
    } as unknown as Queue<FilingJob>;
}

export const kraFilingQueue = USE_CLOUD_TASKS ? createDummyQueue() : createQueue();
