const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'frontend', 'src', 'assets', 'screenshots');

async function captureScreenshots() {
    // Create output directory
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
        // 1. Landing Page
        console.log('Capturing landing page...');
        await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 30000 });
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'landing-page.png'), fullPage: true });
        console.log('✓ landing-page.png');

        // 2. Dashboard
        console.log('Capturing dashboard...');
        await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000); // Wait for data to load
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'dashboard.png'), fullPage: true });
        console.log('✓ dashboard.png');

        // 3. Dashboard - Desktop 9th View (PAYE/NSSF)
        console.log('Capturing Desk 9th view...');
        await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);
        // Click on 9th desk if sidebar nav exists
        const desk9thLink = await page.$('text=/9th|Payroll|Desk 9th/i');
        if (desk9thLink) {
            await desk9thLink.click();
            await page.waitForTimeout(2000);
        }
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'dashboard-desk9th.png'), fullPage: true });
        console.log('✓ dashboard-desk9th.png');

        // 4. Dashboard - Desktop 20th View (VAT/TOT/MRI)
        console.log('Capturing Desk 20th view...');
        const desk20thLink = await page.$('text=/20th|Monthly|Desk 20th/i');
        if (desk20thLink) {
            await desk20thLink.click();
            await page.waitForTimeout(2000);
        }
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'dashboard-desk20th.png'), fullPage: true });
        console.log('✓ dashboard-desk20th.png');

        // 5. Dashboard - Clients View
        console.log('Capturing clients view...');
        const clientsLink = await page.$('text=/Clients|Directory/i');
        if (clientsLink) {
            await clientsLink.click();
            await page.waitForTimeout(2000);
        }
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'dashboard-clients.png'), fullPage: true });
        console.log('✓ dashboard-clients.png');

        // 6. Dashboard - Overview
        console.log('Capturing overview view...');
        const overviewLink = await page.$('text=/Overview|Dashboard/i');
        if (overviewLink) {
            await overviewLink.click();
            await page.waitForTimeout(2000);
        }
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'dashboard-overview.png'), fullPage: true });
        console.log('✓ dashboard-overview.png');

        console.log('\n✅ All screenshots captured!');
        console.log(`📁 Location: ${OUTPUT_DIR}`);
        
    } catch (error) {
        console.error('❌ Error capturing screenshots:', error.message);
        // Still capture what we can
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'error-state.png'), fullPage: true });
    } finally {
        await browser.close();
    }
}

captureScreenshots();
