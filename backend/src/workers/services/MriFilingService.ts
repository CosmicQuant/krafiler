import { Page } from 'playwright';
import { JobContext } from '../../types';
import { appendJobLog } from '../utils/job-helpers';
import { setPortalDateField } from '../utils/form-helpers';
import { fillMonthlyRentalIncomeAmount } from '../utils/filing-helpers';

export class MriFilingService {
    private page: Page;
    private job: JobContext;

    constructor(page: Page, job: JobContext) {
        this.page = page;
        this.job = job;
    }

    async execute(periodFrom: string, periodTo: string, rentalIncomeAmount: number): Promise<void> {
        if (!periodFrom || !periodTo) {
            throw new Error('MRI filing requires periodFrom and periodTo');
        }

        await setPortalDateField(this.page, '#txtPeriodFrom, #periodFrom, input[name="txtPeriodFrom"], input[name*="periodFrom" i]', periodFrom);
        await setPortalDateField(this.page, '#txtPeriodTo, #periodTo, input[name="txtPeriodTo"], input[name*="periodTo" i]', periodTo);

        await appendJobLog(this.job, 'Filled MRI return period fields', { progress: 72 });

        const nextButton = this.page.locator('input[value="Next"], button:has-text("Next"), a:has-text("Next")').first();
        await nextButton.click({ force: true });
        await this.page.waitForTimeout(4000);

        await fillMonthlyRentalIncomeAmount(this.page, this.job, rentalIncomeAmount);

        await appendJobLog(this.job, `Filled MRI rental income amount ${rentalIncomeAmount}`, { progress: 76 });

        await nextButton.click({ force: true });
        await this.page.waitForTimeout(4000);
    }
}
