/**
 * kraFilingWorker.ts
 *
 * BullMQ worker that processes KRA nil return filing jobs one at a time.
 *
 * Run with:  npm run worker
 *
 * Architecture notes:
 *  - concurrency: 1  — sequential processing prevents KRA portal rate-limits.
 *  - Playwright is initialised fresh per job so a failed job cannot leak
 *    browser state (cookies, sessions) into the next one.
 *  - The KRA password is decrypted in-memory and is NEVER logged or persisted.
 *  - The stealth plugin is applied once at module load (not per job).
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { Worker, Job } from 'bullmq';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { redisConnection, KRA_QUEUE_NAME } from '../queues/kraFilingQueue';
import { decrypt } from '../utils/encryption';
import { uploadReceiptToStorage, cleanupTempFile } from '../utils/storage';
import { sendReceiptNotification } from '../utils/notifications';
import { FilingJob, TaxObligationType } from '../types';

// Apply stealth plugin once at module load
chromium.use(StealthPlugin());

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-flash-latest';

const TAX_OBLIGATION_PATTERNS: Record<TaxObligationType, RegExp[]> = {
    income_tax_resident_individual: [
        /^income\s*tax\s*-\s*resident\s*individual$/i,
        /resident\s*individual/i,
        /^resident\s*individual$/i,
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
        /value\s*added\s*tax/i,
    ],
    paye: [
        /^pay\s*as\s*you\s*earn$/i,
        /^paye$/i,
        /pay\s*as\s*you\s*earn/i,
    ],
    turnover_tax: [
        /^turnover\s*tax$/i,
        /^tot$/i,
        /turnover\s*tax/i,
    ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Waits for a random duration between 3 and 8 seconds to simulate human
 * interaction cadence and reduce the risk of triggering WAF rate limits.
 */
