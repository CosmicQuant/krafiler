/**
 * test-vat-local.ts
 *
 * Local VAT filing test script that mirrors the worker's prepareVatOnly flow.
 * Uses the same login logic as kraFilingWorker.ts but is self-contained to
 * avoid module import issues.
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Apply stealth plugin
chromium.use(StealthPlugin());

const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

const GEMMA4_API_KEY = process.env.GEMMA4_API_KEY ?? '';
const GEMMA4_MODEL = process.env.GEMMA4_MODEL ?? 'gemma-4-31b-it';

const KRA_PIN = 'A003102127T';
const KRA_PASSWORD = '07239368870';
const CLIENT_NAME = 'Test_Client';
const PERIOD_FROM = '2026-04-01';
const PERIOD_TO = '2026-04-30';
const VAT_PREVIOUS_CREDIT = 0;

const jobId = `local-${Date.now()}`;

// ── Log helper ───────────────────────────────────────────────────────────────
async function log(message: string, meta?: { progress?: number; level?: string }) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${jobId}] ${message}${meta?.progress ? ` (progress: ${meta.progress}%)` : ''}`;
    console.log(line);
    const logPath = path.join(TMP_DIR, `${jobId}.log`);
    await fs.mkdir(TMP_DIR, { recursive: true });
    await fs.appendFile(logPath, line + '\n');
}

// ── Gemma 4 captcha solver ───────────────────────────────────────────────────
async function solveCaptchaWithGemma4(imagePath: string): Promise<string> {
    const imageBuffer = await fs.readFile(imagePath);
    const base64 = imageBuffer.toString('base64');

    const prompt = `You are solving a KRA captcha. Look at the image carefully. It shows numbers and a math operator (+, -, ×, or *). Solve the arithmetic and return ONLY the final number as digits. No words, no punctuation, no explanation. Example: if the image shows "12 + 34", return "46". Example: if the image shows "8 - 3", return "5".`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMMA4_MODEL}:generateContent?key=${GEMMA4_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: 'image/png',
                                    data: base64,
                                },
                            },
                        ],
                    },
                ],
                generationConfig: {
                    maxOutputTokens: 100,
                    temperature: 0,
                },
            }),
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemma 4 API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    // Gemma 4 returns "thought" parts (reasoning) and regular answer parts.
    // We must only take text from non-thought parts to avoid concatenating
    // reasoning numbers with the final answer.
    const answerParts = parts.filter((p: any) => !p.thought);
    const text = answerParts.map((p: any) => p.text).join(' ').trim();
    if (!text) {
        throw new Error(`Gemma 4 returned no answer parts. Full response: ${JSON.stringify(data)}`);
    }
    const cleaned = text.replace(/\D/g, '');
    if (!cleaned) {
        throw new Error(`Gemma 4 returned no numeric answer: "${text}"`);
    }
    return cleaned;
}

// ── Browser launch ───────────────────────────────────────────────────────────
async function launchBrowser() {
    const launchOptions = {
        headless: false,
        slowMo: 0,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
        ],
    };

    const contextOptions = {
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: null,
        acceptDownloads: true,
        locale: 'en-KE',
        timezoneId: 'Africa/Nairobi',
    };

    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];

    for (const exe of candidates) {
        try {
            await fs.access(exe);
            await log(`Launching browser: ${exe}`);
            const context = await chromium.launchPersistentContext(
                path.join(TMP_DIR, 'browser-profile'),
                { ...launchOptions, ...contextOptions, executablePath: exe }
            );
            await log('Browser launched');
            const page = context.pages()[0] ?? (await context.newPage());
            return { context, page, close: async () => context.close() };
        } catch {
            continue;
        }
    }
    throw new Error('No local browser found');
}

// ── KRA Login (exact same logic as worker) ─────────────────────────────────────
async function performKraLogin(
    page: any,
    kraPin: string,
    kraPassword: string
): Promise<void> {
    await log('Waiting for login page...');
    await page.waitForSelector('#logid', { timeout: 15_000 });
    await log('Login page ready');

    await log('Entering PIN...');
    await page.fill('#logid', kraPin);

    await log('Clicking Continue...');
    const continueFound = await page.$('a[href="javascript:CheckPIN();"]');
    if (continueFound) {
        await continueFound.click();
    } else {
        await log('Continue <a> not found, calling CheckPIN() via JS...');
        await page.evaluate(() => { (globalThis as any).CheckPIN(); });
    }

    // Check for PIN error dialogs
    const dialogMessage = await Promise.race([
        new Promise<string | null>((resolve) => {
            const handler = async (dialog: any) => {
                const msg = dialog.message();
                await dialog.dismiss();
                resolve(msg);
            };
            page.once('dialog', handler);
            setTimeout(() => {
                page.off('dialog', handler);
                resolve(null);
            }, 1000);
        }),
    ]);

    if (dialogMessage) {
        await log(`KRA dialog after PIN: "${dialogMessage}"`);
    }

    // Wait for password field
    await log('Waiting for password field...');
    const passwordVisible = await page.waitForSelector('input[type="password"]:visible', { timeout: 18_000 })
        .then(() => true)
        .catch(() => false);

    if (!passwordVisible) {
        const errMsg = dialogMessage
            ?? await page.$eval('#errorDiv, .error-message, [id*="error"]', (el: any) => el.textContent?.trim()).catch(() => null)
            ?? 'Password section did not appear after CheckPIN().';
        throw new Error(`PIN validation failed: ${errMsg}`);
    }
    await log('Password field appeared');

    await log('Entering password...');
    await page.fill('input[type="password"]', kraPassword);

    await log('Solving captcha...');
    await page.waitForSelector('input[name="captcahText"]', { timeout: 10_000 });

    let captchaAnswer = '';
    const screenPath = path.join(TMP_DIR, `captcha-${jobId}.png`);

    // Try DOM text first
    try {
        const stampText = await page.$eval(
            '#securityStamp, .security-stamp, [id*="stamp"], img[src*="SecurityStamp"]',
            (el: any) => el.textContent?.trim() ?? ''
        );
        if (stampText) {
            const match = stampText.match(/(\d+)\s*([+\-×x*])\s*(\d+)/);
            if (match) {
                const a = parseInt(match[1], 10);
                const op = match[2];
                const b = parseInt(match[3], 10);
                if (op === '+' || op === '×' || op === 'x' || op === '*') {
                    captchaAnswer = String(a + b);
                } else if (op === '-') {
                    captchaAnswer = String(a - b);
                }
                await log(`DOM arithmetic captcha: ${a} ${op} ${b} = ${captchaAnswer}`);
            }
        }
    } catch {
        // Continue to screenshot
    }

    // Screenshot + Gemma 4 fallback
    if (!captchaAnswer) {
        const captchaSelectors = [
            '#loginCaptcha',
            '#captchaImg',
            '#captcha_img',
            'img[id*="captcha"]',
            'img[src*="GenerateCaptcha"]',
            'img[src*="captcha"]',
        ];
        let usedElement = false;
        for (const sel of captchaSelectors) {
            const el = await page.$(sel);
            if (!el) continue;
            const box = await el.boundingBox();
            if (!box || box.width < 10 || box.height < 10) continue;
            await el.screenshot({ path: screenPath, type: 'png' });
            usedElement = true;
            await log(`Captcha screenshot saved: ${screenPath}`);
            break;
        }
        if (!usedElement) {
            await page.screenshot({ path: screenPath, type: 'png' });
            await log(`Viewport screenshot saved: ${screenPath}`);
        }

        try {
            captchaAnswer = await solveCaptchaWithGemma4(screenPath);
            await log(`Gemma 4 solved captcha: ${captchaAnswer}`);
        } catch (e: any) {
            throw new Error(`Captcha solving failed: ${e.message}`);
        }
    }

    await page.fill('input[name="captcahText"]', captchaAnswer);

    await log('Submitting login...');
    await page.click('#loginButton');

    // Wait for post-login outcome
    const dashboardSelectors = [
        '#mainNav',
        '#sideNav',
        '.dashboard',
        'a[href="eReturns.htm"]',
        'a[href="logout.htm"]',
        'a[href="javascript:logout()"]',
        'a[href*="logout"]',
        '#logout',
        '#logoutBtn',
        'text=Dashboard',
        'text=Returns',
        'text=My Profile',
        'text=Compliance',
        'text=My Ledger',
        'text=Audit & Assessment',
        'text=Payments',
        'text=Refunds',
        'text=Objection & Appeal',
        'text=Taxpayer Information Update',
    ];

    const passwordChangeSelectors = [
        'input[name="oldPassword"]',
        'input[name="newPassword"]',
        'input[name="confirmPassword"]',
        'text=Change Password',
        'text=Password Reset',
        'text=Reset Password',
    ];

    const mobileVerificationSelectors = [
        'input[name="otpCode"]',
        'input[name="otp"]',
        'text=Mobile Verification',
        'text=Enter OTP',
        'text=One Time Password',
        'text=Verification Code',
        'text=Verify Mobile',
    ];

    const deadline = Date.now() + 18_000;
    while (Date.now() < deadline) {
        const url = page.url();
        if (url.includes('login.htm') && url.includes('error')) {
            throw new Error('Login rejected by KRA');
        }

        for (const sel of dashboardSelectors) {
            const visible = await page.locator(sel).first().isVisible().catch(() => false);
            if (visible) {
                await log('Dashboard detected, login successful');
                return;
            }
        }

        for (const sel of passwordChangeSelectors) {
            const visible = await page.locator(sel).first().isVisible().catch(() => false);
            if (visible) {
                throw new Error('Password expired — needs reset');
            }
        }

        for (const sel of mobileVerificationSelectors) {
            const visible = await page.locator(sel).first().isVisible().catch(() => false);
            if (visible) {
                throw new Error('Mobile verification required — provide OTP');
            }
        }

        await new Promise(r => setTimeout(r, 250));
    }

    await log('Post-login timeout — dashboard not detected');
    throw new Error('Post-login dashboard did not expose the expected UI controls');
}

// ── VAT download (exact same as worker) ──────────────────────────────────────
async function downloadVatAutoPopulatedReturn(page: any, kraPin: string): Promise<string> {
    // Set up dialog handler
    let dialogAccepted = false;
    const dialogHandler = async (dialog: any) => {
        const message = dialog.message();
        await log(`KRA dialog: "${message}" (type: ${dialog.type()})`);
        if (dialog.type() === 'confirm' || dialog.type() === 'alert') {
            await dialog.accept();
            dialogAccepted = true;
        } else {
            await dialog.dismiss();
        }
    };
    page.on('dialog', dialogHandler);

    // Find download button
    const exactSelectors = [
        '#dwnlod_btn_tims',
        'input[type="button"][value*="Autopopulated" i]',
        'button:has-text("Autopopulated")',
        'button:has-text("Download"):has-text("VAT")',
        'input[type="button"][value*="Download" i][value*="VAT" i]',
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
        throw new Error('Could not locate the VAT auto-populated return download control');
    }

    const triggerLabel = await trigger.evaluate((element: HTMLElement) => {
        if (element instanceof HTMLInputElement) {
            return element.value || element.id || 'download button';
        }
        return element.textContent?.trim() || element.id || 'download button';
    }).catch(() => 'download button');
    await log(`Found download button: "${triggerLabel}" (selector: ${matchedSelector})`);

    const sourceZipPath = path.join(TMP_DIR, `${Date.now()}_${kraPin}_VAT_source.zip`);

    // Try native download
    let download: any = null;
    try {
        [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            trigger.click({ force: true }).catch(() => trigger.click()),
        ]);
        await download.saveAs(sourceZipPath);
        await log(`Downloaded VAT package: ${sourceZipPath}`);
        page.off('dialog', dialogHandler);
        return sourceZipPath;
    } catch (primaryErr: any) {
        await log(`Primary download failed: ${primaryErr.message}. Trying fallback...`);
    }

    // Fallback: trigger via JS and capture response
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
            await log(`Captured response: ${buffer.length} bytes`);
        } catch {}
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
        await log('Triggered download via JS');

        const deadline = Date.now() + 30_000;
        while (!captured && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (jsErr: any) {
        page.off('response', responseHandler);
        page.off('dialog', dialogHandler);
        throw new Error(`Download JS fallback failed: ${jsErr.message}`);
    }

    page.off('response', responseHandler);
    page.off('dialog', dialogHandler);

    if (!captured || !capturedBuffer) {
        throw new Error('Download capture failed after both attempts');
    }

    const finalBuffer = capturedBuffer as Buffer;
    const fallbackPath = path.join(TMP_DIR, capturedFilename);
    await fs.writeFile(fallbackPath, finalBuffer);
    await log(`Downloaded via fallback: ${fallbackPath} (${finalBuffer.length} bytes)`);
    return fallbackPath;
}

// ── Main test ─────────────────────────────────────────────────────────────────
async function runLocalVatTest() {
    await fs.mkdir(TMP_DIR, { recursive: true });
    await log('=== Local VAT Test Started ===');

    const { context, page, close } = await launchBrowser();

    try {
        // Navigate to KRA
        await log('Navigating to KRA portal...');
        await page.goto('https://itax.kra.go.ke/KRA-Portal/', {
            waitUntil: 'domcontentloaded',
            timeout: 90_000,
        });
        await log('KRA portal loaded');

        // Login using worker logic
        await performKraLogin(page, KRA_PIN, KRA_PASSWORD);
        await log('Login successful');
        await page.waitForTimeout(3000);

        // Navigate to eReturns via the Returns menu
        await log('Hovering over Returns menu...');
        const returnsMenu = page.locator('a:has-text("Returns"), a[href*="Returns"], a[onclick*="showReturns"]').first();
        await returnsMenu.hover();
        await page.waitForTimeout(1000);
        await log('Returns menu hovered');

        // Click "File Return" from the dropdown
        await log('Clicking File Return...');
        const fileReturn = page.locator('a:has-text("File Return"), a[href*="FileReturn"], a[href*="showEReturns"]').first();
        await fileReturn.click({ force: true });
        await log('File Return clicked');
        await page.waitForTimeout(3000);
        await log(`Current URL after File Return: ${page.url()}`);

        // Select VAT obligation from the dropdown
        await log('Selecting VAT obligation from dropdown...');
        // Find the dropdown that contains the VAT option (not the disabled Type dropdown)
        const allSelects = await page.locator('select').all();
        let taxObligationSelect: any = null;
        for (const sel of allSelects) {
            const isDisabled = await sel.isDisabled().catch(() => true);
            if (isDisabled) continue;
            const options = await sel.evaluate((el: HTMLSelectElement) => Array.from(el.options).map(o => o.text));
            if (options.some((o: string) => o.includes('Value Added Tax'))) {
                taxObligationSelect = sel;
                break;
            }
        }
        if (!taxObligationSelect) {
            throw new Error('Could not find the Tax Obligation dropdown with VAT option');
        }
        await taxObligationSelect.selectOption({ label: 'Value Added Tax (VAT)' });
        await log('VAT obligation selected from dropdown');
        await page.waitForTimeout(1000);

        // Click Next
        await log('Clicking Next on obligation form...');
        const nextBtn = page.locator('input[name="nextBtn"], input[type="button"][value*="Next"], button:has-text("Next")').first();
        await nextBtn.click();
        await log('Clicked Next');
        await page.waitForTimeout(3000);
        await log(`Current URL after Next: ${page.url()}`);

        // Wait for the VAT return form to load (Download button should appear)
        await log('Waiting for VAT return form...');
        await page.waitForSelector('#dwnlod_btn_tims, input[type="button"][value*="Autopopulated"], button:has-text("Autopopulated")', {
            timeout: 20_000,
        });
        await log('VAT return form loaded');

        // Download auto-populated VAT return
        await log('Downloading auto-populated VAT return...');
        const sourceZipPath = await downloadVatAutoPopulatedReturn(page, KRA_PIN);
        await log(`Downloaded VAT package: ${sourceZipPath}`);

        // Close browser
        await close();
        await log('Browser closed');

        // Generate VAT ZIP
        await log('Generating VAT ZIP...');
        const { prepareVatReturnArtifacts } = await import('../scripts/vat-return-generator');
        const artifacts = await prepareVatReturnArtifacts({
            sourceZipPath,
            clientName: CLIENT_NAME,
            taxpayerPin: KRA_PIN,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            previousCredit: VAT_PREVIOUS_CREDIT,
        });

        await log(`VAT ZIP generated: ${artifacts.generatedZipPath}`);
        await log(`Summary: inputVat=${artifacts.summary.inputVat}, outputVat=${artifacts.summary.outputVat}, netVatBalance=${artifacts.summary.netVatBalance}`);

        // Copy to output
        const outputDir = path.join(TMP_DIR, 'vat-output');
        await fs.mkdir(outputDir, { recursive: true });
        const finalZipPath = path.join(outputDir, `${jobId}_VAT_Generated.zip`);
        await fs.copyFile(artifacts.generatedZipPath, finalZipPath);
        await log(`Final ZIP: ${finalZipPath}`);

        console.log('\n✅ Local VAT test completed successfully!');
        console.log(`Generated ZIP: ${finalZipPath}`);
        console.log(`Source ZIP: ${sourceZipPath}`);
        console.log(`Log: ${path.join(TMP_DIR, `${jobId}.log`)}`);

    } catch (error: any) {
        await log(`ERROR: ${error.message}`);
        console.error('\n❌ Local VAT test failed:', error.message);
        try {
            const failScreenshot = path.join(TMP_DIR, `failure-${jobId}.png`);
            await page.screenshot({ path: failScreenshot, fullPage: true });
            console.log(`Screenshot: ${failScreenshot}`);
        } catch {}
        try {
            await close();
        } catch {}
        process.exit(1);
    }
}

runLocalVatTest().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
