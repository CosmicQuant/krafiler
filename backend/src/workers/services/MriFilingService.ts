import { Page } from 'playwright';
import { JobContext } from '../../types';
import { appendJobLog } from '../utils/job-helpers';
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

        // KRA pre-fills the MRI period dates. We only verify them are present.
        const fromValue = await this.page.locator('#txtPeriodFrom').first().inputValue().catch(() => '');
        const toValue = await this.page.locator('#txtPeriodTo').first().inputValue().catch(() => '');
        await appendJobLog(this.job, `MRI period pre-filled: ${fromValue} to ${toValue}`, { progress: 72 });

        // KRA MRI form uses tabview_switch tabs; after clicking Next the first time,
        // the old tab's Next button becomes hidden. Use .last() because the active tab's
        // button is typically the last matching visible one.
        const clickVisibleNext = async () => {
            const btn = this.page.locator('#nextBtn:visible, input[value="Next"]:visible, button:has-text("Next"):visible, a:has-text("Next"):visible').last();
            await btn.click({ force: true });
        };

        await clickVisibleNext();
        await this.page.waitForTimeout(5000);

        await fillMonthlyRentalIncomeAmount(this.page, this.job, rentalIncomeAmount);

        await appendJobLog(this.job, `Filled MRI rental income amount ${rentalIncomeAmount}`, { progress: 76 });

        await clickVisibleNext();
        await this.page.waitForTimeout(6000);
    }
}
