import { JobContext } from '../../types';
import { fileNssfReturn } from '../../scripts/file-nssf-return';

export class NssfService {
    private job: JobContext;

    constructor(job: JobContext) {
        this.job = job;
    }

    async execute(kraPin: string, password: string, fileUrl: string, period?: string): Promise<{ receiptPath: string; receiptNumber: string | null }> {
        const effectivePeriod = period || (() => {
            const now = new Date();
            const year = now.getFullYear();
            let month = now.getMonth() + 1;
            if (now.getDate() <= 9) { month = month - 1; if (month === 0) month = 12; }
            return `${String(month).padStart(2, '0')}/${year}`;
        })();
        const result = await fileNssfReturn(this.job, kraPin, password, fileUrl, effectivePeriod);
        return { receiptPath: result.paymentOrderPath || '', receiptNumber: null };
    }
}
