/**
 * kraFilingQueue.ts
 *
 * Exports a shared BullMQ Queue and the Redis connection instance.
 * Both the Express API (producer) and the worker (consumer) import from here
 * so they share identical queue/connection configuration.
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { FilingJob } from '../types';

export const KRA_QUEUE_NAME = 'kra-filing-queue';

/**
 * Shared Redis connection.
 * `maxRetriesPerRequest: null` is required by BullMQ — it prevents ioredis from
 * throwing on blocked commands used internally by BullMQ workers.
 */
export const redisConnection = new IORedis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

redisConnection.on('error', (err: Error) => {
    console.error('[Redis] Connection error:', err.message);
});

redisConnection.on('connect', () => {
    console.log('[Redis] Connected successfully');
});

/**
 * BullMQ queue for KRA nil return filing jobs.
 *
 * Retry strategy: exponential back-off starting at 60 s, up to 3 attempts.
 * This is conservative — the KRA portal rate-limits aggressively.
 */
export const kraFilingQueue = new Queue<FilingJob>(KRA_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 60_000, // 1 minute base delay; doubles each retry
        },
        removeOnComplete: { count: 100 }, // keep the last 100 completed jobs
        removeOnFail: { count: 50 },      // keep the last 50 failed jobs
    },
});
