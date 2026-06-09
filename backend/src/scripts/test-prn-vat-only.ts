import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const KRA_PIN = 'A003198897N';
const KRA_PASSWORD = '072044866200';

async function login(page: any): Promise<void> {
  console.log(`[${KRA_PIN}] Logging in...`);
  await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

  await page.waitForSelector('#logid', { timeout: 15000 });
  await page.fill('#logid', KRA_PIN);

  const continueFound = await page.$('a[href="javascript:CheckPIN();"]');
  if (continueFound) await continueFound.click();
  else await page.evaluate(() => { (globalThis as any).CheckPIN(); }).catch(() => {});

  await page.waitForSelector('input[type="password"]:visible', { timeout: 18000 });
  await page.fill('input[type="password"]', KRA_PASSWORD);

  await page.waitForSelector('input[name="captcahText"]', { timeout: 10000 }).catch(() => {});
  try {
    await page.waitForFunction(() => {
      const input = document.querySelector('input[name="captcahText"]') as HTMLInputElement;
      return input && input.value.trim().length >= 2;
    }, { timeout: 120000 });
    await page.waitForTimeout(1000);
    await page.click('#loginButton');
  } catch(e) {
    console.log(`[${KRA_PIN}] CAPTCHA timeout or skipped`);
  }

  await page.waitForSelector('a:has-text("Payments"), a[href*="paymentRegistration"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log(`[${KRA_PIN}] Logged in.`);
}

async function generateVATPRN(page: any): Promise<string | null> {
  console.log(`\n========== VAT PRN (${KRA_PIN}) ==========`);

  // Navigate to Payment Registration
  console.log('[PRN] Navigating to Payment Registration...');
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const payments = links.find(l => l.textContent && l.textContent.trim() === 'Payments');
    if (payments) {
      payments.dispatchEvent(new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true }));
    }
  });
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const pr = links.find(l => l.textContent && l.textContent.trim() === 'Payment Registration');
    if (pr) pr.click();
    else if (typeof (window as any).showPaymentRegForm === 'function') {
      (window as any).showPaymentRegForm();
    }
  });
  await page.waitForTimeout(8000);

  // Check if already on Tax Form
  const alreadyOnTaxForm = await page.evaluate(() => !!document.querySelector('select#cmbTaxHead'));
  if (!alreadyOnTaxForm) {
    console.log('[PRN] Clicking Next...');
    const nextSelectors = [
      'input[value="Next"]', '#btnSubmit', '#btnNext',
      'input[type="button"][value="Next"]',
      'button:has-text("Next")', 'a:has-text("Next")',
      'input[name="btnNext"]', 'input[name="submitBtn"]',
      'input[id*="next"]', 'button[id*="next"]',
    ];
    let nextBtnFound = false;
    for (const sel of nextSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        console.log(`✓ Found Next button: ${sel}`);
        await btn.click({ timeout: 60000 });
        nextBtnFound = true;
        break;
      }
    }
    if (!nextBtnFound) {
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

    // Wait for Tax Form to load
    console.log('[PRN] Waiting for Tax Form to render...');
    try {
      await page.waitForFunction(() => !!document.querySelector('select#cmbTaxHead'), { timeout: 60000 });
      console.log('[PRN] Tax Form loaded successfully');
    } catch {
      console.log('⚠️ Tax Form NOT found!');
      await page.screenshot({ path: `prn_vat_no_taxform.png`, fullPage: true });
      return null;
    }
    await page.waitForTimeout(3000);
  } else {
    console.log('[PRN] Already on Tax Form page');
  }

  // Fill Tax Head
  console.log('[PRN] Setting Tax Head: VAT');
  await page.evaluate(() => {
    const select = document.querySelector('select#cmbTaxHead') as HTMLSelectElement;
    if (select) {
      for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].text.includes('VAT')) {
          select.selectedIndex = i;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
  });

  // Wait for Tax Sub Head to populate via AJAX — detect when loading is done
  console.log('[PRN] Waiting for Tax Sub Head to populate via AJAX...');
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
    // Re-check if the form loaded after reload
    const hasTaxHeadAfterReload = await page.evaluate(() => !!document.querySelector('select#cmbTaxHead'));
    if (!hasTaxHeadAfterReload) {
      console.log('[PRN] Tax Form not found after reload');
      await page.screenshot({ path: `prn_vat_reload_fail.png`, fullPage: true });
      return null;
    }
    // Re-select Tax Head after reload
    console.log('[PRN] Re-setting Tax Head after reload: VAT');
    await page.evaluate(() => {
      const select = document.querySelector('select#cmbTaxHead') as HTMLSelectElement;
      if (select) {
        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].text.includes('VAT')) {
            select.selectedIndex = i;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
    });
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

  // Fill Tax Sub Head
  console.log('[PRN] Setting Tax Sub Head: (0201) Value Added Tax (VAT)');
  let subHeadMatched = await page.evaluate(() => {
    const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
    if (select) {
      for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].text.includes('Value Added Tax')) {
          select.selectedIndex = i;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  });

  console.log(`Sub-head matched: ${subHeadMatched}`);
  if (!subHeadMatched) {
    console.log(`[PRN] Available sub-head options: ${subHeadOptions.join(' | ')}`);
  }
  await page.waitForTimeout(2000);

  // Fill Payment Type
  console.log('[PRN] Setting Payment Type: Self Assessment');
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

  // Select Tax Period Year and Month (April for VAT)
  console.log('[PRN] Setting Tax Period (Year 2026, Month April)...');
  await page.evaluate(() => {
    const yearSelect = document.querySelector('select#cmbTaxPeriodYear') as HTMLSelectElement;
    if (yearSelect) {
      for (let i = 0; i < yearSelect.options.length; i++) {
        if (yearSelect.options[i].text === '2026') {
          yearSelect.selectedIndex = i;
          yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const monthSelect = document.querySelector('select#cmbTaxPeriodMonth') as HTMLSelectElement;
    if (monthSelect) {
      for (let i = 0; i < monthSelect.options.length; i++) {
        if (monthSelect.options[i].text === 'April') {
          monthSelect.selectedIndex = i;
          monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
  });
  await page.waitForTimeout(3000);

  // Wait for liability table to appear after period selection
  console.log('[PRN] Waiting for liability table...');
  let hasLiabilities = false;
  try {
    await page.waitForFunction(() => {
      const table = document.getElementById('LiablibilityTbl');
      return !!table && table.style.display !== 'none' && !!document.querySelector('#LiablibilityTbl input[name="liabilityRadio"]');
    }, { timeout: 15000 });
    hasLiabilities = true;
  } catch {
    console.log('[PRN] No liabilities table found after period selection');
  }

  console.log(`Liabilities table: ${hasLiabilities}`);
  if (!hasLiabilities) {
    console.log('[PRN] No liabilities table found. Taking debug screenshot...');
    await page.screenshot({ path: `prn_vat_no_liabilities.png`, fullPage: true });
  }

  if (hasLiabilities) {
    await page.evaluate(() => {
      const radio = document.getElementById('liabilityRadio_0') as HTMLInputElement
        || document.querySelector('#LiablibilityTbl input[name="liabilityRadio"]') as HTMLInputElement;
      if (radio) {
        radio.checked = true;
        radio.click();
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForTimeout(2000);

    // Click Add
    const addResult = await page.evaluate(() => {
      const addLink = document.getElementById('a_taxObligationTable') as HTMLElement;
      const table = document.getElementById('taxObligationTable') as HTMLTableElement;
      const rowsBefore = table?.rows.length ?? 0;
      if (addLink) {
        addLink.click();
        return { clicked: true, rowsBefore };
      }
      return { clicked: false, rowsBefore };
    });
    console.log(`Add clicked: ${addResult.clicked}, rows before: ${addResult.rowsBefore}`);
    await page.waitForTimeout(3000);

    // Check for "Entered amount should be greater than 0" alert and set amount
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
  } else {
    console.log('⚠️ No liabilities table found — this may be normal if no liabilities exist');
  }

  // Payment Mode
  console.log('[PRN] Setting Payment Mode: Other Payment Modes');
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
  await page.waitForTimeout(2000);

  // Submit
  console.log('[PRN] Clicking Submit...');
  await page.evaluate(() => {
    const submitBtn = document.querySelector('input[value="Submit"]') as HTMLElement;
    if (submitBtn) submitBtn.click();
  });
  await page.waitForTimeout(5000);

  // Dismiss any survey popup before downloading
  console.log('[PRN] Checking for survey popup...');
  try {
    const surveyDismissed = await page.evaluate(() => {
      // Try to find and click "Not Now" or "X" or "Close" on survey popup
      const buttons = Array.from(document.querySelectorAll('button, a, span, div'));
      const dismissBtn = buttons.find(el => {
        const text = el.textContent?.trim().toLowerCase() || '';
        return text.includes('not now') || text.includes('close') || text.includes('x') || text.includes('dismiss') || text.includes('cancel') || text.includes('no thanks');
      }) as HTMLElement;
      if (dismissBtn) {
        dismissBtn.click();
        return true;
      }
      // Also try to find modal overlay and click outside
      const overlay = document.querySelector('.modal-overlay, .survey-overlay, .popup-overlay, [id*="survey"], [class*="survey"]') as HTMLElement;
      if (overlay) {
        overlay.click();
        return true;
      }
      return false;
    });
    if (surveyDismissed) {
      console.log('[PRN] Survey popup dismissed');
      await page.waitForTimeout(1000);
    }
  } catch (e) {
    // Ignore popup dismissal errors
  }

  // Download PRN
  console.log('[PRN] Downloading...');
  try {
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    // Use a try/catch for the click because the page may navigate away
    try {
      await page.evaluate(() => {
        const aTags = Array.from(document.querySelectorAll('a'));
        const dl = aTags.find(a => a.textContent && a.textContent.includes('Download Payment Slip'));
        if (dl) dl.click();
      });
    } catch (clickErr: any) {
      console.log(`[PRN] Click failed (page navigated), waiting for download anyway...`);
    }
    const download = await downloadPromise;
    const tempPath = path.join(__dirname, '..', '..', 'tmp', `test-prn-VAT-${Date.now()}.pdf`);
    await download.saveAs(tempPath);
    console.log(`✅ VAT PRN downloaded!`);
    console.log(`   Saved to: ${tempPath}`);
    return tempPath;
  } catch (e) {
    console.log(`❌ VAT PRN download failed:`, e);
    await page.screenshot({ path: `prn_vat_fail.png`, fullPage: true });
    return null;
  }
}

async function run() {
  console.log('=== VAT PRN Test Script ===');
  console.log(`PIN: ${KRA_PIN}\n`);

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  const executablePath = candidates.find(p => fs.existsSync(p));
  if (!executablePath) throw new Error('No Chrome or Edge found!');

  const KRA_BROWSER_PROFILE_DIR = path.join(__dirname, '..', '..', 'tmp', `kra-browser-profile-vat`);
  if (!fs.existsSync(KRA_BROWSER_PROFILE_DIR)) {
    fs.mkdirSync(KRA_BROWSER_PROFILE_DIR, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(KRA_BROWSER_PROFILE_DIR, {
    headless: false,
    executablePath,
    args: ['--start-maximized', '--no-sandbox'],
    viewport: null,
    acceptDownloads: true
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  // Global dialog handler
  page.on('dialog', async (dialog: any) => {
    console.log(`[Dialog] ${dialog.type()}: ${dialog.message()}`);
    await dialog.accept().catch(() => {});
  });

  try {
    await login(page);
    const result = await generateVATPRN(page);
    await context.close();
    if (result) {
      console.log(`\n✅ VAT PRN: ${result}`);
    } else {
      console.log(`\n❌ VAT PRN: FAILED`);
    }
  } catch (e: any) {
    await context.close();
    console.log(`\n❌ VAT PRN: FAILED - ${e.message}`);
  }

  console.log('\nTest complete!');
  process.exit(0);
}

run().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
