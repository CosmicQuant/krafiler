import { Page } from 'playwright';
import path from 'path';

export interface PrnConfig {
    periodYear: string;
    periodMonth?: string;
    taxType: string;
    periodFrom?: string;
    kraPin?: string;
    /** Payroll-computed amount for NITA / Affordable Housing Levy PRNs. */
    amount?: number;
}

const TAX_MAPPING: Record<string, { headRegex: RegExp; subHeadRegex: RegExp }> = {
    monthly_rental_income: {
        headRegex: /^Income Tax$/i,
        subHeadRegex: /Rent Income/i,
    },
    paye: {
        headRegex: /^Income Tax$/i,
        subHeadRegex: /PAYE/i,
    },
    turnover_tax: {
        headRegex: /^Income Tax$/i,
        subHeadRegex: /Turnover Tax/i,
    },
    vat: {
        headRegex: /^VAT$/i,
        subHeadRegex: /^\(0201\)\s*Value Added Tax \(VAT\)$/i,
    },
    nita: {
        headRegex: /^Agency Revenue$/i,
        subHeadRegex: /NITA Levy/i,
    },
    affordable_housing: {
        headRegex: /^Agency Revenue$/i,
        subHeadRegex: /Housing Levy/i,
    },
};

const SUB_HEAD_LABEL_MAP: Record<string, string> = {
    vat: 'Value Added Tax (VAT)',
    turnover_tax: 'Turnover Tax',
    monthly_rental_income: 'Rent Income',
    paye: 'Pay As You Earn',
    nita: 'NITA Levy',
    affordable_housing: 'Housing Levy',
};

// KRA uses either the old cmb* IDs or the newer name-based IDs.
const SELECTORS = {
    taxHead: 'select#cmbTaxHead, select[name="taxHeadId"]',
    taxSubHead: 'select#cmbTaxSubHead, select[name="taxSubHeadId"]',
    paymentType: 'select#cmbPaymentType, select[name="paymentTypeId"]',
    taxPeriodYear: 'select#cmbTaxPeriodYear, select[name="taxPeriodYear"]',
    taxPeriodMonth: 'select#cmbTaxPeriodMonth, select[name="taxPeriodMonth"]',
    paymentMode: 'select#cmbPaymentMode, select[name="paymentModeId"]',
    receivingBank: 'select#cmbReceivingBank, select[name="receivingBankId"]',
};

/** Returns the first visible element matching any of the comma-separated selectors. */
async function firstVisible(page: Page, selector: string): Promise<any | null> {
    const locators = selector.split(',').map((s) => page.locator(s.trim()).first());
    for (const loc of locators) {
        try {
            if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
                return loc;
            }
        } catch {
            // ignore
        }
    }
    return null;
}

