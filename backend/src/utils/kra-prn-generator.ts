import { Page } from 'playwright';
import path from 'path';

export interface PrnConfig {
    periodYear: string;
    periodMonth?: string;
    taxType: string;
}

const TAX_MAPPING: Record<string, { headRegex: RegExp, subHeadRegex: RegExp }> = {
    'monthly_rental_income': {
        headRegex: /Income Tax/i,
        subHeadRegex: /Rent Income/i
    },
    'paye': {
        headRegex: /Income Tax/i,
        subHeadRegex: /PAYE/i
    },
    'turnover_tax': {
        headRegex: /Income Tax/i,
        subHeadRegex: /Turnover Tax/i
    },
    'vat': {
        headRegex: /Value Added Tax \(VAT\)/i,
        subHeadRegex: /Value Added Tax \(VAT\)/i
    },
    'nita': {
        headRegex: /Agency Tax/i,
        subHeadRegex: /NITA/i
    },
    'affordable_housing': {
        headRegex: /Agency Tax/i,
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

        console.log(`[PRN] Selecting Period (${config.periodYear}/${config.periodMonth || 'N/A'})...`);
        
        let combinedPeriodStr = "";
        if (config.periodMonth && config.periodYear) {
            // KRA combined dropdown format: "Apr 2026 - Apr 2026"
            const shortMonth = config.periodMonth.slice(0, 3);
            combinedPeriodStr = `${shortMonth} ${config.periodYear} - ${shortMonth} ${config.periodYear}`;
        }

        const isCombinedPeriod = await page.evaluate((combinedStr) => {
            const selects = Array.from(document.querySelectorAll('select'));
            for (const select of selects) {
                for (let i = 0; i < select.options.length; i++) {
                    if (combinedStr && select.options[i].text.includes(combinedStr)) {
                        select.selectedIndex = i;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
            }
            return false;
        }, combinedPeriodStr);

        if (isCombinedPeriod) {
            console.log(`[PRN] Selected combined tax period: ${combinedPeriodStr}`);
            await page.waitForTimeout(2000);
        } else {
            console.log('[PRN] Combined period dropdown not found, falling back to separate Year/Month dropdowns.');
            if (config.periodYear) {
                await page.locator('select#cmbTaxPeriodYear').selectOption({ label: config.periodYear }).catch(() => {});
                await page.waitForTimeout(1000);
            }
            if (config.periodMonth) {
                await page.locator('select#cmbTaxPeriodMonth').selectOption({ label: config.periodMonth }).catch(() => {});
                await page.waitForTimeout(2000);
            }
        }

        console.log('[PRN] Adding Liability...');
        try {
            const addBtnLocator = page.locator('input[value="Add"]:visible, a.subbuttonHome:has-text("Add"):visible, button:has-text("Add"):visible').first();
            await addBtnLocator.click({ timeout: 5000 });
            console.log('[PRN] Clicked visible Add button successfully.');
        } catch (e: any) {
            console.log('[PRN] Could not click visible Add button:', e.message);
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
