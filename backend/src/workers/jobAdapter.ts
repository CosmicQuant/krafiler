/**
 * jobAdapter.ts
 *
 * Job adapter that uses Firestore as the backing store for job state.
 * Used when running the HTTP worker (Pub/Sub / Cloud Tasks).
 */

import { Timestamp } from 'firebase-admin/firestore';
import { FilingJob, JobContext } from '../types';
import * as jobStore from '../services/jobStore';

export class FirestoreJobAdapter implements JobContext {
    private _data: FilingJob;
    private _progress: number | undefined;

    constructor(private jobId: string) {
        this._data = { jobId, userId: '', payload: {} as any, createdAt: new Date().toISOString() };
    }

    get id(): string | undefined {
        return this.jobId;
    }

    get data(): FilingJob {
        return this._data;
    }

    set data(value: FilingJob) {
        this._data = value;
    }

    get progress(): number | undefined {
        return this._progress;
    }

    set progress(value: number | undefined) {
        this._progress = value;
    }

    async log(entry: string): Promise<void> {
        try {
            const parsed = JSON.parse(entry);
            await jobStore.appendJobLog(this.jobId, {
                timestamp: parsed.timestamp || new Date().toISOString(),
                message: parsed.message || entry,
                progress: typeof parsed.progress === 'number' ? parsed.progress : null,
                level: parsed.level === 'error' ? 'error' : 'info',
            });
        } catch {
            await jobStore.appendJobLog(this.jobId, {
                timestamp: new Date().toISOString(),
                message: entry,
                progress: null,
                level: 'info',
            });
        }
    }

    async updateProgress(progress: number): Promise<void> {
        this._progress = progress;
        await jobStore.updateJob(this.jobId, { progress, updatedAt: Timestamp.now() });
    }

    async updateMessage(message: string): Promise<void> {
        await jobStore.updateJob(this.jobId, { message, updatedAt: Timestamp.now() });
    }

    async updateData(data: Partial<FilingJob>): Promise<void> {
        Object.assign(this._data, data);
        const doc = await jobStore.getJob(this.jobId);
        if (doc) {
            await jobStore.updateJob(this.jobId, {
                payload: { ...doc.payload, ...data },
            });
        }
    }

    async refresh(): Promise<void> {
        const doc = await jobStore.getJob(this.jobId);
        if (doc) {
            this._data = doc.payload;
            this._progress = typeof doc.progress === 'number' ? doc.progress : undefined;
        }
    }
}