/** Dispatch a change event on a select element after selecting by regex. */
async function selectOptionByRegex(page: Page, selector: string, regex: RegExp): Promise<boolean> {
    return page.evaluate(
        ({ sel, source, flags }: { sel: string; source: string; flags: string }) => {
            const re = new RegExp(source, flags);
            const elements = Array.from(document.querySelectorAll(sel));
            for (const el of elements) {
                const select = el as HTMLSelectElement;
                if (!select.options) continue;
                for (let i = 0; i < select.options.length; i++) {
                    if (re.test(select.options[i].text.trim())) {
                        select.selectedIndex = i;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
            }
            return false;
        },
        { sel: selector, source: regex.source, flags: regex.flags }
    );
}

/** Dispatch a change event on a select element after selecting by label (partial match). */
async function selectOptionByLabel(page: Page, selector: string, label: string): Promise<boolean> {
    const tryLocator = async (): Promise<boolean> => {
        const loc = await firstVisible(page, selector);
        if (!loc) return false;

        // Try exact Playwright label first.
        try {
            await loc.selectOption({ label });
            return true;
        } catch {
            // Fall back to partial text match via JS evaluation.
            return await loc.evaluate(
                (el: HTMLElement, lbl: string) => {
                    const select = el as HTMLSelectElement;
                    if (!select.options) return false;
                    for (let i = 0; i < select.options.length; i++) {
                        if (select.options[i].text.trim().includes(lbl)) {
                            select.selectedIndex = i;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }
                    }
                    return false;
                },
                label
            );
        }
    };

    try {
        const locatorMatched = await tryLocator();
        if (locatorMatched) return true;
    } catch {
        // fall through to document-level JS
    }

    return page.evaluate(
        ({ sel, label: lbl }: { sel: string; label: string }) => {
            const elements = Array.from(document.querySelectorAll(sel));
            for (const el of elements) {
                const select = el as HTMLSelectElement;
                if (!select.options) continue;
                for (let i = 0; i < select.options.length; i++) {
                    if (select.options[i].text.trim().includes(lbl)) {
                        select.selectedIndex = i;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
            }
            return false;
        },
        { sel: selector, label }
    );
}

/** Dispatch a change event on a select element after selecting by value text. */
async function selectOptionByValueText(page: Page, selector: string, text: string): Promise<boolean> {
    try {
        const loc = await firstVisible(page, selector);
        if (loc) {
            await loc.selectOption({ label: text }).catch(async () => {
                await loc.selectOption({ value: text }).catch(() => {});
            });
            return true;
        }
    } catch {
        // fall through to JS
    }
    return page.evaluate(
        ({ sel, text: txt }: { sel: string; text: string }) => {
            const elements = Array.from(document.querySelectorAll(sel));
            for (const el of elements) {
                const select = el as HTMLSelectElement;
                if (!select.options) continue;
                for (let i = 0; i < select.options.length; i++) {
                    const optionText = select.options[i].text.trim();
                    const optionValue = select.options[i].value.trim();
                    if (optionText === txt || optionValue === txt) {
                        select.selectedIndex = i;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
            }
            return false;
        },
        { sel: selector, text }
    );
}

export async function generatePRNSlip(
    page: Page,
    config: PrnConfig,
    destPath: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
    console.log(`[PRN] Starting PRN generation for ${config.taxType}...`);

    const mapping = TAX_MAPPING[config.taxType];
    if (!mapping) {
        throw new Error(`Unsupported tax type for PRN generation: ${config.taxType}`);
    }

    try {
        // ── Step 1: Navigate via Payments menu ────────────────────────────────────
        // KRA blocks direct URL access to paymentRegistration.htm with an
        // "accessed iTax functionality using direct URL" error. We must use the
        // portal menu like a real user.
        console.log('[PRN] Hovering Payments menu and clicking Payment Registration...');
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const payments = links.find((l) => l.textContent && l.textContent.trim() === 'Payments');
            if (payments) {
                payments.dispatchEvent(new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true }));
            }
        });
        await page.waitForTimeout(2_000);

        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const pr = links.find((l) => l.textContent && l.textContent.trim() === 'Payment Registration');
            if (pr) pr.click();
            else if (typeof (window as any).showPaymentRegForm === 'function') (window as any).showPaymentRegForm();
        });
        await page.waitForTimeout(8_000);

        // ── Step 2: Applicant Type page (Next button) ──────────────────────────────
        const onApplicantType = await page.evaluate(() => {
            return !!document.getElementById('applicantTypeDropDown');
        });

        if (onApplicantType) {
            console.log('[PRN] Applicant Type page detected; selecting Taxpayer and submitting form...');

            // KRA now requires an applicant type to be explicitly chosen before Next works.
            // Bypass the browser confirm() and submit the form directly to the Tax Form action.
            await page.evaluate((pin: string) => {
                const dropdown = document.getElementById('applicantTypeDropDown') as HTMLSelectElement | null;
                if (dropdown) {
                    dropdown.value = 'T'; // Taxpayer
                    dropdown.dispatchEvent(new Event('change', { bubbles: true }));
                }
                const taxpayerPin = document.getElementById('taxpayerPin') as HTMLInputElement | null;
                if (taxpayerPin && pin) {
                    taxpayerPin.value = pin;
                    taxpayerPin.dispatchEvent(new Event('change', { bubbles: true }));
                    taxpayerPin.dispatchEvent(new Event('blur', { bubbles: true }));
                }
                const form = (document as any).prePaymentRegForm as HTMLFormElement | undefined;
                if (form) {
                    form.action = 'paymentRegistration.htm?actionCode=loadPRForm';
                    form.submit();
                }
            }, config.kraPin ?? '');

            // Wait for the Tax Form page to load after form submission.
            await page.waitForFunction(
                () => !!(document.querySelector('select#cmbTaxHead, select[name="taxHeadId"]') || document.querySelector('select#cmbTaxSubHead, select[name="taxSubHeadId"]')),
                { timeout: 60_000 }
            );
        }

        // ── Step 3: Wait for Tax Form ──────────────────────────────────────────────
        console.log('[PRN] Waiting for Tax Form to render...');
        let ready = false;
        try {
            await page.waitForFunction(
                () => {
                    return !!(document.querySelector('select#cmbTaxHead, select[name="taxHeadId"]') || document.querySelector('select#cmbTaxSubHead, select[name="taxSubHeadId"]'));
                },
                { timeout: 60_000 }
            );
            ready = true;
        } catch (e) {
            console.log('[PRN] Tax Form did not render within 60s, checking current URL and reloading once...');
            const currentUrl = page.url();
            console.log(`[PRN] Current URL before reload: ${currentUrl}`);
            await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
            await page.waitForTimeout(5_000);
            await page.waitForFunction(
                () => {
                    return !!(document.querySelector('select#cmbTaxHead, select[name="taxHeadId"]') || document.querySelector('select#cmbTaxSubHead, select[name="taxSubHeadId"]'));
                },
                { timeout: 60_000 }
            );
            ready = true;
        }
        console.log(`[PRN] Tax Form ready: ${ready}`);

        // ── Step 4: Tax Head ───────────────────────────────────────────────────────
        console.log(`[PRN] Selecting Tax Head for ${config.taxType}...`);
        const headLabel = mapping.headRegex.source.replace(/\\/g, '').replace(/\$/g, '').replace(/\^/g, '');
        let headSelected = await selectOptionByLabel(page, SELECTORS.taxHead, headLabel);
        if (!headSelected) {
            headSelected = await selectOptionByRegex(page, SELECTORS.taxHead, mapping.headRegex);
        }
        if (!headSelected) {
            console.warn('[PRN] Could not explicitly select Tax Head; proceeding anyway');
        }
        await page.waitForTimeout(3_000);

        // ── Step 5: Tax Sub Head ───────────────────────────────────────────────────
        console.log(`[PRN] Selecting Tax Sub Head for ${config.taxType}...`);
        let subHeadSelected = false;
        const preferredSubHeadLabel = SUB_HEAD_LABEL_MAP[config.taxType];
        if (preferredSubHeadLabel) {
            subHeadSelected = await selectOptionByLabel(page, SELECTORS.taxSubHead, preferredSubHeadLabel);
        }
        if (!subHeadSelected) {
            subHeadSelected = await selectOptionByRegex(page, SELECTORS.taxSubHead, mapping.subHeadRegex);
        }
        if (!subHeadSelected) {
            const available = await page.evaluate((sel: string) => {
                const select = document.querySelector(sel) as HTMLSelectElement | null;
                return select ? Array.from(select.options).map((o) => o.text).filter(Boolean) : [];
            }, SELECTORS.taxSubHead);
            console.warn(`[PRN] Could not select Tax Sub Head. Available options: ${available.join(' | ')}`);
        }
        await page.waitForTimeout(3_000);

        // ── Step 6: Payment Type ───────────────────────────────────────────────────
        console.log('[PRN] Selecting Payment Type...');
        const paymentTypeSelected = await selectOptionByLabel(page, SELECTORS.paymentType, 'Self Assessment Tax')
            || await selectOptionByLabel(page, SELECTORS.paymentType, 'Self Assessment')
            || await page.evaluate((sel: string) => {
                const elements = Array.from(document.querySelectorAll(sel));
                for (const el of elements) {
                    const select = el as HTMLSelectElement;
                    if (!select.options) continue;
                    for (let i = 0; i < select.options.length; i++) {
                        if (select.options[i].text.includes('Self Assessment')) {
                            select.selectedIndex = i;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }
                    }
                }
                return false;
            }, SELECTORS.paymentType);
        if (!paymentTypeSelected) {
            console.warn('[PRN] Could not select Payment Type');
        }
        await page.waitForTimeout(2_000);

        // ── Step 7: Tax Period ─────────────────────────────────────────────────────
        console.log('[PRN] Selecting Tax Period...');
        const targetYear = config.periodYear || new Date().getFullYear().toString();
        const targetMonth = config.periodMonth || new Date().toLocaleString('default', { month: 'long' });

        await selectOptionByValueText(page, SELECTORS.taxPeriodYear, targetYear);
        await page.waitForTimeout(2_000);
        await selectOptionByValueText(page, SELECTORS.taxPeriodMonth, targetMonth);
        await page.waitForTimeout(3_000);
        console.log(`[PRN] Selected period: ${targetYear} / ${targetMonth}`);

        // ── Step 8: Liability selection ────────────────────────────────────────────
        console.log('[PRN] Searching for pending liabilities list...');
        let hasLiabilities = false;
        try {
            await page.waitForFunction(
                () => {
                    const table = document.getElementById('LiablibilityTbl') as HTMLElement | null;
                    return !!table && table.style.display !== 'none' && !!table.querySelector('input[type="radio"]');
                },
                { timeout: 8_000 }
            );
            hasLiabilities = true;
        } catch {
            console.log('[PRN] No liabilities table found');
        }

        if (hasLiabilities) {
            await page.evaluate(() => {
                const radio =
                    (document.getElementById('liabilityRadio_0') as HTMLInputElement | null) ??
                    (document.querySelector('#LiablibilityTbl input[type="radio"]') as HTMLInputElement | null);
                if (radio) {
                    radio.checked = true;
                    radio.click();
                    radio.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
            await page.waitForTimeout(1_000);
        }

        // ── Step 9: Add Liability row ──────────────────────────────────────────────
        console.log('[PRN] Adding Liability...');
        page.once('dialog', async (dialog) => {
            console.log('[PRN] Add dialog popup:', dialog.message());
            await dialog.accept();
        });

        const addClicked = await page.evaluate(() => {
            const addLink = document.getElementById('a_taxObligationTable') as HTMLElement | null;
            if (addLink) {
                addLink.click();
                return 'a_taxObligationTable';
            }
            const addBtn = document.querySelector('input[value="Add"], button:has-text("Add"), a.subbuttonHome:has-text("Add")') as HTMLElement | null;
            if (addBtn) {
                addBtn.click();
                return 'generic-add-button';
            }
            return 'none';
        });
        console.log(`[PRN] Add click target: ${addClicked}`);
        await page.waitForTimeout(3_000);

        // If KRA shows "Entered amount should be greater than 0", populate the amount field and re-add.
        // For NITA/AHL the amount is payroll-computed and passed via config.amount; otherwise fall back to 1000.
        const amountToEnter = config.amount && config.amount > 0 ? String(Math.round(config.amount)) : '1000';
        const amountSet = await page.evaluate((amount: string) => {
            const amountInput =
                (document.getElementById('in_taxObligationTable_11') as HTMLInputElement | null) ||
                (document.querySelector('input[name*="amount"], input[id*="amount"], input[id*="Amount"]') as HTMLInputElement | null);
            if (amountInput) {
                amountInput.value = amount;
                amountInput.dispatchEvent(new Event('change', { bubbles: true }));
                amountInput.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            return false;
        }, amountToEnter);
        console.log(`[PRN] Amount input set: ${amountSet}`);
        if (amountSet) {
            await page.waitForTimeout(1_500);
            await page.evaluate(() => {
                const addLink = document.getElementById('a_taxObligationTable') as HTMLElement | null;
                if (addLink) addLink.click();
            });
            await page.waitForTimeout(3_000);
        }

        // ── Step 10: Payment Mode and Bank ─────────────────────────────────────────
        console.log('[PRN] Selecting Payment Mode (Other Payment Modes)...');
        await selectOptionByLabel(page, SELECTORS.paymentMode, 'Other Payment Modes').catch(() => {});
        await page.waitForTimeout(2_000);

        console.log('[PRN] Selecting Receiving Bank Name...');
        await page.evaluate((sel: string) => {
            const elements = Array.from(document.querySelectorAll(sel));
            for (const el of elements) {
                const bankSelect = el as HTMLSelectElement;
                if (bankSelect && bankSelect.options.length > 1) {
                    bankSelect.selectedIndex = 1;
                    bankSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        }, SELECTORS.receivingBank);
        await page.waitForTimeout(1_500);

        // ── Step 11: Submit ────────────────────────────────────────────────────────
        console.log('[PRN] Clicking Submit...');
        const dialogHandler = async (dialog: any) => {
            console.log('[PRN] Dialog popup:', dialog.message());
            await dialog.accept();
        };
        page.on('dialog', dialogHandler);

        await page.evaluate(() => {
            const submitBtn = document.querySelector('input[value="Submit"]') as HTMLElement | null;
            if (submitBtn) submitBtn.click();
        });
        await page.waitForTimeout(5_000);

        // ── Step 12: Download PRN Slip ─────────────────────────────────────────────
        console.log('[PRN] Downloading PRN Slip...');
        try {
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 60_000 }),
                page
                    .locator('a:has-text("Download Payment Slip")')
                    .click()
                    .catch(async () => {
                        await page.evaluate(() => {
                            const aTags = Array.from(document.querySelectorAll('a'));
                            const dl = aTags.find((a) => a.textContent && a.textContent.includes('Download Payment Slip'));
                            if (dl) dl.click();
                        });
                    }),
            ]);
            await download.saveAs(destPath);
            console.log('[PRN] Success! Saved PRN to:', destPath);
            page.off('dialog', dialogHandler);
            return { success: true, filePath: destPath };
        } catch (downloadErr: any) {
            console.log('[PRN] Failed to auto-download PRN.', downloadErr.message);
            page.off('dialog', dialogHandler);
            return { success: false, error: downloadErr.message };
        }
    } catch (err: any) {
        console.error('[PRN] PRN generation error:', err);
        return { success: false, error: err.message };
    }
}
