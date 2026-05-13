const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'frontend', 'src', 'assets', 'screenshots');

async function captureScreenshots() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    try {
        // 1. Landing Page (new design)
        console.log('Capturing new landing page...');
        await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'landing-page-v2.png'), fullPage: true });
        console.log('✓ landing-page-v2.png');

        // 2. Landing Page - Hero section only
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'landing-hero.png') });
        console.log('✓ landing-hero.png');

        // 3. Dashboard
        console.log('Capturing dashboard...');
        await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'dashboard-v2.png'), fullPage: true });
        console.log('✓ dashboard-v2.png');

        // 4. Dashboard - Desk 9th
        console.log('Capturing Desk 9th view...');
        const links = await page.$$('a, button');
        for (const link of links) {
            const text = await link.textContent();
            if (text && text.match(/9th|Payroll|Desk 9th/i)) {
                await link.click();
                await page.waitForTimeout(2000);
                break;
            }
        }
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'dashboard-desk9th-v2.png'), fullPage: true });
        console.log('✓ dashboard-desk9th-v2.png');

        // 5. Dashboard - Desk 20th
        console.log('Capturing Desk 20th view...');
        const links20 = await page.$$('a, button');
        for (const link of links20) {
            const text = await link.textContent();
            if (text && text.match(/20th|Monthly|Returns/i)) {
                await link.click();
                await page.waitForTimeout(2000);
                break;
            }
        }
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'dashboard-desk20th-v2.png'), fullPage: true });
        console.log('✓ dashboard-desk20th-v2.png');

        console.log('\n✅ All screenshots captured!');
        console.log(`📁 Location: ${OUTPUT_DIR}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'error-state.png'), fullPage: true });
    } finally {
        await browser.close();
    }
}

captureScreenshots();
