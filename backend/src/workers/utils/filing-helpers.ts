import fs from 'fs/promises';
import path from 'path';
import { Job } from 'bullmq';
import { FilingJob } from '../../types';
import { appendJobLog } from './job-helpers';
import { waitForPortalReadyWithReload, findMatchingPortalMessage, waitForMatchingPortalMessage, waitForDialogMessage, snapshotPageControls } from './portal-helpers';
import { selectOptionByTextPatterns, setPortalDateField } from './form-helpers';

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function resolveUploadArtifactPath(
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
        // Try workspace root first, then fallback to backend-relative path
        const workspaceRoot = path.resolve(__dirname, '../../../../');
        const localPath = path.resolve(workspaceRoot, 'frontend/public', decodeURIComponent(normalizedUrl.substring(1)));
        if (await pathExists(localPath)) {
            return localPath;
        }
        // Fallback for nested backend builds
        const fallbackPath = path.resolve(__dirname, '../../../frontend/public', decodeURIComponent(normalizedUrl.substring(1)));
        if (await pathExists(fallbackPath)) {
            return fallbackPath;
        }
        throw new Error(`Generated ${artifactPrefix.toUpperCase()} artifact not found on disk at: ${localPath} (also checked: ${fallbackPath})`);
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

async function getFileInputValue(locator: any): Promise<string> {
    return locator.evaluate((input: HTMLInputElement) => String(input.value ?? '').trim());
}

export async function waitForFileInputSelection(
    fileInput: any,
    fileName: string,
    timeout = 3_000
): Promise<string> {
    const deadline = Date.now() + timeout;
    let lastValue = '';

    while (Date.now() < deadline) {
        lastValue = await getFileInputValue(fileInput).catch(() => '');
        if (lastValue.toLowerCase().includes(fileName.toLowerCase())) {
            return lastValue;
        }

        await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return lastValue;
}

export async function resolveBestPayeFileInput(page: any): Promise<{
    locator: any;
    metadata: {
        id: string;
        name: string;
        accept: string;
        visible: boolean;
        disabled: boolean;
        label: string;
        rowText: string;
        multiple: boolean;
    };
}> {
    const candidates = await page.evaluate(() => {
        const isVisible = (element: HTMLElement) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        return Array.from(document.querySelectorAll('input[type="file"]'))
            .map((element, index) => {
                const input = element as HTMLInputElement;
                const linkedLabel = input.id
                    ? Array.from(document.querySelectorAll('label')).find((label) => label.getAttribute('for') === input.id) ?? null
                    : null;
                const nearestLabel = input.closest('label');
                const label = (linkedLabel?.textContent ?? nearestLabel?.textContent ?? '').replace(/\s+/g, ' ').trim();
                const rowText = (input.closest('tr, td, div, form')?.textContent ?? '').replace(/\s+/g, ' ').trim();
                const haystack = [input.id, input.name, input.accept, label, rowText].join(' ').toLowerCase();

                let score = 0;
                if (!input.disabled) {
                    score += 100;
                }
                if (isVisible(input)) {
                    score += 40;
                }
                if (/zip|upload|attach|file|browse|choose/.test(haystack)) {
                    score += 25;
                }
                if (/paye|return|form/.test(haystack)) {
                    score += 10;
                }
                if ((input.accept ?? '').toLowerCase().includes('zip')) {
                    score += 20;
                }

                return {
                    index,
                    score,
                    id: input.id ?? '',
                    name: input.name ?? '',
                    accept: input.accept ?? '',
                    visible: isVisible(input),
                    disabled: Boolean(input.disabled),
                    label,
                    rowText,
                    multiple: Boolean(input.multiple),
                };
            })
            .sort((left, right) => right.score - left.score);
    });

    if (!candidates.length) {
        throw new Error('Could not find any file input on the PAYE upload page');
    }

    const bestCandidate = candidates[0];
    return {
        locator: page.locator('input[type="file"]').nth(bestCandidate.index),
        metadata: {
            id: bestCandidate.id,
            name: bestCandidate.name,
            accept: bestCandidate.accept,
            visible: bestCandidate.visible,
            disabled: bestCandidate.disabled,
            label: bestCandidate.label,
            rowText: bestCandidate.rowText,
            multiple: bestCandidate.multiple,
        },
    };
}

export async function selectUploadFile(
    page: any,
    fileInput: any,
    zipPath: string
): Promise<{ method: 'filechooser' | 'input'; triggerLabel: string | null }> {
    const chooserTriggerSelector = [
        'input[type="file"]:visible',
        'label:has(input[type="file"])',
        'label:has-text("Choose File")',
        'label:has-text("Browse")',
        'button:has-text("Choose File")',
        'button:has-text("Browse")',
        'input[type="button"][value*="Choose File" i]',
        'input[type="button"][value*="Browse" i]',
        'input[type="submit"][value*="Choose File" i]',
        'input[type="submit"][value*="Browse" i]',
        'a:has-text("Choose File")',
        'a:has-text("Browse")',
    ].join(', ');

    const chooserTrigger = page.locator(chooserTriggerSelector).first();
    const chooserTriggerCount = await chooserTrigger.count().catch(() => 0);

    if (chooserTriggerCount > 0) {
        const triggerLabel = await chooserTrigger.evaluate((element: HTMLElement) => {
            if (element instanceof HTMLInputElement) {
                return element.value || element.name || element.id || 'visible file input';
            }

            return element.textContent?.replace(/\s+/g, ' ').trim() || element.getAttribute('name') || element.id || 'file chooser trigger';
        }).catch(() => 'file chooser trigger');

        const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 2_500 }).catch(() => null);
        await chooserTrigger.click({ force: true }).catch(async () => {
            await chooserTrigger.click().catch(() => undefined);
        });

        const fileChooser = await fileChooserPromise;
        if (fileChooser) {
            await fileChooser.setFiles(zipPath);
            return { method: 'filechooser', triggerLabel };
        }
    }

    await fileInput.setInputFiles(zipPath);
    return { method: 'input', triggerLabel: null };
}

