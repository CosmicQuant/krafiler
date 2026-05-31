/**
 * NavigationService.ts
 *
 * Handles KRA portal menu navigation (hovering, clicking nested menus)
 * and resolving the obligation forms.
 */

import { Page } from 'playwright';
import { JobContext } from '../../types';
import {
    setJobStep,
    waitForPortalReadyWithReload,
    assertJobNotCancelled,
    humanDelay,
    navigationDelay
} from '../utils';

export class NavigationService {
    private page: Page;
    private job: JobContext;

    constructor(page: Page, job: JobContext) {
        this.page = page;
        this.job = job;
    }

    async navigateToReturns(): Promise<void> {
        await setJobStep(this.job, 35, 'Navigating to Returns menu...');

        // Wait for the Returns menu to be present
        await waitForPortalReadyWithReload(this.page, this.job, {
            description: 'Dashboard Returns Menu',
            selectors: ['a:has-text("Returns")'],
        });

        const returnsMenu = this.page.locator('a:has-text("Returns")').first();
        await returnsMenu.hover();
        await humanDelay();

        const fileReturnLink = this.page.locator('a:has-text("File Return")').first();
        await fileReturnLink.waitFor({ state: 'visible', timeout: 10_000 });
        await fileReturnLink.click();

        await navigationDelay();

        await waitForPortalReadyWithReload(this.page, this.job, {
            description: 'e-Return Tax Obligation Selection',
            selectors: ['select[name="taxObligation"]', '#regType'],
        });
    }

    async selectObligation(): Promise<void> {
        await setJobStep(this.job, 40, `Selecting obligation: ${this.job.data.payload.taxObligationType}...`);

        const typeSelector = '#regType';
        if (await this.page.locator(typeSelector).count() > 0) {
            await this.page.selectOption(typeSelector, 'Self');
            await humanDelay();
        }

        // We use the raw obligation string from the payload; robust matching via SelectOptionHelpers could be applied here
        // For now, assume the job data matches the dropdown values or use partial matches.
        const obligationSelector = 'select[name="taxObligation"]';

        const options = await this.page.locator(`${obligationSelector} option`).evaluateAll(opts =>
            (opts as HTMLOptionElement[]).map(opt => ({ text: opt.text, value: opt.value }))
        );

        const target = this.job.data.payload.taxObligationType.toLowerCase().replace(/_/g, ' ');
        const match = options.find(opt => opt.text.toLowerCase().includes(target));

        if (!match) {
             throw new Error(`Could not find tax obligation matching "${this.job.data.payload.taxObligationType}" in dropdown.`);
        }

        await this.page.selectOption(obligationSelector, match.value);
        await humanDelay();

        await this.page.click('button:has-text("Next"), input[value="Next"]');
        await navigationDelay();
    }
}
