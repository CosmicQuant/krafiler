/**
 * BrowserService.ts
 *
 * Manages the Playwright lifecycle, stealth plugins, and user profiles.
 */

import { chromium, BrowserContext, Page, Browser } from 'playwright';
import { Job } from 'bullmq';
import { FilingJob } from '../../types';
import {
    KRA_BROWSER_PROFILE_DIR,
    KRA_REUSE_BROWSER_PROFILE,
    PLAYWRIGHT_SLOW_MO,
    PLAYWRIGHT_HEADLESS,
    KRA_BROWSER_CHANNEL,
    KRA_BROWSER_EXECUTABLE_PATH,
    WINDOWS_BROWSER_EXECUTABLE_CANDIDATES
} from '../constants/config';
import { appendJobLog, assertJobNotCancelled } from '../utils/job-helpers';

export class BrowserService {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private readonly job: Job<FilingJob>;

    constructor(job: Job<FilingJob>) {
        this.job = job;
    }

    async launch(): Promise<Page> {
        await assertJobNotCancelled(this.job, 'browser launch', 0);
        await appendJobLog(this.job, 'Launching browser instance...', { progress: 5 });

        // Note: Stealth plugin integration would go here if needed.
        // Currently, vanilla playwright is used as standard.

        try {
            if (KRA_REUSE_BROWSER_PROFILE && KRA_BROWSER_PROFILE_DIR) {
                this.context = await chromium.launchPersistentContext(KRA_BROWSER_PROFILE_DIR, {
                    headless: PLAYWRIGHT_HEADLESS,
                    slowMo: PLAYWRIGHT_SLOW_MO,
                    viewport: { width: 1280, height: 800 },
                    channel: KRA_BROWSER_CHANNEL || undefined,
                    executablePath: KRA_BROWSER_EXECUTABLE_PATH || undefined,
                    args: ['--disable-blink-features=AutomationControlled'],
                });
                this.page = this.context.pages()[0] ?? await this.context.newPage();
            } else {
                this.browser = await chromium.launch({
                    headless: PLAYWRIGHT_HEADLESS,
                    slowMo: PLAYWRIGHT_SLOW_MO,
                    channel: KRA_BROWSER_CHANNEL || undefined,
                    executablePath: KRA_BROWSER_EXECUTABLE_PATH || undefined,
                    args: ['--disable-blink-features=AutomationControlled'],
                });
                this.context = await this.browser.newContext({
                    viewport: { width: 1280, height: 800 },
                });
                this.page = await this.context.newPage();
            }

            // Expose a stub to avoid standard webdriver detection
            await this.page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                });
            });

            return this.page;
        } catch (error) {
            await appendJobLog(this.job, `Failed to launch browser: ${error instanceof Error ? error.message : String(error)}`, { level: 'error' });
            throw error;
        }
    }

    async close(): Promise<void> {
        try {
            if (this.page && !this.page.isClosed()) {
                await this.page.close().catch(() => {});
            }
            if (this.context) {
                await this.context.close().catch(() => {});
            }
            if (this.browser) {
                await this.browser.close().catch(() => {});
            }
        } catch (error) {
            const { logger } = require('../../../logger');
            logger.error({ jobId: this.job.id ?? this.job.data.jobId, err: error }, `Error during cleanup`);
        } finally {
            this.page = null;
            this.context = null;
            this.browser = null;
        }
    }
}
