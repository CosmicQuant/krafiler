import { Job } from 'bullmq';
import { FilingJob } from '../../types';
import { fileNssfReturn } from '../../scripts/file-nssf-return';

export class NssfService {
    private job: Job<FilingJob>;

    constructor(job: Job<FilingJob>) {
        this.job = job;
    }

    async execute(kraPin: string, password: string, fileUrl: string): Promise<{ receiptPath: string; receiptNumber: string | null }> {
        await fileNssfReturn(this.job, kraPin, password, fileUrl, '04/2026');
        return { receiptPath: '', receiptNumber: null };
    }
}
