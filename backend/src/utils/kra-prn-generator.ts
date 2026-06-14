import { Page } from 'playwright';
import path from 'path';

export interface PrnConfig {
    periodYear: string;
    periodMonth?: string;
    taxType: string;
    periodFrom?: string;
}

const TAX_MAPPING: Record<string, { headRegex: RegExp, subHeadRegex: RegExp }> = {
    'monthly_rental_income': {
        headRegex: /^Income Tax$/i,
        subHeadRegex: /Rent Income/i
    },
    'paye': {
        headRegex: /^Income Tax$/i,
        subHeadRegex: /PAYE/i
    },
    'turnover_tax': {
        headRegex: /^Income Tax$/i,
        subHeadRegex: /Turnover Tax/i
    },
    'vat': {
        headRegex: /^VAT$/i,
        subHeadRegex: /^\(0201\)\s*Value Added Tax \(VAT\)$/i
    },
    'nita': {
        headRegex: /^Agency Revenue$/i,
        subHeadRegex: /NITA Levy/i
    },
    'affordable_housing': {
        headRegex: /^Agency Revenue$/i,
        subHeadRegex: /Housing Levy/i
    }
};

export async function generatePRNSlip(
    page: Page,
    config: PrnConfig,
    destPath: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
        console.log(`[PRN] Starting PRN generation for ${config.taxType}...`);

        const mapping = TAX_MAPPING[config.taxType];
        if (!mapping) {
            throw new Error(`Unsupported tax type for PRN generation: ${config.taxType}`);
        }

        console.log('[PRN] Hovering over Payments menu and clicking Payment Registration...');
        await page.waitForTimeout(2000);
        
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const payments = links.find(l => l.textContent && l.textContent.trim() === 'Payments');
            if (payments) {
                payments.dispatchEvent(new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true }));
            }
        });
        await page.waitForTimeout(1000);
        
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const pr = links.find(l => l.textContent && l.textContent.trim() === 'Payment Registration');
            if (pr) pr.click();
            else if (typeof (window as any).showPaymentRegForm === 'function') {
                (window as any).showPaymentRegForm();
            }
        });
        
        await page.waitForTimeout(5000);

        console.log('[PRN] Checking if already on Tax Form page...');
        const alreadyOnTaxForm = await page.evaluate(() => !!document.querySelector('select#cmbTaxHead'));
        if (alreadyOnTaxForm) {
            console.log('[PRN] Already on Tax Form page, skipping Applicant Type step');
        } else {
            console.log('[PRN] Clicking Next on Applicant Type...');
            try {
                // Try multiple selectors for the Next button
                const nextSelectors = [
                    'input[value="Next"]',
                    '#btnSubmit',
                    '#btnNext',
                    'input[type="button"][value="Next"]',
                    'button:has-text("Next")',
                    'a:has-text("Next")',
                    'input[name="btnNext"]',
                    'input[name="submitBtn"]',
                    'input[id*="next"]',
                    'button[id*="next"]',
                ];
                let nextBtnFound = false;
                for (const sel of nextSelectors) {
                    const btn = await page.$(sel);
                    if (btn) {
                        console.log(`[PRN] Found Next button with selector: ${sel}`);
                        // Accept the dialog that appears after clicking Next
                        page.once('dialog', async (dialog) => {
                            console.log('[PRN] Dialog popup after Next:', dialog.message());
                            await dialog.accept();
                        });
                        await btn.click();
                        nextBtnFound = true;
                        break;
                    }
                }
                if (!nextBtnFound) {
                    console.log('[PRN] Next button not found with selectors, trying JS click...');
                    await page.evaluate(() => {
                        const allInputs = Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], button, a'));
                        for (const el of allInputs) {
                            if (el.getAttribute('value') === 'Next' || el.textContent?.trim() === 'Next') {
                                (el as HTMLElement).click();
                                return true;
                            }
                        }
                        return false;
                    });
                }
                await page.waitForTimeout(10000);
            } catch (e) {
                console.log('[PRN] Next button click failed:', e);
            }
        }

        console.log('[PRN] Waiting for Tax Form to render...');
        const taxHeadSelector = 'select#cmbTaxHead';
        try {
            await page.waitForFunction((sel: string) => {
                return !!document.querySelector(sel);
            }, taxHeadSelector, { timeout: 60000 });
        } catch(e) {
            console.log('[PRN] Timeout waiting for Tax Form to render. Reloading page...');
            await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
            await page.waitForTimeout(5000);
            try {
                await page.waitForFunction((sel: string) => {
                    return !!document.querySelector(sel);
                }, taxHeadSelector, { timeout: 60000 });
            } catch (e2) {
                console.log('[PRN] Second timeout waiting for Tax Form. Dumping page state...');
                const html = await page.content().catch(() => '');
                console.log('[PRN] Page HTML length:', html.length);
                console.log('[PRN] Page HTML first 1000 chars:', html.substring(0, 1000));
                throw new Error('Failed to load Tax Form after reload. The KRA portal may be down or the page structure has changed.');
            }
        }

        console.log(`[PRN] Filling out Tax Head for ${config.taxType}...`);
        await page.evaluate(({ matchSource, matchFlags }) => {
            const regex = new RegExp(matchSource, matchFlags);
            const select = document.querySelector('select#cmbTaxHead') as HTMLSelectElement;
            if (select) {
                for (let i = 0; i < select.options.length; i++) {
                    if (regex.test(select.options[i].text.trim())) {
                        select.selectedIndex = i;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        break;
                    }
                }
            }
        }, { matchSource: mapping.headRegex.source, matchFlags: mapping.headRegex.flags });
        await page.waitForTimeout(3000);

        // Wait for Tax Sub Head to populate via AJAX
        console.log(`[PRN] Waiting for Tax Sub Head to populate via AJAX...`);
        let subHeadOptions: string[] = [];
        try {
            await page.waitForFunction(() => {
                const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
                return select && select.options.length > 1;
            }, { timeout: 30000 });
            subHeadOptions = await page.evaluate(() => {
                const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
                if (!select) return [];
                return Array.from(select.options).map(o => o.text).filter(t => t.trim() && t.trim() !== '--Select--');
            });
            console.log(`[PRN] Tax Sub Head populated: ${subHeadOptions.join(' | ')}`);
        } catch {
            console.log('[PRN] Tax Sub Head did not populate after 30s — reloading page...');
            await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
            await page.waitForTimeout(5000);
            // Re-select Tax Head after reload
            console.log(`[PRN] Re-setting Tax Head after reload: ${config.taxType}...`);
            await page.evaluate(({ matchSource, matchFlags }) => {
                const regex = new RegExp(matchSource, matchFlags);
                const select = document.querySelector('select#cmbTaxHead') as HTMLSelectElement;
                if (select) {
                    for (let i = 0; i < select.options.length; i++) {
                        if (regex.test(select.options[i].text.trim())) {
                            select.selectedIndex = i;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                            break;
                        }
                    }
                }
            }, { matchSource: mapping.headRegex.source, matchFlags: mapping.headRegex.flags });
            // Wait again for Tax Sub Head
            try {
                await page.waitForFunction(() => {
                    const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
                    return select && select.options.length > 1;
                }, { timeout: 30000 });
                subHeadOptions = await page.evaluate(() => {
                    const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
                    if (!select) return [];
                    return Array.from(select.options).map(o => o.text).filter(t => t.trim() && t.trim() !== '--Select--');
                });
                console.log(`[PRN] Tax Sub Head populated after reload: ${subHeadOptions.join(' | ')}`);
            } catch {
                console.log('[PRN] Tax Sub Head still did not populate after reload');
                subHeadOptions = await page.evaluate(() => {
                    const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
                    if (!select) return [];
                    return Array.from(select.options).map(o => o.text).filter(t => t.trim() && t.trim() !== '--Select--');
                });
            }
        }

    console.log(`[PRN] Filling out Tax Sub Head for ${config.taxType}...`);

    // Primary: try exact label selection via Playwright locator (matches the test script flow)
    const subHeadLabelMap: Record<string, string> = {
        'vat': '(0201) Value Added Tax (VAT)',
        'turnover_tax': '(0111) Income Tax - Turnover Tax (ToT)',
        'monthly_rental_income': '(0111) Income Tax - Rent Income (MRI)',
        'paye': '(0111) Income Tax - Pay As You Earn (PAYE)',
        'nita': 'Agency Revenue - NITA Levy',
        'affordable_housing': 'Agency Revenue - Housing Levy',
    };
    let subHeadMatched = false;
    const preferredSubHeadLabel = subHeadLabelMap[config.taxType];
    if (preferredSubHeadLabel) {
        try {
            await page.locator('select#cmbTaxSubHead').selectOption({ label: preferredSubHeadLabel });
            subHeadMatched = true;
            console.log(`[PRN] Selected Tax Sub Head by label: ${preferredSubHeadLabel}`);
        } catch (locatorErr: any) {
            console.log(`[PRN] Locator subhead selection failed: ${locatorErr.message}, falling back to regex`);
        }
    }

    // Fallback: regex match like before
    if (!subHeadMatched) {
        subHeadMatched = await page.evaluate(({ matchSource, matchFlags }) => {
            const regex = new RegExp(matchSource, matchFlags);
            const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
            if (select) {
                for (let i = 0; i < select.options.length; i++) {
                    if (regex.test(select.options[i].text.trim())) {
                        select.selectedIndex = i;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
            }
            return false;
        }, { matchSource: mapping.subHeadRegex.source, matchFlags: mapping.subHeadRegex.flags });
    }

    if (!subHeadMatched) {
        console.warn(`[PRN] WARNING: Could not explicitly match Tax Sub Head using /${mapping.subHeadRegex.source}/i`);
        console.warn(`[PRN] Available options: ${subHeadOptions.join(' | ')}`);
    }
    await page.waitForTimeout(3000);

    console.log('[PRN] Filling out Payment Type...');
    const paymentTypeLabels = ['Self Assessment Tax', 'Self Assessment'];
    let paymentTypeMatched = false;
    for (const label of paymentTypeLabels) {
        try {
            await page.locator('select#cmbPaymentType').selectOption({ label });
            paymentTypeMatched = true;
            console.log(`[PRN] Selected Payment Type by label: ${label}`);
            break;
        } catch {
            // try next label
        }
    }
    if (!paymentTypeMatched) {
        await page.evaluate(() => {
            const select = document.querySelector('select#cmbPaymentType') as HTMLSelectElement;
            if (select) {
                for (let i = 0; i < select.options.length; i++) {
                    if (select.options[i].text.includes('Self Assessment')) {
                        select.selectedIndex = i;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        break;
                    }
                }
            }
        });
    }
    await page.waitForTimeout(3000);

        // --- TAX PERIOD SELECTION ---
        console.log('[PRN] Selecting Tax Period...');
        // Use period from config or default to current
        const targetYear = config.periodYear || new Date().getFullYear().toString();
        const targetMonth = config.periodMonth || new Date().toLocaleString('default', { month: 'long' });
        
        await page.evaluate((year: string) => {
            const yearSelect = document.querySelector('select#cmbTaxPeriodYear') as HTMLSelectElement;
            if (yearSelect) {
                for (let i = 0; i < yearSelect.options.length; i++) {
                    if (yearSelect.options[i].text === year) {
                        yearSelect.selectedIndex = i;
                        yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        break;
                    }
                }
            }
        }, targetYear);
        await page.waitForTimeout(2000);

        await page.evaluate((month: string) => {
            const monthSelect = document.querySelector('select#cmbTaxPeriodMonth') as HTMLSelectElement;
            if (monthSelect) {
                for (let i = 0; i < monthSelect.options.length; i++) {
                    if (monthSelect.options[i].text === month) {
                        monthSelect.selectedIndex = i;
                        monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        break;
                    }
                }
            }
        }, targetMonth);
        await page.waitForTimeout(3000);
        console.log(`[PRN] Selected period: ${targetYear} / ${targetMonth}`);

        // --- LIABILITY SELECTION ---
        // Match the working test-script flow: if KRA shows a pending-liabilities table,
        // select the first radio; otherwise just click Add to create a manual obligation row.
        console.log('[PRN] Searching for pending liabilities list (radio buttons)...');
        let hasLiabilities = false;
        try {
            await page.waitForFunction(() => {
                const table = document.getElementById('LiablibilityTbl') as HTMLElement | null;
                return !!table && table.style.display !== 'none' && !!document.querySelector('#LiablibilityTbl input[name="liabilityRadio"]');
            }, { timeout: 8_000 });
            hasLiabilities = true;
        } catch (e: any) {
            console.log('[PRN] No liabilities table found:', e.message);
        }

        if (hasLiabilities) {
            await page.evaluate(() => {
                const radio = (document.getElementById('liabilityRadio_0') as HTMLInputElement | null)
                    ?? (document.querySelector('#LiablibilityTbl input[name="liabilityRadio"]') as HTMLInputElement | null);
                if (radio) {
                    radio.checked = true;
                    radio.click();
                    radio.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
            await page.waitForTimeout(1000);
        }

        // --- ADD LIABILITY ---
        // Simplified, test-script style: click the visible Add button/link.
        console.log('[PRN] Adding Liability...');
        try {
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

            // Wait a moment for the row to be added
            await page.waitForTimeout(3000);

            // If KRA shows "Entered amount should be greater than 0", populate the amount field and re-add
            const amountSet = await page.evaluate(() => {
                const amountInput = document.getElementById('in_taxObligationTable_11') as HTMLInputElement
                    || document.querySelector('input[name*="amount"], input[id*="amount"], input[id*="Amount"]') as HTMLInputElement;
                if (amountInput) {
                    amountInput.value = '1000';
                    amountInput.dispatchEvent(new Event('change', { bubbles: true }));
                    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                }
                return false;
            });
            console.log(`[PRN] Amount input set: ${amountSet}`);
            if (amountSet) {
                await page.waitForTimeout(1500);
                await page.evaluate(() => {
                    const addLink = document.getElementById('a_taxObligationTable') as HTMLElement | null;
                    if (addLink) addLink.click();
                });
                await page.waitForTimeout(3000);
            }
        } catch (e: any) {
            console.log('[PRN] Failed to add liability row:', e.message);
            // Continue anyway — KRA may have auto-added
        }
        await page.waitForTimeout(2000);

        console.log('[PRN] Selecting Payment Mode (Other Payment Modes)...');
        await page.evaluate(() => {
            const select = document.querySelector('select#cmbPaymentMode, select[name="paymentModeId"]') as HTMLSelectElement;
            if (select) {
                for (let i = 0; i < select.options.length; i++) {
                    if (select.options[i].text.includes('Other Payment Modes')) {
                        select.selectedIndex = i;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        break;
                    }
                }
            }
        });
        await page.locator('select#cmbPaymentMode, select[name="paymentModeId"]').selectOption({ label: 'Other Payment Modes' }).catch(() => {});
        await page.waitForTimeout(1500);

        console.log('[PRN] Selecting Receiving Bank Name (if required)...');
        await page.evaluate(() => {
            const bankSelect = document.querySelector('select#cmbReceivingBank') as HTMLSelectElement;
            if (bankSelect && bankSelect.options.length > 1) {
                bankSelect.selectedIndex = 1; // Pick the first available bank
                bankSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await page.waitForTimeout(1500);

        console.log('[PRN] Clicking Submit...');
        
        // Ensure any confirmation dialog is accepted!
        const dialogHandler = async (dialog: any) => {
            console.log('[PRN] Dialog popup:', dialog.message());
            await dialog.accept();
        };
        page.on('dialog', dialogHandler);

        await page.evaluate(() => {
            const submitBtn = document.querySelector('input[value="Submit"]') as HTMLElement;
            if (submitBtn) submitBtn.click();
        });
        
        await page.waitForTimeout(5000); // Give the page time to load the result page

        console.log('[PRN] Downloading PRN Slip... waiting for download event.');
        try {
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 60000 }),
                page.locator('a', { hasText: 'Download Payment Slip' }).click().catch(async () => {
                    // Fallback to evaluating click if locator fails
                    await page.evaluate(() => {
                        const aTags = Array.from(document.querySelectorAll('a'));
                        const dl = aTags.find(a => a.textContent && a.textContent.includes('Download Payment Slip'));
                        if (dl) dl.click();
                    });
                })
            ]);
            await download.saveAs(destPath);
            console.log('[PRN] Success! Saved PRN to:', destPath);
            
            // Clean up listener
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
