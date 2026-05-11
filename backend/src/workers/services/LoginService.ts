/**
 * LoginService.ts
 *
 * Orchestrates KRA portal authentication, including captcha resolution,
 * password resets, and mobile verifications.
 */

import { Page } from 'playwright';
import { Job } from 'bullmq';
import { FilingJob } from '../../types';
import {
    KRA_PORTAL_URL,
    CAPTCHA_ELEMENT_SELECTORS,
} from '../constants';
import {
    assertJobNotCancelled,
    setJobStep,
    appendJobLog,
    waitForPortalReadyWithReload,
    detectAuthenticatedPortalState,
    waitForPostLoginOutcome,
    solveCaptcha,
    humanDelay,
    generateKraCompliantPassword,
    escapeAttributeValue
} from '../utils';

export class LoginService {
    private page: Page;
    private job: Job<FilingJob>;

    constructor(page: Page, job: Job<FilingJob>) {
        this.page = page;
        this.job = job;
    }

    async login(): Promise<void> {
        const { kraPin, kraPassword, encryptedPassword } = this.job.data.payload;
        const activePassword = kraPassword || encryptedPassword || '';

        await setJobStep(this.job, 10, 'Navigating to KRA Portal login page...');
        await this.page.goto(KRA_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        const currentState = await detectAuthenticatedPortalState(this.page);
        if (currentState === 'dashboard') {
            await appendJobLog(this.job, 'Already authenticated. Skipping login.', { progress: 20 });
            return;
        }

        await waitForPortalReadyWithReload(this.page, this.job, {
            description: 'Login page',
            selectors: ['#logid'],
        });

        await setJobStep(this.job, 15, 'Entering KRA PIN...');
        await this.page.fill('#logid', kraPin);
        await humanDelay(100, 300);
        await this.page.click('#loginButton');

        await waitForPortalReadyWithReload(this.page, this.job, {
            description: 'Password and captcha prompt',
            selectors: ['input[name="captcahText"]'],
        });

        await setJobStep(this.job, 20, 'Entering password and resolving Captcha...');
        await this.page.fill('input[type="password"]', escapeAttributeValue(activePassword));
        await humanDelay();

        // Solve Captcha
        const captchaSelector = CAPTCHA_ELEMENT_SELECTORS.find(s => this.page.locator(s).first() !== null) || '#loginCaptcha';
        await solveCaptcha(this.page, captchaSelector, 'input[name="captcahText"]', this.job, 22);

        await humanDelay();
        await this.page.click('#loginButton');

        await setJobStep(this.job, 25, 'Waiting for authentication result...');
        const outcome = await waitForPostLoginOutcome(this.page, this.job, 25);

        switch (outcome.type) {
            case 'dashboard':
                await appendJobLog(this.job, 'Login successful. Reached dashboard.', { progress: 30 });
                break;
            case 'password-change':
                await this.handlePasswordChange();
                break;
            case 'mobile-verification':
                await this.handleMobileVerification();
                break;
            case 'login-failure':
                throw new Error(`Authentication failed: ${outcome.message}`);
            case 'dialog':
                throw new Error(`Unexpected dialog during login: ${outcome.message}`);
            case 'blank-login-shell':
                throw new Error('KRA returned a blank login shell. The service may be overloaded.');
            case 'timeout':
                throw new Error('Timed out waiting for authentication to resolve.');
        }
    }

    private async handlePasswordChange(): Promise<void> {
        await setJobStep(this.job, 28, 'Handling forced password change...');
        const newPassword = generateKraCompliantPassword();

        await appendJobLog(this.job, `System generated new password. Ensure this is saved back to the DB!`, { level: 'info' });
        // NOTE: In a real environment, you must propagate this `newPassword` back to the orchestrator to update the database.

        const currentPassword = this.job.data.payload.kraPassword || this.job.data.payload.encryptedPassword || '';
        await this.page.fill('input[name="oldPassword"]', escapeAttributeValue(currentPassword));
        await this.page.fill('input[name="newPassword"]', escapeAttributeValue(newPassword));
        await this.page.fill('input[name="confirmPassword"]', escapeAttributeValue(newPassword));

        const securityQuestionPattern = /favorite color/i;
        const securityQuestionLabel = await this.page.locator('label').filter({ hasText: securityQuestionPattern }).first();

        if (await securityQuestionLabel.count() > 0) {
            const selectId = await securityQuestionLabel.getAttribute('for');
            if (selectId) {
                 await this.page.selectOption(`#${selectId}`, 'Blue');
            }
            await this.page.fill('input[name="securityAnswer"]', 'Blue');
        }

        await this.page.click('button:has-text("Submit"), input[type="submit"][value="Submit"]');
        const dialogMessage = await new Promise<string | null>((resolve) => {
             this.page.once('dialog', async (dialog) => {
                 const msg = dialog.message();
                 await dialog.accept();
                 resolve(msg);
             });
             setTimeout(() => resolve(null), 10000);
        });

        if (dialogMessage && /successfully/i.test(dialogMessage)) {
             await appendJobLog(this.job, 'Password changed successfully. Proceeding...', { progress: 30 });
             // Emulate re-login if required by KRA after password change
        } else {
             throw new Error(`Failed to process forced password change: ${dialogMessage ?? 'No confirmation received'}`);
        }
    }

    private async handleMobileVerification(): Promise<void> {
        throw new Error('Mobile verification intercept required. Manual intervention needed.');
    }
}
