import { Page } from 'playwright';
import path from 'path';

export interface PrnConfig {
    periodYear: string;
    periodMonth?: string;
    taxType: string;
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
                        const allInputs = document.querySelectorAll('input[type="button"], input[type="submit"], button, a');
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
        const subHeadMatched = await page.evaluate(({ matchSource, matchFlags }) => {
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
        
        if (!subHeadMatched) {
            console.warn(`[PRN] WARNING: Could not explicitly match Tax Sub Head using /${mapping.subHeadRegex.source}/i`);
            console.warn(`[PRN] Available options: ${subHeadOptions.join(' | ')}`);
        }
        await page.waitForTimeout(3000);

        console.log('[PRN] Filling out Payment Type...');
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
        console.log('[PRN] Searching for pending liabilities list (radio buttons)...');
        let hasLiabilities = false;
        try {
            await page.waitForFunction(() => {
                const table = document.getElementById('LiablibilityTbl') as HTMLElement | null;
                return !!table && table.style.display !== 'none' && !!document.querySelector('#LiablibilityTbl input[name="liabilityRadio"]');
            }, { timeout: 15_000 });
            hasLiabilities = true;
        } catch (e: any) {
            console.log('[PRN] No liabilities table found after 15s:', e.message);
        }

        if (hasLiabilities) {
            const selectionResult = await page.evaluate(() => {
                const radio = (document.getElementById('liabilityRadio_0') as HTMLInputElement | null)
                    ?? (document.querySelector('#LiablibilityTbl input[name="liabilityRadio"]') as HTMLInputElement | null);
                const onSelect = (window as any).onSelectliabilityRadio;
                const subHeadSelect = document.getElementById('cmbTaxSubHead') as HTMLSelectElement | null;
                const taxHeadSelect = document.getElementById('cmbTaxHead') as HTMLSelectElement | null;

                if (!radio) {
                    return { success: false, reason: 'No liability radio found in #LiablibilityTbl' };
                }

                radio.checked = true;

                if (typeof onSelect === 'function') {
                    onSelect(radio);
                } else {
                    radio.click();
                    radio.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // KRA's Add validation expects these hidden fields to be populated.
                const selectedSubHeadText = subHeadSelect?.selectedOptions?.[0]?.text?.trim() ?? '';
                const selectedTaxHeadValue = taxHeadSelect?.value ?? '';
                const taxTypeNameInput = document.getElementById('in_taxObligationTable_3') as HTMLInputElement | null;
                const obligationTypeInput = document.getElementById('hidObligationType') as HTMLInputElement | null;
                if (taxTypeNameInput && !taxTypeNameInput.value) {
                    taxTypeNameInput.value = selectedSubHeadText;
                }
                if (obligationTypeInput && !obligationTypeInput.value) {
                    obligationTypeInput.value = selectedTaxHeadValue;
                }

                const addLink = document.getElementById('a_taxObligationTable') as HTMLElement | null;
                const obligationFieldSet = document.getElementById('ObligationDetailFieldSet') as HTMLElement | null;

                return {
                    success: true,
                    radioId: radio.id,
                    hidRadioValue: (document.getElementById('hidRadioValue') as HTMLInputElement | null)?.value ?? '',
                    obligationId: (document.getElementById('in_taxObligationTable_7') as HTMLInputElement | null)?.value ?? '',
                    fromDate: (document.getElementById('in_taxObligationTable_9') as HTMLInputElement | null)?.value ?? '',
                    toDate: (document.getElementById('in_taxObligationTable_10') as HTMLInputElement | null)?.value ?? '',
                    taxTypeName: (document.getElementById('in_taxObligationTable_3') as HTMLInputElement | null)?.value ?? '',
                    obligationType: (document.getElementById('hidObligationType') as HTMLInputElement | null)?.value ?? '',
                    addVisible: !!addLink && addLink.offsetParent !== null,
                    fieldSetVisible: !!obligationFieldSet && obligationFieldSet.style.display !== 'none',
                };
            });

            if (!selectionResult.success) {
                console.log('[PRN] Liability selection failed:', selectionResult.reason);
            } else {
                console.log(`[PRN] Selected liability radio ${selectionResult.radioId}; hidRadioValue=${selectionResult.hidRadioValue}; obligationId=${selectionResult.obligationId}; fromDate=${selectionResult.fromDate}; toDate=${selectionResult.toDate}; taxTypeName=${selectionResult.taxTypeName}; obligationType=${selectionResult.obligationType}; addVisible=${selectionResult.addVisible}; fieldSetVisible=${selectionResult.fieldSetVisible}`);
            }

            // Always try to add, even if selection result was partial
            await page.locator('#a_taxObligationTable:visible').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {
                console.log('[PRN] Add link not visible, trying direct click');
            });
        } else {
            console.log('[PRN] No liabilities available — proceeding to manual entry mode');
        }

        // --- ADD LIABILITY ---
        console.log('[PRN] Adding Liability...');
        try {
            page.once('dialog', async (dialog) => {
                console.log('[PRN] Add dialog popup:', dialog.message());
                await dialog.accept();
            });

            const addResult = await page.evaluate(() => {
                const table = document.getElementById('taxObligationTable') as HTMLTableElement | null;
                const rowsBefore = table?.rows.length ?? 0;
                const addvalidation = (window as any).addvalidation;
                const beforeAdd = (window as any).beforeAddIntotaxObligationTable;
                const addrow = (window as any).addrow;
                const addLink = document.getElementById('a_taxObligationTable') as HTMLElement | null;
                let validationReturnValue = 'not-called';
                let beforeAddReturnValue = 'not-called';

                if (typeof beforeAdd === 'function') {
                    beforeAddReturnValue = String(beforeAdd());
                }

                if (typeof addvalidation === 'function') {
                    validationReturnValue = String(addvalidation());
                }

                const rowsAfterValidation = table?.rows.length ?? 0;

                if (rowsAfterValidation > rowsBefore) {
                    return {
                        invoked: true,
                        mode: 'beforeAdd+validation',
                        returnValue: validationReturnValue,
                        beforeAddReturnValue,
                        rowsBefore,
                        rowsAfterValidation,
                    };
                }

                if (addLink) {
                    addLink.click();
                    return {
                        invoked: true,
                        mode: 'beforeAdd+validation+click',
                        returnValue: validationReturnValue,
                        beforeAddReturnValue,
                        rowsBefore,
                        rowsAfterValidation,
                    };
                }

                if (typeof addrow === 'function') {
                    const deleteFn = (document.getElementById('taxObligationTable_beforeDeleteFunction') as HTMLInputElement | null)?.value ?? '';
                    const modifyFn = (document.getElementById('taxObligationTable_beforeModifyClickedFunction') as HTMLInputElement | null)?.value ?? '';
                    addrow('taxObligationTable', '4', '9', '3', deleteFn, modifyFn, 'N', 'N');
                    return {
                        invoked: true,
                        mode: 'beforeAdd+validation+addrow',
                        returnValue: validationReturnValue,
                        beforeAddReturnValue,
                        rowsBefore,
                        rowsAfterValidation,
                    };
                }

                return {
                    invoked: false,
                    mode: 'none',
                    returnValue: validationReturnValue,
                    beforeAddReturnValue,
                    rowsBefore,
                    rowsAfterValidation,
                };
            });

            console.log(`[PRN] Add attempt via ${addResult.mode}; beforeAdd returned ${addResult.beforeAddReturnValue}; addvalidation returned ${addResult.returnValue}; taxObligationTable rows before=${addResult.rowsBefore}, afterValidation=${addResult.rowsAfterValidation}`);

            // Wait for rows to increase
            await page.waitForFunction(
                (previousRows) => {
                    const table = document.getElementById('taxObligationTable') as HTMLTableElement | null;
                    return !!table && table.rows.length > previousRows;
                },
                addResult.rowsBefore,
                { timeout: 10_000 }
            ).catch(() => {
                console.log('[PRN] Warning: Row count did not increase, proceeding anyway');
            });

            const rowsAfter = await page.evaluate(() => {
                const table = document.getElementById('taxObligationTable') as HTMLTableElement | null;
                return table?.rows.length ?? 0;
            });
            console.log(`[PRN] taxObligationTable rows after add: ${rowsAfter}`);

            // Handle "Entered amount should be greater than 0" alert
            console.log('[PRN] Checking for amount input in obligation table...');
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
            console.log(`Amount input set: ${amountSet}`);
            if (amountSet) {
                await page.waitForTimeout(2000);
                // Re-click Add after setting amount
                await page.evaluate(() => {
                    const addLink = document.getElementById('a_taxObligationTable') as HTMLElement;
                    if (addLink) addLink.click();
                });
                await page.waitForTimeout(3000);
            }
        } catch (e: any) {
            console.log('[PRN] Failed to add liability row:', e.message);
            // Continue anyway — KRA may have auto-added
        }
        await page.waitForTimeout(3000);

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