function humanDelay(): Promise<void> {
    const ms = Math.floor(Math.random() * (8_000 - 3_000 + 1)) + 3_000;
    return new Promise((resolve) => setTimeout(resolve, ms));
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

async function solveCaptchaWithGemini(screenshotPath: string, jobId: string): Promise<{ expression: string; answer: string }> {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is required for Gemini captcha extraction');
    }

    const imageBuffer = await fs.readFile(screenshotPath);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            systemInstruction: {
                parts: [
                    {
                        text: 'Extract the KRA Security Stamp arithmetic captcha from screenshots and respond in the exact requested format only.',
                    },
                ],
            },
            contents: [
                {
                    parts: [
                        {
                            inline_data: {
                                mime_type: 'image/png',
                                data: imageBuffer.toString('base64'),
                            },
                        },
                        {
                            text: [
                                'Read the Kenya Revenue Authority login page screenshot.',
                                'Find the Security Stamp arithmetic captcha only.',
                                'Return exactly one line and nothing else in this format:',
                                'expression=<left><operator><right>;answer=<integer>',
                                'Example: expression=78+9;answer=87',
                                'Do not include words, markdown, or explanations.'
                            ].join(' '),
                        },
                    ],
                },
            ],
            generationConfig: {
                responseMimeType: 'text/plain',
                temperature: 0,
                topP: 0.1,
                candidateCount: 1,
                maxOutputTokens: 32,
                mediaResolution: 'MEDIA_RESOLUTION_HIGH',
                thinkingConfig: {
                    thinkingBudget: 0,
                },
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Gemini request failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    const rawText = extractGeminiText(payload);
    const match = rawText.match(/expression\s*=\s*(\d+)\s*([\+\-\*\/])\s*(\d+)\s*;\s*answer\s*=\s*(-?\d+)/i);

    if (!match) {
        throw new Error(`Gemini returned an unexpected captcha format: "${rawText}"`);
    }

    const expression = `${match[1]} ${match[2]} ${match[3]}`;
    const answer = match[4].trim();
    const expectedAnswer = String(solveCaptcha(expression));

    if (answer !== expectedAnswer) {
        throw new Error(`Gemini answer mismatch for job ${jobId}: expression ${expression}, expected ${expectedAnswer}, got ${answer}`);
    }

    return { expression, answer };
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

// ─── Core Job Processor ───────────────────────────────────────────────────────

async function processFilingJob(job: Job<FilingJob>): Promise<void> {
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
    } = payload;

    console.log(`[Worker] Starting job ${jobId} for PIN ${kraPin}`);

    // ── Step 1: Decrypt password in-memory ──────────────────────────────────────
    // The plaintext password exists only in this local scope and is GC'd after
    // the browser session closes.
    const kraPassword = decrypt(encryptedPassword, iv, authTag);

    await fs.mkdir(TMP_DIR, { recursive: true });

    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

    try {
        // ── Step 2: Launch browser with stealth configuration ────────────────────
        await job.updateProgress(5);
        const isHeadless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
        browser = await chromium.launch({
            headless: isHeadless,
            slowMo: isHeadless ? 0 : 400, // slow visible actions so you can watch
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--start-maximized',
            ],
        });

        const context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 },
            acceptDownloads: true,
            locale: 'en-KE',
            timezoneId: 'Africa/Nairobi',
        });

        const page = await context.newPage();

        // ── Step 3: Navigate to KRA iTax portal ─────────────────────────────────
        await job.updateProgress(10);
        console.log(`[Worker][${jobId}] Navigating to KRA portal…`);

        await page.goto('https://itax.kra.go.ke/KRA-Portal/', {
            waitUntil: 'domcontentloaded',
            timeout: 90_000, // KRA portal can be very slow
        });

        // Dump real element IDs/names so we can verify selectors
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

        await humanDelay();

        // ── Step 4: Enter KRA PIN and click Continue ─────────────────────────────
        await job.updateProgress(20);
        console.log(`[Worker][${jobId}] Entering KRA PIN…`);

        await page.waitForSelector('#logid', { timeout: 15_000 });
        await page.fill('#logid', kraPin);

        // "Continue" triggers CheckPIN() — try direct selector first, fall back to JS call
        console.log(`[Worker][${jobId}] Clicking Continue (CheckPIN)…`);
        const checkPinDialogPromise = waitForDialogMessage(page, 10_000);
        const continueFound = await page.$('a[href="javascript:CheckPIN();"]');
        if (continueFound) {
            await continueFound.click();
        } else {
            // Some KRA portal versions render the button differently — call JS directly
            console.log(`[Worker][${jobId}] Continue <a> not found via href selector, calling CheckPIN() via JS…`);
            await page.evaluate(() => { (globalThis as any).CheckPIN(); });
        }
        const checkPinDialogMessage = await checkPinDialogPromise;
        if (checkPinDialogMessage) {
            console.log(`[Worker][${jobId}] KRA dialog: "${checkPinDialogMessage}"`);
        }

        // Wait for the password section to become visible after CheckPIN() AJAX completes.
        // If the PIN is invalid, KRA shows an alert and the password section stays hidden.
        const passwordVisible = await page.waitForSelector('input[type="password"]:visible', { timeout: 30_000 })
            .then(() => true)
            .catch(() => false);

        if (!passwordVisible) {
            const errMsg = checkPinDialogMessage
                ?? await page.$eval('#errorDiv, .error-message, [id*="error"]', (el: any) => el.textContent?.trim()).catch(() => null)
                ?? 'Password section did not appear after CheckPIN(). The KRA PIN may be invalid or inactive.';
            throw new Error(`PIN validation failed: ${errMsg}`);
        }

        await humanDelay();

        // ── Step 5: Enter password ───────────────────────────────────────────────
        await job.updateProgress(30);
        console.log(`[Worker][${jobId}] Entering password…`);

        // Password field id is obfuscated (e.g. #xxZTT9p2wQ) — use type selector
        await page.fill('input[type="password"]', kraPassword);

        await humanDelay();

        // ── Step 6: Solve arithmetic captcha via Gemini vision ───────────────────
        await job.updateProgress(35);
        console.log(`[Worker][${jobId}] Solving captcha via Gemini vision…`);

        await page.waitForSelector('input[name="captcahText"]', { timeout: 10_000 });

        let captchaAnswer = '';

        const captchaSelectors = [
            '#loginCaptcha',
            '#captchaImg',
            '#captcha_img',
            'img[id*="captcha"]',
            'img[src*="GenerateCaptcha"]',
            'img[src*="captcha"]',
        ];

        const screenPath = path.join(TMP_DIR, `captcha-element-${jobId}.png`);
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
            const captchaResult = await solveCaptchaWithGemini(screenPath, jobId);
            captchaAnswer = captchaResult.answer;
            console.log(`[Worker][${jobId}] Gemini parsed captcha: "${captchaResult.expression}" => ${captchaResult.answer}`);
        } catch (e) {
            console.warn(`[Worker][${jobId}] Gemini captcha extraction failed:`, (e as Error).message);
        }

        if (!captchaAnswer) {
            console.warn(`[Worker][${jobId}] Could not solve captcha with Gemini — login will likely fail.`);
        }

        await page.fill('input[name="captcahText"]', captchaAnswer);

        await humanDelay();

        // ── Step 7: Submit login ─────────────────────────────────────────────────
        await job.updateProgress(40);
        console.log(`[Worker][${jobId}] Logging in…`);

        // Login button is <a id="loginButton" href="javascript:submitForm1();">
        await page.click('#loginButton');
        await page.waitForLoadState('domcontentloaded');

        await humanDelay();

        // ── Step 8: Navigate to Returns → File Nil Return ────────────────────────
        await job.updateProgress(50);
        console.log(`[Worker][${jobId}] Opening nil return form…`);

        // Take a screenshot and dump the nav menu so we can discover the real selectors
        const postLoginScreenshot = path.join(TMP_DIR, `post-login-${jobId}.png`);
        await page.screenshot({ path: postLoginScreenshot, fullPage: false });
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

        // Try to find and click the Returns menu — KRA uses various selectors
        // Try: text match, href match, id match
        const returnsLink = await page.$('#returns') ??
            await page.$('a:has-text("Returns")') ??
            await page.$('td:has-text("Returns") a') ??
            await page.$('li:has-text("Returns") a') ??
            await page.$('a[href*="return"]');

        if (returnsLink) {
            console.log(`[Worker][${jobId}] Found Returns menu element, hovering…`);
            await returnsLink.hover();
        } else {
            console.warn(`[Worker][${jobId}] Returns menu element not found by common selectors — trying page text click`);
            await page.getByText('Returns', { exact: true }).first().hover();
        }

        // Wait for "File Nil Return" submenu link
        const nilReturnLink = await page.waitForSelector(
            'a[href*="nilReturn"], a[href*="NilReturn"], a[href*="nil-return"], a:has-text("Nil Return")',
            { timeout: 10_000 }
        );
        await nilReturnLink.click();
        await page.waitForLoadState('domcontentloaded');

        await humanDelay();

        // ── Step 9: Select individual resident income tax obligation ─────────────
        await job.updateProgress(60);
        console.log(`[Worker][${jobId}] Selecting nil return type and tax obligation…`);

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
        console.log(`[Worker][${jobId}] Nil return select metadata:`, JSON.stringify(selectMetadata, null, 2));

        const typeSelect = page.locator('tr:has-text("Type") select').first();
        await typeSelect.waitFor({ timeout: 10_000 });
        const typeSelectDisabled = await typeSelect.isDisabled();
        if (typeSelectDisabled) {
            const currentType = await typeSelect.evaluate((select: any) => ({
                value: String(select.value ?? '').trim(),
                text: String(select.options?.[select.selectedIndex]?.textContent ?? '').trim(),
            }));
            console.log(`[Worker][${jobId}] Return type is locked by KRA: ${currentType.text} [${currentType.value}]`);
        } else {
            const typeChoice = await selectOptionByTextPatterns(typeSelect, [/^self$/i]);
            console.log(`[Worker][${jobId}] Selected return type: ${typeChoice.text} [${typeChoice.value}]`);
        }

        const obligationSelect = page.locator('select#regType, select[name="obligationId"]').first();
        await obligationSelect.waitFor({ timeout: 10_000 });
        const obligationChoice = await selectOptionByTextPatterns(
            obligationSelect,
            TAX_OBLIGATION_PATTERNS[taxObligationType]
        );
        console.log(`[Worker][${jobId}] Selected tax obligation: ${obligationChoice.text} [${obligationChoice.value}]`);

        const nextDialogPromise = waitForDialogMessage(page, 10_000);
        await page.locator('#nextBtn, input[value="Next"], button:has-text("Next"), a:has-text("Next")').first().click();
        const nextDialogMessage = await nextDialogPromise;
        if (nextDialogMessage) {
            console.log(`[Worker][${jobId}] KRA dialog: "${nextDialogMessage}"`);
            throw new Error(nextDialogMessage);
        }
        await page.waitForLoadState('domcontentloaded');

        await humanDelay();

        // ── Step 10: Fill date range and rental property radio ───────────────────
        await job.updateProgress(70);
        console.log(`[Worker][${jobId}] Filling return periods…`);

        const directFromField = page.locator('#periodFrom, input[id*="from" i], input[name*="from" i]').first();
        const directToField = page.locator('#periodTo, input[id*="to" i], input[name*="to" i]').first();
        const directFromCount = await directFromField.count();
        const directToCount = await directToField.count();

        if (directFromCount > 0 && directToCount > 0) {
            await directFromField.fill(periodFrom);
            await directToField.fill(periodTo);
        } else {
            const dateFields = page.locator('input[placeholder*="dd/mm/yyyy" i], input[placeholder*="dd-mm-yyyy" i]');
            const dateFieldCount = await dateFields.count();
            if (dateFieldCount < 2) {
                throw new Error('Could not find From Date and To Date inputs on the nil return form');
            }
            await dateFields.nth(0).fill(periodFrom);
            await dateFields.nth(1).fill(periodTo);
        }

        const rentalValue = ownsRentalProperty ? 'yes' : 'no';
        const rentalRadio = page.locator(`input[name="ownsRental"][value="${rentalValue}"], input[type="radio"][value="${rentalValue}"]`).first();
        if (await rentalRadio.count() > 0) {
            await rentalRadio.click();
        } else {
            console.log(`[Worker][${jobId}] Rental property radio not present on this form — continuing`);
        }

        await humanDelay();

        // ── Step 11: Submit (handle JS confirmation dialog) ──────────────────────
        await job.updateProgress(80);
        console.log(`[Worker][${jobId}] Submitting nil return…`);

        const submitDialogPromise = waitForDialogMessage(page, 10_000);

        await page.locator('#submitBtn, input[value="Submit"], button:has-text("Submit"), a:has-text("Submit")').first().click();
        const submitDialogMessage = await submitDialogPromise;
        if (submitDialogMessage) {
            console.log(`[Worker][${jobId}] KRA dialog: "${submitDialogMessage}"`);
        }

        await page.waitForLoadState('domcontentloaded').catch(() => undefined);

        const receiptButtonVisible = await page.waitForSelector('#downloadReceipt', { timeout: 10_000 })
            .then(() => true)
            .catch(() => false);

        if (submitDialogMessage && !receiptButtonVisible) {
            throw new Error(submitDialogMessage);
        }

        await humanDelay();

        // ── Step 12: Download PDF acknowledgment receipt ─────────────────────────
        await job.updateProgress(90);
        console.log(`[Worker][${jobId}] Waiting for receipt download…`);

        const receiptFileName = `kra-receipt-${jobId}-${Date.now()}.pdf`;
        const receiptPath = path.join(TMP_DIR, receiptFileName);

        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            page.click('#downloadReceipt'),
        ]);

        await download.saveAs(receiptPath);
        console.log(`[Worker][${jobId}] Receipt saved: ${receiptPath}`);

        // Clean up browser resources before network I/O
        await context.close();
        await browser.close();
        browser = undefined;

        // ── Step 13: Upload receipt to cloud storage ──────────────────────────────
        await job.updateProgress(94);
        const { fileUrl } = await uploadReceiptToStorage(receiptPath, jobId);

        // ── Step 14: Remove local temp file ──────────────────────────────────────
        await job.updateProgress(96);
        await cleanupTempFile(receiptPath);

        // ── Step 15: Notify user ──────────────────────────────────────────────────
        await job.updateProgress(98);
        await sendReceiptNotification({
            userId,
            jobId,
            kraPin,
            receiptUrl: fileUrl,
            completedAt: new Date().toISOString(),
        });

        await job.updateProgress(100);
        console.log(`[Worker][${jobId}] Job completed. Receipt URL: ${fileUrl}`);
    } catch (err) {
        // Do NOT close the browser on failure — keep Chrome open so you can see
        // exactly where it stopped and what the page looks like.
        // Chrome will close naturally when the worker process is restarted.
        console.warn(`[Worker][${jobId ?? 'unknown'}] Job failed — Chrome window left open for inspection.`);
        if (browser) {
            // Take a screenshot at the point of failure for debugging
            try {
                const failScreenshot = path.join(TMP_DIR, `failure-${jobId}-${Date.now()}.png`);
                const pages = browser.contexts().flatMap(c => c.pages());
                if (pages.length > 0) {
                    await pages[0].screenshot({ path: failScreenshot });
                    console.log(`[Worker] Failure screenshot: ${failScreenshot}`);
                }
            } catch (_) { /* ignore screenshot errors */ }
        }
        throw err; // Re-throw so BullMQ marks the job as failed and retries
    }
}

// ─── Worker Registration ──────────────────────────────────────────────────────

export const kraFilingWorker = new Worker<FilingJob>(
    KRA_QUEUE_NAME,
    processFilingJob,
    {
        connection: redisConnection,
        /**
         * concurrency: 1 — jobs run sequentially.
         * Running multiple Playwright sessions simultaneously risks IP bans and
         * corrupted KRA portal session state.
         */
        concurrency: 1,
    }
);

kraFilingWorker.on('active', (job) => {
    console.log(`[Worker] Job ${job.id} started`);
});

kraFilingWorker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
});

kraFilingWorker.on('failed', (job, err: Error) => {
    console.error(`[Worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
});

kraFilingWorker.on('progress', (job, progress) => {
    console.log(`[Worker] Job ${job.id} progress: ${progress}%`);
});

kraFilingWorker.on('error', (err: Error) => {
    console.error('[Worker] Worker error:', err.message);
});

console.log(`[Worker] Listening on queue "${KRA_QUEUE_NAME}" (concurrency: 1)`);
