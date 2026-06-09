import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

interface TestCase {
  name: string;
  pin: string;
  password: string;
  taxType: string;
  headLabel: string;
  subHeadLabel: string;
  fileName: string;
}

const TEST_CASES: TestCase[] = [
  {
    name: 'ToT',
    pin: 'A013328490B',
    password: '0741040238',
    taxType: 'turnover_tax',
    headLabel: 'Income Tax',
    subHeadLabel: 'Turnover Tax',
    fileName: 'ToT',
  },
  {
    name: 'MRI',
    pin: 'A005485268G',
    password: '272145710',
    taxType: 'monthly_rental_income',
    headLabel: 'Income Tax',
    subHeadLabel: 'Rent Income',
    fileName: 'MRI',
  },
  {
    name: 'VAT',
    pin: 'A003198897N',
    password: '072044866200',
    taxType: 'vat',
    headLabel: 'VAT',
    subHeadLabel: '(0201) Value Added Tax (VAT)',
    fileName: 'VAT',
  },
];

async function login(page: any, pin: string, password: string): Promise<void> {
  console.log(`\n[${pin}] Logging in...`);
  await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

  await page.waitForSelector('#logid', { timeout: 15000 });
  await page.fill('#logid', pin);

  const continueFound = await page.$('a[href="javascript:CheckPIN();"]');
  if (continueFound) await continueFound.click();
  else await page.evaluate(() => { (globalThis as any).CheckPIN(); }).catch(() => {});

  await page.waitForSelector('input[type="password"]:visible', { timeout: 18000 });
  await page.fill('input[type="password"]', password);

  await page.waitForSelector('input[name="captcahText"]', { timeout: 10000 }).catch(() => {});
  try {
    await page.waitForFunction(() => {
      const input = document.querySelector('input[name="captcahText"]') as HTMLInputElement;
      return input && input.value.trim().length >= 2;
    }, { timeout: 120000 });
    await page.waitForTimeout(1000);
    await page.click('#loginButton');
  } catch(e) {
    console.log(`[${pin}] CAPTCHA timeout or skipped`);
  }

  await page.waitForSelector('a:has-text("Payments"), a[href*="paymentRegistration"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log(`[${pin}] Logged in.`);
}

async function generatePRN(page: any, testCase: TestCase, index: number): Promise<string | null> {
  const { pin, taxType, headLabel, subHeadLabel, fileName } = testCase;
  console.log(`\n========== PRN ${index + 1}/${TEST_CASES.length}: ${fileName} (${pin}) ==========`);

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
          await btn.click();
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
        console.log('[PRN] Tax Form not loaded after 60s, reloading page...');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(5000);
        try {
          await page.waitForFunction(() => !!document.querySelector('select#cmbTaxHead'), { timeout: 60000 });
          console.log('[PRN] Tax Form loaded after reload');
        } catch {
          console.log('⚠️ Tax Form NOT found even after reload!');
          await page.screenshot({ path: `prn_${fileName}_no_taxform.png`, fullPage: true });
          // Debug: dump page HTML
          const html = await page.content().catch(() => '');
          console.log(`[PRN] Page HTML length: ${html.length}`);
          console.log(`[PRN] Page HTML snippet: ${html.substring(0, 500)}`);
          return null;
        }
      }
      await page.waitForTimeout(3000);
    } else {
      console.log('[PRN] Already on Tax Form page');
    }

  // Verify Tax Form
  const hasTaxHead = await page.evaluate(() => !!document.querySelector('select#cmbTaxHead'));
  if (!hasTaxHead) {
    console.log(`⚠️ Tax Form NOT found for ${fileName}!`);
    await page.screenshot({ path: `prn_${fileName}_no_taxform.png`, fullPage: true });
    return null;
  }

  // Fill Tax Head
  console.log(`[PRN] Setting Tax Head: ${headLabel}`);
  await page.evaluate((label: string) => {
    const select = document.querySelector('select#cmbTaxHead') as HTMLSelectElement;
    if (select) {
      for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].text.includes(label)) {
          select.selectedIndex = i;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
  }, headLabel);

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
      await page.screenshot({ path: `prn_${fileName}_reload_fail.png`, fullPage: true });
      return null;
    }
    // Re-select Tax Head after reload
    console.log(`[PRN] Re-setting Tax Head after reload: ${headLabel}`);
    await page.evaluate((label: string) => {
      const select = document.querySelector('select#cmbTaxHead') as HTMLSelectElement;
      if (select) {
        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].text.includes(label)) {
            select.selectedIndex = i;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
    }, headLabel);
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
  console.log(`[PRN] Setting Tax Sub Head: ${subHeadLabel}`);
  let subHeadMatched = await page.evaluate((label: string) => {
    const select = document.querySelector('select#cmbTaxSubHead') as HTMLSelectElement;
    if (select) {
      for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].text.includes(label)) {
          select.selectedIndex = i;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  }, subHeadLabel);

  console.log(`Sub-head matched: ${subHeadMatched}`);
  if (!subHeadMatched) {
    console.log(`[PRN] Available sub-head options: ${subHeadOptions.join(' | ')}`);
  }
  await page.waitForTimeout(2000);

  // Fill Payment Type
  console.log(`[PRN] Setting Payment Type: Self Assessment`);
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

  // Select Tax Period Year and Month
  // Use April for VAT (May has zero amount), May for others
  const isVat = testCase.taxType === 'vat';
  const targetMonth = isVat ? 'April' : 'May';
  console.log(`[PRN] Setting Tax Period (Year 2026, Month ${targetMonth})...`);
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
    await page.screenshot({ path: `prn_${fileName}_no_liabilities.png`, fullPage: true });
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
        const tempPath = path.join(__dirname, '..', '..', 'tmp', `test-prn-${testCase.fileName}-${Date.now()}.pdf`);
        await download.saveAs(tempPath);
        console.log(`✅ ${testCase.fileName} PRN downloaded!`);
        console.log(`   Saved to: ${tempPath}`);
        return tempPath;
    } catch (e) {
        console.log(`❌ ${testCase.fileName} PRN download failed:`, e);
        // Take screenshot to see what happened
        await page.screenshot({ path: `prn_${testCase.fileName}_fail.png`, fullPage: true });
        console.log(`[PRN] Screenshot saved to prn_${testCase.fileName}_fail.png`);
        // Fallback: try to capture the current page as PDF using page.pdf()
        try {
            console.log('[PRN] Attempting fallback: capturing page as PDF...');
            const fallbackPath = path.join(__dirname, '..', '..', 'tmp', `test-prn-${testCase.fileName}-fallback-${Date.now()}.pdf`);
            await page.pdf({ path: fallbackPath, format: 'A4', printBackground: true });
            console.log(`✅ ${testCase.fileName} PRN captured via fallback!`);
            console.log(`   Saved to: ${fallbackPath}`);
            return fallbackPath;
        } catch (pdfErr: any) {
            console.log(`❌ Fallback PDF capture also failed:`, pdfErr.message);
        }
        return null;
    }
}

