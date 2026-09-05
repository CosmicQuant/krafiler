/**
 * kraFilingWorker.ts
 *
 * KRA filing processor â€” handles Playwright automation for tax return filing.
 *
 * This module is imported by the HTTP worker (server.worker.ts) which receives
 * Pub/Sub push messages and delegates to processFilingJob().
 *
 * Architecture notes:
 *  - concurrency: 1  â€” sequential processing prevents KRA portal rate-limits.
 *  - Playwright launches a fresh browser process per job. A dedicated optional
 *    profile directory can be reused so static KRA assets stay cached across
 *    jobs while cookies and web storage are cleared before each run.
 *  - The submitted KRA password flows plaintext (encryption disabled for testing).
 *  - If KRA forces a password reset, the generated replacement password is
 *    returned through job status so the operator can recover the credential.
 *  - The stealth plugin is applied once at module load (not per job).
 */

import 'dotenv/config';
import { randomInt } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { JobContext } from '../types';
import { adminDb } from '../lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import * as jobStore from '../services/jobStore';
// import { decrypt } from '../utils/encryption';
import { storeReceiptLocally } from '../utils/storage';
import { sendReceiptNotification } from '../utils/notifications';
import { uploadFile, uploadBuffer, receiptPath as gcsReceiptPath, getSignedDownloadUrl } from '../lib/cloudStorage';
import { computeFullHousingLevyForPeriod, computeNitaLevyForPeriod } from '../services/payrollLevyAmounts';
import type { PrnConfig } from '../utils/kra-prn-generator';
import { CredentialUpdate, FilingJob, FilingStepLog, TaxObligationType } from '../types';
import { PayeFilingService } from './services/PayeFilingService';
import { VatFilingService } from './services/VatFilingService';
import { TotFilingService } from './services/TotFilingService';
import { MriFilingService } from './services/MriFilingService';
import { PrnService } from './services/PrnService';
import { NssfService } from './services/NssfService';
import { setPortalDateField } from './utils/form-helpers';
import {
    KraError,
    KraErrorCode,
} from './http';

// Apply stealth plugin once at module load
chromium.use(StealthPlugin());

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);
const KRA_BROWSER_PROFILE_DIR = process.env.KRA_BROWSER_PROFILE_DIR ?? path.join(TMP_DIR, 'browser-profile');
const KRA_REUSE_BROWSER_PROFILE = process.env.KRA_REUSE_BROWSER_PROFILE !== 'false';

const KRA_PORTAL_URL = 'https://itax.kra.go.ke/KRA-Portal/';
const KRA_DEBUG_ARTIFACTS = process.env.KRA_DEBUG_ARTIFACTS === 'true';

const GEMMA4_API_KEY = process.env.GEMMA4_API_KEY ?? '';
const GEMMA4_MODEL = process.env.GEMMA4_MODEL ?? 'gemma-4-31b-it';
const PLAYWRIGHT_SLOW_MO = Math.max(0, Number.parseInt(process.env.PLAYWRIGHT_SLOW_MO ?? '0', 10) || 0);
const KRA_BROWSER_CHANNEL = (process.env.KRA_BROWSER_CHANNEL ?? 'chrome').trim().toLowerCase();
const KRA_BROWSER_EXECUTABLE_PATH = process.env.KRA_BROWSER_EXECUTABLE_PATH?.trim() ?? '';
const WINDOWS_BROWSER_EXECUTABLE_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
] as const;

type BrowserLaunchPreference = {
    label: string;
    executablePath?: string;
    channel?: 'chrome' | 'msedge';
};

const TAX_OBLIGATION_PATTERNS: Record<TaxObligationType, RegExp[]> = {
    income_tax_resident_individual: [
        /^income\s*tax\s*-\s*resident\s*individual$/i,
        /resident\s*individual/i,
        /^resident\s*individual$/i,
    ],
    monthly_rental_income: [
        /^income\s*tax\s*-\s*rent\s*income\s*\(mri\)$/i,
        /^income\s*tax\s*-\s*rent\s*income$/i,
        /rent\s*income/i,
        /monthly\s*rental\s*income/i,
        /\bmri\b/i,
    ],
    income_tax_non_resident_individual: [
        /^income\s*tax\s*-?\s*non-?resident\s*individual$/i,
        /non-?resident\s*individual/i,
    ],
    income_tax_company: [
        /^income\s*tax\s*-\s*company$/i,
        /^income\s*tax\s*company$/i,
        /company/i,
    ],
    vat: [
        /^value\s*added\s*tax$/i,
        /^vat$/i,
        /^Value\s*Added\s*Tax\s*\(VAT\)$/i,
        /value\s*added\s*tax/i,
    ],
    paye: [
        /^pay\s*as\s*you\s*earn$/i,
        /^paye$/i,
        /^Income\s*Tax\s*-\s*PAYE$/i,
        /pay\s*as\s*you\s*earn/i,
    ],
    turnover_tax: [
        /^turnover\s*tax$/i,
        /^tot$/i,
        /turnover\s*tax/i,
    ],
    nssf: [
        /^nssf$/i
    ],
    excise_duty: [
        /^excise\s*duty$/i,
        /^excise$/i,
        /excise/i,
    ],
    nita: [
        /^nita\s*levy$/i,
        /^nita$/i,
        /nita/i,
    ],
    affordable_housing: [
        /^housing\s*levy$/i,
        /^affordable\s*housing\s*levy$/i,
        /housing\s*levy/i,
    ],
};

const LOGIN_FAILURE_PATTERNS = [
    /password\s+you\s+entered\s+is\s+incorrect/i,
    /incorrect\s+password/i,
    /invalid\s+password/i,
    /remaining\s+number\s+of\s+attempts/i,
    /account\s+(?:is\s+)?locked/i,
    /security\s+stamp.*incorrect/i,
    /captcha.*incorrect/i,
    /invalid\s+login/i,
];

const AUTHENTICATED_DASHBOARD_SELECTORS = [
    '#homePageLink',
    'a:has-text("Logout")',
    'a:has-text("Returns")',
    'a:has-text("My Profile")',
    'a:has-text("Compliance")',
    'a:has-text("My Ledger")',
    'a:has-text("Audit & Assessment")',
    'a:has-text("Payments")',
    'a:has-text("Refunds")',
    'a:has-text("Objection & Appeal")',
    'a:has-text("Taxpayer Information Update")',
    'text=Dashboard',
    'text=Returns',
    '#mainNav',
    '#sideNav',
    '.dashboard',
    'a[href="eReturns.htm"]',
    'a[href="logout.htm"]',
    'a[href="javascript:logout()"]',
    'a[href*="logout"]',
    '#logout',
    '#logoutBtn',
] as const;

const PASSWORD_CHANGE_SELECTORS = [
    'text=YOUR PASSWORD HAS EXPIRED!',
    'text=Change Password',
    'text=FIRST TIME LOGIN!',
    'text=Security Question',
] as const;

const MOBILE_VERIFICATION_SELECTORS = [
    'text=Mobile Number Verification',
    'button:has-text("Send Verification Code")',
] as const;

const PASSWORD_EXPIRED_PATTERNS = [
    /your\s+password\s+has\s+expired/i,
    /change\s+password/i,
    /first\s*time\s*login/i,
];

const FAVORITE_COLOR_SECURITY_QUESTION_PATTERNS = [
    /^what\s+is\s+your\s+favorite\s+color\??$/i,
];

const FAVORITE_COLOR_SECURITY_ANSWER = 'Blue';

const TURNOVER_TAX_SUBMISSION_ERROR_PATTERNS = [
    /invalid\s+file/i,
    /period\s+already\s+filed/i,
    /already\s+submitted/i,
    /please\s+attach/i,
    /upload\s+file/i,
];

const PAYE_SUBMISSION_ERROR_PATTERNS = [
    /please\s+upload\s+form/i,
    /please\s+attach/i,
    /upload\s+file/i,
    /invalid\s+file/i,
    /selected\s+tax\s+obligation/i,
    /error\s+occurred\s+while\s+uploading/i,
];

const PAYE_RETRYABLE_UPLOAD_ERROR_PATTERNS = [
    /please\s+upload\s+form/i,
    /please\s+attach/i,
    /upload\s+file/i,
];

const VAT_SUBMISSION_ERROR_PATTERNS = [
    /please\s+upload\s+form/i,
    /please\s+attach/i,
    /upload\s+file/i,
    /invalid\s+file/i,
    /error\s+occurred\s+while\s+uploading/i,
    /selected\s+tax\s+obligation/i,
    /not\s+declared/i,
    /credit\s+note/i,
    /error\s+description/i,
    /validation\s+failed/i,
    /invalid\s+(invoice|return|data|period)/i,
    /failed\s+to\s+(submit|file|upload)/i,
];

const VAT_DOWNLOAD_TRIGGER_SELECTORS = [
    'a:has-text("Click Here")',
    'a:has-text("Download")',
    'button:has-text("Download")',
    'input[type="button"][value*="Download" i]',
    'input[type="submit"][value*="Download" i]',
    'input[type="button"][onclick*="download" i]',
    'input[type="submit"][onclick*="download" i]',
    'a[onclick*="download" i]',
    'button[onclick*="download" i]',
    'a[href*="download" i]',
    'a[href*="template" i]',
    'input[value*="Click Here" i]',
    'button:has-text("Template")',
    'a:has-text("Template")',
];

const PAYE_UPLOAD_TRIGGER_SELECTORS = [
    'button:has-text("Upload")',
    'input[type="button"][value*="Upload" i]',
    'input[type="submit"][value*="Upload" i]',
    'input[type="image"][src*="upload" i]',
    'a:has-text("Upload")',
    'button[id*="upload" i]',
    'input[type="button"][id*="upload" i]',
    'input[type="submit"][id*="upload" i]',
    'input[type="image"][id*="upload" i]',
    'button[name*="upload" i]',
    'input[type="button"][name*="upload" i]',
    'input[type="submit"][name*="upload" i]',
    'input[type="image"][name*="upload" i]',
    'a[onclick*="upload" i]',
    'input[onclick*="upload" i]',
    'button[onclick*="upload" i]',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function captureDebugScreenshot(page: any, jobId: string, suffix: string): Promise<string | null> {
    try {
        await fs.mkdir(TMP_DIR, { recursive: true });
        const screenshotPath = path.join(TMP_DIR, `debug-${jobId}-${suffix}-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[Worker][${jobId}] Debug screenshot saved: ${screenshotPath}`);
        return screenshotPath;
    } catch (err: any) {
        console.warn(`[Worker][${jobId}] Failed to capture debug screenshot: ${err.message}`);
        return null;
    }
}

/**
 * Waits for a random duration to simulate human interaction cadence without
 * making ordinary form entry feel artificially slow.
 */
function humanDelay(minMs = 80, maxMs = 180): Promise<void> {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function navigationDelay(): Promise<void> {
    return humanDelay(140, 320);
}

// ─── Post-filing PRN auto-generation ───────────────────────────────────────────

/**
 * After a successful filing, generate PRN(s) inline within the same browser session.
 * PAYE filings generate 3 PRNs (PAYE, NITA, AHL).
 * VAT/ToT/MRI filings generate 1 PRN for the filed obligation.
 * Errors are caught and logged as warnings — they do NOT mark the filing as failed.
 */
export async function generatePrnAfterFiling(
    parentJob: JobContext,
    page: any,
    kraPin: string,
    periodFrom: string,
    periodTo: string,
    taxObligationType: TaxObligationType
): Promise<Array<{ taxType: TaxObligationType; prnPath?: string; prnGcsPath?: string; error?: string }>> {
    const prnResults: Array<{ taxType: TaxObligationType; prnPath?: string; prnGcsPath?: string; error?: string }> = [];

    // Determine which PRN types to generate based on the filed obligation
    const prnTypesToGenerate: Array<{ taxType: TaxObligationType; label: string }> = [];

    if (taxObligationType === 'paye') {
        // PAYE filings require 3 PRNs: PAYE, NITA, AHL
        prnTypesToGenerate.push(
            { taxType: 'paye', label: 'PAYE' },
            { taxType: 'nita', label: 'NITA Levy' },
            { taxType: 'affordable_housing', label: 'Housing Levy' }
        );
    } else if (taxObligationType === 'turnover_tax') {
        prnTypesToGenerate.push({ taxType: 'turnover_tax', label: 'ToT' });
    } else if (taxObligationType === 'monthly_rental_income') {
        prnTypesToGenerate.push({ taxType: 'monthly_rental_income', label: 'MRI' });
    } else if (taxObligationType === 'vat') {
        prnTypesToGenerate.push({ taxType: 'vat', label: 'VAT' });
    }

    if (prnTypesToGenerate.length === 0) {
        console.log(`[PRN Auto] No PRN generation needed for ${taxObligationType}`);
        return prnResults;
    }

    console.log(`[PRN Auto] Generating ${prnTypesToGenerate.length} PRN(s) inline after ${taxObligationType} filing...`);
    await appendJobLog(parentJob, `Generating ${prnTypesToGenerate.length} PRN(s) inline after successful filing`, { progress: 96 });

    const prnService = new PrnService(page, parentJob);

    // Load payroll-computed NITA/AHL amounts from the client doc when available.
    let clientAmounts: { nitaAmount?: number; housingLevyAmount?: number } = {};
    const clientId = (parentJob.data.payload as any).clientId;
    if (clientId) {
        try {
            const clientDoc = await adminDb.collection('clients').doc(clientId).get();
            if (clientDoc.exists) {
                const clientData = clientDoc.data() as any;
                clientAmounts = {
                    nitaAmount: clientData?.amounts?.nitaAmount ?? (parentJob.data.payload as any).nitaAmount,
                    housingLevyAmount: clientData?.amounts?.housingLevyAmount ?? (parentJob.data.payload as any).housingLevyAmount,
                };
            }
        } catch (err) {
            console.warn(`[PRN Auto] Could not load client amounts:`, (err as Error).message);
        }
    }

    for (const prnConfig of prnTypesToGenerate) {
        // Use the filing period so the PRN matches the return period (e.g. May 2026 VAT)
        const prnDate = periodFrom ? new Date(periodFrom) : new Date();
        // NOTE: amounts.housingLevyAmount stores the FULL statutory AHL remittance
        // (3% = 1.5% employee + 1.5% employer), matching the P10 XML declaration.
        // Use it as-is — do NOT double it again here.
        //
        // The payroll run for the period is the AUTHORITATIVE source (Σ employee
        // ahlDeduction × 2) — client-doc amounts and payload values can be stale
        // from before the full-statutory change, so prefer the run when it exists.
        let amount: number | undefined;
        if (prnConfig.taxType === 'nita') {
            amount = (await computeNitaLevyForPeriod(clientId, periodFrom))
                ?? (clientAmounts.nitaAmount ?? (parentJob.data.payload as any).nitaAmount);
        } else if (prnConfig.taxType === 'affordable_housing') {
            amount = (await computeFullHousingLevyForPeriod(clientId, periodFrom))
                ?? (clientAmounts.housingLevyAmount ?? (parentJob.data.payload as any).housingLevyAmount);
        }
        const prnConfigObj: PrnConfig = {
            taxType: prnConfig.taxType,
            periodYear: prnDate.getFullYear().toString(),
            periodMonth: prnDate.toLocaleString('default', { month: 'long' }),
            periodFrom,
            kraPin,
            amount,
        };

        try {
            console.log(`[PRN Auto] Generating ${prnConfig.label} PRN...`);
            const prnResult = await prnService.generate(prnConfigObj);

            if (prnResult.prnPath) {
                prnResults.push({ taxType: prnConfig.taxType, prnPath: prnResult.prnPath, prnGcsPath: prnResult.prnGcsPath });
                console.log(`[PRN Auto] ${prnConfig.label} PRN generated: ${prnResult.prnPath}`);
                await appendJobLog(parentJob, `${prnConfig.label} PRN generated successfully`, { progress: 97 });
            } else if (prnResult.error) {
                prnResults.push({ taxType: prnConfig.taxType, error: prnResult.error });
                console.log(`[PRN Auto] ${prnConfig.label} PRN failed: ${prnResult.error}`);
                await appendJobLog(parentJob, `${prnConfig.label} PRN generation failed: ${prnResult.error}`, { progress: 97, level: 'info' });
            }
        } catch (err: any) {
            console.error(`[PRN Auto] ${prnConfig.label} PRN error:`, err.message);
            prnResults.push({ taxType: prnConfig.taxType, error: err.message });
                await appendJobLog(parentJob, `${prnConfig.label} PRN generation error: ${err.message}`, { progress: 97, level: 'info' });
        }
    }

    return prnResults;
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function resolvePreferredBrowserLaunches(): Promise<BrowserLaunchPreference[]> {
    const candidates: BrowserLaunchPreference[] = [];
    const seen = new Set<string>();

    const pushCandidate = (candidate: BrowserLaunchPreference) => {
        const key = `${candidate.executablePath ?? ''}|${candidate.channel ?? ''}`;
        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        candidates.push(candidate);
    };

    if (KRA_BROWSER_EXECUTABLE_PATH && await pathExists(KRA_BROWSER_EXECUTABLE_PATH)) {
        pushCandidate({
            label: `system browser at ${KRA_BROWSER_EXECUTABLE_PATH}`,
            executablePath: KRA_BROWSER_EXECUTABLE_PATH,
        });
    }

    if (process.platform === 'win32') {
        for (const browserPath of WINDOWS_BROWSER_EXECUTABLE_CANDIDATES) {
            if (await pathExists(browserPath)) {
                pushCandidate({
                    label: `system browser at ${browserPath}`,
                    executablePath: browserPath,
                });
            }
        }
    }

    if (KRA_BROWSER_CHANNEL === 'chrome' || KRA_BROWSER_CHANNEL === 'msedge') {
        pushCandidate({
            label: `Playwright ${KRA_BROWSER_CHANNEL} channel`,
            channel: KRA_BROWSER_CHANNEL,
        });
    }

    pushCandidate({ label: 'bundled Playwright Chromium' });
    return candidates;
}

async function getOtpFromSmsService(providedOtpCode?: string): Promise<string> {
    const otpCode = providedOtpCode?.trim() || process.env.KRA_OTP_CODE?.trim();
    if (otpCode) {
        return otpCode;
    }

    throw new Error('KRA mobile verification is waiting for an OTP. Implement getOtpFromSmsService() or provide otpCode / KRA_OTP_CODE.');
}

async function getInputValue(locator: any): Promise<string> {
    return locator.evaluate((input: HTMLInputElement) => String(input.value ?? '').trim());
}

async function appendJobLog(
    job: JobContext,
    message: string,
    options: {
        progress?: number;
        level?: FilingStepLog['level'];
    } = {}
): Promise<void> {
    const entry: FilingStepLog = {
        timestamp: new Date().toISOString(),
        message,
        progress: typeof options.progress === 'number' ? options.progress : null,
        level: options.level ?? 'info',
    };

    await job.log(JSON.stringify(entry));
}

class JobCancelledError extends Error {
    constructor(message = 'Job cancelled by user.') {
        super(message);
        this.name = 'JobCancelledError';
    }
}

function hasCancellationRequest(jobData?: Partial<FilingJob> | null): boolean {
    return typeof jobData?.cancelRequestedAt === 'string' && jobData.cancelRequestedAt.trim().length > 0;
}

async function assertJobNotCancelled(
    job: JobContext,
    context: string,
    progress?: number
): Promise<void> {
    await job.refresh();
    const latestJobData = job.data as FilingJob;
    if (!hasCancellationRequest(latestJobData)) {
        return;
    }

    const progressValue = typeof progress === 'number'
        ? progress
        : typeof job.progress === 'number'
            ? job.progress
            : undefined;

    await appendJobLog(job, `Cancellation requested by operator. Stopping during ${context}.`, {
        progress: progressValue,
    });
    console.warn(`[Worker][${job.data.jobId}] Cancellation requested during ${context}; stopping the job.`);
    throw new JobCancelledError();
}

async function setJobStep(job: JobContext, progress: number, message: string): Promise<void> {
    await assertJobNotCancelled(job, message, progress);
    await job.updateProgress(progress);
    await appendJobLog(job, message, { progress });
    console.log(`[Worker][${job.data.jobId}] ${message}`);
}

async function resolveTimingContext(
    details?: string | (() => string | Promise<string>)
): Promise<string> {
    if (!details) {
        return '';
    }

    try {
        const resolved = typeof details === 'function' ? await details() : details;
        return resolved ? ` | ${resolved}` : '';
    } catch {
        return '';
    }
}

async function measureJobPhase<T>(
    job: JobContext,
    label: string,
    progress: number | undefined,
    action: () => Promise<T>,
    details?: string | (() => string | Promise<string>)
): Promise<T> {
    const startedAt = new Date();
    const startedMs = Date.now();
    const progressValue = typeof progress === 'number' ? progress : undefined;
    await assertJobNotCancelled(job, label, progressValue);
    const startMessage = `Timing start | ${label} | startedAt=${startedAt.toISOString()}`;
    await appendJobLog(job, startMessage, { progress: progressValue });
    console.log(`[Worker][${job.data.jobId}] ${startMessage}`);

    try {
        const result = await action();
        const endedAt = new Date();
        const durationMs = Date.now() - startedMs;
        const context = await resolveTimingContext(details);
        const endMessage = `Timing end | ${label} | startedAt=${startedAt.toISOString()} | endedAt=${endedAt.toISOString()} | durationMs=${durationMs}${context}`;
        await appendJobLog(
            job,
            endMessage,
            { progress: progressValue }
        );
        console.log(`[Worker][${job.data.jobId}] ${endMessage}`);
        return result;
    } catch (error) {
        const endedAt = new Date();
        const durationMs = Date.now() - startedMs;
        const context = await resolveTimingContext(details);
        const message = error instanceof Error ? error.message : String(error);
        const failureMessage = `Timing failure | ${label} | startedAt=${startedAt.toISOString()} | endedAt=${endedAt.toISOString()} | durationMs=${durationMs} | error=${message}${context}`;
        await appendJobLog(
            job,
            failureMessage,
            { progress: progressValue, level: 'error' }
        );
        console.warn(`[Worker][${job.data.jobId}] ${failureMessage}`);
        throw error;
    }
}

async function waitForAnySelector(
    page: any,
    selectors: string[],
    timeout = 20_000,
    cancellation?: {
        job?: JobContext;
        context?: string;
        progress?: number;
    }
): Promise<string | null> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        if (cancellation?.job) {
            await assertJobNotCancelled(
                cancellation.job,
                cancellation.context ?? 'a portal wait',
                cancellation.progress
            );
        }

        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            const found = await locator.count().then((count: number) => count > 0).catch(() => false);
            if (found) {
                return selector;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return null;
}

async function findVisibleSelector(
    page: any,
    selectors: readonly string[]
): Promise<string | null> {
    for (const selector of selectors) {
        const locator = page.locator(selector).first();
        const count = await locator.count().catch(() => 0);
        if (count > 0) {
            return selector;
        }
    }

    return null;
}

async function isBlankKraLoginShell(page: any): Promise<boolean> {
    return page.evaluate(() => {
        const bodyText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
        const visibleControls = Array.from(document.querySelectorAll('input, button, a, select, textarea')).some((element) => {
            const htmlElement = element as HTMLElement;
            const style = window.getComputedStyle(htmlElement);
            const rect = htmlElement.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        });

        return /\/KRA-Portal\/login\.htm/i.test(window.location.href)
            && ['interactive', 'complete'].includes(document.readyState)
            && bodyText.length === 0
            && !visibleControls;
    }).catch(() => false);
}

type PostLoginOutcome =
    | { type: 'dashboard'; selector: string }
    | { type: 'password-change'; selector: string }
    | { type: 'mobile-verification'; selector: string }
    | { type: 'dialog'; message: string }
    | { type: 'login-failure'; message: string }
    | { type: 'blank-login-shell' }
    | { type: 'timeout' };

async function waitForPostLoginOutcome(
    page: any,
    job: JobContext,
    progress: number,
    timeout = 18_000
): Promise<PostLoginOutcome> {
    let dialogMessage: string | null = null;
    void waitForDialogMessage(page, 4_000)
        .then((message) => {
            dialogMessage = message;
        })
        .catch(() => undefined);

    const deadline = Date.now() + timeout;
    let blankShellDetectedAt: number | null = null;

    while (Date.now() < deadline) {
        await assertJobNotCancelled(job, 'post-login landing selector', progress);

        if (dialogMessage) {
            return { type: 'dialog', message: dialogMessage };
        }

        const loginFailureMessage = await findMatchingPortalMessage(page, LOGIN_FAILURE_PATTERNS).catch(() => null);
        if (loginFailureMessage) {
            return { type: 'login-failure', message: loginFailureMessage };
        }

        const dashboardSelector = await findVisibleSelector(page, AUTHENTICATED_DASHBOARD_SELECTORS);
        if (dashboardSelector) {
            return { type: 'dashboard', selector: dashboardSelector };
        }

        const passwordChangeSelector = await findVisibleSelector(page, PASSWORD_CHANGE_SELECTORS);
        if (passwordChangeSelector) {
            return { type: 'password-change', selector: passwordChangeSelector };
        }

        const mobileVerificationSelector = await findVisibleSelector(page, MOBILE_VERIFICATION_SELECTORS);
        if (mobileVerificationSelector) {
            return { type: 'mobile-verification', selector: mobileVerificationSelector };
        }

        const blankLoginShell = await isBlankKraLoginShell(page);
        if (blankLoginShell) {
            blankShellDetectedAt ??= Date.now();
            if (Date.now() - blankShellDetectedAt >= 1_500) {
                return { type: 'blank-login-shell' };
            }
        } else {
            blankShellDetectedAt = null;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return { type: 'timeout' };
}

async function waitForPortalReadyWithReload(
    page: any,
    job: JobContext,
    options: {
        description: string;
        selectors: string[];
        timeout?: number;
        reloadAttempts?: number;
        waitForNetworkIdle?: boolean;
    }
): Promise<void> {
    const {
        description,
        selectors,
        timeout = 20_000,
        reloadAttempts = 1,
        waitForNetworkIdle = false,
    } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= reloadAttempts; attempt += 1) {
        try {
            await assertJobNotCancelled(job, description, typeof job.progress === 'number' ? job.progress : undefined);
            const alreadyLoaded = await page.evaluate(() => ['interactive', 'complete'].includes(document.readyState)).catch(() => false);
            if (!alreadyLoaded) {
                await page.waitForLoadState('domcontentloaded', { timeout: Math.max(5_000, timeout) }).catch(() => {});
            }
            if (waitForNetworkIdle) {
                await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
            }

            // Check for KRA error page (session timeout / re-submit) early
            const errorSelectors = [
                ...selectors,
                'text=An Error Occured',
                'text=session has timed out',
                'text=page re-submit',
            ];
            const matchedSelector = await waitForAnySelector(page, errorSelectors, timeout, {
                job,
                context: description,
                progress: typeof job.progress === 'number' ? job.progress : undefined,
            });

            // If we matched an error message instead of an expected control, fail fast
            if (matchedSelector && (
                matchedSelector.includes('Error Occured') ||
                matchedSelector.includes('session has timed out') ||
                matchedSelector.includes('page re-submit')
            )) {
                const errorText = await page.locator('body').innerText().catch(() => '');
                const snippet = errorText.slice(0, 300);
                throw new Error(`KRA displayed an error page: ${snippet}`);
            }

            if (matchedSelector) {
                if (attempt > 0) {
                    await appendJobLog(job, `${description} recovered after reloading the page`, {
                        progress: typeof job.progress === 'number' ? job.progress : undefined,
                    });
                }
                return;
            }

            lastError = new Error(`${description} did not expose the expected UI controls`);
        } catch (error) {
            lastError = error as Error;
        }

        if (attempt < reloadAttempts) {
            await assertJobNotCancelled(job, `${description} reload`, typeof job.progress === 'number' ? job.progress : undefined);
            await appendJobLog(job, `${description} is taking too long to load; reloading and retrying`, {
                progress: typeof job.progress === 'number' ? job.progress : undefined,
            });
            console.warn(`[Worker][${job.data.jobId}] ${description} stalled; reloading page (attempt ${attempt + 1}/${reloadAttempts})`);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
            await navigationDelay();
        }
    }

    throw lastError ?? new Error(`${description} did not finish loading`);
}

/**
 * Parses an arithmetic captcha string (e.g. "185 - 5 ?", "12 + 7 ?") and
 * returns the integer result.
 *
 * The KRA security stamp uses single-operator integer arithmetic — division
 * results are floored to avoid floating-point strings.
 *
 * @throws If the captcha text cannot be parsed with the expected regex.
 */
function solveCaptcha(captchaText: string): number {
    // Matches: <integer> <operator> <integer>
    const match = captchaText.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);

    if (!match) {
        throw new Error(`Unable to parse captcha text: "${captchaText}"`);
    }

    const a = parseInt(match[1], 10);
    const operator = match[2];
    const b = parseInt(match[3], 10);

    switch (operator) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return Math.floor(a / b);
        default: throw new Error(`Unknown captcha operator: "${operator}"`);
    }
}

function extractGeminiText(payload: any): string {
    const candidates = payload?.candidates;

    if (!Array.isArray(candidates)) {
        return '';
    }

    return candidates
        .flatMap((candidate: any) => candidate?.content?.parts ?? [])
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim();
}

async function solveCaptchaWithGemma4(screenshotPath: string): Promise<string> {
    if (!GEMMA4_API_KEY) {
        throw new Error('GEMMA4_API_KEY is required for captcha extraction');
    }

    const imageBuffer = await fs.readFile(screenshotPath);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMMA4_MODEL)}:generateContent?key=${encodeURIComponent(GEMMA4_API_KEY)}`;

    const maxRetries = 3;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (attempt > 0) {
            const delayMs = 1000 * Math.pow(2, attempt - 1);
            console.log(`[Captcha] Gemma 4 request failed, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: 'You solve math captchas. Look at the image and return ONLY the final numeric answer to the arithmetic problem shown in the Security Stamp or captcha area. Do not explain.' },
                            {
                                inline_data: {
                                    mime_type: 'image/png',
                                    data: imageBuffer.toString('base64'),
                                },
                            },
                        ],
                    }],
                    generationConfig: {
                        maxOutputTokens: 128,
                        temperature: 0,
                    },
                }),
            });

            if (response.ok) {
                const payload = await response.json();
                const answer = extractGemma4CaptchaAnswer(payload);
                if (answer) return answer;
                throw new Error(`Gemma 4 returned an unexpected captcha format: ${JSON.stringify(payload.candidates?.[0]?.content?.parts ?? [])}`);
            }

            const errorText = await response.text();
            lastError = new Error(`Gemma 4 request failed (${response.status}): ${errorText}`);
            // Only retry on 5xx or 429; fail fast on 4xx (except 429)
            if (response.status < 500 && response.status !== 429) {
                throw lastError;
            }
        } catch (err: any) {
            lastError = err;
            if (err.message && err.message.includes('fetch failed')) {
                // Network errors are retriable
                continue;
            }
            if (attempt === maxRetries - 1) throw err;
        }
    }

    throw lastError ?? new Error('Gemma 4 captcha solving failed after retries');
}

