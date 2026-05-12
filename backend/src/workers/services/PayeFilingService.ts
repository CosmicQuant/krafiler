import { Page } from 'playwright';
import { Job } from 'bullmq';
import { FilingJob } from '../../types';
import { resolveUploadArtifactPath, resolveBestPayeFileInput, selectUploadFile, waitForFileInputSelection, ensureDeclarationAccepted } from '../utils/filing-helpers';
import { appendJobLog } from '../utils/job-helpers';

export class PayeFilingService {
    private page: Page;
    private job: Job<FilingJob>;

    constructor(page: Page, job: Job<FilingJob>) {
        this.page = page;
        this.job = job;
    }

    async upload(payeZipUrl: string): Promise<void> {
        const zipPath = await resolveUploadArtifactPath(payeZipUrl, this.job.data.jobId, 'paye');
        const fileName = zipPath.split(/[\\/]/).pop() ?? 'paye.zip';
        await appendJobLog(this.job, `Resolved PAYE ZIP on disk: ${zipPath}`, { progress: 68 });

        const { locator: fileInput, metadata } = await resolveBestPayeFileInput(this.page);
        await fileInput.waitFor({ timeout: 20_000 });
        await appendJobLog(this.job, `Using PAYE attachment input ${JSON.stringify(metadata)}`, { progress: 68 });

        const uploadMethod = await selectUploadFile(this.page, fileInput, zipPath);
        const selectedValue = await waitForFileInputSelection(fileInput, fileName, 3_000);
        if (!selectedValue.toLowerCase().includes(fileName.toLowerCase())) {
            throw new Error(`KRA did not acknowledge PAYE ZIP selection for ${fileName}`);
        }

        await ensureDeclarationAccepted(this.page);
        await appendJobLog(this.job, `Selected PAYE ZIP ${fileName} using ${uploadMethod.method} and accepted the declaration`, { progress: 70 });
    }
}
