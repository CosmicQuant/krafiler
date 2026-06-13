/**
 * jobStore.ts
 *
 * Firestore-backed job storage for Cloud Tasks bridge mode.
 * Stores job metadata, progress, logs, and results regardless of DATABASE_MODE.
 */

import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { FilingJob, FilingStepLog } from '../types';
import { logger } from '../logger';

const JOBS_COLLECTION = 'jobs';
const LOGS_SUBCOLLECTION = 'logs';

export interface JobStoreDoc {
    ownerUid: string;
    clientId?: string;
    payload: FilingJob;
    status: 'waiting' | 'active' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    message: string;
    cloudTaskName?: string;
    result?: any;
    error?: { message: string; code: string; retryable: boolean; failedAt: Timestamp };
    credentialUpdate?: any;
    cancelRequestedAt?: string;
    cancelledAt?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    startedAt?: Timestamp;
    completedAt?: Timestamp;
    durationMs?: number;
}

export async function createJob(
    jobId: string,
    ownerUid: string,
    payload: FilingJob,
    cloudTaskName?: string,
    clientId?: string
): Promise<void> {
    const docRef = adminDb.collection(JOBS_COLLECTION).doc(jobId);
    await docRef.set({
        ownerUid,
        clientId: clientId || payload.payload?.clientId || null,
        payload,
        status: 'waiting',
        progress: 0,
        message: 'Job queued',
        cloudTaskName: cloudTaskName || null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90-day TTL
    });
    logger.info({ jobId, ownerUid, clientId }, 'Job created in Firestore');
}

export async function getJob(jobId: string): Promise<JobStoreDoc | null> {
    const doc = await adminDb.collection(JOBS_COLLECTION).doc(jobId).get();
    if (!doc.exists) return null;
    return doc.data() as JobStoreDoc;
}

export async function updateJob(
    jobId: string,
    updates: Partial<JobStoreDoc>
): Promise<void> {
    const docRef = adminDb.collection(JOBS_COLLECTION).doc(jobId);
    await docRef.update({
        ...updates,
        updatedAt: Timestamp.now(),
    });
}

export async function appendJobLog(
    jobId: string,
    entry: FilingStepLog
): Promise<void> {
    const logRef = adminDb.collection(JOBS_COLLECTION).doc(jobId).collection(LOGS_SUBCOLLECTION).doc();
    await logRef.set({
        ...entry,
        createdAt: Timestamp.now(),
    });
}

export async function getPendingJobsByUser(ownerUid: string): Promise<{ id: string; doc: JobStoreDoc }[]> {
    const snapshot = await adminDb
        .collection(JOBS_COLLECTION)
        .where('ownerUid', '==', ownerUid)
        .where('status', 'in', ['waiting', 'active', 'processing'])
        .get();

    return snapshot.docs.map((d: any) => ({ id: d.id, doc: d.data() as JobStoreDoc }));
}

export async function getJobLogs(jobId: string, limit = 200): Promise<FilingStepLog[]> {
    const snapshot = await adminDb
        .collection(JOBS_COLLECTION)
        .doc(jobId)
        .collection(LOGS_SUBCOLLECTION)
        .orderBy('createdAt', 'asc')
        .limit(limit)
        .get();

    return snapshot.docs.map((d: any) => {
        const data = d.data();
        return {
            timestamp: data.timestamp || data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
            message: data.message,
            progress: typeof data.progress === 'number' ? data.progress : null,
            level: data.level === 'error' ? 'error' : 'info',
        } as FilingStepLog;
    });
}
