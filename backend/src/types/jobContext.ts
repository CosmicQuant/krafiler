/**
 * jobContext.ts
 *
 * Abstraction over BullMQ Job and Firestore job adapters.
 * All filing services and helpers operate against this interface.
 */

import { FilingJob, FilingStepLog } from '.';

export interface JobContext {
    readonly id: string | undefined;
    data: FilingJob;
    progress: number | undefined;

    log(entry: string): Promise<void>;
    updateProgress(progress: number): Promise<void>;
    updateData(data: Partial<FilingJob>): Promise<void>;
    refresh(): Promise<void>;
}