export async function ensureDeclarationAccepted(page: any): Promise<void> {
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

export async function downloadVatAutoPopulatedReturn(page: any, job: Job<FilingJob>, kraPin: string): Promise<string> {
    // KRA VAT download flow:
    // 1. Button with id="dwnlod_btn_tims" value="Download Autopopulated VAT Return"
    // 2. Click triggers confirm dialog: "Do you want to download pre filled form?"
    // 3. Clicking OK triggers POST to eReturns.htm?actionCode=downloadAmendmentForms
    // 4. Response has Content-Disposition: attachment;filename="..._VAT.zip"

    // ── 1. Set up dialog handler BEFORE anything else ────────────────────────
    let dialogAccepted = false;
    const dialogHandler = async (dialog: any) => {
        const message = dialog.message();
        await appendJobLog(job, `KRA dialog appeared: "${message}" (type: ${dialog.type()})`, { progress: 72 });
        if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
            await dialog.accept();
            dialogAccepted = true;
            await appendJobLog(job, `Accepted ${dialog.type()} dialog`, { progress: 72 });
        } else {
            await dialog.dismiss();
        }
    };
    page.on('dialog', dialogHandler);

    // ── 2. Find the download button by exact ID first ───────────────────────
    // The button has a typo in the ID: "dwnlod_btn_tims" (not "download_btn_tims")
    const exactSelectors = [
        '#dwnlod_btn_tims',
        'input[type="button"][value="Download Autopopulated VAT Return"]',
        'input.submit[type="button"][value*="Autopopulated"]',
    ];

    let trigger: any = null;
    let matchedSelector = '';
    for (const sel of exactSelectors) {
        const candidate = page.locator(sel).filter({ visible: true }).first();
        const count = await candidate.count().catch(() => 0);
        if (count > 0) {
            trigger = candidate;
            matchedSelector = sel;
            break;
        }
    }

    if (!trigger) {
        page.off('dialog', dialogHandler);
        throw new Error('Could not locate the VAT auto-populated return download control (#dwnlod_btn_tims)');
    }

    const triggerLabel = await trigger.evaluate((element: HTMLElement) => {
        if (element instanceof HTMLInputElement) {
            return element.value || element.id || 'download button';
        }
        return element.textContent?.trim() || element.id || 'download button';
    }).catch(() => 'download button');

    await appendJobLog(job, `Found VAT download button: "${triggerLabel}" (selector: ${matchedSelector})`, { progress: 72 });

    const sourceZipPath = path.join(TMP_DIR, `${Date.now()}_${kraPin}_VAT_source.zip`);

    // ── 3. Try native browser download capture first ─────────────────────────
    let download: any = null;
    try {
        [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 45_000 }),
            trigger.click({ force: true }),
        ]);
        await download.saveAs(sourceZipPath);
        await appendJobLog(job, `Downloaded VAT package via browser download event: ${sourceZipPath}`, { progress: 73 });
        page.off('dialog', dialogHandler);
        return sourceZipPath;
    } catch (primaryErr: any) {
        await appendJobLog(job, `Primary download capture failed: ${primaryErr.message}. Trying JS fallback...`, { progress: 72 });
    }

    // ── 4. Fallback: trigger via JS and capture response ────────────────────
    // Set up immediate response body capture so the browser doesn't discard it.
    let capturedBuffer: Buffer | null = null;
    let capturedFilename = `${Date.now()}_${kraPin}_VAT_source.zip`;
    let captured = false;

    const responseHandler = async (response: any) => {
        const url = response.url();
        const headers = response.headers();
        const cd = headers['content-disposition'] || '';
        if (!cd.includes('attachment') && !url.includes('downloadAmendmentForm')) return;

        try {
            const buffer = await response.body();
            capturedBuffer = buffer;
            const filenameMatch = cd.match(/filename="([^"]+)"/);
            if (filenameMatch) {
                capturedFilename = filenameMatch[1].replace(/[:\/\\*?"<>|]/g, '_');
            }
            captured = true;
            await appendJobLog(job, `Captured VAT download response inline: ${buffer.length} bytes`, { progress: 72 });
        } catch (bodyErr: any) {
            await appendJobLog(job, `Failed to read response body inline: ${bodyErr.message}`, { progress: 72, level: 'info' });
        }
    };
    page.on('response', responseHandler);

    try {
        await page.evaluate(() => {
            if (typeof (window as any).downloadAmendmentForm === 'function') {
                (window as any).downloadAmendmentForm('N');
            } else {
                const btn = document.querySelector('#dwnlod_btn_tims') as HTMLElement;
                if (btn) {
                    const onclick = btn.getAttribute('onclick');
                    if (onclick) {
                        const fn = new Function(onclick);
                        fn.call(btn);
                    } else {
                        btn.click();
                    }
                }
            }
        });
        await appendJobLog(job, `Triggered VAT download via JS fallback`, { progress: 72 });

        // Wait up to 15s for the response handler to fire
        const deadline = Date.now() + 15_000;
        while (!captured && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (jsErr: any) {
        page.off('response', responseHandler);
        page.off('dialog', dialogHandler);
        throw new Error(`VAT download JS fallback failed: ${jsErr.message}`);
    }

    page.off('response', responseHandler);
    page.off('dialog', dialogHandler);

    if (!captured || !capturedBuffer) {
        throw new Error('VAT download capture failed after both primary and fallback attempts');
    }

    const finalBuffer = capturedBuffer as Buffer;
    const fallbackPath = path.join(TMP_DIR, capturedFilename);
    await fs.writeFile(fallbackPath, finalBuffer);
    await appendJobLog(job, `Downloaded VAT package via response capture: ${fallbackPath} (${finalBuffer.length} bytes, dialog: ${dialogAccepted ? 'accepted' : 'not shown'})`, { progress: 73 });
    return fallbackPath;
}

export async function fillMonthlyRentalIncomeAmount(
    page: any,
    job: Job<FilingJob>,
    rentalIncomeAmount: number
): Promise<void> {
    if (!Number.isFinite(rentalIncomeAmount) || rentalIncomeAmount <= 0) {
        throw new Error('MRI filing requires a positive rental income amount');
    }

    type VisibleInputCandidate = {
        tag: string;
        id: string;
        name: string;
        type: string;
        placeholder: string;
        value: string;
        readOnly: boolean;
        disabled: boolean;
        visible: boolean;
        rowText: string;
        label: string;
    };

    const candidateMetadata: VisibleInputCandidate[] = await page.evaluate(() => {
        const isVisible = (element: HTMLElement) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        return Array.from(document.querySelectorAll('input, textarea'))
            .map((element) => {
                const input = element as HTMLInputElement | HTMLTextAreaElement;
                const rowText = input.closest('tr, td, div, label')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
                const label = input.id
                    ? document.querySelector(`label[for="${input.id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
                    : '';

                return {
                    tag: input.tagName,
                    id: input.id ?? '',
                    name: input.getAttribute('name') ?? '',
                    type: 'type' in input ? input.type ?? '' : '',
                    placeholder: input.getAttribute('placeholder') ?? '',
                    value: input.value ?? '',
                    readOnly: Boolean((input as HTMLInputElement).readOnly),
                    disabled: Boolean((input as HTMLInputElement).disabled),
                    visible: isVisible(input as HTMLElement),
                    rowText,
                    label,
                };
            })
            .filter((candidate: VisibleInputCandidate) => candidate.visible)
            .filter((candidate: VisibleInputCandidate) => !candidate.disabled && !candidate.readOnly)
            .filter((candidate: VisibleInputCandidate) => !['hidden', 'submit', 'button', 'radio', 'checkbox', 'password'].includes((candidate.type || '').toLowerCase()));
    });

    const rankedCandidate = candidateMetadata.find((candidate: VisibleInputCandidate) => {
        const haystack = [candidate.id, candidate.name, candidate.placeholder, candidate.label, candidate.rowText]
            .join(' ')
            .toLowerCase();

        return /rent|rental|income|gross|amount/.test(haystack) && !/period|from|to|date/.test(haystack);
    }) ?? candidateMetadata.find((candidate: VisibleInputCandidate) => ['number', 'text', ''].includes((candidate.type || '').toLowerCase()));

    if (!rankedCandidate) {
        await appendJobLog(job, `MRI amount field could not be matched. Visible input metadata: ${JSON.stringify(candidateMetadata)}`, {
            progress: 70,
            level: 'error',
        });
        throw new Error('Could not locate the monthly rental income input field');
    }

    let fieldLocator;
    if (rankedCandidate.id) {
        fieldLocator = page.locator(`[id="${rankedCandidate.id}"]`).first();
    } else if (rankedCandidate.name) {
        fieldLocator = page.locator(`[name="${rankedCandidate.name}"]`).first();
    } else {
        fieldLocator = page.locator('input:visible, textarea:visible').first();
    }

    await fieldLocator.fill(String(rentalIncomeAmount));
    await fieldLocator.blur();
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    await appendJobLog(job, `Entered MRI amount ${rentalIncomeAmount} into ${rankedCandidate.name || rankedCandidate.id || rankedCandidate.placeholder || 'the detected amount field'}`, {
        progress: 70,
    });
}

export async function prepareVatPackageFromPortal(
    page: any,
    job: Job<FilingJob>,
    options: {
        kraPin: string;
        clientName: string;
        periodFrom: string;
        periodTo: string;
        previousCredit: number;
    }
) {
    const sourceZipPath = await downloadVatAutoPopulatedReturn(page, job, options.kraPin);
    const artifacts = await import('../../scripts/vat-return-generator').then((mod) =>
        mod.prepareVatReturnArtifacts({
            sourceZipPath,
            clientName: options.clientName,
            taxpayerPin: options.kraPin,
            periodFrom: options.periodFrom,
            periodTo: options.periodTo,
            previousCredit: options.previousCredit,
        })
    );
    await appendJobLog(job, `Prepared VAT upload ZIP ${artifacts.generatedZipLabel}`, { progress: 78 });
    await appendJobLog(job, `VAT summary ready: input ${artifacts.summary.inputVat}, output ${artifacts.summary.outputVat}, previous credit ${artifacts.summary.previousCredit}, net ${artifacts.summary.netVatBalance}`, { progress: 78 });
    return artifacts;
}

export async function uploadVatTaxZip(page: any, job: Job<FilingJob>, vatZipUrl: string): Promise<void> {
    const zipPath = await resolveUploadArtifactPath(vatZipUrl, job.data.jobId, 'vat');
    const fileName = path.basename(zipPath);
    await appendJobLog(job, `Resolved VAT ZIP on disk: ${zipPath}`, { progress: 68 });

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ timeout: 20_000 });
    const uploadMethod = await selectUploadFile(page, fileInput, zipPath);
    const selectedValue = await waitForFileInputSelection(fileInput, fileName, 3_000);

    if (!selectedValue.toLowerCase().includes(fileName.toLowerCase())) {
        const snapshot = await snapshotPageControls(page);
        await appendJobLog(job, `VAT attachment did not stick after ${uploadMethod.method} binding. Page snapshot: ${snapshot}`, {
            progress: 69,
            level: 'error',
        });
        throw new Error(`KRA did not acknowledge VAT ZIP selection for ${fileName}`);
    }

    await ensureDeclarationAccepted(page);
    await appendJobLog(job, `Selected VAT ZIP ${fileName} using ${uploadMethod.method} and accepted the declaration`, {
        progress: 70,
    });
}

export async function uploadPayeTaxZip(page: any, job: Job<FilingJob>, payeZipUrl: string): Promise<void> {
    const zipPath = await resolveUploadArtifactPath(payeZipUrl, job.data.jobId, 'paye');
    const fileName = path.basename(zipPath);
    await appendJobLog(job, `Resolved PAYE ZIP on disk: ${zipPath}`, { progress: 68 });

    const { locator: fileInput, metadata } = await resolveBestPayeFileInput(page);
    await fileInput.waitFor({ timeout: 20_000 });
    await appendJobLog(job, `Using PAYE attachment input ${JSON.stringify(metadata)}`, { progress: 68 });

    const uploadMethod = await selectUploadFile(page, fileInput, zipPath);
    const selectedValue = await waitForFileInputSelection(fileInput, fileName, 3_000);

    if (!selectedValue.toLowerCase().includes(fileName.toLowerCase())) {
        throw new Error(`KRA did not acknowledge PAYE ZIP selection for ${fileName}`);
    }

    await ensureDeclarationAccepted(page);
    await appendJobLog(job, `Selected PAYE ZIP ${fileName} using ${uploadMethod.method} and accepted the declaration`, {
        progress: 70,
    });
}

export async function uploadTurnoverTaxZip(
    page: any,
    job: Job<FilingJob>,
    totYear: number,
    totMonth: number,
    totTurnover: number
): Promise<void> {
    if (!Number.isFinite(totYear) || !Number.isFinite(totMonth) || !Number.isFinite(totTurnover)) {
        throw new Error('Turnover Tax filing requires totYear, totMonth, and totTurnover in the queued job payload');
    }

    const outputDir = path.join(TMP_DIR, 'generated-zips');
    await fs.mkdir(outputDir, { recursive: true });

    const inputSettings = {
        taxPayerPin: job.data.payload.kraPin,
        returnPeriod: { year: totYear, month: totMonth },
        turnover: totTurnover,
        returnType: 'Original' as const
    };

    await appendJobLog(job, `Generating ToT ZIP payload for period ${totMonth}/${totYear} with turnover ${totTurnover}`, {
        progress: 68,
    });

    const resolvedZipPath = await import('../../scripts/kra-tot-generator').then((mod) => mod.packageToTZip(inputSettings, outputDir));
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ timeout: 20_000 });
    await fileInput.setInputFiles(resolvedZipPath);

    await ensureDeclarationAccepted(page);
    await appendJobLog(job, `Uploaded ToT ZIP file ${path.basename(resolvedZipPath)} and accepted the declaration`, {
        progress: 70,
    });
}

export async function prepareForMriPage(
    page: any,
    job: Job<FilingJob>,
    periodFrom: string,
    periodTo: string,
    rentalIncomeAmount: number
): Promise<void> {
    if (!periodFrom || !periodTo) {
        throw new Error('MRI filing requires periodFrom and periodTo');
    }

    if (Number.isFinite(rentalIncomeAmount) && rentalIncomeAmount > 0) {
        await setPortalDateField(page, '#txtPeriodFrom, #periodFrom, input[name="txtPeriodFrom"], input[name*="periodFrom" i]', periodFrom);
        await setPortalDateField(page, '#txtPeriodTo, #periodTo, input[name="txtPeriodTo"], input[name*="periodTo" i]', periodTo);

        await page.locator('input[value="Next"], button:has-text("Next"), a:has-text("Next")').first().click();
        await page.waitForTimeout(4000);
        await fillMonthlyRentalIncomeAmount(page, job, rentalIncomeAmount);
        await page.locator('input[value="Next"], button:has-text("Next"), a:has-text("Next")').first().click();
        await page.waitForTimeout(4000);
    } else {
        throw new Error('MRI filing requires a positive rental income amount');
    }
}

export async function prepareNilReturnPage(
    page: any,
    job: Job<FilingJob>,
    periodFrom: string,
    periodTo: string,
    ownsRentalProperty: boolean
): Promise<void> {
    await setPortalDateField(page, '#txtPeriodFrom, #periodFrom, input[name="txtPeriodFrom"], input[name*="periodFrom" i]', periodFrom);
    await setPortalDateField(page, '#txtPeriodTo, #periodTo, input[name="txtPeriodTo"], input[name*="periodTo" i]', periodTo);

    const radioAnswer = ownsRentalProperty ? 'Yes' : 'No';
    const radio = page.locator(`input[type="radio"][value="${radioAnswer}"]`).first();
    if (await radio.count() > 0) {
        await radio.check();
        return;
    }

    const label = page.locator(`label:has-text("${radioAnswer}")`).first();
    if (await label.count() > 0) {
        await label.click();
        return;
    }

    const candidate = page.locator(`input[type="radio"]`).first();
    if (await candidate.count() > 0) {
        await candidate.check();
        return;
    }

    throw new Error('Could not select the rental property answer on the nil return form');
}
