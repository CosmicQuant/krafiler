/**
 * file-paye-nil-existing-flow.ts
 *
 * Uses the exact production Playwright nil-return flow from kraFilingWorker.ts
 * to file a PAYE nil return for April 2026. Captures HAR, network traffic,
 * console logs, and token/state changes for HTTP state-machine porting.
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { chromium } from 'playwright';
import type { BrowserContext, Dialog, Page, Request, Response } from 'playwright';
import { solveCaptchaWithGemma4Buffer } from '../workers/utils/captcha';

const KRA_PORTAL_URL = 'https://itax.kra.go.ke/KRA-Portal/';
const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

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

const TAX_OBLIGATION_PATTERNS: Record<string, RegExp[]> = {
    paye: [/paye/i, /pay\s+as\s+you\s+earn/i],
};

const SUCCESS_SELECTORS = [
    'text=Return Receipt Generated',
    'text=Return Submitted successfully',
    'text=Acknowledgement Number',
    'text=Acknowledgment Receipt',
    'text=Acknowledgement Receipt',
    'text=Receipt Number',
];

interface NetworkEntry {
    url: string;
    method: string;
    requestHeaders: Record<string, string>;
    postData: string | null;
    responseStatus?: number;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
    timestamp: number;
}

interface ConsoleEntry {
    type: string;
    text: string;
    timestamp: number;
    location?: string;
}

interface TokenEntry {
    stage: string;
    url: string;
    tokenKey: string | null;
    timestamp: number;
}

interface StateSnapshot {
    stage: string;
    url: string;
    title: string;
    tokenKey: string | null;
    bodyText: string;
    interactiveElements: any[];
    timestamp: number;
}

function getConfig() {
    return {
        kraPin: process.env.KRA_PIN?.trim() || 'P051699440T',
        kraPassword: process.env.KRA_PASSWORD?.trim() || 'Quriah1!',
        periodFrom: process.env.PERIOD_FROM?.trim() || '01/04/2026',
        periodTo: process.env.PERIOD_TO?.trim() || '30/04/2026',
        ownsRentalProperty: process.env.OWNS_RENTAL_PROPERTY === 'true',
    };
}

function createRunId(): string {
    return `paye-nil-flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function launchBrowser(headless: boolean) {
    const baseOptions = {
        headless,
        slowMo: 200,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--start-maximized', '--disable-blink-features=AutomationControlled'],
    };
    try {
        return await chromium.launch({ ...baseOptions, channel: 'chrome' as any });
    } catch {
        return chromium.launch(baseOptions);
    }
}

async function humanDelay(minMs = 500, maxMs = 1_400): Promise<void> {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function navigationDelay(): Promise<void> {
    return humanDelay(1_500, 3_000);
}

async function waitForAnySelector(page: Page, selectors: string[], timeout = 20_000): Promise<string | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const selector of selectors) {
            const found = await page.locator(selector).first().count().then((c) => c > 0).catch(() => false);
            if (found) return selector;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return null;
}

async function waitForPortalReadyWithReload(
    page: Page,
    options: { description: string; selectors: string[]; timeout?: number; reloadAttempts?: number }
): Promise<void> {
    const { description, selectors, timeout = 20_000, reloadAttempts = 1 } = options;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= reloadAttempts; attempt += 1) {
        try {
            await page.waitForLoadState('domcontentloaded', { timeout });
            const errorSelectors = [...selectors, 'text=An Error Occured', 'text=session has timed out', 'text=page re-submit', 'text=Session Expired'];
            const matched = await waitForAnySelector(page, errorSelectors, timeout);
            if (matched && (matched.includes('Error Occured') || matched.includes('session has timed out') || matched.includes('page re-submit') || matched.includes('Session Expired'))) {
                throw new Error(`KRA displayed an error page while loading ${description}`);
            }
            if (matched) return;
            lastError = new Error(`${description} did not expose the expected UI controls`);
        } catch (error) {
            lastError = error as Error;
        }
        if (attempt < reloadAttempts) {
            console.warn(`[PAYENilFlow] ${description} stalled; reloading page (attempt ${attempt + 1}/${reloadAttempts})`);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
            await navigationDelay();
        }
    }
    throw lastError ?? new Error(`${description} did not finish loading`);
}

async function findMatchingPortalMessage(page: Page, patterns: RegExp[]): Promise<string | null> {
    const candidates = await page.evaluate(() => {
        const texts = new Set<string>();
        const selectors = ['#errorDiv', '.error-message', '.ui-message-error', '.ui-messages-error', '[id*="error"]', '[class*="error"]', 'font[color="red"]'];
        for (const selector of selectors) {
            document.querySelectorAll(selector).forEach((el) => {
                const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
                if (text) texts.add(text);
            });
        }
        (document.body?.innerText ?? '')
            .split(/\r?\n/)
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .forEach((line) => texts.add(line));
        return Array.from(texts);
    });
    return candidates.find((candidate) => patterns.some((pattern) => pattern.test(candidate))) ?? null;
}

async function waitForMatchingPortalMessage(page: Page, patterns: RegExp[], timeout = 8_000): Promise<string | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const message = await findMatchingPortalMessage(page, patterns).catch(() => null);
        if (message) return message;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
}

async function solveLoginCaptcha(page: Page, runId: string): Promise<string> {
    const captchaSelectors = ['#loginCaptcha', '#captchaImg', '#captcha_img', 'img[id*="captcha"]', 'img[src*="GenerateCaptcha"]', 'img[src*="captcha"]'];
    const screenshotPath = path.join(TMP_DIR, `captcha-flow-${runId}.png`);
    for (const selector of captchaSelectors) {
        const captchaElement = await page.$(selector);
        if (!captchaElement) continue;
        const box = await captchaElement.boundingBox();
        if (!box || box.width < 10 || box.height < 10) continue;
        await captchaElement.screenshot({ path: screenshotPath, type: 'png' });
        break;
    }

    const imageBuffer = await fs.readFile(screenshotPath);
    const answer = await solveCaptchaWithGemma4Buffer(imageBuffer, {
        job: { log: async (entry: string) => console.log('[CAPTCHA]', entry), updateProgress: async () => {} } as any,
    });
    return answer;
}

async function performKraLogin(page: Page, config: ReturnType<typeof getConfig>, runId: string): Promise<void> {
    console.log(`[PAYENilFlow] Logging in with PIN ${config.kraPin}`);
    await page.waitForSelector('#logid', { timeout: 20_000 });
    await page.fill('#logid', config.kraPin);

    const continueLink = await page.$('a[href="javascript:CheckPIN();"]');
    if (continueLink) await continueLink.click();
    else await page.evaluate(() => { (globalThis as any).CheckPIN(); });

    const passwordVisible = await page.waitForSelector('input[type="password"]:visible', { timeout: 30_000 }).then(() => true).catch(() => false);
    if (!passwordVisible) {
        const msg = await findMatchingPortalMessage(page, LOGIN_FAILURE_PATTERNS).catch(() => null);
        throw new Error(`PIN validation failed: ${msg ?? 'Password field did not appear'}`);
    }

    await page.fill('input[type="password"]', config.kraPassword);
    const captchaAnswer = await solveLoginCaptcha(page, runId);
    console.log(`[PAYENilFlow] CAPTCHA answer: ${captchaAnswer}`);
    await page.fill('input[name="captcahText"]', captchaAnswer);
    await page.click('#loginButton');

    const postLoginSelector = await Promise.race([
        waitForAnySelector(page, ['#homePageLink', 'a:has-text("Logout")', 'a:has-text("Returns")', 'text=Mobile Number Verification'], 20_000),
        waitForMatchingPortalMessage(page, LOGIN_FAILURE_PATTERNS, 20_000).then((msg) => { if (msg) throw new Error(msg); return null; }),
    ]);
    if (!postLoginSelector) throw new Error('Dashboard did not appear after login');
    console.log('[PAYENilFlow] Login appears successful');
}

async function getInputValue(locator: any): Promise<string> {
    return locator.evaluate((input: HTMLInputElement) => String(input.value ?? '').trim());
}

async function setPortalDateField(locator: any, value: string, label: string): Promise<void> {
    const el = locator.first();
    await el.evaluate((input: HTMLInputElement) => { input.value = ''; }).catch(() => undefined);
    await el.fill(value);
    await el.evaluate((input: HTMLInputElement, val: string) => { input.value = val; input.dispatchEvent(new Event('change', { bubbles: true })); input.dispatchEvent(new Event('blur', { bubbles: true })); }, value).catch(() => undefined);
    console.log(`[PAYENilFlow] Filled ${label}: ${value}`);
}

async function selectOptionByTextPatterns(selectLocator: any, patterns: RegExp[]): Promise<{ value: string; text: string } | null> {
    const options = await selectLocator.evaluate((sel: HTMLSelectElement) =>
        Array.from(sel.options).map((o) => ({ value: o.value, text: (o.textContent ?? '').trim() }))
    );
    const match = options.find((o: any) => patterns.some((p) => p.test(o.text)));
    if (!match) return null;
    await selectLocator.selectOption({ value: match.value });
    return match;
}

async function selectRentalPropertyAnswer(page: Page, ownsRentalProperty: boolean): Promise<boolean> {
    const rentalRow = page.locator('tr:has-text("rental")').first();
    if (await rentalRow.count() > 0) {
        const rowRadios = rentalRow.locator('input[type="radio"]');
        const radioCount = await rowRadios.count();
        if (radioCount >= 2) {
            const targetIndex = ownsRentalProperty ? 0 : 1;
            await rowRadios.nth(targetIndex).check();
            return true;
        }
    }

    const valueCandidates = ownsRentalProperty
        ? ['yes', 'y', 'true', '1']
        : ['no', 'n', 'false', '0'];

    for (const value of valueCandidates) {
        const candidate = page.locator(`input[type="radio"][value="${value}"]`).first();
        if (await candidate.count() > 0) {
            await candidate.check();
            return true;
        }
    }

    const labelText = ownsRentalProperty ? /^yes$/i : /^no$/i;
    const label = page.getByText(labelText).first();
    if (await label.count() > 0) {
        await label.click();
        return true;
    }

    return false;
}

async function extractReceiptNumber(page: Page): Promise<string | null> {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const receiptMatch = bodyText.match(/Acknowledgement\s*Number\s*[:\-]?\s*([A-Z0-9\-/]+)/i) ||
        bodyText.match(/Acknowledgment\s*Number\s*[:\-]?\s*([A-Z0-9\-/]+)/i) ||
        bodyText.match(/Receipt\s*(?:Number|No\.?|#)?\s*[:\-]?\s*([A-Z0-9\-/]+)/i);
    const candidate = receiptMatch?.[1] ?? null;
    if (candidate && candidate.toLowerCase() === 'generated') return null;
    return candidate;
}

async function extractNoticeId(html: string): Promise<string | null> {
    const match = html.match(/loadReceipt&noticeId=([0-9]+)/);
    return match?.[1] ?? null;
}

async function filePayeNilReturn(
    page: Page,
    config: ReturnType<typeof getConfig>,
    runId: string,
    capture: {
        token: (stage: string, url: string, html: string) => void;
        snapshot: (stage: string, page: Page) => Promise<void>;
    }
) {
    console.log('[PAYENilFlow] Navigating to Returns → File Nil Return...');

    // Hover Returns menu and click File Nil Return
    const returnsMenu = page.locator('#returns, a:has-text("Returns"), td:has-text("Returns") a, li:has-text("Returns") a').first();
    if (await returnsMenu.count() > 0) {
        await returnsMenu.hover();
        await page.waitForTimeout(1_500);
        const nilReturnLink = page.locator('a[href*="nilReturn" i], a[href*="NilReturn" i], a:has-text("File Nil Return"), a:has-text("Nil Return")').filter({ visible: true }).first();
        if (await nilReturnLink.count() > 0) {
            await nilReturnLink.click();
            console.log('[PAYENilFlow] Clicked File Nil Return via menu hover');
        }
    }

    // Fallback: trigger via JS if menu did not navigate
    await page.waitForTimeout(1_000);
    const currentUrl = page.url();
    if (!currentUrl.includes('eReturns.htm')) {
        console.log('[PAYENilFlow] Menu did not navigate to eReturns; triggering nilReturn via JS');
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
    }

    await page.waitForURL(/eReturns\.htm/, { timeout: 15_000 }).catch(() => undefined);
    await waitForPortalReadyWithReload(page, {
        description: 'eReturns page',
        selectors: ['select#regType', 'select[name="obligationId"]', 'tr:has-text("Type") select', '#dwnlod_btn_tims'],
        timeout: 20_000,
        reloadAttempts: 1,
    });

    await capture.snapshot('eReturns-obligation-page', page);

    // Log all form metadata
    const allSelects = await page.$$eval('select', (els) =>
        els.map((el) => ({
            id: (el as HTMLSelectElement).id,
            name: (el as HTMLSelectElement).name,
            options: Array.from((el as HTMLSelectElement).options).map((o) => ({ value: o.value, text: (o.textContent ?? '').trim() })),
        }))
    );
    const metaPath = path.join(TMP_DIR, `paye-nil-flow-meta-${runId}.json`);
    await fs.writeFile(metaPath, JSON.stringify(allSelects, null, 2));
    console.log(`[PAYENilFlow] Select metadata saved to: ${metaPath}`);

    // Select type "Self" if present and enabled
    const typeSelectLocator = page.locator('tr').filter({ hasText: 'Type' }).locator('select').locator('visible=true').first();
    try {
        await typeSelectLocator.waitFor({ state: 'visible', timeout: 10_000 });
        const disabled = await typeSelectLocator.isDisabled();
        if (!disabled) {
            const choice = await selectOptionByTextPatterns(typeSelectLocator, [/^self$/i]);
            console.log(`[PAYENilFlow] Selected return type: ${choice?.text} [${choice?.value}]`);
        }
    } catch { /* ignore */ }

    // Select PAYE obligation
    let obligationSelect: any = null;
    let obligationChoice: any = null;
    for (const sel of await page.locator('select').all()) {
        const isDisabled = await sel.isDisabled().catch(() => true);
        if (isDisabled) continue;
        try {
            const choice = await selectOptionByTextPatterns(sel, TAX_OBLIGATION_PATTERNS.paye);
            if (choice) {
                obligationSelect = sel;
                obligationChoice = choice;
                break;
            }
        } catch { continue; }
    }

    if (!obligationSelect || !obligationChoice) {
        throw new Error('Could not find the PAYE tax obligation dropdown');
    }
    console.log(`[PAYENilFlow] Selected PAYE obligation: ${obligationChoice.text} [${obligationChoice.value}]`);

    // Capture token/state before clicking Next
    await capture.snapshot('before-next-click', page);

    // Click Next
    const nextDialogPromise = waitForDialogMessage(page, 10_000);
    await page.locator('#nextBtn:visible, input[value="Next"]:visible, button:has-text("Next"):visible, a:has-text("Next"):visible').first().click();
    console.log('[PAYENilFlow] Clicked Next');

    const nextDialogMessage = await nextDialogPromise;
    if (nextDialogMessage) {
        throw new Error(`KRA blocked the form after obligation selection: ${nextDialogMessage}`);
    }

    await waitForPortalReadyWithReload(page, {
        description: 'Nil return details page',
        selectors: ['#txtPeriodFrom', '#txtPeriodTo', 'input[name="txtPeriodFrom"]', 'input[name="txtPeriodTo"]', '#btnSubmit', 'input[value="Submit"]', 'button:has-text("Next")'],
        timeout: 60_000,
        reloadAttempts: 0,
    });

    await capture.snapshot('nil-return-details-page', page);

    // Period fields are usually readonly/prepopulated; only fill if editable and empty.
    const directFromField = page.locator('#txtPeriodFrom, #periodFrom, input[name="txtPeriodFrom"]').first();
    const directToField = page.locator('#txtPeriodTo, #periodTo, input[name="txtPeriodTo"]').first();
    const directFromCount = await directFromField.count();
    const directToCount = await directToField.count();

    if (directFromCount > 0 && directToCount > 0) {
        const existingFromDate = await getInputValue(directFromField);
        const existingToDate = await getInputValue(directToField);
        if (existingFromDate && existingToDate) {
            console.log(`[PAYENilFlow] KRA prepopulated the return period: ${existingFromDate} to ${existingToDate}`);
        } else {
            await setPortalDateField(directFromField, config.periodFrom, 'From date');
            await setPortalDateField(directToField, config.periodTo, 'To date');
        }
    } else {
        const dateFields = page.locator('input[placeholder*="dd/mm/yyyy" i], input[placeholder*="dd-mm-yyyy" i]');
        const dateFieldCount = await dateFields.count();
        if (dateFieldCount >= 2) {
            const existingFromDate = await getInputValue(dateFields.nth(0));
            const existingToDate = await getInputValue(dateFields.nth(1));
            if (existingFromDate && existingToDate) {
                console.log(`[PAYENilFlow] KRA prepopulated the return period: ${existingFromDate} to ${existingToDate}`);
            } else {
                await setPortalDateField(dateFields.nth(0), config.periodFrom, 'From date');
                await setPortalDateField(dateFields.nth(1), config.periodTo, 'To date');
            }
        }
    }

    // Answer rental property question if present
    const hasRadios = await page.$$eval('input[type="radio"]', (els) => els.length > 0).catch(() => false);
    if (hasRadios) {
        const rentalAnswered = await selectRentalPropertyAnswer(page, config.ownsRentalProperty);
        console.log(`[PAYENilFlow] Rental property answer selected: ${config.ownsRentalProperty ? 'Yes' : 'No'} (answered=${rentalAnswered})`);
    }

    await humanDelay(400, 900);

    // Capture state before submit
    await capture.snapshot('before-submit', page);

    // Submit with dialog handler
    console.log('[PAYENilFlow] Submitting nil return...');
    let submitDialogMessage: string | null = null;
    let dialogAccepted = false;
    const dialogHandler = async (dialog: Dialog) => {
        submitDialogMessage = dialog.message();
        console.log(`[PAYENilFlow] Dialog: ${submitDialogMessage}`);
        if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
            await dialog.accept();
            dialogAccepted = true;
        } else {
            await dialog.dismiss();
        }
    };
    page.on('dialog', dialogHandler);

    let submitClicked = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        submitClicked = await page.evaluate(() => {
            const btn = document.querySelector('#btnSubmit') as HTMLElement;
            if (btn) { btn.click(); return true; }
            const alt = document.querySelector('input[value="Submit"], button[type="submit"]') as HTMLElement;
            if (alt) { alt.click(); return true; }
            return false;
        });
        if (submitClicked) break;
        await page.waitForTimeout(1_000);
    }
    if (!submitClicked) {
        page.off('dialog', dialogHandler);
        throw new Error('Submit button not found on the return form');
    }

    submitDialogMessage = await waitForDialogMessage(page, 10_000).catch(() => null);
    if (submitDialogMessage) {
        console.log(`[PAYENilFlow] Submit dialog: ${submitDialogMessage}`);
    }

    // Handle declaration checkbox + Accept if present
    const declarationCheckbox = page.locator('input[type="checkbox"]').filter({ visible: true }).first();
    const acceptBtn = page.locator('input[value="Accept"], button:has-text("Accept")').filter({ visible: true }).first();
    if (await declarationCheckbox.count() > 0 && await acceptBtn.count() > 0) {
        console.log('[PAYENilFlow] Declaration checkbox detected — checking and clicking Accept');
        await declarationCheckbox.check();
        await humanDelay(200, 400);
        await acceptBtn.click();
        await page.waitForTimeout(4_000);
    } else if (await acceptBtn.count() > 0) {
        console.log('[PAYENilFlow] Accept button detected — clicking');
        await acceptBtn.click();
        await page.waitForTimeout(4_000);
    }

    // Handle post-submit confirmation / survey dialog
    let confirmationClicked = false;
    for (let confirmAttempt = 0; confirmAttempt < 3; confirmAttempt += 1) {
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

                if (yesBtn && notNowBtn) {
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
                console.log(`[PAYENilFlow] Post-submit ${confirmResult === 'yes' ? 'confirmation (Yes)' : 'survey dismissed (Not Now)'} detected via JS — clicked`);
                await page.waitForTimeout(confirmResult === 'yes' ? 5_000 : 3_000);
                break;
            }
        } catch (confirmErr: any) {
            console.log(`[PAYENilFlow] Confirmation click attempt ${confirmAttempt + 1} failed (non-critical):`, confirmErr.message);
        }
        await page.waitForTimeout(1_000);
    }

    if (!confirmationClicked) {
        const yesConfirm = page.locator('a:has-text("Yes"), a.btn:has-text("Yes"), a[onclick*="accepted"], [onclick*="accepted"]').first();
        const notNowConfirm = page.locator('a:has-text("Not Now"), a.btn:has-text("Not Now"), a[onclick*="notAccepted"], [onclick*="notAccepted"]').first();
        try {
            if (await notNowConfirm.count() > 0) {
                console.log('[PAYENilFlow] Post-submit survey (Not Now) detected — clicking');
                await notNowConfirm.click();
                await page.waitForTimeout(4_000);
            } else if (await yesConfirm.count() > 0) {
                console.log('[PAYENilFlow] Post-submit confirmation (Yes) detected — clicking');
                await yesConfirm.click();
                await page.waitForTimeout(4_000);
            }
        } catch {
            // ignore
        }
    }

    page.off('dialog', dialogHandler);

    // Wait for receipt page
    let receiptPageReady = false;
    try {
        await waitForPortalReadyWithReload(page, {
            description: 'Post-submit receipt page',
            selectors: SUCCESS_SELECTORS,
            timeout: 60_000,
            reloadAttempts: 0,
        });
        receiptPageReady = true;
    } catch {
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    }

    await capture.snapshot('post-submit-receipt-page', page);

    const receiptNumber = await extractReceiptNumber(page);
    const noticeId = await extractNoticeId(await page.content());
    if (receiptNumber) {
        console.log(`[PAYENilFlow] Receipt number detected: ${receiptNumber}`);
    }
    if (noticeId) {
        console.log(`[PAYENilFlow] Receipt noticeId detected: ${noticeId}`);
    }

    if (!receiptPageReady) {
        throw new Error('KRA did not confirm the return was submitted successfully. No receipt page detected.');
    }

    // Find receipt download link
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

    let downloadMeta: { id: string; href: string; onclick: string; text: string; className: string; tagName?: string } | undefined;
    for (const selector of receiptLinkSelectors) {
        try {
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
                console.log(`[PAYENilFlow] Found receipt link via selector: ${selector}`);
                break;
            }
        } catch {
            // try next selector
        }
    }

    // Fallback scoring
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

        const problemLinkPatterns = /reportProblem|report\s*problem|contactUs|contact\s*us|help|support|consult|reprint|loadReprintAckDtlsForm|showEReturns|fileReturn|viewEReturns/i;
        const sideMenuClasses = /mainmenu|topmenu|submenu|sidebar/i;
        const navOnclickPatterns = /loadPage|showMenu|javascript:show|javascript:load/i;

        const scoreElement = (link: typeof interactiveElements[0]): number => {
            const href = link.href.toLowerCase();
            const onclick = link.onclick.toLowerCase();
            const text = link.text.toLowerCase();
            const cls = link.className.toLowerCase();
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
            if (text.length > 50) score -= 20;
            return score;
        };

        const scored = interactiveElements
            .map((link) => ({ link, score: scoreElement(link) }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score);

        if (scored.length > 0) {
            downloadMeta = scored[0].link;
            console.log(`[PAYENilFlow] Selected receipt link by score ${scored[0].score}: ${JSON.stringify(downloadMeta)}`);
        }
    }

    // Direct receipt function fallback
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
                tagName: 'a',
            };
        }
    }

    if (!downloadMeta) {
        throw new Error('Could not locate the receipt download link on the KRA receipt page');
    }

    // Dismiss survey/confirmation popup if present before download
    try {
        const popupDismissed = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]'));
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
            console.log(`[PAYENilFlow] Dismissed iTax ${popupDismissed === 'yes' ? 'confirmation' : 'survey'} popup`);
            await page.waitForTimeout(2_000);
        }
    } catch {
        // ignore
    }

    // Download receipt
    const receiptFileName = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}_${config.kraPin}_paye_Receipt.pdf`;
    const receiptPath = path.join(TMP_DIR, receiptFileName);

    let downloadSelector: string;
    if (downloadMeta.id) {
        downloadSelector = `#${downloadMeta.id}`;
    } else if (downloadMeta.onclick) {
        downloadSelector = `[onclick*="${downloadMeta.onclick.slice(0, 40).replace(/"/g, '\\"')}"]`;
    } else if (downloadMeta.href) {
        downloadSelector = `[href*="${downloadMeta.href.slice(0, 40).replace(/"/g, '\\"')}"]`;
    } else if (downloadMeta.text) {
        const tag = downloadMeta.tagName || 'a';
        downloadSelector = `${tag}:has-text("${downloadMeta.text.slice(0, 40).replace(/"/g, '\\"')}")`;
    } else {
        downloadSelector = 'a, button, input[type="button"]';
    }
    console.log(`[PAYENilFlow] Using download selector: ${downloadSelector}`);

    let receiptDownloaded = false;
    let responseResolved = false;
    let downloadResolved = false;
    let popupResolved = false;

    const pdfResponsePromise = new Promise<Response | null>((resolve) => {
        const handler = async (response: Response) => {
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
        setTimeout(() => {
            if (!responseResolved) {
                page.off('response', handler);
                resolve(null);
            }
        }, 60_000);
    });

    const downloadEventPromise = new Promise<{ saveAs(path: string): Promise<void> } | null>((resolve) => {
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

    const popupPromise = new Promise<Page | null>((resolve) => {
        const timeout = setTimeout(() => {
            if (!popupResolved) {
                page.off('popup', popupHandler);
                resolve(null);
            }
        }, 60_000);
        const popupHandler = async (popup: Page) => {
            popupResolved = true;
            clearTimeout(timeout);
            page.off('popup', popupHandler);
            resolve(popup);
        };
        page.on('popup', popupHandler);
    });

    const shouldUseDirectFunction =
        downloadMeta.text === 'Direct receipt function' ||
        (downloadMeta.onclick || '').toLowerCase().includes('downloadreturnsreceipt') ||
        (downloadMeta.onclick || '').toLowerCase().includes('downloadreceipt') ||
        (downloadMeta.href || '').toLowerCase().includes('downloadreturnsreceipt') ||
        (downloadMeta.href || '').toLowerCase().includes('downloadreceipt');

    let clicked = false;
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

    const pdfResponse = await pdfResponsePromise;
    const downloadEvent = await downloadEventPromise;
    const popupPage = await popupPromise;

    if (pdfResponse) {
        const buffer = await pdfResponse.body();
        await fs.writeFile(receiptPath, buffer);
        receiptDownloaded = true;
        console.log(`[PAYENilFlow] Receipt saved via response interception: ${receiptPath}`);
    } else if (downloadEvent) {
        await downloadEvent.saveAs(receiptPath);
        receiptDownloaded = true;
        console.log(`[PAYENilFlow] Receipt saved via download event: ${receiptPath}`);
    } else if (popupPage) {
        await popupPage.waitForLoadState('domcontentloaded').catch(() => undefined);
        const popupUrl = popupPage.url().toLowerCase();
        console.log(`[PAYENilFlow] Receipt opened in popup: ${popupUrl}`);
        try {
            const popupResponse = await popupPage.waitForResponse(
                async (response: Response) => {
                    const url = response.url().toLowerCase();
                    const ct = ((await response.headerValue('content-type')) || '').toLowerCase();
                    return ct.includes('pdf') || ct.includes('octet-stream') || url.includes('.pdf') || url.includes('receipt');
                },
                { timeout: 15_000 }
            );
            const buffer = await popupResponse.body();
            await fs.writeFile(receiptPath, buffer);
            receiptDownloaded = true;
            console.log(`[PAYENilFlow] Receipt saved via popup response interception: ${receiptPath}`);
        } catch (popupErr: any) {
            await popupPage.pdf({ path: receiptPath, format: 'A4' });
            receiptDownloaded = true;
            console.log(`[PAYENilFlow] Receipt saved via popup print-to-PDF: ${receiptPath}`);
        }
        await popupPage.close().catch(() => undefined);
    } else {
        await page.waitForTimeout(3_000);
        const currentUrl = page.url().toLowerCase();
        if (currentUrl.includes('.pdf') || currentUrl.includes('receipt')) {
            const mainResponse = await page.waitForResponse(
                (response: Response) => response.url().toLowerCase() === currentUrl,
                { timeout: 10_000 }
            ).catch(() => null);
            if (mainResponse) {
                const buffer = await mainResponse.body();
                await fs.writeFile(receiptPath, buffer);
                receiptDownloaded = true;
                console.log(`[PAYENilFlow] Receipt saved from current page navigation: ${receiptPath}`);
            }
        }
    }

    if (receiptDownloaded) {
        const fileBuffer = await fs.readFile(receiptPath).catch(() => Buffer.alloc(0));
        const header = fileBuffer.slice(0, 8);
        if (!header.toString().startsWith('%PDF')) {
            await fs.unlink(receiptPath).catch(() => {});
            receiptDownloaded = false;
            throw new Error(`Downloaded receipt is not a valid PDF (header: ${header.toString('hex')})`);
        }
    } else {
        throw new Error('No PDF response detected after clicking receipt link');
    }

    await capture.snapshot('after-receipt-download', page);

    const body = await page.content();
    return {
        success: true,
        message: 'Nil return submitted successfully',
        receiptNumber,
        receiptPath,
        rawResponse: body,
    };
}

async function waitForDialogMessage(page: Page, timeout = 5_000): Promise<string | null> {
    try {
        const dialog = await page.waitForEvent('dialog', { timeout });
        const message = dialog.message();
        await dialog.accept();
        return message;
    } catch {
        return null;
    }
}

async function extractTokenKey(html: string): Promise<string | null> {
    const match = html.match(/<input[^>]+name=["']token_key["'][^>]+value=["']([^"']+)["'][^>]*>/i);
    return match?.[1] ?? null;
}

async function main(): Promise<void> {
    const config = getConfig();
    const runId = createRunId();
    let context: BrowserContext | null = null;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    const requests: NetworkEntry[] = [];
    const responses: Array<{ url: string; status: number; headers: Record<string, string>; timestamp: number }> = [];
    const consoleLogs: ConsoleEntry[] = [];
    const tokenHistory: TokenEntry[] = [];
    const snapshots: StateSnapshot[] = [];
    const startTime = Date.now();

    const harDir = path.join(TMP_DIR, 'har');
    const harPath = path.join(harDir, `paye-nil-flow-${runId}.har`);

    const recordToken = async (stage: string, url: string, html: string) => {
        const tokenKey = await extractTokenKey(html);
        tokenHistory.push({ stage, url, tokenKey, timestamp: Date.now() - startTime });
        console.log(`[PAYENilFlow][Token][${stage}] token_key=${tokenKey ? `${tokenKey.slice(0, 16)}...` : 'null'} url=${url}`);
    };

    const recordSnapshot = async (stage: string, page: Page) => {
        try {
            const html = await page.content();
            const tokenKey = await extractTokenKey(html);
            const url = page.url();
            const title = await page.title().catch(() => '');
            const bodyText = await page.evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 500));
            const interactiveElements = await page.$$eval(
                'input, select, textarea, button, a',
                (els) => els.slice(0, 100).map((el) => {
                    const input = el as HTMLInputElement;
                    return {
                        tag: el.tagName,
                        id: el.id ?? '',
                        name: input.name ?? '',
                        type: input.type ?? '',
                        value: (input.value ?? '').slice(0, 60),
                        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
                        href: el.getAttribute('href') ?? '',
                        onclick: el.getAttribute('onclick') ?? '',
                    };
                })
            );
            snapshots.push({ stage, url, title, tokenKey, bodyText, interactiveElements, timestamp: Date.now() - startTime });
            await recordToken(stage, url, html);
            const snapshotPath = path.join(TMP_DIR, `snapshot-${stage}-${runId}.html`);
            await fs.writeFile(snapshotPath, html);
        } catch (err: any) {
            console.warn(`[PAYENilFlow] Failed to record snapshot ${stage}:`, err.message);
        }
    };

    console.log('[PAYENilFlow] ==================================================');
    console.log(`[PAYENilFlow] Test run: ${runId}`);
    console.log(`[PAYENilFlow] Filing PAYE nil return for April 2026`);
    console.log(`[PAYENilFlow] PIN: ${config.kraPin}`);
    console.log(`[PAYENilFlow] HAR path: ${harPath}`);
    console.log('[PAYENilFlow] ==================================================');

    try {
        await fs.mkdir(TMP_DIR, { recursive: true });
        await fs.mkdir(harDir, { recursive: true });

        browser = await launchBrowser(false);
        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: null,
            acceptDownloads: true,
            locale: 'en-KE',
            timezoneId: 'Africa/Nairobi',
            recordHar: { path: harPath },
        });

        const page = await context.newPage();

        // Capture console logs
        page.on('console', (msg) => {
            consoleLogs.push({
                type: msg.type(),
                text: msg.text(),
                timestamp: Date.now() - startTime,
                location: msg.location()?.url,
            });
        });
        page.on('pageerror', (error) => {
            consoleLogs.push({
                type: 'pageerror',
                text: error.message,
                timestamp: Date.now() - startTime,
            });
        });

        // Capture network requests and responses
        page.on('request', (request: Request) => {
            requests.push({
                url: request.url(),
                method: request.method(),
                requestHeaders: request.headers(),
                postData: request.postData(),
                timestamp: Date.now() - startTime,
            });
        });

        page.on('response', async (response: Response) => {
            const url = response.url();
            const status = response.status();
            const headers = response.headers();
            responses.push({ url, status, headers, timestamp: Date.now() - startTime });

            // Capture response bodies for HTML/text responses for token/state study
            const contentType = (headers['content-type'] || '').toLowerCase();
            if (contentType.includes('text/html') || contentType.includes('text/plain') || url.includes('.dwr')) {
                try {
                    const body = await response.text().catch(() => null);
                    if (body) {
                        const bodyPath = path.join(TMP_DIR, `response-body-${runId}-${Date.now()}-${Buffer.from(url).toString('base64url').slice(0, 24)}.txt`);
                        await fs.writeFile(bodyPath, `URL: ${url}\nStatus: ${status}\n\n${body}`);
                    }
                } catch {
                    // ignore
                }
            }
        });

        await page.goto(KRA_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await waitForPortalReadyWithReload(page, {
            description: 'KRA login page',
            selectors: ['#logid', '#loginButton', 'input[name="captcahText"]'],
            timeout: 20_000,
            reloadAttempts: 1,
        });

        await recordSnapshot('login-page', page);

        await performKraLogin(page, config, runId);
        await navigationDelay();

        await recordSnapshot('post-login-dashboard', page);

        const result = await filePayeNilReturn(page, config, runId, { token: recordToken, snapshot: recordSnapshot });
        const totalMs = Date.now() - startTime;
        const totalSeconds = (totalMs / 1000).toFixed(2);

        console.log('\n[PAYENilFlow] ==================================================');
        console.log(`[PAYENilFlow] Result: ${result.success ? 'SUCCESS' : 'FAILURE'}`);
        console.log(`[PAYENilFlow] Message: ${result.message}`);
        console.log(`[PAYENilFlow] Receipt number: ${result.receiptNumber ?? 'N/A'}`);
        console.log(`[PAYENilFlow] Receipt path: ${result.receiptPath ?? 'N/A'}`);
        console.log(`[PAYENilFlow] Total time: ${totalSeconds}s (${totalMs}ms)`);
        console.log('[PAYENilFlow] ==================================================\n');

        const responseDumpPath = path.join(TMP_DIR, `paye-nil-flow-response-${runId}.html`);
        await fs.writeFile(responseDumpPath, result.rawResponse);
        console.log(`[PAYENilFlow] Raw response saved to: ${responseDumpPath}`);

        const requestsDumpPath = path.join(TMP_DIR, `paye-nil-flow-requests-${runId}.json`);
        await fs.writeFile(requestsDumpPath, JSON.stringify({ requests, responses }, null, 2));
        console.log(`[PAYENilFlow] Captured network requests saved to: ${requestsDumpPath}`);

        const consoleDumpPath = path.join(TMP_DIR, `paye-nil-flow-console-${runId}.json`);
        await fs.writeFile(consoleDumpPath, JSON.stringify(consoleLogs, null, 2));
        console.log(`[PAYENilFlow] Console logs saved to: ${consoleDumpPath}`);

        const tokenDumpPath = path.join(TMP_DIR, `paye-nil-flow-tokens-${runId}.json`);
        await fs.writeFile(tokenDumpPath, JSON.stringify(tokenHistory, null, 2));
        console.log(`[PAYENilFlow] Token history saved to: ${tokenDumpPath}`);

        const snapshotsDumpPath = path.join(TMP_DIR, `paye-nil-flow-snapshots-${runId}.json`);
        await fs.writeFile(snapshotsDumpPath, JSON.stringify(snapshots, null, 2));
        console.log(`[PAYENilFlow] State snapshots saved to: ${snapshotsDumpPath}`);

        console.log('[PAYENilFlow] Browser will stay open for 30 seconds.');
        await new Promise((resolve) => setTimeout(resolve, 30_000));
    } catch (error: any) {
        const totalMs = Date.now() - startTime;
        console.error(`[PAYENilFlow] Test failed after ${(totalMs / 1000).toFixed(2)}s:`, error.message);
        console.error(error.stack);

        const requestsDumpPath = path.join(TMP_DIR, `paye-nil-flow-requests-${runId}.json`);
        await fs.writeFile(requestsDumpPath, JSON.stringify({ requests, responses }, null, 2)).catch(() => undefined);
        console.log(`[PAYENilFlow] Captured network requests saved to: ${requestsDumpPath}`);

        const consoleDumpPath = path.join(TMP_DIR, `paye-nil-flow-console-${runId}.json`);
        await fs.writeFile(consoleDumpPath, JSON.stringify(consoleLogs, null, 2)).catch(() => undefined);

        const tokenDumpPath = path.join(TMP_DIR, `paye-nil-flow-tokens-${runId}.json`);
        await fs.writeFile(tokenDumpPath, JSON.stringify(tokenHistory, null, 2)).catch(() => undefined);

        const snapshotsDumpPath = path.join(TMP_DIR, `paye-nil-flow-snapshots-${runId}.json`);
        await fs.writeFile(snapshotsDumpPath, JSON.stringify(snapshots, null, 2)).catch(() => undefined);

        process.exitCode = 1;
    } finally {
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
    }
}

main();
