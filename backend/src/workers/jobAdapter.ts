/**
 * jobAdapter.ts
 *
 * Adapters that implement JobContext over BullMQ Job or Firestore.
 */

import { Job } from 'bullmq';
import { Timestamp } from 'firebase-admin/firestore';
import { FilingJob, JobContext } from '../types';
import { kraFilingQueue } from '../queues/kraFilingQueue';
import * as jobStore from '../services/jobStore';

/**
 * Wraps a BullMQ Job to satisfy JobContext.
 * Used when running the traditional BullMQ worker.
 */
export class BullMQJobAdapter implements JobContext {
    constructor(private job: Job<FilingJob>) {}

    get id(): string | undefined {
        return this.job.id ? String(this.job.id) : undefined;
    }

    get data(): FilingJob {
        return this.job.data;
    }

    get progress(): number | undefined {
        return typeof this.job.progress === 'number' ? this.job.progress : undefined;
    }

    async log(entry: string): Promise<void> {
        await this.job.log(entry);
    }

    async updateProgress(progress: number): Promise<void> {
        await this.job.updateProgress(progress);
    }

    async updateData(data: Partial<FilingJob>): Promise<void> {
        await this.job.updateData(data as any);
    }

    async refresh(): Promise<void> {
        const latest = await kraFilingQueue.getJob(String(this.job.id ?? this.job.data.jobId));
        if (latest) {
            (this.job as any).data = latest.data;
            (this.job as any).progress = latest.progress;
        }
    }
}

/**
 * Uses Firestore as the backing store for job state.
 * Used when running the Cloud Tasks HTTP worker.
 */
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
