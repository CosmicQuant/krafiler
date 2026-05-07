import { Page } from 'playwright';
import { Job } from 'bullmq';
import { FilingJob } from '../../types';
import { appendJobLog } from '../utils/job-helpers';

export class NilReturnService {
    private page: Page;
    private job: Job<FilingJob>;

    constructor(page: Page, job: Job<FilingJob>) {
        this.page = page;
        this.job = job;
    }

    async execute(): Promise<void> {
        await appendJobLog(this.job, 'Processing nil return on KRA portal', { progress: 68 });

        const nilReturnButton = this.page.locator('text=Nil Return, text=Proceed with Nil Return, text=Submit Nil Return').first();
        await nilReturnButton.waitFor({ timeout: 20_000 });
        await nilReturnButton.click({ force: true });

        await this.page.waitForTimeout(2500);
        await appendJobLog(this.job, 'Submitted nil return form', { progress: 76 });
    }
}