function extractGemma4CaptchaAnswer(payload: any): string | null {
    // Gemma 4 returns a two-part response:
    // parts[0] = { text: "... reasoning ...", thought: true }
    // parts[1] = { text: "126", thought: false }  ← answer
    // Extract the answer from the last non-thought part.
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const answerParts = parts.filter((p: any) => !p.thought && typeof p.text === 'string');
    const rawText = answerParts.length > 0 ? answerParts[answerParts.length - 1].text : '';

    const cleaned = rawText.replace(/\D/g, '');
    if (cleaned) {
        return cleaned;
    }

    // If no answer part found, scan the entire response for any number
    const allPartsText = parts.map((p: any) => p.text).join('\n');
    const fallbackNumbers = allPartsText.match(/\b\d+\b/g);
    if (fallbackNumbers && fallbackNumbers.length > 0) {
        return fallbackNumbers[fallbackNumbers.length - 1];
    }

    return null;
}

async function selectOptionByTextPatterns(
    locator: any,
    patterns: RegExp[]
): Promise<{ value: string; text: string }> {
    const options = await locator.evaluate((select: any) =>
        Array.from(select.options).map((option: any) => ({
            value: String(option.value ?? '').trim(),
            text: String(option.textContent ?? '').trim(),
        }))
    );

    const match = options.find((option: { value: string; text: string }) =>
        option.value && patterns.some((pattern) => pattern.test(option.text))
    );

    if (!match) {
        throw new Error(`No matching option found. Available options: ${options.map((o: any) => `${o.text} [${o.value}]`).join(', ')}`);
    }

    await locator.selectOption(match.value);
    return match;
}

async function waitForDialogMessage(page: any, timeout = 5_000): Promise<string | null> {
    try {
        const dialog = await page.waitForEvent('dialog', { timeout });
        const message = dialog.message();
        await dialog.accept();
        return message;
    } catch {
        return null;
    }
}

async function summariseCurrentPage(page: any): Promise<string> {
    return page.evaluate(() => {
        const bodyText = (document.body?.innerText ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 240);

        return JSON.stringify({
            title: document.title ?? '',
            readyState: document.readyState ?? '',
            url: window.location.href,
            bodyText,
        });
    }).catch(() => 'unavailable');
}

