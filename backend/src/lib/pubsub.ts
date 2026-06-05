/**
 * pubsub.ts
 *
 * Cloud Pub/Sub integration for the KRAFILER filing pipeline.
 *
 * Replaces Cloud Tasks. Jobs are published to a Pub/Sub topic;
 * a push subscription delivers them to the worker service's /process-job endpoint.
 */

import { PubSub } from '@google-cloud/pubsub';
import { logger } from '../logger';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'taxpulse-498006';
const TOPIC_NAME = process.env.PUBSUB_TOPIC || 'filing-jobs';

let pubsubInstance: PubSub | null = null;

function getPubSub(): PubSub {
    if (!pubsubInstance) {
        pubsubInstance = new PubSub({ projectId: PROJECT_ID });
    }
    return pubsubInstance;
}

function topicPath(): string {
    return `projects/${PROJECT_ID}/topics/${TOPIC_NAME}`;
}

/**
 * Publish a filing job to Pub/Sub.
 */
export async function publishFilingJob(jobId: string): Promise<string> {
    const pubsub = getPubSub();
    const topic = pubsub.topic(TOPIC_NAME);

    const messageBuffer = Buffer.from(JSON.stringify({ jobId }));
    const [messageId] = await topic.publishMessage({ data: messageBuffer });

    logger.info({ jobId, messageId, topic: TOPIC_NAME }, 'Pub/Sub message published');
    return messageId;
}

/**
 * Ensure the Pub/Sub topic exists.
 * Call this once at startup (idempotent).
 */
export async function ensureTopicExists(): Promise<void> {
    const pubsub = getPubSub();
    const topic = pubsub.topic(TOPIC_NAME);

    try {
        const [exists] = await topic.exists();
        if (exists) {
            logger.info({ topic: TOPIC_NAME }, 'Pub/Sub topic already exists');
        } else {
            await pubsub.createTopic(TOPIC_NAME);
            logger.info({ topic: TOPIC_NAME }, 'Pub/Sub topic created');
        }
    } catch (err: any) {
        // Topic may already exist in another region/project context
        if (err?.code === 6 || err?.message?.includes('already exists')) {
            logger.info({ topic: TOPIC_NAME }, 'Pub/Sub topic already exists (concurrent creation)');
        } else {
            throw err;
        }
    }
}
