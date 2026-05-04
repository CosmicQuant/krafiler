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
        subHeadRegex: /Rent Income \(MRI\)/i
    },
    'paye': {
        headRegex: /Income Tax/i,
        subHeadRegex: /PAYE/i
    },
    'turnover_tax': {
        headRegex: /Income Tax/i,
        subHeadRegex: /Turnover Tax \(TOT\)/i
    },
    'vat': {
        headRegex: /Value Added Tax \(VAT\)/i,
        subHeadRegex: /^Value Added Tax \(VAT\)$/i // ^ $ to avoid exact matching 'VAT on Services' / 'Imported VAT' if needed. KRA uses VAT exactly
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
            await page.evaluate(() => {
                const nextBtn = document.querySelector('input[value="Next"], #btnSubmit, #btnNext, input[type="button"][value="Next"]') as HTMLElement;
                if (nextBtn) nextBtn.click();
            });
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
        await page.evaluate(({ matchSource, matchFlags }) => {
            const regex = new RegExp(matchSource, matchFlags);
            const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
            if (select) {
                for (let i = 0; i < select.options.length; i++) {
                    if (regex.test(select.options[i].text.trim())) {
                        select.selectedIndex = i;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        break;
                    }
                }
            }
        }, { matchSource: mapping.subHeadRegex.source, matchFlags: mapping.subHeadRegex.flags });
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
        if (config.periodYear) {
            await page.locator('select#cmbTaxPeriodYear').selectOption({ label: config.periodYear }).catch(() => {});
            await page.waitForTimeout(1000);
        }
        if (config.periodMonth) {
            await page.locator('select#cmbTaxPeriodMonth').selectOption({ label: config.periodMonth }).catch(() => {});
            await page.waitForTimeout(2000);
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
        await page.waitForTimeout(3000);

        console.log('[PRN] Clicking Submit...');
        await page.evaluate(() => {
            const submitBtn = document.querySelector('input[value="Submit"]') as HTMLElement;
            if (submitBtn) submitBtn.click();
        });

        console.log('[PRN] Downloading PRN Slip... waiting for dialog to approve and download event.');
        try {
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 60000 }),
                page.click('a:has-text("Download Payment Slip")')
            ]);
            await download.saveAs(destPath);
            console.log('[PRN] Success! Saved PRN to:', destPath);
            return { success: true, filePath: destPath };
        } catch (downloadErr: any) {
            console.log('[PRN] Failed to auto-download PRN.', downloadErr.message);
            return { success: false, error: downloadErr.message };
        }
    } catch (err: any) {
        console.error('[PRN] PRN generation error:', err);
        return { success: false, error: err.message };
    }
}
