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
        subHeadRegex: /NITA/i
    },
    'affordable_housing': {
        headRegex: /^Agency Revenue$/i,
        subHeadRegex: /Affordable Housing/i
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

        console.log('[PRN] Clicking Next on Applicant Type...');
        try {
            const nextSelector = `input[value="Next"], #btnSubmit, #btnNext, input[type="button"][value="Next"]`;
            await page.waitForSelector(nextSelector, { timeout: 30000 });
            
            // Accept the dialog that appears after clicking Next
            page.once('dialog', async (dialog) => {
                console.log('[PRN] Dialog popup after Next:', dialog.message());
                await dialog.accept();
            });

            const btn = page.locator(nextSelector).first();
            await btn.click({ force: true });
            
            await page.waitForTimeout(10000);
        } catch (e) {
            console.log('[PRN] Next button not found or failed. Proceeding...');
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
            await page.waitForFunction((sel: string) => {
                return !!document.querySelector(sel);
            }, taxHeadSelector, { timeout: 60000 });
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

        console.log('[PRN] Searching for pending liabilities list (radio buttons)...');
        try {
            await page.waitForFunction(() => {
                const table = document.getElementById('LiablibilityTbl') as HTMLElement | null;
                return !!table && table.style.display !== 'none' && !!document.querySelector('#LiablibilityTbl input[name="liabilityRadio"]');
            }, { timeout: 15_000 });

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
                throw new Error(selectionResult.reason);
            }

            console.log(`[PRN] Selected liability radio ${selectionResult.radioId}; hidRadioValue=${selectionResult.hidRadioValue}; obligationId=${selectionResult.obligationId}; fromDate=${selectionResult.fromDate}; toDate=${selectionResult.toDate}; taxTypeName=${selectionResult.taxTypeName}; obligationType=${selectionResult.obligationType}; addVisible=${selectionResult.addVisible}; fieldSetVisible=${selectionResult.fieldSetVisible}`);
            await page.locator('#a_taxObligationTable:visible').waitFor({ state: 'visible', timeout: 5_000 });
        } catch (e: any) {
            console.log('[PRN] Failed to interact with liability radio button:', e.message);
            throw e;
        }

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

            if (!addResult.invoked) {
                throw new Error('KRA Add handler was not found');
            }

            console.log(`[PRN] Add attempt via ${addResult.mode}; beforeAdd returned ${addResult.beforeAddReturnValue}; addvalidation returned ${addResult.returnValue}; taxObligationTable rows before=${addResult.rowsBefore}, afterValidation=${addResult.rowsAfterValidation}`);

            await page.waitForFunction(
                (previousRows) => {
                    const table = document.getElementById('taxObligationTable') as HTMLTableElement | null;
                    return !!table && table.rows.length > previousRows;
                },
                addResult.rowsBefore,
                { timeout: 10_000 }
            );

            const rowsAfter = await page.evaluate(() => {
                const table = document.getElementById('taxObligationTable') as HTMLTableElement | null;
                return table?.rows.length ?? 0;
            });

            console.log(`[PRN] Added liability row successfully via ${addResult.mode}; addvalidation returned ${addResult.returnValue}; taxObligationTable rows=${rowsAfter}`);
        } catch (e: any) {
            console.log('[PRN] Failed to add liability row:', e.message);
            throw e;
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
