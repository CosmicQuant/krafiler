import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

// Test credentials
const KRA_PIN = 'P051784007D';
const KRA_PASSWORD = '0720470947';

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

async function testInlinePrn() {
  console.log('=== Inline PRN Generation Test ===');
  console.log(`PIN: ${KRA_PIN}\n`);

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  const executablePath = candidates.find(p => fs.existsSync(p));
  if (!executablePath) throw new Error('No Chrome or Edge found!');

  const KRA_BROWSER_PROFILE_DIR = path.join(__dirname, '..', '..', 'tmp', `kra-browser-profile-inline`);
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
    
    // Import the generatePrnAfterFiling function
    const { generatePrnAfterFiling } = await import('../workers/kraFilingWorker');
    
    // Create a mock job context
    const mockJob = {
      id: 'test-inline-prn',
      data: {
        jobId: 'test-inline-prn',
        userId: 'dev-user',
        payload: {
          kraPin: KRA_PIN,
          clientId: 'test-client',
        }
      },
      progress: 0,
      log: async (message: string) => {
        console.log(`[Job Log] ${message}`);
      },
      updateProgress: async (progress: number) => {
        console.log(`[Progress] ${progress}%`);
      },
      updateMessage: async (message: string) => {
        console.log(`[Message] ${message}`);
      },
      updateData: async (data: any) => {
        console.log(`[Data Update] ${JSON.stringify(data)}`);
      },
      refresh: async () => {
        console.log(`[Refresh] Job refreshed`);
      }
    } as any;

    console.log('\n[TEST] Calling inline PRN generation...');
    const prnResults = await generatePrnAfterFiling(
      mockJob,
      page,
      KRA_PIN,
      '2026-04-01',
      '2026-04-30',
      'paye' as any
    );

    console.log('\n=== PRN Results ===');
    for (const result of prnResults) {
      if (result.prnPath) {
        console.log(`✅ ${result.taxType}: ${result.prnPath}`);
      } else if (result.error) {
        console.log(`❌ ${result.taxType}: ${result.error}`);
      }
    }

    await context.close();
    console.log('\nTest complete!');
  } catch (e: any) {
    await context.close();
    console.error('\nTest failed:', e.message);
    process.exit(1);
  }
}

testInlinePrn();
