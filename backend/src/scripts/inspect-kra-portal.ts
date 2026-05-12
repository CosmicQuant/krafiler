/**
 * inspect-kra-portal.ts
 *
 * Diagnostic / selector-discovery script. Run this ONCE to:
 *  1. Open a VISIBLE Chrome window (headless: false)
 *  2. Navigate to the real KRA iTax portal
 *  3. Print every input, button, select, and anchor element's attributes
 *     so you can see the real selectors
 *  4. Take a screenshot
 *  5. Pause for 90 seconds so you can interact with the browser manually
 *
 * Run:
 *   npx ts-node src/scripts/inspect-kra-portal.ts
 *   (or after build)  node dist/scripts/inspect-kra-portal.js
 */

import 'dotenv/config';
import path from 'path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const SCREENSHOT_PATH = path.join(__dirname, '..', '..', 'kra-portal-screenshot.png');

async function inspect(): Promise<void> {
    console.log('[Inspector] Launching visible Chrome…');

    const browser = await chromium.launch({
        headless: false,
        slowMo: 300, // slow down each action so you can watch
        args: ['--start-maximized'],
    });

    const context = await browser.newContext({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: null, // use the full window from --start-maximized
        locale: 'en-KE',
        timezoneId: 'Africa/Nairobi',
    });

    const page = await context.newPage();

    console.log('[Inspector] Navigating to KRA iTax portal (timeout: 90s)…');
    try {
        await page.goto('https://itax.kra.go.ke/KRA-Portal/', {
            waitUntil: 'networkidle',
            timeout: 90_000,
        });
        console.log('[Inspector] Page loaded. URL:', page.url());
    } catch (err) {
        console.warn('[Inspector] Navigation timed out or errored:', (err as Error).message);
        console.log('[Inspector] Current URL:', page.url());
        console.log('[Inspector] Taking screenshot of whatever loaded…');
    }

    // ── Take a screenshot ──────────────────────────────────────────────────────
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`[Inspector] Screenshot saved → ${SCREENSHOT_PATH}`);

    // ── Dump all interactive elements with their real attributes ───────────────
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  REAL ELEMENT ATTRIBUTES ON THE KRA PORTAL LOGIN PAGE');
    console.log('═══════════════════════════════════════════════════════════');

    const elements = await page.$$eval(
        'input, button, select, textarea, a[href], [onclick]',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (els: any[]) =>
            els.map((el: any) => {
                const attrs: Record<string, string> = {};
                for (const attr of el.attributes) {
                    attrs[attr.name] = attr.value.slice(0, 80);
                }
                return {
                    tag: el.tagName.toLowerCase(),
                    text: (el.textContent ?? '').trim().slice(0, 60),
                    attrs,
                };
            })
    );

    for (const el of elements) {
        const attrStr = Object.entries(el.attrs)
            .map(([k, v]) => `${k}="${v}"`)
            .join('  ');
        console.log(`<${el.tag}> ${attrStr}${el.text ? `  [text: "${el.text}"]` : ''}`);
    }

    // ── Also log page title and all frame URLs ─────────────────────────────────
    console.log('\n[Inspector] Page title:', await page.title());
    const frames = page.frames();
    if (frames.length > 1) {
        console.log('[Inspector] FRAMES detected (portal may use iframes):');
        for (const frame of frames) {
            console.log('  Frame URL:', frame.url());
        }
    }

    // ── Pause 90 seconds — interact with the browser manually if needed ────────
    console.log('\n[Inspector] Pausing for 90 seconds. Interact with the browser now.');
    console.log('[Inspector] Press Ctrl+C to exit early.\n');
    await new Promise<void>((resolve) => setTimeout(resolve, 90_000));

    await browser.close();
    console.log('[Inspector] Done.');
}

inspect().catch((err) => {
    console.error('[Inspector] Fatal error:', err);
    process.exit(1);
});
