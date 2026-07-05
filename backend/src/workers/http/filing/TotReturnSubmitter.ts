import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { BaseHttpFilingService, FilingReceiptResult } from './BaseHttpFilingService';

export interface TotReturnInput {
    kraPin: string;
    periodFrom: string;
    periodTo: string;
    totYear: number;
    totMonth: number;
    totTurnover: number;
}

/**
 * Placeholder TOT HTTP filing service.
 *
 * The capture-driven implementation will be filled in after a real TOT filing
 * run is recorded by the deployed worker. For now it loads the TOT form page,
 * captures the response, and reports that the HTTP flow is not yet implemented
 * so the job fails fast and the capture is available for analysis.
 */
export class TotReturnSubmitter extends BaseHttpFilingService {
    protected obligationLabel(): string {
        return 'Turnover Tax';
    }

    async file(input: Record<string, unknown>): Promise<FilingReceiptResult> {
        const totInput: TotReturnInput = {
            kraPin: String(input.kraPin),
            periodFrom: String(input.periodFrom),
            periodTo: String(input.periodTo),
            totYear: Number(input.totYear),
            totMonth: Number(input.totMonth),
            totTurnover: Number(input.totTurnover),
        };

        if (!Number.isFinite(totInput.totYear) || !Number.isFinite(totInput.totMonth) || !Number.isFinite(totInput.totTurnover)) {
            throw new Error('Turnover Tax filing requires totYear, totMonth, and totTurnover in the queued job payload');
        }

        await setJobStep(this.job, 70, 'Loading TOT return form (HTTP)');
        await appendJobLog(this.job, `TOT HTTP filing not yet implemented; capture recorded for ${totInput.totMonth}/${totInput.totYear}`, { progress: 72, level: 'warn' });

        // Capture the current form page so developers can inspect the TOT flow.
        await this.session.snapshotHtml('form-load');

        throw new Error(
            `TOT HTTP filing is under construction. A capture of the current form has been saved to Cloud Storage for job ${this.job.data.jobId}.`
        );
    }
}
