import path from 'path';
import fs from 'fs/promises';
import { Page } from 'playwright';
import { Job } from 'bullmq';
import { FilingJob } from '../../types';
import { logger } from '../../logger';

const FAILED_JOBS_DIR = path.resolve(__dirname, '..', '..', '..', 'failed_jobs');

/**
 * Captures diagnostics (screenshot, HTML dump, and metadata) when a job fails.
 */
export async function captureFailureDiagnostics(
    page: Page | undefined,
    job: Job<FilingJob>,
    error: unknown
): Promise<void> {
    const jobId = String(job.id ?? job.data.jobId);
    const jobDir = path.join(FAILED_JOBS_DIR, jobId);

    try {
        await fs.mkdir(jobDir, { recursive: true });

        const metadata = {
            jobId,
            taxObligation: job.data.payload?.taxObligationType,
            kraPin: job.data.payload?.kraPin,
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        };

        await fs.writeFile(
            path.join(jobDir, 'metadata.json'),
            JSON.stringify(metadata, null, 2)
        );

        if (page && !page.isClosed()) {
            try {
                await page.screenshot({ path: path.join(jobDir, 'screenshot.png'), fullPage: true });
                const content = await page.content();
                await fs.writeFile(path.join(jobDir, 'page.html'), content);
                logger.info({ jobId }, `Failure diagnostics captured to ${jobDir}`);
            } catch (pageError) {
                logger.warn({ jobId, err: pageError }, 'Failed to capture screenshot/HTML during diagnostics');
            }
        }
    } catch (fsError) {
        logger.error({ jobId, err: fsError }, 'Failed to write diagnostics directory');
    }
}