async function snapshotPageControls(page: any): Promise<string> {
    return page.evaluate(() => {
        const bodyText = (document.body?.innerText ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 320);

        const controlSelectors = [
            'input',
            'button',
            'a',
            'label',
            'select',
            'textarea',
            'iframe',
        ];

        const controls = controlSelectors.flatMap((selector) =>
            Array.from(document.querySelectorAll(selector)).slice(0, 80).map((element) => {
                const htmlElement = element as HTMLElement;
                const style = window.getComputedStyle(htmlElement);
                const input = element as HTMLInputElement;
                return {
                    tag: element.tagName,
                    id: htmlElement.id ?? '',
                    name: input.name ?? '',
                    type: input.type ?? '',
                    text: (htmlElement.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
                    value: (input.value ?? '').slice(0, 120),
                    href: htmlElement.getAttribute('href') ?? '',
                    onclick: htmlElement.getAttribute('onclick') ?? '',
                    visible: style.display !== 'none' && style.visibility !== 'hidden',
                    disabled: 'disabled' in input ? Boolean(input.disabled) : false,
                };
            })
        );

        return JSON.stringify({
            title: document.title ?? '',
            readyState: document.readyState ?? '',
            url: window.location.href,
            bodyText,
            controls,
        });
    }).catch(() => 'unavailable');
}

async function returnToPayeUploadPage(page: any, job: JobContext): Promise<void> {
    const backControl = page.locator('#backBtn, input[value*="Back" i], button:has-text("Back"), a:has-text("Back")').first();
    const backControlCount = await backControl.count().catch(() => 0);

    if (backControlCount > 0) {
        await backControl.click({ force: true }).catch(async () => {
            await backControl.click().catch(() => undefined);
        });
    } else {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
    }

    await appendJobLog(job, 'Returned to the PAYE upload form after KRA rejected the attachment', { progress: 80 });
    await waitForPortalReadyWithReload(page, job, {
        description: 'PAYE upload page after upload retry',
        selectors: ['input[type="file"]', '#submitBtn', 'input[value="Submit"]', 'text=Terms and Conditions', 'button:has-text("Upload")', 'input[value*="Upload" i]'],
        timeout: 30_000,
        reloadAttempts: 0,
    });
}


async function findMatchingPortalMessage(
    page: any,
    patterns: RegExp[]
): Promise<string | null> {
    const candidates = await page.evaluate(() => {
        const texts = new Set<string>();
        const selectors = [
            '#errorDiv',
            '.error-message',
            '.ui-message-error',
            '.ui-messages-error',
            '[id*="error"]',
            '[class*="error"]',
            'font[color="red"]',
        ];

        for (const selector of selectors) {
            document.querySelectorAll(selector).forEach((element) => {
                const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
                if (text) {
                    texts.add(text);
                }
            });
        }

        (document.body?.innerText ?? '')
            .split(/\r?\n/)
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .forEach((line) => texts.add(line));

        return Array.from(texts);
    });

    return candidates.find((candidate: string) =>
        patterns.some((pattern) => pattern.test(candidate))
    ) ?? null;
}

async function waitForMatchingPortalMessage(
    page: any,
    patterns: RegExp[],
    timeout = 8_000
): Promise<string | null> {
    if (patterns.length === 0) {
        return null;
    }

    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        const message = await findMatchingPortalMessage(page, patterns).catch(() => null);
        if (message) {
            return message;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return null;
}

async function detectAuthenticatedPortalState(
    page: any,
    timeout = 30_000
): Promise<'dashboard' | 'login' | 'mobile-verification' | 'password-change' | null> {
    const selector = await waitForAnySelector(page, [
        ...AUTHENTICATED_DASHBOARD_SELECTORS,
        '#logid',
        '#loginButton',
        'input[name="captcahText"]',
        ...MOBILE_VERIFICATION_SELECTORS,
        ...PASSWORD_CHANGE_SELECTORS,
    ], timeout);

    if (!selector) {
        return null;
    }

    if (/Mobile Number Verification|Send Verification Code/i.test(selector)) {
        return 'mobile-verification';
    }

    if (PASSWORD_EXPIRED_PATTERNS.some((pattern) => pattern.test(selector))) {
        return 'password-change';
    }

    if (/#logid|#loginButton|captcahText/.test(selector)) {
        return 'login';
    }

    if (/#homePageLink|Logout|Returns/.test(selector)) {
        return 'dashboard';
    }

    return null;
}

async function fillSecurityAnswerFields(page: any, answer: string): Promise<boolean> {
    const findSecurityAnswerInput = async (labelPattern: RegExp) => {
        const candidates = await page.locator('input:visible').evaluateAll((elements: HTMLInputElement[]) => {
            const isVisible = (element: HTMLElement) => {
                const style = window.getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            };

            return elements
                .map((input, index) => {
                    const type = (input.getAttribute('type') ?? '').toLowerCase();
                    const rowText = input.closest('tr, td, div, label')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
                    const label = input.id
                        ? document.querySelector(`label[for="${input.id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
                        : '';

                    return {
                        index,
                        type,
                        rowText,
                        label,
                        disabled: input.disabled,
                        readOnly: input.readOnly,
                        visible: isVisible(input),
                    };
                })
                .filter((candidate) => candidate.visible)
                .filter((candidate) => !candidate.disabled && !candidate.readOnly)
                .filter((candidate) => !['hidden', 'password', 'checkbox', 'radio', 'submit', 'button'].includes(candidate.type));
        });

        const match = candidates.find((candidate: { index: number; rowText: string; label: string }) =>
            labelPattern.test(`${candidate.rowText} ${candidate.label}`)
        );

        return match ? page.locator('input:visible').nth(match.index) : null;
    };

    const securityAnswerField = await findSecurityAnswerInput(/(^|\b)security answer\b/i);
    const confirmSecurityAnswerField = await findSecurityAnswerInput(/confirm security answer/i);

    if (securityAnswerField && confirmSecurityAnswerField) {
        await securityAnswerField.fill(answer);
        await confirmSecurityAnswerField.fill(answer);
        return true;
    }

    const fallbackTextInputs = page.locator('input:not([type]):visible, input[type="text"]:visible, input[type="search"]:visible, input[type="email"]:visible');
    const fallbackCount = await fallbackTextInputs.count();
    if (fallbackCount >= 2) {
        await fallbackTextInputs.nth(0).fill(answer);
        await fallbackTextInputs.nth(1).fill(answer);
        return true;
    }

    return false;
}

async function selectRentalPropertyAnswer(page: any, ownsRentalProperty: boolean): Promise<boolean> {
    const rentalRow = page.locator('tr:has-text("rental")').first();
    if (await rentalRow.count() > 0) {
        const rowRadios = rentalRow.locator('input[type="radio"]');
        const radioCount = await rowRadios.count();
        if (radioCount >= 2) {
            const targetIndex = ownsRentalProperty ? 0 : 1;
            const targetRadio = rowRadios.nth(targetIndex);
            await checkRadioRobust(targetRadio);
            return true;
        }
    }

    const valueCandidates = ownsRentalProperty
        ? ['yes', 'y', 'true', '1']
        : ['no', 'n', 'false', '0'];

    for (const value of valueCandidates) {
        const candidate = page.locator(`input[type="radio"][name="isProperty"][value="${value.toUpperCase()}"]`).first();
        if (await candidate.count() > 0) {
            await checkRadioRobust(candidate);
            return true;
        }
    }

    // Fallback: any radio whose value matches the desired answer.
    const fallbackValue = ownsRentalProperty ? 'Y' : 'N';
    const fallback = page.locator(`input[type="radio"][value="${fallbackValue}"]`).first();
    if (await fallback.count() > 0) {
        await checkRadioRobust(fallback);
        return true;
    }

    const labelText = ownsRentalProperty ? /^yes$/i : /^no$/i;
    const label = page.getByText(labelText).first();
    if (await label.count() > 0) {
        await label.click();
        return true;
    }

    return false;
}

/**
 * Checks a radio button using JS evaluation when possible, avoiding Playwright's
 * strict "click did not change state" error for already-selected radios.
 */
async function checkRadioRobust(locator: any): Promise<void> {
    try {
        await locator.evaluate((input: HTMLInputElement) => {
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    } catch {
        // If evaluate fails, fall back to Playwright's check (e.g. for detached elements).
        await locator.check();
    }
}

function shuffleCharacters(characters: string[]): string {
    const copy = [...characters];

    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = randomInt(0, index + 1);
        [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }

    return copy.join('');
}

function generateKraCompliantPassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const special = '@#$!%*?';
    const all = `${upper}${lower}${digits}${special}`;

    const pick = (alphabet: string) => alphabet[randomInt(0, alphabet.length)];
    const characters = [pick(upper), pick(lower), pick(digits), pick(special)];

    while (characters.length < 14) {
        characters.push(pick(all));
    }

    return shuffleCharacters(characters);
}

function escapeAttributeValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function performKraLogin(
    page: any,
    job: JobContext,
    kraPin: string,
    kraPassword: string,
    options: {
        pinProgress: number;
        pinMessage: string;
        passwordProgress: number;
        passwordMessage: string;
        captchaProgress: number;
        captchaMessage: string;
        submitProgress: number;
        submitMessage: string;
        otpCode?: string;
    }
): Promise<{ passwordExpired: boolean }> {
    const { jobId } = job.data;

    await setJobStep(job, options.pinProgress, options.pinMessage);

    await page.waitForSelector('#logid', { timeout: 15_000 });
    await page.fill('#logid', kraPin);

    console.log(`[Worker][${jobId}] Clicking Continue (CheckPIN)…`);
    const continueFound = await page.$('a[href="javascript:CheckPIN();"]');
    if (continueFound) {
        await continueFound.click();
    } else {
        console.log(`[Worker][${jobId}] Continue <a> not found via href selector, calling CheckPIN() via JS…`);
        await page.evaluate(() => { (globalThis as any).CheckPIN(); });
    }

    // Check for immediate PIN error dialogs (fast, non-blocking timeout)
    const checkPinDialogMessage = await waitForDialogMessage(page, 1_000);
    if (checkPinDialogMessage) {
        console.log(`[Worker][${jobId}] KRA dialog: "${checkPinDialogMessage}"`);
    }

    const passwordVisible = await page.waitForSelector('input[type="password"]:visible', { timeout: 18_000 })
        .then(() => true)
        .catch(() => false);

    if (!passwordVisible) {
        const errMsg = checkPinDialogMessage
            ?? await page.$eval('#errorDiv, .error-message, [id*="error"]', (el: any) => el.textContent?.trim()).catch(() => null)
            ?? 'Password section did not appear after CheckPIN(). The KRA PIN may be invalid or inactive.';
        throw new Error(`PIN validation failed: ${errMsg}`);
    }

    await setJobStep(job, options.passwordProgress, options.passwordMessage);
    await page.fill('input[type="password"]', kraPassword);

    await setJobStep(job, options.captchaProgress, options.captchaMessage);
    await page.waitForSelector('input[name="captcahText"]', { timeout: 10_000 });

    let captchaAnswer = '';
    const screenPath = path.join(TMP_DIR, `captcha-element-${jobId}.png`);

    // ── Strategy 1: Read security stamp text directly from DOM (most reliable) ──
    try {
        const stampText = await page.$eval(
            '#securityStamp, .security-stamp, [id*="stamp"], img[src*="SecurityStamp"]',
            (el: any) => el.textContent?.trim() ?? ''
        );
        if (stampText) {
            const match = stampText.match(/(\d+)\s*([+\-×x*])\s*(\d+)/);
            if (match) {
                const a = parseInt(match[1], 10);
                const op = match[2];
                const b = parseInt(match[3], 10);
                if (op === '+' || op === '×' || op === 'x' || op === '*') {
                    captchaAnswer = String(a + b);
                } else if (op === '-') {
                    captchaAnswer = String(a - b);
                }
                console.log(`[Worker][${jobId}] DOM arithmetic captcha: ${a} ${op} ${b} = ${captchaAnswer}`);
            }
        }
    } catch {
        // DOM text not available, continue to screenshot strategy
    }

    // ── Strategy 2: Screenshot + AI vision fallback ──
    if (!captchaAnswer) {
        const captchaSelectors = [
            '#loginCaptcha',
            '#captchaImg',
            '#captcha_img',
            'img[id*="captcha"]',
            'img[src*="GenerateCaptcha"]',
            'img[src*="captcha"]',
        ];
        let usedElementScreenshot = false;

        for (const selector of captchaSelectors) {
            const captchaElement = await page.$(selector);
            if (!captchaElement) {
                continue;
            }

            const box = await captchaElement.boundingBox();
            if (!box || box.width < 10 || box.height < 10) {
                continue;
            }

            await captchaElement.screenshot({ path: screenPath, type: 'png' });
            usedElementScreenshot = true;
            console.log(`[Worker][${jobId}] Lossless captcha element screenshot saved via ${selector}: ${screenPath}`);
            break;
        }

        if (!usedElementScreenshot) {
            await page.screenshot({ path: screenPath, fullPage: false, type: 'png' });
            console.log(`[Worker][${jobId}] Captcha element not found; fell back to viewport screenshot: ${screenPath}`);
        }

        try {
            captchaAnswer = await solveCaptchaWithGemma4(screenPath);
            console.log(`[Worker][${jobId}] OpenCode Go solved captcha: ${captchaAnswer}`);
        } catch (e) {
            console.warn(`[Worker][${jobId}] OpenCode Go captcha solving failed:`, (e as Error).message);
            throw new Error(`Captcha solving failed: ${(e as Error).message}`);
        }
    }

    await page.fill('input[name="captcahText"]', captchaAnswer);

    await setJobStep(job, options.submitProgress, options.submitMessage);
    await page.click('#loginButton');
    const postLoginOutcome = await measureJobPhase(job, 'post-login landing selector', options.submitProgress, async () => {
        return await waitForPostLoginOutcome(page, job, options.submitProgress);
    }, () => `currentUrl=${page.url()}`);

    if (postLoginOutcome.type === 'dialog') {
        console.log(`[Worker][${jobId}] KRA dialog: "${postLoginOutcome.message}"`);
        await appendJobLog(job, `KRA login dialog: ${postLoginOutcome.message}`, { progress: options.submitProgress, level: 'error' });
        throw new Error(postLoginOutcome.message);
    }

    if (postLoginOutcome.type === 'login-failure') {
        await appendJobLog(job, `KRA login rejected the request: ${postLoginOutcome.message}`, {
            progress: options.submitProgress,
            level: 'error',
        });
        throw new Error(postLoginOutcome.message);
    }

    if (postLoginOutcome.type === 'password-change') {
        return { passwordExpired: true };
    }

    if (postLoginOutcome.type === 'mobile-verification') {
        await handleMobileVerification(page, job, options.otpCode);
        return { passwordExpired: false };
    }

    if (postLoginOutcome.type === 'blank-login-shell') {
        const blankShellSnapshot = await summariseCurrentPage(page);
        await appendJobLog(job, `Detected a blank post-login shell before dashboard recovery: ${blankShellSnapshot}`, {
            progress: options.submitProgress,
            level: 'error',
        });
        await appendJobLog(job, 'Blank post-login login.htm shell detected; reloading early instead of waiting through the full dashboard timeout', {
            progress: options.submitProgress,
        });
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => undefined);
        await navigationDelay();
        await measureJobPhase(job, 'post-login dashboard ready', options.submitProgress, async () => {
            await waitForPortalReadyWithReload(page, job, {
                description: 'Post-login dashboard',
                selectors: [...AUTHENTICATED_DASHBOARD_SELECTORS],
                timeout: 10_000,
                reloadAttempts: 0,
            });
        }, () => `currentUrl=${page.url()}`);
        return { passwordExpired: false };
    }

    if (postLoginOutcome.type === 'timeout') {
        const postLoginSnapshot = await summariseCurrentPage(page);
        await appendJobLog(job, `Post-login page snapshot before dashboard retry: ${postLoginSnapshot}`, {
            progress: options.submitProgress,
            level: 'error',
        });
        await measureJobPhase(job, 'post-login dashboard ready', options.submitProgress, async () => {
            await waitForPortalReadyWithReload(page, job, {
                description: 'Post-login dashboard',
                selectors: [...AUTHENTICATED_DASHBOARD_SELECTORS],
                timeout: 12_000,
                reloadAttempts: 1,
            });
        }, () => `currentUrl=${page.url()}`);
    }

    return { passwordExpired: false };
}

async function handleExpiredPasswordReset(
    page: any,
    job: JobContext,
    currentPassword: string
): Promise<CredentialUpdate> {
    await setJobStep(job, 42, 'KRA requires a credential update before filing can continue');

    const expiredFormVisible = await waitForAnySelector(page, ['text=YOUR PASSWORD HAS EXPIRED!', 'text=Change Password', 'text=FIRST TIME LOGIN!', 'text=Security Question'], 15_000, {
        job,
        context: 'KRA credential update page',
        progress: 42,
    });
    if (!expiredFormVisible) {
        throw new Error('Expected the KRA credential update page, but it did not appear');
    }

    const visiblePasswordFields = page.locator('input[type="password"]:visible');
    const visiblePasswordFieldCount = await visiblePasswordFields.count();
    if (visiblePasswordFieldCount < 3) {
        throw new Error('KRA showed the credential update page, but the password fields were not all visible');
    }

    const generatedPassword = generateKraCompliantPassword();

    await setJobStep(job, 44, 'Generating a compliant replacement iTax password');
    await visiblePasswordFields.nth(0).fill(currentPassword);
    await visiblePasswordFields.nth(1).fill(generatedPassword);
    await visiblePasswordFields.nth(2).fill(generatedPassword);

    const securityQuestionSelect = page.locator('select:visible').filter({ has: page.locator('option') }).first();
    if (await securityQuestionSelect.count() > 0) {
        await setJobStep(job, 45, 'Completing KRA security question setup');
        await selectOptionByTextPatterns(securityQuestionSelect, FAVORITE_COLOR_SECURITY_QUESTION_PATTERNS);

        const answersFilled = await fillSecurityAnswerFields(page, FAVORITE_COLOR_SECURITY_ANSWER);
        if (!answersFilled) {
            throw new Error('KRA requested security answers, but the answer fields were not visible');
        }
    }

    const guidelineCheckboxes = page.locator('input[type="checkbox"]:visible');
    const guidelineCheckboxCount = await guidelineCheckboxes.count();
    for (let index = 0; index < guidelineCheckboxCount; index += 1) {
        const checkbox = guidelineCheckboxes.nth(index);
        const isChecked = await checkbox.isChecked().catch(() => false);
        if (!isChecked) {
            await checkbox.check();
        }
    }

    await humanDelay(250, 600);

    await setJobStep(job, 46, 'Submitting the forced password change');
    const passwordChangeDialogPromise = waitForDialogMessage(page, 10_000);
    await page.locator('input[value="Submit"], button:has-text("Submit"), a:has-text("Submit")').first().click();
    const passwordChangeDialogMessage = await passwordChangeDialogPromise;
    if (passwordChangeDialogMessage && !/success/i.test(passwordChangeDialogMessage)) {
        throw new Error(`KRA rejected the password change: ${passwordChangeDialogMessage}`);
    }

    const postResetState = await detectAuthenticatedPortalState(page, 15_000);
    if (postResetState === 'password-change') {
        const portalMessage = await page.$eval('#errorDiv, .error-message, [id*="error"]', (el: any) => el.textContent?.trim()).catch(() => null);
        throw new Error(`Password change did not complete: ${portalMessage ?? 'KRA kept the credential update screen open'}`);
    }

    const credentialUpdate: CredentialUpdate = {
        passwordChanged: true,
        newPassword: generatedPassword,
        changedAt: new Date().toISOString(),
    };

    await appendJobLog(job, 'Password updated successfully. Returning to login with the generated credential.', { progress: 46 });
    await job.refresh();
    await job.updateData({
        ...(job.data as FilingJob),
        credentialUpdate,
    });

    return credentialUpdate;
}

async function handleMobileVerification(
    page: any,
    job: JobContext,
    providedOtpCode?: string
): Promise<void> {
    await setJobStep(job, 41, 'Completing KRA mobile number verification');

    const sendVerificationButton = page.locator('button:has-text("Send Verification Code"), input[value*="Send Verification Code" i], a:has-text("Send Verification Code")').first();
    if (await sendVerificationButton.count() > 0) {
        await sendVerificationButton.click();
    }

    const otpFieldSelector = await waitForAnySelector(page, [
        'input[name*="otp" i]',
        'input[id*="otp" i]',
        'input[placeholder*="verification code" i]',
        'input[placeholder*="otp" i]',
        'input[maxlength="6"]',
    ], 20_000, {
        job,
        context: 'mobile verification OTP field',
        progress: 41,
    });

    if (!otpFieldSelector) {
        throw new Error('KRA requested mobile verification, but the OTP input field did not appear');
    }

    const otpCode = await getOtpFromSmsService(providedOtpCode);
    await page.locator(otpFieldSelector).first().fill(otpCode);
    await appendJobLog(job, 'Entered the mobile verification code', { progress: 41 });
    await humanDelay(250, 600);

    const verifyButton = page.locator('button:has-text("Verify"), button:has-text("Submit"), input[value*="Verify" i], input[value*="Submit" i], a:has-text("Verify")').first();
    if (await verifyButton.count() > 0) {
        await verifyButton.click();
    }

    await waitForPortalReadyWithReload(page, job, {
        description: 'Post-OTP dashboard',
        selectors: ['#homePageLink', 'a:has-text("Logout")', 'a:has-text("Returns")'],
        timeout: 20_000,
        reloadAttempts: 1,
    });
}

async function extractVatCreditBroughtForward(page: any, browserContext: any, job: JobContext): Promise<number> {
    const { jobId } = job.data;

    await appendJobLog(job, 'Navigating to View Filed Returns to extract credit brought forward...', { progress: 46 });

    // Step 1: Hover over Returns menu and click "View Filed Returns"
    const returnsMenu = page.locator('a:has-text("Returns"), #returns, td:has-text("Returns") a').first();
    if (await returnsMenu.count() === 0) {
        throw new Error('Returns menu not found');
    }
    await returnsMenu.hover();
    await page.waitForTimeout(1_500);

    await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of Array.from(links)) {
            if (link.textContent?.includes('View Filed Return')) {
                link.click();
                break;
            }
        }
    });
    await page.waitForTimeout(5_000);
    await appendJobLog(job, 'Clicked View Filed Returns', { progress: 46 });

    // Step 2: Select VAT from Tax Obligation dropdown
    const allSelects = await page.locator('select').all();
    let obligationSelect: any = null;
    for (const sel of allSelects) {
        const isDisabled = await sel.isDisabled().catch(() => true);
        if (isDisabled) continue;
        try {
            const options = await sel.evaluate((el: HTMLSelectElement) => Array.from(el.options).map(o => o.text));
            if (options.some((o: string) => o.includes('Value Added Tax'))) {
                obligationSelect = sel;
                break;
            }
        } catch {
            continue;
        }
    }

    if (!obligationSelect) {
        throw new Error('Could not find Tax Obligation dropdown with VAT option');
    }
    await obligationSelect.selectOption({ label: 'Value Added Tax (VAT)' });
    await appendJobLog(job, 'Selected VAT from Tax Obligation dropdown', { progress: 46 });
    await page.waitForTimeout(1_000);

    // Step 3: Set up dialog handler and click Consult button
    let dialogHandled = false;
    page.on('dialog', async (dialog: any) => {
        dialogHandled = true;
        const msg = dialog.message();
        await appendJobLog(job, `KRA dialog: "${msg}" (type: ${dialog.type()})`, { progress: 46 });
        if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
            await dialog.accept();
        } else {
            await dialog.dismiss();
        }
    });

    await page.evaluate(() => {
        const btn = document.querySelector('input[value="Consult"]') as HTMLInputElement;
        if (btn) {
            btn.focus();
            btn.click();
        }
    });
    await appendJobLog(job, 'Clicked Consult button', { progress: 46 });
    await page.waitForTimeout(5_000);
    page.removeAllListeners('dialog');

    // Wait for table to load
    let tableFound = false;
    for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(5_000);
        const tableCount = await page.locator('table').count();
        if (tableCount > 0) {
            tableFound = true;
            await appendJobLog(job, `Found ${tableCount} table(s) on page`, { progress: 46 });
            break;
        }
    }
    if (!tableFound) {
        throw new Error('No filed returns table found after clicking Consult');
    }

    // Step 4: Click "View" on the most recent filing (first row) — opens in new window
    const viewLinks = await page.locator('table a:has-text("View"), table input[value="View"], table a[href*="view"]').all();
    if (viewLinks.length === 0) {
        throw new Error('No View links found in filed returns table');
    }

    const newPagePromise = browserContext.waitForEvent('page', { timeout: 30_000 });
    await viewLinks[0].click();
    await appendJobLog(job, 'Clicked View on most recent filing, waiting for new window...', { progress: 46 });

    const newPage = await newPagePromise;
    await newPage.waitForLoadState('domcontentloaded', { timeout: 30_000 });
    await appendJobLog(job, `New window opened: ${newPage.url()}`, { progress: 46 });
    await newPage.waitForTimeout(3_000);

    // Use new page for credit extraction
    page = newPage;

    // Step 5: Scroll to bottom and find credit value
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2_000);

    const creditRow = page.locator('tr:has-text("Net VAT Payable / Credit Carried Forward")').first();
    let creditValue: number | null = null;

    if (await creditRow.count() > 0) {
        const cells = await creditRow.locator('td').all();
        if (cells.length > 0) {
            const lastCell = cells[cells.length - 1];
            const text = await lastCell.textContent();
            const match = text?.match(/-?\d{1,3}(,\d{3})*(\.\d+)?/);
            if (match) {
                creditValue = parseFloat(match[0].replace(/,/g, ''));
            }
        }
    }

    if (creditValue === null) {
        throw new Error('Could not extract credit carried forward value');
    }

    // Only use negative values as credit (positive means payable, not credit)
    const credit = creditValue < 0 ? Math.abs(creditValue) : 0;

    await appendJobLog(job, `Extracted credit carried forward: KES ${credit}`, { progress: 46 });

    // Close new window and switch back to original page
    await newPage.close();
    await appendJobLog(job, 'Closed new window, switched back to original page', { progress: 46 });

    return credit;
}

async function extractVatWithholding(page: any, job: JobContext, periodFrom: string): Promise<number> {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const periodDate = new Date(periodFrom);
    const targetMonth = monthNames[periodDate.getMonth()];
    const targetYear = String(periodDate.getFullYear());

    await appendJobLog(job, `Checking VAT withholding for ${targetMonth} ${targetYear}...`, { progress: 46 });

    // Hover Certificates menu
    const certificatesMenu = page.locator('a:has-text("Certificates")').first();
    await certificatesMenu.hover();
    await page.waitForTimeout(1_500);

    // Click Reprint VAT Withholding Certificate
    await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of Array.from(links)) {
            if (link.textContent?.includes('Reprint VAT Withholding Certificate')) {
                link.click();
                break;
            }
        }
    });
    await page.waitForTimeout(5_000);
    await appendJobLog(job, 'Clicked Reprint VAT Withholding Certificate', { progress: 46 });

    // Select Month and Year from dropdowns
    let monthSelected = false;
    let yearSelected = false;

    for (let i = 0; i < 5; i++) {
        const select = page.locator('select').nth(i);
        const count = await select.count();
        if (count === 0) continue;

        const options = await select.evaluate((el: HTMLSelectElement) =>
            Array.from(el.options).map(o => ({ text: o.text, value: o.value }))
        );

        const hasMonths = options.some((o: any) => monthNames.some(m => o.text.includes(m) || o.value.includes(m)));
        if (hasMonths && !monthSelected) {
            await select.selectOption({ label: targetMonth });
            await appendJobLog(job, `Selected month: ${targetMonth}`, { progress: 46 });
            monthSelected = true;
            continue;
        }

        const hasYears = options.some((o: any) => /^\d{4}$/.test(o.text) || /^\d{4}$/.test(o.value));
        if (hasYears && !yearSelected) {
            await select.selectOption({ label: targetYear });
            await appendJobLog(job, `Selected year: ${targetYear}`, { progress: 46 });
            yearSelected = true;
        }
    }

    if (!monthSelected || !yearSelected) {
        await appendJobLog(job, 'WARNING: Could not select month/year for withholding check', { progress: 46, level: 'warn' });
        return 0;
    }

    await page.waitForTimeout(1_000);

    // Set up dialog handler BEFORE clicking Consult
    let dialogHandled = false;
    page.on('dialog', async (dialog: any) => {
        dialogHandled = true;
        const msg = dialog.message();
        await appendJobLog(job, `KRA withholding dialog: "${msg}" (type: ${dialog.type()})`, { progress: 46 });
        if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
            await dialog.accept();
        } else {
            await dialog.dismiss();
        }
    });

    // Click Consult button
    await page.evaluate(() => {
        const btn = document.querySelector('input[value="Consult"]') as HTMLInputElement;
        if (btn) {
            btn.focus();
            btn.click();
        }
    });
    await appendJobLog(job, 'Clicked Consult button for withholding', { progress: 46 });
    await page.waitForTimeout(5_000);
    page.removeAllListeners('dialog');

    if (dialogHandled) {
        await appendJobLog(job, 'Dialog handled, waiting for results...', { progress: 46 });
    }
    await page.waitForTimeout(10_000);

    // Check for "Records Not Found"
    const pageText = await page.evaluate(() => document.body.innerText || '');
    if (pageText.includes('Records Not Found')) {
        await appendJobLog(job, 'No withholding records found for this period', { progress: 46 });
        return 0;
    }

    // Try to extract Total VAT Withholding Amount from DOM
    let withholdingAmount: number | null = null;
    const totalMatch = pageText.match(/Total VAT Withholding Amount\s*[:\-]?\s*([\d,]+\.?\d*)/i);
    if (totalMatch) {
        withholdingAmount = parseFloat(totalMatch[1].replace(/,/g, ''));
        await appendJobLog(job, `Extracted withholding amount from DOM: ${withholdingAmount}`, { progress: 46 });
    }

    if (withholdingAmount === null) {
        await appendJobLog(job, 'Could not extract withholding amount, defaulting to 0', { progress: 46 });
        withholdingAmount = 0;
    }

    await appendJobLog(job, `Total VAT Withholding Amount: KES ${withholdingAmount}`, { progress: 46 });
    return withholdingAmount;
}

async function resolveUploadArtifactPath(
    artifactUrl: string,
    jobId: string,
    artifactPrefix: string,
): Promise<string> {
    const normalizedUrl = artifactUrl.trim();

    if (/^[A-Za-z]:[\\/]/.test(normalizedUrl)) {
        if (!await pathExists(normalizedUrl)) {
            throw new Error(`Resolved ${artifactPrefix.toUpperCase()} artifact is missing on disk: ${normalizedUrl}`);
        }

        return normalizedUrl;
    }

    if (normalizedUrl.startsWith('/clients/')) {
        const localPath = path.resolve(__dirname, '../../../frontend/public', decodeURIComponent(normalizedUrl.substring(1)));
        if (!await pathExists(localPath)) {
            throw new Error(`Generated ${artifactPrefix.toUpperCase()} artifact not found on disk at: ${localPath}`);
        }

        return localPath;
    }

    const fullArtifactUrl = normalizedUrl.startsWith('http')
        ? normalizedUrl
        : `http://localhost:3000${normalizedUrl.startsWith('/') ? normalizedUrl : `/${normalizedUrl}`}`;
    const response = await fetch(fullArtifactUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${artifactPrefix.toUpperCase()} artifact: ${response.status} ${response.statusText}`);
    }

    const downloadPath = path.join(TMP_DIR, `${artifactPrefix}-${jobId}${path.extname(normalizedUrl) || '.zip'}`);
    await fs.writeFile(downloadPath, Buffer.from(await response.arrayBuffer()));
    return downloadPath;
}

async function ensureDeclarationAccepted(page: any): Promise<void> {
    const checkbox = page.locator(
        'input[type="checkbox"]:near(:text("Terms and Conditions")), input[type="checkbox"][name*="agree" i], input[type="checkbox"][id*="agree" i], input[type="checkbox"]'
    ).first();

    const checkboxCount = await checkbox.count().catch(() => 0);
    if (!checkboxCount) {
        return;
    }

    const isChecked = await checkbox.isChecked().catch(() => false);
    if (!isChecked) {
        await checkbox.check().catch(async () => {
            await checkbox.click({ force: true }).catch(() => undefined);
        });
    }
}

async function extractReceiptNumber(page: any): Promise<string | null> {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const receiptMatch = bodyText.match(/(?:Acknowledg(?:e)?ment|Receipt)\s*(?:Number|No\.?|#)?\s*[:\-]?\s*([A-Z0-9\-/]+)/i);
    const candidate = receiptMatch?.[1] ?? null;
    // "Generated" is a status label, not a real receipt number
    if (candidate && candidate.toLowerCase() === 'generated') {
        return null;
    }
    return candidate;
}

// ─── HTTP Filing Orchestrator ─────────────────────────────────────────────────

async function processFilingViaHttp(job: JobContext): Promise<{
    receiptPath?: string;
    receiptNumber: string | null;
    credentialUpdate: CredentialUpdate | null;
}> {
    const { HttpFilingOrchestrator } = await import('./http/filing/HttpFilingOrchestrator');
    const orchestrator = new HttpFilingOrchestrator(job);
    return orchestrator.run();
}

// ─── Core Job Processor ───────────────────────────────────────────────────────

export async function processFilingJob(job: JobContext): Promise<{
    receiptPath?: string;
    receiptNumber: string | null;
    credentialUpdate: CredentialUpdate | null;
    prnPath?: string;
    prnResults?: Array<{ taxType?: string; prnPath?: string; prnGcsPath?: string }>;
    vatSummary?: {
        inputVat: number;
        outputVat: number;
        previousCredit: number;
        payableVat: number;
        netVatBalance: number;
    };
    generatedZipUrl?: string;
    generatedZipLabel?: string;
    sourcePackageUrl?: string;
    sourcePackageLabel?: string;
}> {
    const { jobId, userId, payload } = job.data;
    const {
        kraPin,
        encryptedPassword,
        iv,
        authTag,
        periodFrom,
        periodTo,
        taxObligationType,
        ownsRentalProperty,
        rentalIncomeAmount,
        otpCode,
    } = payload;
    const printPrnOnly = (payload as any).printPrnOnly === true;
    const isMriReturn = taxObligationType === 'monthly_rental_income';
    const isTotReturn = taxObligationType === 'turnover_tax';
    const isPayeUpload = taxObligationType === 'paye' && !!(payload as any).payeZipUrl;
    const isVatPrepareOnly = taxObligationType === 'vat' && (payload as any).prepareVatOnly === true && (payload as any).vatCurrentMonthDownload !== true;
    const isVatCurrentMonthDownload = taxObligationType === 'vat' && (payload as any).vatCurrentMonthDownload === true;
    const isVatUpload = taxObligationType === 'vat' && !!(payload as any).vatZipUrl && !isVatPrepareOnly && !isVatCurrentMonthDownload;
    const vatPreviousCredit = typeof (payload as any).vatPreviousCredit === 'number'
        ? (payload as any).vatPreviousCredit
        : Number((payload as any).vatPreviousCredit ?? 0) || 0;
    const sectionBWithoutPinSales = typeof (payload as any).sectionBWithoutPinSales === 'number'
        ? (payload as any).sectionBWithoutPinSales
        : Number((payload as any).sectionBWithoutPinSales ?? 0) || 0;
    const resolvedClientName = payload.clientName?.trim() || kraPin;

    
    const isNssfReturn = taxObligationType === 'nssf';

    console.log(`[Worker] Starting job ${jobId} for identifier ${kraPin}`);
    await appendJobLog(job, 'Job accepted by worker');

    // Plaintext password (encryption disabled for testing)
    let activePassword = payload.kraPassword || (payload as any).nssfPassword || '';
    let credentialUpdate: CredentialUpdate | null = job.data.credentialUpdate ?? null;

    if (isNssfReturn) {
        const nssfFileUrl = (payload as any).nssfFileUrl;
        if (!nssfFileUrl) throw new Error('Missing NSSF File URL in payload.');
        const nssfPeriod = (payload as any).nssfPeriod as string | undefined;
        const nssfService = new NssfService(job);
        let nssfResult: any;
        try {
            nssfResult = await nssfService.execute(kraPin, activePassword, nssfFileUrl, nssfPeriod);
        } catch (nssfErr: any) {
            const msg = nssfErr?.message || String(nssfErr);
            let errorType = 'UNKNOWN';
            let userMessage = 'An unexpected error occurred during NSSF filing. Please try again or contact support.';
            if (msg.includes('Timeout') || msg.includes('timeout')) {
                if (msg.includes('502') || msg.includes('504') || msg.includes('Gateway')) {
                    errorType = 'SITE_DOWN';
                    userMessage = 'NSSF portal is currently unavailable (502/504 Gateway Error). Please try again later.';
                } else {
                    errorType = 'TIMEOUT';
                    userMessage = 'NSSF portal is taking too long to respond. The site may be slow or temporarily down. Please try again.';
                }
            } else if (msg.includes('502') || msg.includes('504') || msg.includes('Bad Gateway') || msg.includes('Gateway Timeout')) {
                errorType = 'SITE_DOWN';
                userMessage = 'NSSF portal is currently unavailable (502/504 Gateway Error). Please try again later.';
            } else if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET')) {
                errorType = 'NETWORK_ERROR';
                userMessage = 'Cannot connect to NSSF portal. Please check your internet connection and try again.';
            } else if (msg.includes('404')) {
                errorType = 'NOT_FOUND';
                userMessage = 'NSSF portal page not found. The site may be undergoing maintenance.';
            }
            console.error(`[Worker][${jobId}] NSSF filing failed: ${errorType}: ${msg}`);
            await appendJobLog(job, `NSSF filing failed: ${userMessage}`, { progress: 0, level: 'error' });
            await jobStore.updateJob(jobId, {
                status: 'failed',
                error: errorType,
                errorMessage: msg,
                userMessage,
                updatedAt: new Date().toISOString(),
            } as any);
            if (payload.clientId) {
                await adminDb.collection('clients').doc(payload.clientId).update({
                    nssfStatus: 'failed',
                    nssfError: userMessage,
                    nssfErrorType: errorType,
                    nssfLastErrorAt: new Date().toISOString(),
                });
            }
            throw new Error(userMessage);
        }

        // Upload NSSF payment order receipt to GCS — no local disk storage.
        // fileNssfReturn writes to tmpdir() (not the receipts/ dir), so we read
        // the buffer and upload it directly, then delete the temp file.
        let receiptGcsPath: string | null = null;
        if (nssfResult.receiptPath) {
            try {
                const buf = await fs.readFile(nssfResult.receiptPath);
                const fileName = path.basename(nssfResult.receiptPath);
                receiptGcsPath = gcsReceiptPath(userId, payload.clientId || 'unknown', jobId, fileName);
                await uploadBuffer(buf, receiptGcsPath, { contentType: 'application/pdf' });
                await appendJobLog(job, `Receipt uploaded to Cloud Storage: ${receiptGcsPath}`, { progress: 94 });
                // Delete the temp file — we never store receipts on local disk
                await fs.unlink(nssfResult.receiptPath).catch(() => {});
            } catch (uploadErr: any) {
                console.error(`[Worker][${jobId}] Failed to upload NSSF receipt to GCS:`, uploadErr.message);
                await appendJobLog(job, `Receipt upload to Cloud Storage failed: ${uploadErr.message}`, { progress: 94, level: 'info' });
            }
        }

        // Upload NSSF HAR capture to GCS for HTTP porting analysis
        if (nssfResult.harPath) {
            try {
                const harBuf = await fs.readFile(nssfResult.harPath);
                const harGcsPath = gcsReceiptPath(userId, payload.clientId || 'unknown', jobId, 'nssf-capture.har')
                    .replace('/receipts/', '/captures/');
                await uploadBuffer(harBuf, harGcsPath, { contentType: 'application/json' });
                await appendJobLog(job, `NSSF HAR capture uploaded to Cloud Storage: ${harGcsPath}`, { progress: 95, level: 'info' });
                await fs.unlink(nssfResult.harPath).catch(() => {});
            } catch (harErr: any) {
                console.error(`[Worker][${jobId}] Failed to upload NSSF HAR to GCS:`, harErr.message);
            }
        }

        // Update client NSSF status and receipt URL
        if (payload.clientId) {
            // Receipt URL points at the GCS-backed streaming endpoint, NOT a local path.
            // The endpoint streams the file from Cloud Storage and never touches local disk.
            const nssfReceiptUrl = receiptGcsPath
                ? `/api/clients/${payload.clientId}/receipts/nssf`
                : '';
            await adminDb.collection('clients').doc(payload.clientId).update({
                'lastFiled.nssf': new Date().toISOString(),
                'status.nssf': 'filed',
                nssf: 'filed',
                nssfLastFiledDate: new Date().toISOString(),
                nssfReceiptUrl,
                // Clear any stale failure markers from a previous attempt so the
                // compliance tab no longer shows the old error banner.
                nssfStatus: 'filed',
                nssfError: null,
                nssfErrorType: null,
            });
            if (receiptGcsPath) {
                await jobStore.updateJob(jobId, {
                    'artifacts.receiptGcsPath': receiptGcsPath,
                } as any);
            }
            await appendJobLog(job, `Updated client NSSF last filed tracking`, { progress: 95 });
        }

        // Generate a signed URL for the NSSF receipt so the frontend can download it
        let nssfReceiptUrl: string | undefined;
        try {
            if (receiptGcsPath) {
                nssfReceiptUrl = await getSignedDownloadUrl(receiptGcsPath, 60 * 24 * 7); // 7 days
            }
        } catch (e: any) {
            console.error(`[Worker][${jobId}] Failed to generate NSSF receipt signed URL:`, e.message);
        }

        return { receiptPath: nssfReceiptUrl || receiptGcsPath || undefined, receiptNumber: null, credentialUpdate };
    }

    await fs.mkdir(TMP_DIR, { recursive: true });

    // ── HTTP engine fast path for nil returns, Turnover Tax, and PRN generation (feature-flagged) ─
    const useHttpEngine = process.env.USE_HTTP_ENGINE === 'true' || (payload as any).useHttpEngine === true;
    const isNilReturnExplicit = (payload as any).isNil === true;
    const isMriFiling = taxObligationType === 'monthly_rental_income' && !isNilReturnExplicit && !printPrnOnly;
    const isPayeUploadJob = taxObligationType === 'paye' && !printPrnOnly && !!(payload as any).payeZipUrl;
    const isHttpSupportedObligation =
        isNilReturnExplicit ||
        taxObligationType === 'turnover_tax' ||
        isMriFiling ||
        isPayeUploadJob ||
        (printPrnOnly && (
            (taxObligationType as string) === 'monthly_rental_income' ||
            (taxObligationType as string) === 'vat' ||
            taxObligationType === 'paye' ||
            (taxObligationType as string) === 'income_tax_resident_individual' ||
            (taxObligationType as string) === 'income_tax_non_resident_individual' ||
            (taxObligationType as string) === 'income_tax_company' ||
            (taxObligationType as string) === 'capital_gains_tax' ||
            (taxObligationType as string) === 'digital_asset_tax' ||
            (taxObligationType as string) === 'advance_tax' ||
            (taxObligationType as string) === 'withholding' ||
            (taxObligationType as string) === 'excise_duty'
        )) ||
        isVatPrepareOnly ||
        isVatCurrentMonthDownload ||
        isVatUpload;

    let fallBackToPlaywright = false;

    if (useHttpEngine && isHttpSupportedObligation) {
        const maxHttpAttempts = 2; // 1 initial attempt + 1 retry
        let httpResult: any;

        for (let httpAttempt = 1; httpAttempt <= maxHttpAttempts; httpAttempt++) {
            try {
                if (httpAttempt > 1) {
                    await appendJobLog(job, `Retrying HTTP engine (attempt ${httpAttempt}/${maxHttpAttempts})...`, { progress: 10, level: 'info' });
                }
                httpResult = await processFilingViaHttp(job);
                break; // success — exit the retry loop
            } catch (httpErr) {
                const message = httpErr instanceof Error ? httpErr.message : String(httpErr);

                // Password expiry and mobile verification require the interactive
                // Playwright flow — it can complete the password-change/OTP screens
                // automatically and return the new credentials in credentialUpdate.
                // The HTTP engine cannot, so hand the job to the browser path below
                // instead of failing it.
                const errCode = (httpErr as any)?.code;
                if (errCode === 'PASSWORD_EXPIRED' || errCode === 'MOBILE_VERIFICATION_REQUIRED') {
                    await appendJobLog(job, `${message} — switching to browser automation, which completes this step automatically`, { progress: 42, level: 'warn' });
                    console.warn(`[Worker][${jobId}] HTTP engine cannot handle ${errCode}; falling back to Playwright`);
                    fallBackToPlaywright = true;
                    break;
                }

                // Do not retry on non-retryable errors (bad credentials, validation errors from KRA).
                const isRetryable = !(httpErr as any)?.retryable === false
                    && !/credential|invalid.*password|account.*locked|validation.*error|file.*structural/i.test(message);

                if (httpAttempt < maxHttpAttempts && isRetryable) {
                    const isNetworkTimeout = /ETIMEDOUT|ECONNRESET|socket hang up|Network error|System Error|portal returned 5\d\d|Portal unavailable/i.test(message);
                    const retryDelay = isNetworkTimeout ? 15_000 : 2_000;
                    await appendJobLog(job, `HTTP engine attempt ${httpAttempt} failed: ${message}. Will retry in ${retryDelay / 1000}s.`, { progress: 10, level: 'warn' });
                    console.warn(`[Worker][${jobId}] HTTP engine attempt ${httpAttempt} failed, retrying in ${retryDelay}ms:`, message);
                    await new Promise((r) => setTimeout(r, retryDelay));
                    continue;
                }

                await appendJobLog(job, `HTTP engine failed after ${httpAttempt} attempt(s): ${message}`, { progress: 10, level: 'error' });
                console.error(`[Worker][${jobId}] HTTP engine failed after ${httpAttempt} attempt(s):`, message);
                throw httpErr;
            }
        }

        if (fallBackToPlaywright) {
            // Re-enter the browser flow below with the original credentials.
            // The Playwright path detects the password-change / mobile-verification
            // screens, completes them, and files the return as before.
            await appendJobLog(job, 'Continuing with Playwright browser automation...', { progress: 45, level: 'info' });
        } else {
        try {
            const httpResultFinal = httpResult;

            // Store PRN results and GCS path in Firestore for download route lookup.
            if (printPrnOnly && (httpResultFinal as any).prnResults) {
                const prnResults = (httpResultFinal as any).prnResults;
                const primaryPrn = prnResults[0];

                await jobStore.updateJob(jobId, {
                    'result.prnResults': prnResults,
                    'artifacts.receiptGcsPath': primaryPrn?.prnGcsPath,
                } as any);

                // Update client tracking with PRN download URL.
                if (payload.clientId) {
                    const obligationCol =
                        taxObligationType === 'turnover_tax' ? 'tot'
                        : taxObligationType === 'monthly_rental_income' ? 'mri'
                        : taxObligationType === 'vat' ? 'vat'
                        : taxObligationType === 'paye' ? 'paye'
                        : null;

                    if (obligationCol && primaryPrn) {
                        let prnUrl: string | undefined;
                        try {
                            if (primaryPrn.prnGcsPath) {
                                prnUrl = await getSignedDownloadUrl(primaryPrn.prnGcsPath, 60 * 24 * 7); // 7 days
                            }
                        } catch (e: any) {
                            console.error(`[Worker][${jobId}] Failed to generate client PRN signed URL:`, e.message);
                        }

                        const clientUpdate: Record<string, any> = {};
                        clientUpdate[`${obligationCol}PrnUrl`] = prnUrl || primaryPrn.prnPath?.replace(/\\/g, '/');

                        if (taxObligationType === 'paye') {
                            const clientSnap = await adminDb.collection('clients').doc(payload.clientId).get();
                            const existingResults: Array<{ taxType?: string }> = clientSnap.data()?.payePrnResults || [];
                            // Only persist PRN entries that actually have a download path; a failed
                            // PRN run must not wipe a previously-good entry nor write a placeholder
                            // (a path-less entry crashes the dashboard's PRN rendering loop).
                            const successfulGenerated = prnResults.filter((r: any) => r.prnGcsPath || r.prnPath);
                            const generatedMap = new Map(successfulGenerated.map((r: any) => [r.taxType, r]));
                            const merged = [
                                ...existingResults.filter((r) => !generatedMap.has(r.taxType as any)),
                                ...successfulGenerated.map((r: any) => ({
                                    taxType: r.taxType,
                                    prnPath: r.prnPath,
                                    prnGcsPath: r.prnGcsPath,
                                })),
                            ];
                            clientUpdate[`${obligationCol}PrnResults`] = merged;
                        }

                        await adminDb.collection('clients').doc(payload.clientId).update(clientUpdate);
                        await appendJobLog(job, `Updated client ${obligationCol.toUpperCase()} PRN tracking`, { progress: 95 });
                    }
                }
            } else if ((isVatPrepareOnly || isVatCurrentMonthDownload) && (httpResultFinal as any).vatPrepareResult) {
                // VAT prepare-only: save generated ZIP info to client doc for the "File VAT" button.
                const vatResult = (httpResultFinal as any).vatPrepareResult;

                if (payload.clientId) {
                    // Generate signed URLs from GCS paths if available.
                    let generatedZipUrl = vatResult.generatedZipUrl;
                    let sourcePackageUrl = vatResult.sourcePackageUrl;
                    try {
                        if (vatResult.generatedZipGcsPath) {
                            generatedZipUrl = await getSignedDownloadUrl(vatResult.generatedZipGcsPath, 60 * 24 * 7);
                        }
                        if (vatResult.sourcePackageGcsPath) {
                            sourcePackageUrl = await getSignedDownloadUrl(vatResult.sourcePackageGcsPath, 60 * 24 * 7);
                        }
                    } catch (e: any) {
                        console.error(`[Worker][${jobId}] Failed to generate VAT ZIP signed URLs:`, e.message);
                    }

                    const clientUpdate: Record<string, any> = {
                        vat: 'generated',
                        status: { vat: 'generated' },
                        vatZipUrl: generatedZipUrl,
                        vatZipLabel: vatResult.generatedZipLabel,
                        vatSourcePackageUrl: sourcePackageUrl,
                        vatSourcePackageLabel: vatResult.sourcePackageLabel,
                        vatSummary: vatResult.vatSummary,
                        vatPreparedAt: new Date().toISOString(),
                    };
                    const periodMatch = periodFrom.match(/^(\d{4})-(\d{2})/);
                    if (periodMatch) {
                        clientUpdate.vatPeriod = `${periodMatch[1]}-${periodMatch[2]}`;
                    }
                    await adminDb.collection('clients').doc(payload.clientId).update(clientUpdate);
                    await appendJobLog(job, `Saved prepared VAT ZIP to client workspace`, { progress: 95 });
                }
            } else if (payload.clientId && !printPrnOnly) {
                // Update client tracking for successful HTTP filings (not PRN-only jobs).
                const obligationCol =
                    taxObligationType === 'turnover_tax' ? 'tot'
                    : taxObligationType === 'monthly_rental_income' ? 'mri'
                    : taxObligationType === 'vat' ? 'vat'
                    : taxObligationType === 'paye' ? 'paye'
                    : taxObligationType === 'excise_duty' ? 'exciseDuty'
                    : null;

                if (obligationCol) {
                    const clientUpdate: Record<string, any> = {
                        [`lastFiled.${obligationCol}`]: new Date().toISOString(),
                        [`status.${obligationCol}`]: 'filed',
                        [obligationCol]: 'filed',
                        [`${obligationCol}LastFiledDate`]: new Date().toISOString(),
                    };

                    // Remember the filed period so subsequent standalone PRN generation
                    // (which reads {obligation}PeriodMonth/Year via getClientFilingPeriod)
                    // targets the period that was just filed instead of the
                    // previous-calendar-month default.
                    const pMatch = periodFrom?.match(/^(\d{4})-(\d{2})/);
                    if (pMatch) {
                        clientUpdate[`${obligationCol}PeriodMonth`] = Number(pMatch[2]);
                        clientUpdate[`${obligationCol}PeriodYear`] = Number(pMatch[1]);
                        clientUpdate[`${obligationCol}Period`] = `${pMatch[1]}-${pMatch[2]}`;
                        clientUpdate[`filedPeriods.${obligationCol}`] = FieldValue.arrayUnion(`${pMatch[1]}-${pMatch[2]}`);
                    }

                    if (httpResultFinal.receiptPath) {
                        // Convert local receipt path to GCS signed URL for frontend download.
                        let receiptUrl = httpResultFinal.receiptPath;
                        try {
                            // Read the GCS path from the job artifacts (set by BaseHttpFilingService.downloadReceipt).
                            const jobDoc = await jobStore.getJob(jobId);
                            const gcsPath = (jobDoc as any)?.artifacts?.receiptGcsPath;
                            if (gcsPath) {
                                receiptUrl = await getSignedDownloadUrl(gcsPath, 60 * 24 * 7); // 7 days
                            }
                        } catch (e: any) {
                            console.error(`[Worker][${jobId}] Failed to generate receipt signed URL:`, e.message);
                        }
                        clientUpdate[`${obligationCol}ReceiptUrl`] = receiptUrl;
                    }

                    await adminDb.collection('clients').doc(payload.clientId).update(clientUpdate);
                    await appendJobLog(job, `Updated client ${obligationCol.toUpperCase()} last filed tracking`, { progress: 95 });
                }
            }

            // For PRN-only jobs, return the PRN URL as prnPath for the frontend.
            if (printPrnOnly && (httpResultFinal as any).prnResults) {
                const prnResults = (httpResultFinal as any).prnResults;
                // Generate signed URLs for all PRN results.
                const signedPrnResults = await Promise.all(prnResults.map(async (r: any) => {
                    let prnUrl = r.prnPath?.replace(/\\/g, '/');
                    try {
                        if (r.prnGcsPath) {
                            prnUrl = await getSignedDownloadUrl(r.prnGcsPath, 60 * 24 * 7); // 7 days
                        }
                    } catch (e: any) {
                        console.error(`[Worker][${jobId}] Failed to generate PRN signed URL for ${r.taxType}:`, e.message);
                    }
                    return { ...r, prnPath: prnUrl };
                }));

                return {
                    ...httpResultFinal,
                    receiptPath: '',
                    receiptNumber: null,
                    prnPath: signedPrnResults[0]?.prnPath,
                    prnResults: signedPrnResults,
                };
            }

            // For VAT prepare-only and current-month download jobs, return the VAT summary and ZIP URLs for the frontend.
            if ((isVatPrepareOnly || isVatCurrentMonthDownload) && (httpResultFinal as any).vatPrepareResult) {
                const vatResult = (httpResultFinal as any).vatPrepareResult;
                let generatedZipUrl = vatResult.generatedZipUrl;
                let sourcePackageUrl = vatResult.sourcePackageUrl;
                try {
                    if (vatResult.generatedZipGcsPath) {
                        generatedZipUrl = await getSignedDownloadUrl(vatResult.generatedZipGcsPath, 60 * 24 * 7);
                    }
                    if (vatResult.sourcePackageGcsPath) {
                        sourcePackageUrl = await getSignedDownloadUrl(vatResult.sourcePackageGcsPath, 60 * 24 * 7);
                    }
                } catch (e: any) {
                    console.error(`[Worker][${jobId}] Failed to generate VAT result signed URLs:`, e.message);
                }
                return {
                    ...httpResultFinal,
                    receiptPath: '',
                    receiptNumber: null,
                    vatSummary: vatResult.vatSummary,
                    generatedZipUrl,
                    generatedZipLabel: vatResult.generatedZipLabel,
                    sourcePackageUrl,
                    sourcePackageLabel: vatResult.sourcePackageLabel,
                };
            }

            await setJobStep(job, 98, 'Dispatching completion notification');
            // Convert receipt path to GCS signed URL for the job result.
            let finalReceiptPath = httpResultFinal.receiptPath;
            if (finalReceiptPath) {
                try {
                    const jobDoc = await jobStore.getJob(jobId);
                    const gcsPath = (jobDoc as any)?.artifacts?.receiptGcsPath;
                    if (gcsPath) {
                        finalReceiptPath = await getSignedDownloadUrl(gcsPath, 60 * 24 * 7);
                    }
                } catch (e: any) {
                    console.error(`[Worker][${jobId}] Failed to generate final receipt signed URL:`, e.message);
                }

                await sendReceiptNotification({
                    userId,
                    jobId,
                    kraPin,
                    receiptPath: finalReceiptPath,
                    completedAt: new Date().toISOString(),
                });
            }

            return { ...httpResultFinal, receiptPath: finalReceiptPath };
        } catch (postProcessErr) {
            const message = postProcessErr instanceof Error ? postProcessErr.message : String(postProcessErr);
            await appendJobLog(job, `HTTP engine post-processing failed: ${message}`, { progress: 10, level: 'error' });
            console.error(`[Worker][${jobId}] HTTP engine post-processing failed:`, message);
            throw postProcessErr;
        }
        }
    }

    // ── Playwright capture context (opt-in) ────────────────────────────────────
    const shouldCapturePlaywright = process.env.KRA_CAPTURE_ENABLED === 'true' || (payload as any).capture === true;
    let pwCaptureContext: import('./http/capture').CaptureContext | undefined;
    let pwCaptureHelper: import('./http/capture').PlaywrightCaptureHelper | undefined;

    if (shouldCapturePlaywright) {
        const { CaptureContext, CaptureUploader } = await import('./http/capture');
        pwCaptureContext = new CaptureContext({
            jobId,
            userId,
            clientId: payload.clientId,
            taxObligationType,
            isNil: (payload as any).isNil,
            kraPin,
            options: {
                enabled: true,
                screenshots: process.env.KRA_CAPTURE_SCREENSHOTS === 'true',
            },
            uploader: new CaptureUploader(),
        });
        await appendJobLog(job, 'Capture enabled for Playwright filing run', { progress: 4 });
    }

    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

    try {
        // ── Step 2: Launch browser with stealth configuration ────────────────────
        await setJobStep(job, 5, 'Launching browser session');
        const isHeadless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
        const launchOptions = {
            headless: isHeadless,
            slowMo: isHeadless ? 0 : PLAYWRIGHT_SLOW_MO,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--start-maximized',
                '--disable-blink-features=AutomationControlled',
                ...(isHeadless ? ['--disable-gpu'] : []),
            ],
        };

        const harCaptureDir = process.env.KRA_HAR_CAPTURE_DIR?.trim();
        const harPath = harCaptureDir
            ? path.join(harCaptureDir, `${jobId}-${Date.now()}.har`)
            : null;

        const contextOptions: any = {
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: null,
            acceptDownloads: true,
            locale: 'en-KE',
            timezoneId: 'Africa/Nairobi',
        };

        if (harPath) {
            await fs.mkdir(harCaptureDir!, { recursive: true });
            contextOptions.recordHar = { path: harPath };
            await appendJobLog(job, `HAR capture enabled: ${harPath}`, { progress: 5 });
        }

        const page = await measureJobPhase(job, 'browser launch', 5, async () => {
            const launchPreferences = await resolvePreferredBrowserLaunches();
            let lastLaunchError: Error | null = null;

            for (const preference of launchPreferences) {
                const effectiveLaunchOptions = {
                    ...launchOptions,
                    ...(preference.executablePath ? { executablePath: preference.executablePath } : {}),
                    ...(preference.channel ? { channel: preference.channel } : {}),
                };

                try {
                    await appendJobLog(job, `Attempting browser launch via ${preference.label}`, { progress: 5 });

                    if (KRA_REUSE_BROWSER_PROFILE) {
                        await fs.mkdir(KRA_BROWSER_PROFILE_DIR, { recursive: true });
                        context = await chromium.launchPersistentContext(KRA_BROWSER_PROFILE_DIR, {
                            ...effectiveLaunchOptions,
                            ...contextOptions,
                        });
                        await context.clearCookies().catch(() => undefined);
                        await context.addInitScript(() => {
                            try {
                                window.localStorage.clear();
                            } catch {
                                // Ignore storage clear failures for opaque origins like about:blank.
                            }

                            try {
                                window.sessionStorage.clear();
                            } catch {
                                // Ignore storage clear failures for opaque origins like about:blank.
                            }
                        });
                        await appendJobLog(job, `Using persistent KRA browser profile cache at ${KRA_BROWSER_PROFILE_DIR}`, { progress: 5 });
                    } else {
                        browser = await chromium.launch(effectiveLaunchOptions);
                        context = await browser.newContext(contextOptions);
                    }

                    await appendJobLog(job, `Using browser engine: ${preference.label}`, { progress: 5 });
                    const existingPages = context.pages();
                    return existingPages[0] ?? await context.newPage();
                } catch (error) {
                    lastLaunchError = error as Error;
                    await appendJobLog(job, `Browser launch via ${preference.label} failed: ${lastLaunchError.message}`, {
                        progress: 5,
                        level: 'error',
                    });

                    if (context) {
                        await context.close().catch(() => undefined);
                        context = undefined;
                    }

                    if (browser) {
                        await browser.close().catch(() => undefined);
                        browser = undefined;
                    }
                }
            }

            throw lastLaunchError ?? new Error('No browser launch strategy succeeded');
        }, () => `profileReuse=${KRA_REUSE_BROWSER_PROFILE}${KRA_REUSE_BROWSER_PROFILE ? ` profileDir=${KRA_BROWSER_PROFILE_DIR}` : ''} preferredBrowser=${KRA_BROWSER_EXECUTABLE_PATH || KRA_BROWSER_CHANNEL || 'chromium'}`);

        if (pwCaptureContext) {
            const { PlaywrightCaptureHelper } = await import('./http/capture');
            pwCaptureHelper = new PlaywrightCaptureHelper(page, pwCaptureContext, harPath ?? undefined);
            await pwCaptureHelper.snapshot('login-start', 'post-browser-launch');
        }

        // ── Step 3: Navigate to KRA iTax portal ─────────────────────────────────
        await setJobStep(job, 10, 'Navigating to the KRA portal');

        await measureJobPhase(job, 'page.goto KRA portal', 10, async () => {
            await page.goto(KRA_PORTAL_URL, {
                waitUntil: 'domcontentloaded',
                timeout: 90_000, // KRA portal can be very slow
            });
        }, () => `currentUrl=${page.url()}`);
        await measureJobPhase(job, 'login page ready', 10, async () => {
            await waitForPortalReadyWithReload(page, job, {
                description: 'KRA login page',
                selectors: ['#logid', '#loginButton', 'input[name="captcahText"]'],
                timeout: 12_000,
                reloadAttempts: 1,
            });
        }, () => `currentUrl=${page.url()}`);

        // Dump real element IDs/names so we can verify selectors
        if (KRA_DEBUG_ARTIFACTS) {
            const loginElements = await page.$$eval(
                'input, button, select, a',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (els: any[]) => els.map((el: any) => ({
                    tag: el.tagName,
                    id: el.id ?? '',
                    name: el.name ?? '',
                    type: el.type ?? '',
                    value: (el.value ?? '').slice(0, 30),
                    text: (el.textContent ?? '').trim().slice(0, 40),
                    onclick: (el.getAttribute('onclick') ?? '').slice(0, 60),
                    href: (el.getAttribute('href') ?? '').slice(0, 80),
                }))
            );
            console.log(`[Worker][${jobId}] Login page elements:`, JSON.stringify(loginElements, null, 2));
        }

        await navigationDelay();

        const firstLogin = await performKraLogin(page, job, kraPin, activePassword, {
            pinProgress: 20,
            pinMessage: 'Entering KRA PIN and validating taxpayer account',
            passwordProgress: 30,
            passwordMessage: 'Entering iTax password',
            captchaProgress: 35,
            captchaMessage: 'Solving KRA captcha',
            submitProgress: 40,
            submitMessage: 'Submitting KRA login',
            otpCode,
        });

        if (firstLogin.passwordExpired) {
            credentialUpdate = await handleExpiredPasswordReset(page, job, activePassword);
            activePassword = credentialUpdate.newPassword;

            const postResetState = await detectAuthenticatedPortalState(page, 20_000);
            if (postResetState === 'mobile-verification') {
                await handleMobileVerification(page, job, otpCode);
            } else if (postResetState !== 'dashboard') {
                await setJobStep(job, 48, 'KRA returned to login after the password reset; logging in with the generated password');
                await page.goto(KRA_PORTAL_URL, {
                    waitUntil: 'domcontentloaded',
                    timeout: 90_000,
                });
                await waitForPortalReadyWithReload(page, job, {
                    description: 'KRA login page after password reset',
                    selectors: ['#logid', '#loginButton', 'input[name="captcahText"]'],
                    timeout: 12_000,
                    reloadAttempts: 1,
                });

                const relogin = await performKraLogin(page, job, kraPin, activePassword, {
                    pinProgress: 49,
                    pinMessage: 'Re-entering KRA PIN after password reset',
                    passwordProgress: 49,
                    passwordMessage: 'Entering the generated replacement password',
                    captchaProgress: 49,
                    captchaMessage: 'Solving KRA captcha for the second login attempt',
                    submitProgress: 49,
                    submitMessage: 'Submitting KRA login with the updated password',
                    otpCode,
                });

                if (relogin.passwordExpired) {
                    throw new Error('KRA still requested another password change after the automated reset');
                }
            } else {
                await appendJobLog(job, 'KRA kept the session logged in after the password reset, continuing without a second login.', { progress: 49 });
            }
        }

        await navigationDelay();

        const prnService = new PrnService(page, job);
        const payeFilingService = new PayeFilingService(page, job);
        const vatFilingService = new VatFilingService(page, job);
        const totFilingService = new TotFilingService(page, job);
        const mriFilingService = new MriFilingService(page, job);

        // ── Step 8: Navigate to Returns submenu ──────────────────────────────────
        await setJobStep(job, 50, isTotReturn ? 'Opening the KRA ToT return form' : isMriReturn ? 'Opening the KRA MRI return form' : isPayeUpload ? 'Opening the KRA PAYE return form' : (isVatPrepareOnly || isVatUpload) ? 'Opening the KRA VAT return form' : isVatCurrentMonthDownload ? 'Preparing current-month VAT download from homepage' : 'Opening the KRA nil return form');

        // Take a screenshot and dump the nav menu so we can discover the real selectors
        if (KRA_DEBUG_ARTIFACTS) {
            const postLoginScreenshot = path.join(TMP_DIR, `post-login-${jobId}.png`);
            await page.screenshot({ path: postLoginScreenshot, fullPage: true });
            console.log(`[Worker][${jobId}] Post-login screenshot: ${postLoginScreenshot}`);

            const navElements = await page.$$eval(
                'a, li, td, th, span',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (els: any[]) => els
                    .map((el: any) => ({
                        tag: el.tagName,
                        id: el.id ?? '',
                        text: (el.textContent ?? '').trim().slice(0, 50),
                        href: (el.getAttribute('href') ?? '').slice(0, 80),
                        onclick: (el.getAttribute('onclick') ?? '').slice(0, 80),
                    }))
                    .filter((el: any) => el.text.length > 0)
                    .slice(0, 60)
            );
            console.log(`[Worker][${jobId}] Post-login nav elements:`, JSON.stringify(navElements, null, 2));
        }

        if (printPrnOnly) {
            // Use the requested filing period (periodFrom) for PRN generation, not today's date
            const prnPeriodFrom = payload.periodFrom || '';
            const prnTargetDate = prnPeriodFrom ? new Date(prnPeriodFrom) : new Date();

            await setJobStep(job, 80, `Generating standalone Payment Slip(s) (PRN)...`);

            // For PAYE, generate all three statutory PRNs (PAYE, NITA, AHL).
            // For other obligations, generate a single PRN for the requested type.
            let prnResults: Array<{ taxType: TaxObligationType; prnPath?: string; prnGcsPath?: string; error?: string }> = [];
            try {
                prnResults = await generatePrnAfterFiling(
                    job,
                    page,
                    kraPin,
                    prnPeriodFrom,
                    payload.periodTo || '',
                    taxObligationType
                );
                if (prnResults.length > 0) {
                    await jobStore.updateJob(jobId, {
                        'result.prnResults': prnResults,
                    } as any);
                }
            } catch (prnErr: any) {
                console.error(`[Worker][${jobId}] Standalone PRN generation error:`, prnErr.message);
                await appendJobLog(job, `Standalone PRN generation error: ${prnErr.message}`, { progress: 96, level: 'info' });
            }

            const successfulPrns = prnResults.filter((r) => r.prnPath && !r.error);
            if (successfulPrns.length === 0) {
                throw new Error(`PRN generation failed: no PRNs were generated`);
            }

            if (context) await context.close();
            if (browser) await browser.close();

            // Persist PRN references on the client document so the dashboard can show download links
            if (payload.clientId) {
                try {
                    const obligationCol =
                        taxObligationType === 'paye' ? 'paye'
                        : taxObligationType === 'turnover_tax' ? 'tot'
                        : taxObligationType === 'monthly_rental_income' ? 'mri'
                        : taxObligationType === 'vat' ? 'vat'
                        : null;

                    if (obligationCol) {
                        const clientUpdate: Record<string, any> = {};
                        const primaryPrn = successfulPrns[0];
                        let prnUrl: string | undefined;
                        try {
                            if (primaryPrn.prnGcsPath) {
                                prnUrl = await getSignedDownloadUrl(primaryPrn.prnGcsPath, 60 * 24 * 7); // 7 days
                            }
                        } catch (e: any) {
                            console.error(`[Worker][${jobId}] Failed to generate client PRN signed URL:`, e.message);
                        }
                        clientUpdate[`${obligationCol}PrnUrl`] = prnUrl || primaryPrn.prnPath!.replace(/\\/g, '/');
                        if (taxObligationType === 'paye') {
                            // Merge with existing payePrnResults so a partial re-run does not
                            // wipe out PRNs that were generated successfully in an earlier job.
                            const clientSnap = await adminDb.collection('clients').doc(payload.clientId).get();
                            const existingResults: Array<{ taxType?: string }> = clientSnap.data()?.payePrnResults || [];
                            const successfulPrnsWithPaths = successfulPrns.filter((r: any) => r.prnGcsPath || r.prnPath);
                            const generatedMap = new Map(successfulPrnsWithPaths.map((r) => [r.taxType, r]));
                            const merged = [
                                ...existingResults.filter((r) => !generatedMap.has(r.taxType as any)),
                                ...successfulPrnsWithPaths.map((r) => ({
                                    taxType: r.taxType,
                                    prnPath: r.prnPath,
                                    prnGcsPath: r.prnGcsPath,
                                })),
                            ];
                            clientUpdate[`${obligationCol}PrnResults`] = merged;
                        }
                        await adminDb.collection('clients').doc(payload.clientId).update(clientUpdate);
                        await appendJobLog(job, `Updated client ${obligationCol.toUpperCase()} PRN tracking`, { progress: 95 });
                    }
                } catch (e: any) {
                    console.error('[Worker] Failed to update client PRN tracking:', e.message);
                    await appendJobLog(job, `Failed to update client PRN tracking: ${e.message}`, { progress: 95, level: 'warn' });
                }
            }

            // Return the primary PRN URL for legacy consumers
            const primaryPrn = successfulPrns[0];
            let prnUrl = primaryPrn.prnPath?.replace(/\\/g, '/');
            try {
                if (primaryPrn.prnGcsPath) {
                    prnUrl = await getSignedDownloadUrl(primaryPrn.prnGcsPath, 60 * 24 * 7); // 7 days
                }
            } catch (e: any) {
                console.error(`[Worker][${jobId}] Failed to generate result PRN signed URL:`, e.message);
            }

            return { receiptPath: '', receiptNumber: null, credentialUpdate, prnPath: prnUrl, prnResults: successfulPrns };
        }

        const isNilReturnExplicit = (payload as any).isNil === true;
        const returnsReadyLabel = isTotReturn
            ? 'ToT return obligation page ready'
            : isMriReturn
                ? 'MRI return obligation page ready'
                : isPayeUpload
                    ? 'PAYE return obligation page ready'
                    : (isVatPrepareOnly || isVatUpload)
                        ? 'VAT return obligation page ready'
                    : 'Nil return obligation page ready';

        // ── For VAT preparation: extract credit and withholding from portal ──
        let creditBroughtForward = 0;
        let withholdingAmount = 0;
        if (isVatPrepareOnly || isVatUpload || isVatCurrentMonthDownload) {
            try {
                creditBroughtForward = await extractVatCreditBroughtForward(page, context, job);
                if (creditBroughtForward !== 0) {
                    await appendJobLog(job, `Extracted VAT credit brought forward from portal: KES ${creditBroughtForward}`, { progress: 47 });
                }
            } catch (e: any) {
                await appendJobLog(job, `Could not extract credit from portal: ${e.message}`, { progress: 47, level: 'warn' });
            }

            try {
                withholdingAmount = await extractVatWithholding(page, job, periodFrom);
                if (withholdingAmount !== 0) {
                    await appendJobLog(job, `Extracted VAT withholding from portal: KES ${withholdingAmount}`, { progress: 47 });
                }
            } catch (e: any) {
                await appendJobLog(job, `Could not extract withholding from portal: ${e.message}`, { progress: 47, level: 'warn' });
            }
        }

        // ── Current-month VAT download from homepage ─────────────────────────────
        if (isVatCurrentMonthDownload) {
            await setJobStep(job, 60, 'Downloading current-month VAT transactions from the iTax homepage');

            const effectivePreviousCredit = creditBroughtForward !== 0 ? creditBroughtForward : vatPreviousCredit;
            if (creditBroughtForward !== 0 || withholdingAmount !== 0) {
                await appendJobLog(job, `Using portal-extracted credit for current-month VAT: KES ${effectivePreviousCredit} (credit: ${creditBroughtForward}, withholding: ${withholdingAmount})`, { progress: 60 });
            }

            const vatFilingService = new VatFilingService(page, job);
            const preparedVat = await vatFilingService.prepareCurrentMonthFromHomepage({
                kraPin,
                clientName: resolvedClientName,
                periodFrom,
                periodTo,
                previousCredit: effectivePreviousCredit,
                withholdingAmount,
                sectionBWithoutPinSales: sectionBWithoutPinSales > 0 ? sectionBWithoutPinSales : undefined,
            });

            const vatSummaryWithWithholding = preparedVat.vatSummary;

            if (context) {
                await context.close();
            }
            if (browser) {
                await browser.close();
            }
            context = undefined;
            browser = undefined;

            try {
                if (payload.clientId) {
                    const clientUpdate: Record<string, any> = {
                        vat: 'generated',
                        status: { vat: 'generated' },
                        vatZipUrl: preparedVat.generatedZipUrl,
                        vatZipLabel: preparedVat.generatedZipLabel,
                        vatSourcePackageUrl: preparedVat.sourcePackageUrl,
                        vatSourcePackageLabel: preparedVat.sourcePackageLabel,
                        vatSummary: vatSummaryWithWithholding,
                        vatPreparedAt: new Date().toISOString(),
                    };
                    const currentPeriodFrom = payload.periodFrom || periodFrom || '';
                    if (currentPeriodFrom) {
                        const periodMatch = currentPeriodFrom.match(/^(\d{4})-(\d{2})/);
                        if (periodMatch) {
                            clientUpdate.vatPeriod = `${periodMatch[1]}-${periodMatch[2]}`;
                        }
                    }
                    await adminDb.collection('clients').doc(payload.clientId).update(clientUpdate);
                    await appendJobLog(job, `Saved current-month VAT ZIP to client workspace`, { progress: 95 });
                }
            } catch (persistErr: any) {
                console.error(`[Worker][${jobId}] Failed to persist current-month VAT artifacts:`, persistErr.message);
                await appendJobLog(job, `Warning: current-month VAT ZIP generated but could not be saved to client workspace`, { progress: 95, level: 'info' });
            }

            await setJobStep(job, 100, 'Current-month VAT ZIP generation completed');
            return {
                receiptPath: '',
                receiptNumber: null,
                credentialUpdate,
                vatSummary: vatSummaryWithWithholding,
                generatedZipUrl: preparedVat.generatedZipUrl,
                generatedZipLabel: preparedVat.generatedZipLabel,
                sourcePackageUrl: preparedVat.sourcePackageUrl,
                sourcePackageLabel: preparedVat.sourcePackageLabel,
            };
        }

        // ── Robust Returns menu navigation ──────────────────────────────────────
        // KRA sometimes redirects to "My Ledger" after login instead of dashboard.
        // If so, navigate to dashboard first, then click Returns menu.
        const currentUrl = page.url();
        if (currentUrl.includes('My%20Ledger') || currentUrl.includes('My Ledger')) {
            await appendJobLog(job, 'KRA redirected to My Ledger, navigating to dashboard first...', { progress: 47 });
            await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await navigationDelay();
        }

        // Try multiple strategies to reach the eReturns page
        let navigationAttempts = 0;
        const maxNavigationAttempts = 3;

        while (navigationAttempts < maxNavigationAttempts) {
            navigationAttempts++;
            await appendJobLog(job, `Navigation attempt ${navigationAttempts}/${maxNavigationAttempts}...`, { progress: 47 });

            // Strategy 1: Hover Returns menu → click File Return
            try {
                const returnsMenu = page.locator('#returns, a:has-text("Returns"), td:has-text("Returns") a, li:has-text("Returns") a').first();
                if (await returnsMenu.count() > 0) {
                    await returnsMenu.hover();
                    await page.waitForTimeout(1_500);

                    const filingLinkSelector = (!isNilReturnExplicit && (isMriReturn || isPayeUpload || isTotReturn || isVatPrepareOnly || isVatUpload))
                        ? 'a[href*="showEReturns"], a.mainMenu[href*="showEReturns"], a:has-text("File Return")'
                        : 'a[href*="nilReturn"], a[href*="NilReturn"], a[href*="nilreturn"], a:has-text("File Nil Return"), a:has-text("Nil Return")';

                    const filingLink = page.locator(filingLinkSelector).filter({ visible: true }).first();
                    if (await filingLink.count() > 0) {
                        await filingLink.click();
                        await appendJobLog(job, 'Clicked File Return via menu hover', { progress: 48 });
                        break; // Success
                    }
                }
            } catch { /* try next strategy */ }

            // Strategy 2: Direct JS evaluation
            try {
                if (isNilReturnExplicit) {
                    await page.evaluate(() => {
                        if (typeof (window as any).nilReturn === 'function') {
                            (window as any).nilReturn();
                        } else if (typeof (window as any).showNilReturns === 'function') {
                            (window as any).showNilReturns();
                        } else {
                            const el = document.querySelector('a[href*="nilReturn" i]') as HTMLElement;
                            if (el) el.click();
                        }
                    });
                    await appendJobLog(job, 'Triggered Nil Return via JS', { progress: 48 });
                } else {
                    await page.evaluate(() => {
                        if (typeof (window as any).showEReturns === 'function') {
                            (window as any).showEReturns();
                        } else {
                            const el = document.querySelector('a[href*="showEReturns"]') as HTMLElement;
                            if (el) el.click();
                        }
                    });
                    await appendJobLog(job, 'Triggered File Return via JS', { progress: 48 });
                }
                break; // Success
            } catch { /* try next strategy */ }

            // Strategy 3: Navigate via dashboard reload
            if (navigationAttempts < maxNavigationAttempts) {
                await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
                await navigationDelay();
            }
        }

        // Wait for the eReturns page to load
        await appendJobLog(job, 'Waiting for eReturns page...', { progress: 49 });
        try {
            await page.waitForURL(/eReturns\.htm/, { timeout: 15_000 });
            await appendJobLog(job, `On eReturns page: ${page.url()}`, { progress: 49 });
        } catch {
            await appendJobLog(job, 'URL did not change to eReturns, continuing anyway...', { progress: 49 });
        }

        await measureJobPhase(job, returnsReadyLabel, 50, async () => {
            await waitForPortalReadyWithReload(page, job, {
                description: returnsReadyLabel,
                selectors: ['select#regType', 'select[name="obligationId"]', 'tr:has-text("Type") select', '#dwnlod_btn_tims'],
                timeout: 15_000,
                reloadAttempts: 1,
            });
        }, () => `currentUrl=${page.url()}`);

        await navigationDelay();

        // ── Step 9: Select return type and tax obligation ────────────────────────
        await setJobStep(job, 60, isTotReturn ? 'Selecting ToT return type and tax obligation' : isMriReturn ? 'Selecting MRI return type and tax obligation' : isPayeUpload ? 'Selecting PAYE return type and preparing upload' : (isVatPrepareOnly || isVatUpload) ? 'Selecting VAT return type and preparing the workflow' : 'Selecting nil return type and tax obligation');

        if (KRA_DEBUG_ARTIFACTS) {
            const selectMetadata = await page.$$eval(
                'select',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (els: any[]) => els.map((el: any) => ({
                    id: el.id ?? '',
                    name: el.name ?? '',
                    options: Array.from(el.options).map((option: any) => ({
                        value: option.value ?? '',
                        text: (option.textContent ?? '').trim(),
                    })),
                }))
            );
            console.log(`[Worker][${jobId}] Return select metadata:`, JSON.stringify(selectMetadata, null, 2));
        }

        const typeSelectLocator = page.locator('tr').filter({ hasText: 'Type' }).locator('select').locator('visible=true').first();
        try {
            await typeSelectLocator.waitFor({ state: 'visible', timeout: 10_000 });
            const typeSelectDisabled = await typeSelectLocator.isDisabled();
            if (typeSelectDisabled) {
                const currentType = await typeSelectLocator.evaluate((select: any) => ({
                    value: String(select.value ?? '').trim(),
                    text: String(select.options?.[select.selectedIndex]?.textContent ?? '').trim(),
                }));
                console.log(`[Worker][${jobId}] Return type is locked by KRA: ${currentType.text} [${currentType.value}]`);
            } else {
                const typeChoice = await selectOptionByTextPatterns(typeSelectLocator, [/^self$/i]);
                console.log(`[Worker][${jobId}] Selected return type: ${typeChoice.text} [${typeChoice.value}]`);
            }
        } catch (e: any) {
            console.log(`[Worker][${jobId}] Type select dropdown not visible or error:`, e.message);
        }

        // Find the Tax Obligation dropdown by scanning all enabled <select> elements
        // and picking the one that contains an option matching the desired tax type.
        let obligationSelect: any = null;
        let obligationChoice: any = null;
        const allSelects = await page.locator('select').all();
        for (const sel of allSelects) {
            const isDisabled = await sel.isDisabled().catch(() => true);
            if (isDisabled) continue;
            try {
                const choice = await selectOptionByTextPatterns(sel, TAX_OBLIGATION_PATTERNS[taxObligationType]);
                if (choice) {
                    obligationSelect = sel;
                    obligationChoice = choice;
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!obligationSelect || !obligationChoice) {
            throw new Error(`Could not find the Tax Obligation dropdown for ${taxObligationType}`);
        }

        console.log(`[Worker][${jobId}] Selected tax obligation: ${obligationChoice.text} [${obligationChoice.value}]`);
        await appendJobLog(job, `Selected tax obligation: ${obligationChoice.text}`, { progress: 60 });

        const nextDialogPromise = waitForDialogMessage(page, 10_000);
        await page.locator('#nextBtn:visible, input[value="Next"]:visible, button:has-text("Next"):visible, a:has-text("Next"):visible').first().click();
        const nextDialogMessage = await nextDialogPromise;
        if (nextDialogMessage) {
            console.log(`[Worker][${jobId}] KRA dialog: "${nextDialogMessage}"`);
            await appendJobLog(job, `KRA blocked the form after obligation selection: ${nextDialogMessage}`, { progress: 60, level: 'error' });
            throw new Error(nextDialogMessage);
        }
        // IMPORTANT: Do NOT reload after clicking "Next" — KRA treats page
        // reloads as form re-submissions and invalidates the session with
        // "Your session has timed out or an attempt to page re-submit happened".
        // Instead, wait with a generous timeout and no reload attempts.
        const uploadPageSelectors = (!isNilReturnExplicit && (isTotReturn || isPayeUpload || isVatPrepareOnly || isVatUpload))
            ? [
                'input[type="file"]',
                'input[name*="file" i]',
                'input[id*="file" i]',
                'input[value*="Browse" i]',
                'text=Terms and Conditions',
                'text=Choose File',
                'text=Attach',
                'button:has-text("Upload")',
                'input[value*="Upload" i]',
                'input[type="image"][src*="upload" i]',
                'text=Click Here',
                'text=Download',
                ...VAT_DOWNLOAD_TRIGGER_SELECTORS,
                '#submitBtn',
                'input[value="Submit"]',
            ]
            : isMriReturn
                ? ['#txtPeriodFrom', '#txtPeriodTo', 'button:has-text("Next")', 'input[value="Next"]']
                : [
                    '#txtPeriodFrom',
                    '#txtPeriodTo',
                    'input[name="txtPeriodFrom"]',
                    'input[name="txtPeriodTo"]',
                    'input[name*="periodFrom" i]',
                    'input[name*="periodTo" i]',
                    'input[placeholder*="dd/mm/yyyy" i]',
                    'input[placeholder*="dd-mm-yyyy" i]',
                    'select[name*="month" i]',
                    'select[name*="year" i]',
                    'select[name*="period" i]',
                    'select[name*="obligation" i]',
                    'input[type="radio"]',
                    '#btnSubmit',
                    '#submitBtn',
                    'input[value="Submit"]',
                    'input[value="Next"]',
                    'button:has-text("Next")',
                ];

        try {
            await waitForPortalReadyWithReload(page, job, {
                description: !isNilReturnExplicit && isTotReturn ? 'ToT upload page' : !isNilReturnExplicit && isPayeUpload ? 'PAYE upload page' : !isNilReturnExplicit && isVatPrepareOnly ? 'VAT preparation page' : !isNilReturnExplicit && isVatUpload ? 'VAT upload page' : isMriReturn ? 'MRI return details page' : 'Nil return details page',
                selectors: uploadPageSelectors,
                timeout: 60_000,
                reloadAttempts: 0,
            });
        } catch (error) {
            if (isPayeUpload || isVatPrepareOnly || isVatUpload) {
                const uploadPageSnapshot = await snapshotPageControls(page);
                await appendJobLog(job, `${isPayeUpload ? 'PAYE' : 'VAT'} page snapshot after obligation selection: ${uploadPageSnapshot}`, {
                    progress: 60,
                    level: 'error',
                });
            }
            throw error;
        }

        await navigationDelay();

        // Capture the TOT upload form HTML explicitly so the HTTP port has a clean snapshot.
        if (!isNilReturnExplicit && isTotReturn && pwCaptureHelper) {
            await pwCaptureHelper.snapshot('form-load', 'tot-upload-form');
        }

        // ── Step 10: Fill return details ─────────────────────────────────────────
        await setJobStep(job, 70, (!isNilReturnExplicit && isTotReturn) ? 'Uploading the ToT ZIP file and accepting the declaration' : (!isNilReturnExplicit && isPayeUpload) ? 'Uploading the PAYE ZIP file and accepting the declaration' : (!isNilReturnExplicit && isVatPrepareOnly) ? 'Downloading the VAT auto-populated return and preparing the upload package' : (!isNilReturnExplicit && isVatUpload) ? 'Uploading the VAT ZIP file and accepting the declaration' : (!isNilReturnExplicit && isMriReturn) ? 'Confirming the MRI period and entering monthly rental income' : isNilReturnExplicit ? 'Confirming the nil return period and rental-property answer' : 'Confirming the return period and rental-property answer');

    if (!isNilReturnExplicit && isVatPrepareOnly) {
        // Use credit brought forward from portal if available, otherwise fall back to frontend value.
        // Withholding is tracked separately so it appears in its own XML field and dashboard line.
        const effectivePreviousCredit = creditBroughtForward !== 0 ? creditBroughtForward : vatPreviousCredit;
        if (creditBroughtForward !== 0 || withholdingAmount !== 0) {
            await appendJobLog(job, `Using portal-extracted credit: KES ${effectivePreviousCredit} (credit: ${creditBroughtForward}, withholding: ${withholdingAmount})`, { progress: 70 });
        }

        const preparedVat = await vatFilingService.prepareFromPortal({
            kraPin,
            clientName: resolvedClientName,
            periodFrom,
            periodTo,
            previousCredit: effectivePreviousCredit,
            withholdingAmount,
            sectionBWithoutPinSales: sectionBWithoutPinSales > 0 ? sectionBWithoutPinSales : undefined,
        });

        const vatSummaryWithWithholding = preparedVat.vatSummary;

        if (context) {
            await context.close();
        }
        if (browser) {
            await browser.close();
        }
        context = undefined;
        browser = undefined;

        // Persist the prepared VAT artifacts to the client document so the dashboard
        // can show the "File VAT" button even after a page refresh or a failed filing.
        try {
            if (payload.clientId) {
                const clientUpdate: Record<string, any> = {
                    vat: 'generated',
                    status: { vat: 'generated' },
                    vatZipUrl: preparedVat.generatedZipUrl,
                    vatZipLabel: preparedVat.generatedZipLabel,
                    vatSourcePackageUrl: preparedVat.sourcePackageUrl,
                    vatSourcePackageLabel: preparedVat.sourcePackageLabel,
                    vatSummary: vatSummaryWithWithholding,
                    vatPreparedAt: new Date().toISOString(),
                };
                // Track the period the ZIP was generated for
                const periodFrom = payload.periodFrom || '';
                if (periodFrom) {
                    const periodMatch = periodFrom.match(/^(\d{4})-(\d{2})/);
                    if (periodMatch) {
                        clientUpdate.vatPeriod = `${periodMatch[1]}-${periodMatch[2]}`;
                    }
                }
                await adminDb.collection('clients').doc(payload.clientId).update(clientUpdate);
                await appendJobLog(job, `Saved prepared VAT ZIP to client workspace`, { progress: 95 });
            }
        } catch (persistErr: any) {
            console.error(`[Worker][${jobId}] Failed to persist prepared VAT artifacts:`, persistErr.message);
            await appendJobLog(job, `Warning: VAT ZIP generated but could not be saved to client workspace`, { progress: 95, level: 'info' });
        }

        await setJobStep(job, 100, 'VAT preparation completed. Awaiting filing confirmation');
        return {
            receiptPath: '',
            receiptNumber: null,
            credentialUpdate,
            vatSummary: vatSummaryWithWithholding,
            generatedZipUrl: preparedVat.generatedZipUrl,
            generatedZipLabel: preparedVat.generatedZipLabel,
            sourcePackageUrl: preparedVat.sourcePackageUrl,
            sourcePackageLabel: preparedVat.sourcePackageLabel,
        };
    } else if (!isNilReturnExplicit && isTotReturn) {
        await totFilingService.upload(payload.totYear!, payload.totMonth!, payload.totTurnover!);
    } else if (!isNilReturnExplicit && isPayeUpload) {
        await payeFilingService.upload(payload.payeZipUrl!);
    } else if (!isNilReturnExplicit && isVatUpload) {
        await vatFilingService.upload(payload.vatZipUrl!);
    } else {

            // Use precise selectors — broad patterns like input[name*="to" i] match
            // hidden fields such as <input name="token_key"> causing fill() failures.
            const directFromField = page.locator('#txtPeriodFrom, #periodFrom, input[name="txtPeriodFrom"], input[name*="periodFrom" i]').first();
            const directToField = page.locator('#txtPeriodTo, #periodTo, input[name="txtPeriodTo"], input[name*="periodTo" i]').first();
            const directFromCount = await directFromField.count();
            const directToCount = await directToField.count();

            if (directFromCount > 0 && directToCount > 0) {
                const existingFromDate = await getInputValue(directFromField);
                const existingToDate = await getInputValue(directToField);
                if (existingFromDate && existingToDate) {
                    await appendJobLog(job, `KRA prepopulated the return period: ${existingFromDate} to ${existingToDate}`, { progress: 70 });
                } else {
                    await setPortalDateField(directFromField, periodFrom, 'From date');
                    await setPortalDateField(directToField, periodTo, 'To date');
                }
            } else {
                const dateFields = page.locator('input[placeholder*="dd/mm/yyyy" i], input[placeholder*="dd-mm-yyyy" i]');
                const dateFieldCount = await dateFields.count();
                if (dateFieldCount >= 2) {
                    const existingFromDate = await getInputValue(dateFields.nth(0));
                    const existingToDate = await getInputValue(dateFields.nth(1));
                    if (existingFromDate && existingToDate) {
                        await appendJobLog(job, `KRA prepopulated the return period: ${existingFromDate} to ${existingToDate}`, { progress: 70 });
                    } else {
                        await setPortalDateField(dateFields.nth(0), periodFrom, 'From date');
                        await setPortalDateField(dateFields.nth(1), periodTo, 'To date');
                    }
                }
            }

            if (!isNilReturnExplicit && isMriReturn) {
                await mriFilingService.execute(periodFrom, periodTo, rentalIncomeAmount ?? Number.NaN);
            } else {
                // For first returns after rollout (e.g. Non-Resident Individual), KRA requires the
                // onchange handler on txtPeriodFrom to fire so it can call callProcAjax() via DWR.
                // The DWR response may show a confirmation dialog for errorCd=4002; accepting it
                // triggers updateRolloutDateOnAjax(), which is required before fileNilReturn.
                if (isNilReturnExplicit) {
                    const fromField = page.locator('#txtPeriodFrom, input[name="txtPeriodFrom"]').first();
                    if (await fromField.count() > 0) {
                        let rolloutDialogHandled = false;
                        const rolloutDialogHandler = async (dialog: any) => {
                            if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
                                await dialog.accept();
                                rolloutDialogHandled = true;
                            } else {
                                await dialog.dismiss();
                            }
                        };
                        page.on('dialog', rolloutDialogHandler);
                        try {
                            await appendJobLog(job, 'Triggering nil-return period-change DWR flow', { progress: 72 });
                            await fromField.evaluate((input: HTMLInputElement) => {
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                            });
                            // Wait up to 10s for a rollout confirmation dialog.
                            await Promise.race([
                                new Promise<void>((resolve) => {
                                    const check = setInterval(() => {
                                        if (rolloutDialogHandled) {
                                            clearInterval(check);
                                            resolve();
                                        }
                                    }, 100);
                                }),
                                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
                            ]);
                            // Give KRA time to complete updateRolloutDateOnAjax after dialog acceptance.
                            await page.waitForTimeout(rolloutDialogHandled ? 2_000 : 1_000);
                            await appendJobLog(job, `First-return rollout flow completed (dialog handled: ${rolloutDialogHandled})`, { progress: 75 });
                        } finally {
                            page.off('dialog', rolloutDialogHandler);
                        }
                    }
                }

                // Some nil forms (e.g. ToT) use month/year dropdowns instead of date text fields.
                if (isNilReturnExplicit && (payload as any).totYear && (payload as any).totMonth) {
                    const monthSelect = page.locator('select[name*="month" i], select[id*="month" i]').first();
                    const yearSelect = page.locator('select[name*="year" i], select[id*="year" i]').first();
                    if (await monthSelect.count() > 0) {
                        const monthVal = String((payload as any).totMonth).padStart(2, '0');
                        await monthSelect.selectOption({ value: monthVal }).catch(async () => {
                            await monthSelect.selectOption({ label: new Date(2000, (payload as any).totMonth - 1, 1).toLocaleString('en-US', { month: 'long' }) }).catch(() => undefined);
                        });
                        await appendJobLog(job, `Selected nil return month: ${monthVal}`, { progress: 70 });
                    }
                    if (await yearSelect.count() > 0) {
                        await yearSelect.selectOption({ value: String((payload as any).totYear) }).catch(() => undefined);
                        await appendJobLog(job, `Selected nil return year: ${(payload as any).totYear}`, { progress: 70 });
                    }
                }

                // If a nil-return checkbox or zero-turnover field is present, set it.
                if (isNilReturnExplicit) {
                    const nilCheckbox = page.locator('input[type="checkbox"][name*="nil" i], input[type="checkbox"][id*="nil" i]').first();
                    if (await nilCheckbox.count() > 0 && !await nilCheckbox.isChecked().catch(() => true)) {
                        await nilCheckbox.check().catch(() => undefined);
                        await appendJobLog(job, 'Checked nil-return indicator', { progress: 70 });
                    }
                    const turnoverInput = page.locator('input[name*="turnover" i], input[id*="turnover" i]').first();
                    if (await turnoverInput.count() > 0) {
                        await turnoverInput.fill('0').catch(() => undefined);
                    }
                }

                const hasRadios = await page.$$eval('input[type="radio"]', els => els.length > 0).catch(() => false);
                
                if (hasRadios) {
                    const rentalAnswered = await selectRentalPropertyAnswer(page, ownsRentalProperty);
                    if (rentalAnswered) {
                        await appendJobLog(job, `Selected rental-property answer: ${ownsRentalProperty ? 'Yes' : 'No'}`, { progress: 70 });
                    } else {
                        const radioMetadata = await page.$$eval(
                            'input[type="radio"]',
                            (els: HTMLInputElement[]) => els.map((el) => ({
                                name: el.name ?? '',
                                value: el.value ?? '',
                                checked: Boolean(el.checked),
                            }))
                        ).catch(() => []);
                        await appendJobLog(job, `Rental-property radio could not be matched on the form. Available radios: ${JSON.stringify(radioMetadata)}`, {
                            progress: 70,
                            level: 'error',
                        });
                        throw new Error('Could not select the rental-property answer on the nil return form');
                    }
                } else {
                    await appendJobLog(job, `No rental-property question found on this form (expected for non-individual returns).`, { progress: 70 });
                }
            }
        }

        await humanDelay(400, 900);

        // ── Step 11: Submit (handle JS confirmation dialog) ──────────────────────
        await setJobStep(job, 80, isTotReturn ? 'Submitting the ToT return to KRA' : isPayeUpload ? 'Submitting the PAYE return to KRA' : isVatUpload ? 'Submitting the VAT return to KRA' : isMriReturn ? 'Submitting the MRI return to KRA' : 'Submitting the nil return to KRA');

        let submitDialogMessage: string | null = null;
        let postSubmitPortalMessage: string | null = null;
        let receiptPageLinks: Array<{ id: string; href: string; onclick: string; text: string; className: string; tagName?: string }> = [];
        let downloadMeta: { id: string; href: string; onclick: string; text: string; className: string } | undefined;
        const confirmationOnlyDialogPattern = /do\s+you\s+want\s+to\s+upload\s+the\s+form/i;

        for (let submitAttempt = 1; submitAttempt <= (isPayeUpload ? 2 : 1); submitAttempt++) {
            // Set up dialog handler BEFORE clicking submit (KRA shows JS confirm dialogs)
            let dialogAccepted = false;
            const dialogHandler = async (dialog: any) => {
                if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
                    await dialog.accept();
                    dialogAccepted = true;
                } else {
                    await dialog.dismiss();
                }
            };
            page.on('dialog', dialogHandler);

            // KRA MRI uses tabview_switch — inactive tabs keep buttons in DOM but hidden.
            // Playwright .click() fails on "not visible" elements. Use JS click to bypass.
            let submitClicked = false;
            for (let attempt = 0; attempt < 8; attempt++) {
                submitClicked = await page.evaluate(() => {
                    const btn = document.querySelector('#btnSubmit') as HTMLElement;
                    if (btn) { btn.click(); return true; }
                    const alt = document.querySelector('input[value="Submit"], button[type="submit"]') as HTMLElement;
                    if (alt) { alt.click(); return true; }
                    return false;
                });
                if (submitClicked) break;
                await page.waitForTimeout(1000);
            }
            if (!submitClicked) {
                page.off('dialog', dialogHandler);
                const html = await page.content().catch(() => '');
                await appendJobLog(job, `Submit button not found. Page HTML length: ${html.length}`, { progress: 80, level: 'error' });
                throw new Error('Submit button not found on the return form');
            }

            // Also try the old promise-based dialog capture as backup
            submitDialogMessage = await waitForDialogMessage(page, 10_000).catch(() => null);
            if (submitDialogMessage) {
                console.log(`[Worker][${jobId}] KRA dialog: "${submitDialogMessage}"`);
                await appendJobLog(job, `KRA submit dialog: ${submitDialogMessage}`, { progress: 80 });
            }

            postSubmitPortalMessage = await waitForMatchingPortalMessage(
                page,
                isTotReturn ? TURNOVER_TAX_SUBMISSION_ERROR_PATTERNS : isPayeUpload ? PAYE_SUBMISSION_ERROR_PATTERNS : isVatUpload ? VAT_SUBMISSION_ERROR_PATTERNS : [],
                8_000
            );

            const shouldRetryPayeSubmit =
                isPayeUpload
                && submitAttempt === 1
                && !!postSubmitPortalMessage
                && PAYE_RETRYABLE_UPLOAD_ERROR_PATTERNS.some((pattern) => pattern.test(postSubmitPortalMessage ?? ''));

            if (shouldRetryPayeSubmit) {
                page.off('dialog', dialogHandler);
                await appendJobLog(job, `KRA reported the PAYE form was not attached. Re-uploading once before retrying submit.`, {
                    progress: 80,
                    level: 'error',
                });
                await payeFilingService.upload(payload.payeZipUrl!);
                await humanDelay(400, 900);
                continue;
            }

            if (postSubmitPortalMessage && !/acknowledg|receipt/i.test(postSubmitPortalMessage)) {
                await appendJobLog(job, `KRA submit validation message: ${postSubmitPortalMessage}`, { progress: 80, level: 'error' });
                const shouldRetryImmediately =
                    isPayeUpload
                    && submitAttempt === 1
                    && PAYE_RETRYABLE_UPLOAD_ERROR_PATTERNS.some((pattern) => pattern.test(postSubmitPortalMessage ?? ''));

                if (shouldRetryImmediately) {
                    page.off('dialog', dialogHandler);
                    await appendJobLog(job, 'KRA reported the PAYE form was not attached. Returning to the upload form and retrying once.', {
                        progress: 80,
                        level: 'error',
                    });
                    await returnToPayeUploadPage(page, job);
                    await payeFilingService.upload(payload.payeZipUrl!);
                    await humanDelay(400, 900);
                    continue;
                }

                page.off('dialog', dialogHandler);
                throw new Error(postSubmitPortalMessage);
            }

            // ── Handle declaration checkbox + Accept (test-script pattern) ──────────
            const declarationCheckbox = page.locator('input[type="checkbox"]').filter({ visible: true }).first();
            const acceptBtn = page.locator('input[value="Accept"], button:has-text("Accept")').filter({ visible: true }).first();
            if (await declarationCheckbox.count() > 0 && await acceptBtn.count() > 0) {
                await appendJobLog(job, 'Declaration checkbox detected — checking and clicking Accept', { progress: 82 });
                await declarationCheckbox.check();
                await humanDelay(200, 400);
                await acceptBtn.click();
                await page.waitForTimeout(4000);
            } else if (await acceptBtn.count() > 0) {
                await appendJobLog(job, 'Accept button detected — clicking', { progress: 82 });
                await acceptBtn.click();
                await page.waitForTimeout(4000);
            }

            // ── Handle post-submit confirmation / survey dialog ──────────────────────
            // KRA sometimes renders a confirmation/survey dialog after submission. The
            // buttons are often anchors with onclick="accepted()"/"notAccepted()" that
            // are not considered visible in headless Chromium, so we invoke the JS
            // functions directly and wait for the receipt page to settle.
            let confirmationClicked = false;
            for (let confirmAttempt = 0; confirmAttempt < 3; confirmAttempt++) {
                try {
                    const confirmResult = await page.evaluate(() => {
                        const elements = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]'));
                        const yesBtn = elements.find((el) => {
                            const onclick = (el.getAttribute('onclick') || '').toLowerCase();
                            const text = (el.textContent || (el as HTMLInputElement).value || '').trim().toLowerCase();
                            return onclick.includes('accepted()') || onclick.includes('accepted();') || text === 'yes' || text.startsWith('yes ');
                        }) as HTMLElement | undefined;
                        const notNowBtn = elements.find((el) => {
                            const onclick = (el.getAttribute('onclick') || '').toLowerCase();
                            const text = (el.textContent || (el as HTMLInputElement).value || '').trim().toLowerCase();
                            return onclick.includes('notaccepted()') || onclick.includes('notaccepted();') || text === 'not now' || text.includes('not now');
                        }) as HTMLElement | undefined;

                        // Prefer "Yes" when it looks like a submission confirmation;
                        // prefer "Not Now" when it's clearly a survey.
                        if (yesBtn && notNowBtn) {
                            // Survey usually pairs Yes (take survey) with Not Now (dismiss).
                            // We want to proceed to the receipt page, so click Not Now.
                            notNowBtn.click();
                            return 'not-now';
                        }
                        if (yesBtn) {
                            yesBtn.click();
                            return 'yes';
                        }
                        if (notNowBtn) {
                            notNowBtn.click();
                            return 'not-now';
                        }
                        return false;
                    });
                    if (confirmResult) {
                        confirmationClicked = true;
                        await appendJobLog(job, `Post-submit ${confirmResult === 'yes' ? 'confirmation (Yes)' : 'survey dismissed (Not Now)'} detected via JS — clicked`, { progress: 82 });
                        await page.waitForTimeout(confirmResult === 'yes' ? 5000 : 3000);
                        break;
                    }
                } catch (confirmErr: any) {
                    console.log(`[Worker][${jobId}] Confirmation click attempt ${confirmAttempt + 1} failed (non-critical):`, confirmErr.message);
                }
                await page.waitForTimeout(1000);
            }

            // Fallback using Playwright locators (headed mode) if JS evaluation didn't find anything
            if (!confirmationClicked) {
                const yesConfirm = page.locator('a:has-text("Yes"), a.btn:has-text("Yes"), a[onclick*="accepted"], [onclick*="accepted"]').first();
                const notNowConfirm = page.locator('a:has-text("Not Now"), a.btn:has-text("Not Now"), a[onclick*="notAccepted"], [onclick*="notAccepted"]').first();
                try {
                    if (await notNowConfirm.count() > 0) {
                        await appendJobLog(job, 'Post-submit survey (Not Now) detected — clicking', { progress: 82 });
                        await notNowConfirm.click();
                        await page.waitForTimeout(4000);
                    } else if (await yesConfirm.count() > 0) {
                        await appendJobLog(job, 'Post-submit confirmation (Yes) detected — clicking', { progress: 82 });
                        await yesConfirm.click();
                        await page.waitForTimeout(4000);
                    }
                } catch {
                    // ignore
                }
            }

            page.off('dialog', dialogHandler);

            // ── Wait for KRA to confirm the return was submitted successfully ────────
            const successSelectors = [
                'text=Return Receipt Generated',
                'text=Return Submitted successfully',
                'text=Acknowledgement Number',
                'text=Acknowledgment Receipt',
                'text=Acknowledgement Receipt',
                'text=Receipt Number',
            ];

            let receiptPageReady = false;
            try {
                await waitForPortalReadyWithReload(page, job, {
                    description: 'Post-submit receipt page',
                    selectors: successSelectors,
                    timeout: 60_000,
                    reloadAttempts: 0,
                });
                receiptPageReady = true;
            } catch {
                await page.waitForLoadState('domcontentloaded').catch(() => undefined);
            }

            const settledPortalMessage = await waitForMatchingPortalMessage(
                page,
                isTotReturn ? TURNOVER_TAX_SUBMISSION_ERROR_PATTERNS : isPayeUpload ? PAYE_SUBMISSION_ERROR_PATTERNS : isVatUpload ? VAT_SUBMISSION_ERROR_PATTERNS : [],
                6_000
            );
            if (settledPortalMessage) {
                postSubmitPortalMessage = settledPortalMessage;
            }

            // PAYE-specific retry for "form not attached" errors
            const shouldRetryAfterSummary =
                isPayeUpload
                && submitAttempt === 1
                && !!postSubmitPortalMessage
                && PAYE_RETRYABLE_UPLOAD_ERROR_PATTERNS.some((pattern) => pattern.test(postSubmitPortalMessage ?? ''));

            if (shouldRetryAfterSummary) {
                await appendJobLog(job, 'KRA summary page still says the PAYE form was not attached. Returning to the upload form and retrying once.', {
                    progress: 80,
                    level: 'error',
                });
                await returnToPayeUploadPage(page, job);
                await payeFilingService.upload(payload.payeZipUrl!);
                await humanDelay(400, 900);
                continue;
            }

            // If KRA reported any submission error, fail the job immediately.
            if (postSubmitPortalMessage) {
                await captureDebugScreenshot(page, jobId, 'post-submit-error');
                await appendJobLog(job, `KRA submission error: ${postSubmitPortalMessage}`, { progress: 80, level: 'error' });
                throw new Error(postSubmitPortalMessage);
            }

            // If the success page did not appear, fail the job.
            if (!receiptPageReady) {
                await captureDebugScreenshot(page, jobId, 'post-submit-no-success');
                const errorText = await page.$$eval(
                    '.error-message, #errorDiv, [id*="error"], .errormessage, .validation-message, .alert-danger, .text-danger',
                    (els: HTMLElement[]) => els.map((el) => (el.textContent || '').trim()).filter(Boolean).join(' | ')
                ).catch(() => '');

                if (errorText) {
                    await appendJobLog(job, `KRA validation error prevented filing: ${errorText}`, { progress: 80, level: 'error' });
                    throw new Error(`KRA rejected the return: ${errorText}`);
                }

                await appendJobLog(job, 'KRA did not confirm the return was submitted successfully. No receipt page detected.', { progress: 80, level: 'error' });
                throw new Error('KRA did not confirm the return was submitted successfully. No receipt page detected.');
            }

            // Wait a moment for KRA to render the receipt/acknowledgment link
            await page.waitForTimeout(1_500);

            // First try Playwright locators for known KRA receipt link texts/functions.
            // Keep the action selectors (downloadReturnsReceipt/downloadReceipt) before text-only
            // selectors so we don't accidentally match side-menu "Consult and Reprint..." links.
            const receiptLinkSelectors = [
                'a[onclick*="downloadReturnsReceipt" i]',
                'a[href*="downloadReturnsReceipt" i]',
                'a[onclick*="downloadreceipt" i]',
                'a[href*="downloadreceipt" i]',
                'input[onclick*="downloadReturnsReceipt" i]',
                'input[onclick*="downloadreceipt" i]',
                'button[onclick*="downloadReturnsReceipt" i]',
                'button[onclick*="downloadreceipt" i]',
                'a:has-text("Download Returns Receipt")',
                'a:has-text("Download Receipt")',
                'input[value*="Download Returns Receipt" i]',
                'input[value*="Download Receipt" i]',
                '#downloadReceipt',
                '#downloadReturnsReceipt',
            ];

            for (const selector of receiptLinkSelectors) {
                try {
                    // Headless Chromium often reports KRA's receipt links as not visible,
                    // so try without the visibility filter first.
                    const locator = page.locator(selector).first();
                    if (await locator.count() > 0) {
                        const el = await locator.evaluate((node: HTMLElement) => ({
                            id: node.id ?? '',
                            href: node.getAttribute('href') ?? '',
                            onclick: node.getAttribute('onclick') ?? '',
                            text: (node.textContent ?? '').trim(),
                            className: node.className ?? '',
                            tagName: node.tagName.toLowerCase(),
                        }));
                        downloadMeta = el;
                        await appendJobLog(job, `Found receipt link via selector: ${selector}`, { progress: 85 });
                        break;
                    }
                } catch {
                    // try next selector
                }
            }

            // Fallback: inspect all interactive elements but reject nav/error/problem links.
            // Use a scoring system so real download actions beat side-menu text matches.
            if (!downloadMeta) {
                const interactiveElements = await page.$$eval(
                    'a, button, input[type="button"], input[type="submit"]',
                    (els: HTMLElement[]) => els.map((el) => {
                        const inputEl = el as HTMLInputElement;
                        return {
                            id: el.id ?? '',
                            href: el.getAttribute('href') ?? '',
                            onclick: el.getAttribute('onclick') ?? '',
                            text: (el.textContent ?? inputEl.value ?? '').trim(),
                            className: el.className ?? '',
                            tagName: el.tagName.toLowerCase(),
                        };
                    }).filter((el) => el.text.length > 0 || el.onclick.length > 0)
                );
                receiptPageLinks = interactiveElements;
                if (KRA_DEBUG_ARTIFACTS) {
                    console.log(`[Worker][${jobId}] Receipt page interactive elements:`, JSON.stringify(receiptPageLinks, null, 2));
                }

                const problemLinkPatterns = /reportProblem|report\s*problem|contactUs|contact\s*us|help|support|consult|reprint|loadReprintAckDtlsForm|showEReturns|fileReturn|viewEReturns/i;
                const sideMenuClasses = /mainmenu|topmenu|submenu|sidebar/i;
                const navOnclickPatterns = /loadPage|showMenu|javascript:show|javascript:load/i;

                const scoreElement = (link: typeof interactiveElements[0]): number => {
                    const href = link.href.toLowerCase();
                    const onclick = link.onclick.toLowerCase();
                    const text = link.text.toLowerCase();
                    const cls = link.className.toLowerCase();

                    // Reject obvious non-download elements
                    if (problemLinkPatterns.test(href) || problemLinkPatterns.test(onclick) || problemLinkPatterns.test(text)) return -1;
                    if (sideMenuClasses.test(cls)) return -1;
                    if (navOnclickPatterns.test(onclick) && !onclick.includes('download')) return -1;

                    let score = 0;
                    if (onclick.includes('downloadreturnsreceipt')) score += 100;
                    if (onclick.includes('downloadreceipt')) score += 90;
                    if (href.includes('downloadreturnsreceipt')) score += 100;
                    if (href.includes('downloadreceipt')) score += 90;
                    if (link.id.toLowerCase().includes('downloadreceipt')) score += 80;
                    if (text.includes('download returns receipt')) score += 70;
                    if (text.includes('download receipt')) score += 60;
                    if (text.includes('return receipt')) score += 40;
                    if (text.includes('acknowledgment') || text.includes('acknowledgement')) score += 20;
                    if (text.includes('receipt')) score += 30;
                    if (text.includes('print')) score += 10;
                    // Slight penalty for very long text (usually side-menu navigation)
                    if (text.length > 50) score -= 20;
                    return score;
                };

                const scored = interactiveElements
                    .map((link) => ({ link, score: scoreElement(link) }))
                    .filter((item) => item.score > 0)
                    .sort((a, b) => b.score - a.score);

                if (scored.length > 0) {
                    downloadMeta = scored[0].link;
                    await appendJobLog(job, `Selected receipt link by score ${scored[0].score}: ${JSON.stringify(downloadMeta)}`, { progress: 85 });
                }
            }

            // Last resort: if the page exposes a known KRA receipt download function, trigger it directly.
            if (!downloadMeta) {
                const hasReceiptFunction = await page.evaluate(() => {
                    return typeof (window as any).downloadReturnsReceipt === 'function' ||
                           typeof (window as any).downloadReceipt === 'function' ||
                           typeof (window as any).printReturnsReceipt === 'function';
                });
                if (hasReceiptFunction) {
                    downloadMeta = {
                        id: '',
                        href: '',
                        onclick: 'downloadReturnsReceipt()',
                        text: 'Direct receipt function',
                        className: '',
                    } as any;
                }
            }

            break;
        }

        if (!downloadMeta) {
            await captureDebugScreenshot(page, jobId, 'receipt-link-not-found');
            // Capture the receipt page HTML to Cloud Storage so we can inspect the exact link layout.
            if (pwCaptureHelper) {
                try {
                    await pwCaptureHelper.snapshot('post-submit', 'receipt-page-link-not-found');
                    await appendJobLog(job, 'Captured receipt page HTML to Cloud Storage for analysis', { progress: 80 });
                } catch (captureErr: any) {
                    console.warn(`[Worker][${jobId}] Failed to capture receipt page HTML:`, captureErr.message);
                }
            }
            const receiptHtml = await page.content().catch(() => '');
            await appendJobLog(job, `No valid receipt download link found on the post-submit page. Available links: ${JSON.stringify(receiptPageLinks)}`, { progress: 80, level: 'error' });
            if (receiptHtml) {
                await appendJobLog(job, `Receipt page HTML (truncated): ${receiptHtml.slice(0, 4000)}`, { progress: 80, level: 'info' });
            }
            throw new Error('Could not locate the receipt download link on the KRA receipt page');
        }

        console.log(`[Worker][${jobId}] Found download link: id="${downloadMeta.id}", onclick="${downloadMeta.onclick}", href="${downloadMeta.href}", text="${downloadMeta.text}"`);

        const receiptNumber = await extractReceiptNumber(page);
        if (receiptNumber) {
            await appendJobLog(job, `Receipt number detected: ${receiptNumber}`, { progress: 90 });
        }

        await navigationDelay();

        // ── Step 12: Close iTax Survey / confirmation popup if present ───────────
        // KRA sometimes shows a survey/confirmation modal that blocks the receipt download link.
        try {
            const popupDismissed = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]'));
                // Prefer "Not Now" to dismiss surveys; prefer "Yes"/"accepted" if we still
                // need to confirm the submission.
                const notNowBtn = elements.find((el) => {
                    const onclick = (el.getAttribute('onclick') || '').toLowerCase();
                    const text = (el.textContent || (el as HTMLInputElement).value || '').trim().toLowerCase();
                    return onclick.includes('notaccepted()') || text === 'not now' || text.includes('not now');
                }) as HTMLElement | undefined;
                if (notNowBtn) {
                    notNowBtn.click();
                    return 'not-now';
                }
                const yesBtn = elements.find((el) => {
                    const onclick = (el.getAttribute('onclick') || '').toLowerCase();
                    const text = (el.textContent || (el as HTMLInputElement).value || '').trim().toLowerCase();
                    return onclick.includes('accepted()') || text === 'yes' || text.startsWith('yes ');
                }) as HTMLElement | undefined;
                if (yesBtn) {
                    yesBtn.click();
                    return 'yes';
                }
                return false;
            });
            if (popupDismissed) {
                await appendJobLog(job, `Dismissed iTax ${popupDismissed === 'yes' ? 'confirmation' : 'survey'} popup`, { progress: 90 });
                await page.waitForTimeout(2000);
            }
        } catch (surveyErr: any) {
            console.log(`[Worker][${jobId}] Survey dismissal attempt failed (non-critical):`, surveyErr.message);
        }

        // ── Step 13: Download PDF acknowledgment receipt ─────────────────────────
        await setJobStep(job, 90, 'Waiting for the acknowledgment receipt download');

        const receiptDateStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        const receiptFileName = `${receiptDateStr}_${kraPin}_${taxObligationType}_Receipt.pdf`;
        const receiptPath = path.join(TMP_DIR, receiptFileName);

        // Build a precise selector from the actual element attributes or visible text
        let downloadSelector: string;
        if (downloadMeta.id) {
            downloadSelector = `#${downloadMeta.id}`;
        } else if (downloadMeta.onclick) {
            downloadSelector = `[onclick*="${downloadMeta.onclick.slice(0, 40).replace(/"/g, '\\"')}"]`;
        } else if (downloadMeta.href) {
            downloadSelector = `[href*="${downloadMeta.href.slice(0, 40).replace(/"/g, '\\"')}"]`;
        } else if (downloadMeta.text) {
            const tag = (downloadMeta as any).tagName || 'a';
            downloadSelector = `${tag}:has-text("${downloadMeta.text.slice(0, 40).replace(/"/g, '\\"')}")`;
        } else {
            downloadSelector = 'a, button, input[type="button"]';
        }
        console.log(`[Worker][${jobId}] Using download selector: ${downloadSelector}`);

            let receiptDownloaded = false;
        try {
            // KRA's receipt link may use href="javascript:downloadReturnsReceipt()" which does not
            // trigger Playwright's download event. Intercept the PDF/form-post response, listen
            // for a native download event, and watch for popups as fallbacks.
            let responseResolved = false;
            let downloadResolved = false;
            let popupResolved = false;

            const pdfResponsePromise = new Promise<any>((resolve) => {
                const handler = async (response: any) => {
                    const contentType = (await response.headerValue('content-type') || '').toLowerCase();
                    const url = response.url().toLowerCase();
                    const isPdf = contentType.includes('pdf') ||
                        contentType.includes('octet-stream') ||
                        url.includes('.pdf') ||
                        url.includes('downloadreturnsreceipt') ||
                        url.includes('downloadreceipt') ||
                        url.includes('returnsreceipt') ||
                        url.includes('receipt');
                    if (isPdf) {
                        responseResolved = true;
                        page.off('response', handler);
                        resolve(response);
                    }
                };
                page.on('response', handler);
                // Safety timeout so we don't hang if no response matches
                setTimeout(() => {
                    if (!responseResolved) {
                        page.off('response', handler);
                        resolve(null);
                    }
                }, 60_000);
            });

            const downloadEventPromise = new Promise<any>((resolve) => {
                const timeout = setTimeout(() => {
                    if (!downloadResolved) {
                        page.off('download', downloadHandler);
                        resolve(null);
                    }
                }, 60_000);
                const downloadHandler = async (download: any) => {
                    downloadResolved = true;
                    clearTimeout(timeout);
                    page.off('download', downloadHandler);
                    resolve(download);
                };
                page.on('download', downloadHandler);
            });

            const popupPromise = new Promise<any>((resolve) => {
                const timeout = setTimeout(() => {
                    if (!popupResolved) {
                        page.off('popup', popupHandler);
                        resolve(null);
                    }
                }, 60_000);
                const popupHandler = async (popup: any) => {
                    popupResolved = true;
                    clearTimeout(timeout);
                    page.off('popup', popupHandler);
                    resolve(popup);
                };
                page.on('popup', popupHandler);
            });

            // Use JS click to bypass visibility checks on hidden tab/menu links.
            // Prefer directly invoking KRA's known receipt download function whenever
            // the element points to it.
            let clicked = false;
            const shouldUseDirectFunction =
                downloadMeta.text === 'Direct receipt function' ||
                (downloadMeta.onclick || '').toLowerCase().includes('downloadreturnsreceipt') ||
                (downloadMeta.onclick || '').toLowerCase().includes('downloadreceipt') ||
                (downloadMeta.href || '').toLowerCase().includes('downloadreturnsreceipt') ||
                (downloadMeta.href || '').toLowerCase().includes('downloadreceipt');

            if (shouldUseDirectFunction) {
                clicked = await page.evaluate(() => {
                    try {
                        if (typeof (window as any).downloadReturnsReceipt === 'function') {
                            (window as any).downloadReturnsReceipt();
                            return true;
                        }
                        if (typeof (window as any).downloadReceipt === 'function') {
                            (window as any).downloadReceipt();
                            return true;
                        }
                        if (typeof (window as any).printReturnsReceipt === 'function') {
                            (window as any).printReturnsReceipt();
                            return true;
                        }
                        return false;
                    } catch {
                        return false;
                    }
                });
            }

            if (!clicked) {
                clicked = await page.evaluate((sel) => {
                    const el = document.querySelector(sel) as HTMLElement;
                    if (el) { el.click(); return true; }
                    return false;
                }, downloadSelector);
            }

            if (!clicked) {
                throw new Error('Receipt download link not found or not clickable');
            }

            // Race response interception, native download event, and popup detection
            const pdfResponse = await pdfResponsePromise;
            const downloadEvent = await downloadEventPromise;
            const popupPage = await popupPromise;

            if (pdfResponse) {
                const buffer = await pdfResponse.body();
                await fs.writeFile(receiptPath, buffer);
                receiptDownloaded = true;
                console.log(`[Worker][${jobId}] Receipt saved via response interception: ${receiptPath}`);
            } else if (downloadEvent) {
                await downloadEvent.saveAs(receiptPath);
                receiptDownloaded = true;
                console.log(`[Worker][${jobId}] Receipt saved via download event: ${receiptPath}`);
            } else if (popupPage) {
                // Receipt opened in a popup/tab; wait for it to load and capture the PDF response
                await popupPage.waitForLoadState('domcontentloaded').catch(() => undefined);
                const popupUrl = popupPage.url().toLowerCase();
                await appendJobLog(job, `Receipt opened in popup: ${popupUrl}`, { progress: 91 });
                try {
                    const popupResponse = await popupPage.waitForResponse(
                        (response: any) => {
                            const url = response.url().toLowerCase();
                            const ct = (response.headerValue('content-type') || '').toLowerCase();
                            return ct.includes('pdf') || ct.includes('octet-stream') || url.includes('.pdf') || url.includes('receipt');
                        },
                        { timeout: 15_000 }
                    );
                    const buffer = await popupResponse.body();
                    await fs.writeFile(receiptPath, buffer);
                    receiptDownloaded = true;
                    console.log(`[Worker][${jobId}] Receipt saved via popup response interception: ${receiptPath}`);
                } catch (popupErr: any) {
                    // If no PDF response, try printing the popup to PDF as last resort
                    await popupPage.pdf({ path: receiptPath, format: 'A4' });
                    receiptDownloaded = true;
                    console.log(`[Worker][${jobId}] Receipt saved via popup print-to-PDF: ${receiptPath}`);
                }
                await popupPage.close().catch(() => undefined);
            } else {
                // Last resort: wait briefly then check if the current page itself is now a PDF
                await page.waitForTimeout(3000);
                const currentUrl = page.url().toLowerCase();
                if (currentUrl.includes('.pdf') || currentUrl.includes('receipt')) {
                    const mainResponse = await page.waitForResponse(
                        (response: any) => response.url().toLowerCase() === currentUrl,
                        { timeout: 10_000 }
                    ).catch(() => null);
                    if (mainResponse) {
                        const buffer = await mainResponse.body();
                        await fs.writeFile(receiptPath, buffer);
                        receiptDownloaded = true;
                        console.log(`[Worker][${jobId}] Receipt saved from current page navigation: ${receiptPath}`);
                    }
                }
                if (!receiptDownloaded) {
                    throw new Error('No PDF response detected after clicking receipt link');
                }
            }

            // Validate the saved file is actually a PDF
            if (receiptDownloaded) {
                const fileBuffer = await fs.readFile(receiptPath).catch(() => Buffer.alloc(0));
                const header = fileBuffer.slice(0, 8);
                if (!header.toString().startsWith('%PDF')) {
                    await fs.unlink(receiptPath).catch(() => {});
                    receiptDownloaded = false;
                    throw new Error(`Downloaded receipt is not a valid PDF (header: ${header.toString('hex')}). Likely a KRA error or HTML page was captured.`);
                }
                await appendJobLog(job, `Receipt PDF validated and saved`, { progress: 92 });
            }
        } catch (downloadErr: any) {
            await captureDebugScreenshot(page, jobId, 'receipt-download-failed');
            console.error(`[Worker][${jobId}] Receipt download failed:`, downloadErr.message);
            await appendJobLog(job, `Receipt download failed: ${downloadErr.message}. The return may have been filed, but without a receipt the job cannot be marked successful.`, { progress: 90, level: 'error' });
            throw new Error(`Receipt download failed: ${downloadErr.message}`);
        }

        // ── Step 13: Inline PRN generation after successful filing ───────────────────
        // MUST happen before closing the browser because PRN generation uses the page.
        let prnResults: Array<{ taxType: TaxObligationType; prnPath?: string; prnGcsPath?: string; error?: string }> = [];
        if (!isNilReturnExplicit && (isPayeUpload || isTotReturn || isMriReturn || isVatUpload)) {
            await setJobStep(job, 96, 'Generating Payment Registration Number (PRN) inline');
            try {
                prnResults = await generatePrnAfterFiling(
                    job,
                    page,
                    kraPin,
                    payload.periodFrom || '',
                    payload.periodTo || '',
                    taxObligationType
                );
                if (prnResults.length > 0) {
                    await jobStore.updateJob(jobId, {
                        'result.prnResults': prnResults,
                    } as any);
                }
            } catch (prnErr: any) {
                console.error(`[Worker][${jobId}] PRN generation error:`, prnErr.message);
                await appendJobLog(job, `PRN generation error: ${prnErr.message}`, { progress: 96, level: 'info' });
            }
        }

        // Clean up browser resources before network I/O
        if (context) {
            await context.close();
        }
        if (browser) {
            await browser.close();
        }
        context = undefined;
        browser = undefined;

        // ── Step 14: Store receipt in the workspace ───────────────────────────────
        let storedReceiptPath: string | null = null;
        let receiptRelativePath: string | null = null;
        let receiptGcsPath: string | null = null;
        let receiptSignedUrl: string | undefined;
        if (receiptDownloaded) {
            await setJobStep(job, 94, 'Storing the receipt in the workspace');
            const result = await storeReceiptLocally(receiptPath, jobId);
            storedReceiptPath = result.receiptPath;
            receiptRelativePath = result.relativePath.replace(/\\/g, '/');
            await appendJobLog(job, `Receipt stored locally at ${result.relativePath}`, { progress: 94 });

            // Upload receipt to Cloud Storage so the API can serve it
            try {
                receiptGcsPath = gcsReceiptPath(userId, payload.clientId || 'unknown', jobId, path.basename(storedReceiptPath));
                await uploadFile(storedReceiptPath, receiptGcsPath, { contentType: 'application/pdf' });
                await jobStore.updateJob(jobId, {
                    'artifacts.receiptGcsPath': receiptGcsPath,
                } as any);
                await appendJobLog(job, `Receipt uploaded to Cloud Storage: ${receiptGcsPath}`, { progress: 94 });
            } catch (uploadErr: any) {
                console.error(`[Worker][${jobId}] Failed to upload receipt to GCS:`, uploadErr.message);
                await appendJobLog(job, `Receipt upload to Cloud Storage failed: ${uploadErr.message}`, { progress: 94, level: 'info' });
            }
        } else {
            await appendJobLog(job, 'No receipt was downloaded — skipping local storage and Cloud Storage upload', { progress: 94, level: 'info' });
        }

        // Generate signed URL for the receipt so the frontend can download it
        try {
            if (receiptGcsPath) {
                receiptSignedUrl = await getSignedDownloadUrl(receiptGcsPath, 60 * 24 * 7); // 7 days
            }
        } catch (signedUrlErr: any) {
            console.error(`[Worker][${jobId}] Failed to generate receipt signed URL:`, signedUrlErr.message);
        }

        try {
            let obligationCol = '';
            if (taxObligationType === 'turnover_tax') obligationCol = 'tot';
            else if (taxObligationType === 'monthly_rental_income') obligationCol = 'mri';
            else if (taxObligationType === 'vat') obligationCol = 'vat';
            else if (taxObligationType === 'paye') obligationCol = 'paye';
            else if (taxObligationType === 'excise_duty') obligationCol = 'exciseDuty';

            if (obligationCol && payload.clientId) {
                const clientUpdate: Record<string, any> = {
                    [`lastFiled.${obligationCol}`]: new Date().toISOString(),
                    [`status.${obligationCol}`]: 'filed',
                    // Top-level field that the frontend checks for status badges
                    [obligationCol]: 'filed',
                    [`${obligationCol}LastFiledDate`]: new Date().toISOString(),
                };

                // Persist receipt URL so the dashboard can show a download link
                // Prefer the GCS signed URL; fall back to the local API path only in dev
                if (receiptSignedUrl) {
                    clientUpdate[`${obligationCol}ReceiptUrl`] = receiptSignedUrl;
                } else if (receiptRelativePath) {
                    const apiReceiptUrl = receiptRelativePath.replace(/^data\/receipts\//, '/api/receipts/');
                    clientUpdate[`${obligationCol}ReceiptUrl`] = apiReceiptUrl;
                }

                // Persist PRN URLs from inline generation
                if (prnResults.length > 0) {
                    const successfulPrns = prnResults.filter(r => r.prnPath && !r.error);
                    if (successfulPrns.length > 0) {
                        // Store the first successful PRN URL as the primary one
                        const primaryPrn = successfulPrns[0];
                        let prnUrl: string | undefined;
                        try {
                            if (primaryPrn.prnGcsPath) {
                                prnUrl = await getSignedDownloadUrl(primaryPrn.prnGcsPath, 60 * 24 * 7); // 7 days
                            }
                        } catch (e: any) {
                            console.error(`[Worker][${jobId}] Failed to generate client PRN signed URL:`, e.message);
                        }
                        clientUpdate[`${obligationCol}PrnUrl`] = prnUrl || primaryPrn.prnPath!.replace(/\\/g, '/');
                        // Store all PRN results in a sub-field for multi-PRN tracking (e.g. PAYE).
                        // Merge with existing results so partial re-runs do not delete previously
                        // generated PRNs.
                        const clientSnap = await adminDb.collection('clients').doc(payload.clientId).get();
                        const existingResults: Array<{ taxType?: string }> = clientSnap.data()?.payePrnResults || [];
                        const successfulPrnsWithPaths = successfulPrns.filter((r: any) => r.prnGcsPath || r.prnPath);
                        const generatedMap = new Map(successfulPrnsWithPaths.map((r) => [r.taxType, r]));
                        const merged = [
                            ...existingResults.filter((r) => !generatedMap.has(r.taxType as any)),
                            ...successfulPrnsWithPaths.map((r) => ({
                                taxType: r.taxType,
                                prnPath: r.prnPath,
                                prnGcsPath: r.prnGcsPath,
                            })),
                        ];
                        clientUpdate[`${obligationCol}PrnResults`] = merged;
                    }
                }

                // Persist the filing period (e.g. 2026-05) for period-aware tracking
                const periodFrom = payload.periodFrom || '';
                if (periodFrom) {
                    const periodMatch = periodFrom.match(/^(\d{4})-(\d{2})/);
                    if (periodMatch) {
                        const periodKey = `${periodMatch[1]}-${periodMatch[2]}`;
                        clientUpdate[`${obligationCol}Period`] = periodKey;
                        // Append to filedPeriods array if not already present
                        const filedPeriodsField = `filedPeriods.${obligationCol}`;
                        clientUpdate[filedPeriodsField] = FieldValue.arrayUnion(periodKey);
                    }
                }

                await adminDb.collection('clients').doc(payload.clientId).update(clientUpdate);
                await appendJobLog(job, `Updated client ${obligationCol.toUpperCase()} last filed tracking`, { progress: 95 });
            }
        } catch (e) {
            console.error('[Worker] Failed to update client tracking:', e);
        }

        // ── Step 15: Notify user ──────────────────────────────────────────────────
        await setJobStep(job, 98, 'Dispatching completion notification');
        if (storedReceiptPath) {
            await sendReceiptNotification({
                userId,
                jobId,
                kraPin,
                receiptPath: storedReceiptPath,
                completedAt: new Date().toISOString(),
            });
        }

        // Determine the primary PRN path for the return value
        const primaryPrn = prnResults.length > 0
            ? prnResults.find(r => r.prnPath && !r.error)
            : undefined;

        // Generate signed URL for the primary PRN so the frontend can download it
        let prnUrl: string | undefined;
        try {
            if (primaryPrn?.prnGcsPath) {
                prnUrl = await getSignedDownloadUrl(primaryPrn.prnGcsPath, 60 * 24 * 7); // 7 days
            } else if (primaryPrn?.prnPath) {
                prnUrl = primaryPrn.prnPath.replace(/\\/g, '/');
            }
        } catch (signedUrlErr: any) {
            console.error(`[Worker][${jobId}] Failed to generate PRN signed URL:`, signedUrlErr.message);
        }

        await setJobStep(job, 100, 'Job completed successfully');
        console.log(`[Worker][${jobId}] Job completed. Receipt path: ${storedReceiptPath}`);
        return {
            receiptPath: receiptSignedUrl || receiptRelativePath || undefined,
            receiptNumber,
            credentialUpdate,
            prnPath: prnUrl,
            prnResults: prnResults.length > 0 ? prnResults.filter((r) => r.prnPath && !r.error) : undefined,
        };
    } catch (err) {
        const error = err as Error;
        const currentProgress = typeof job.progress === 'number' ? job.progress : null;
        const isCancelled = error instanceof JobCancelledError;

        if (isCancelled) {
            await job.refresh().catch(() => undefined);
            await job.updateData({
                ...job.data,
                cancelledAt: new Date().toISOString(),
            }).catch(() => undefined);
            await appendJobLog(job, `Job cancelled: ${error.message}`, {
                progress: currentProgress ?? undefined,
            });
            console.warn(`[Worker][${jobId ?? 'unknown'}] Job cancelled by operator — closing browser without extra debug capture.`);
        } else {
            await appendJobLog(job, `Job failed: ${error.message}`, {
                progress: currentProgress ?? undefined,
                level: 'error',
            });
            console.warn(`[Worker][${jobId ?? 'unknown'}] Job failed — closing Chrome after capturing debug artifacts.`);
        }

        if (context || browser) {
            try {
                if (!isCancelled) {
                    const failScreenshot = path.join(TMP_DIR, `failure-${jobId}-${Date.now()}.png`);
                    const pages = context ? context.pages() : browser?.contexts().flatMap((browserContext) => browserContext.pages()) ?? [];
                    if (pages.length > 0) {
                        await pages[0].screenshot({ path: failScreenshot, fullPage: true });
                        console.log(`[Worker] Failure screenshot: ${failScreenshot}`);
                    }
                }
            } catch (_) {
                // Ignore screenshot failures so the original job error still propagates.
            }

            try {
                if (context) {
                    await context.close();
                } else if (browser) {
                    await browser.close();
                }
            } catch (_) {
                // Ignore close failures so caller still receives the original error.
            }
        }
        throw err; // Re-throw so caller handles the failure
    } finally {
        // Finalize Playwright capture (upload HAR, console/dialog buffers, manifest).
        if (pwCaptureHelper) {
            try {
                await pwCaptureHelper.dispose();
            } catch (captureErr: any) {
                console.warn(`[Worker][${jobId}] Playwright capture finalization failed:`, captureErr.message);
            }
        }
        if (pwCaptureContext) {
            try {
                await pwCaptureContext.finalize('unknown');
            } catch (manifestErr: any) {
                console.warn(`[Worker][${jobId}] Playwright capture manifest finalization failed:`, manifestErr.message);
            }
        }
    }
}

// ─── Worker Registration ──────────────────────────────────────────────────────



// Minimal HTTP server for Cloud Run health checks â€” only when this file is the entry point
if (require.main === module) {
    import('http').then((http) => {
        const healthPort = Number(process.env.PORT || 8080);
        http.createServer((_req: any, res: any) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'krafiler-worker' }));
        }).listen(healthPort, () => {
            console.log(`[Worker] Health check server listening on port ${healthPort}`);
        });
    });
}