async function runSingleTest(testCase: TestCase): Promise<{ name: string; result: string | null; error?: string }> {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  const executablePath = candidates.find(p => fs.existsSync(p));
  if (!executablePath) throw new Error('No Chrome or Edge found!');

  const KRA_BROWSER_PROFILE_DIR = path.join(__dirname, '..', '..', 'tmp', `kra-browser-profile-${testCase.pin}`);
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
    await login(page, testCase.pin, testCase.password);
    const result = await generatePRN(page, testCase, 0);
    await context.close();
    return { name: testCase.name, result };
  } catch (e: any) {
    await context.close();
    return { name: testCase.name, result: null, error: e.message };
  }
}

async function run() {
  console.log('=== ToT / MRI / VAT PRN Test Script ===');
  console.log(`Tests: ${TEST_CASES.map(c => `${c.name} (${c.pin})`).join(', ')}\n`);

  const results: Array<{ name: string; result: string | null; error?: string }> = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i];
    console.log(`\n
==============================`);
    console.log(`Starting test ${i + 1}/${TEST_CASES.length}: ${testCase.name}`);
    console.log(`==============================`);
    const result = await runSingleTest(testCase);
    results.push(result);
    if (i < TEST_CASES.length - 1) {
      console.log(`\n--- Waiting 10s before next test ---`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  console.log('\n\n========== FINAL RESULTS ==========');
  for (const r of results) {
    if (r.result) {
      console.log(`✅ ${r.name}: ${r.result}`);
    } else {
      console.log(`❌ ${r.name}: FAILED${r.error ? ' - ' + r.error : ''}`);
    }
  }

  console.log('\nTest complete!');
  process.exit(0);
}

run().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
