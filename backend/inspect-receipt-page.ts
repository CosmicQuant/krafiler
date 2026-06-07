import 'dotenv/config';
import { chromium } from 'playwright';

async function main() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    // Login to NSSF
    console.log('Logging in...');
    await page.goto('https://eservice.nssfkenya.co.ke/eSF24/faces/login.xhtml', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.fill('input[id$="username"]', '21888523');
    await page.fill('input[id$="password"]', '21888523');
    await page.click('input[value="Login"]');
    await page.waitForTimeout(3000);

    // Navigate to payment order
    console.log('Navigating to payment order...');
    await page.goto('https://eservice.nssfkenya.co.ke/eSF24/faces/secureAdmin/paymentOrder.xhtml', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Get the rendered HTML
    console.log('Getting page content...');
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    console.log('HTML length:', html.length);
    console.log('HTML preview:', html.substring(0, 2000));

    // Check if we can find the print button
    const printButton = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a, input'));
        return buttons.map(b => ({
            tag: b.tagName,
            text: b.textContent?.substring(0, 50),
            id: b.id,
            class: b.className,
        })).filter(b => b.text?.toLowerCase().includes('print') || b.id?.toLowerCase().includes('print'));
    });
    console.log('Print buttons found:', printButton);

    // Check if there's a PDF embed or iframe
    const embeds = await page.evaluate(() => {
        const embeds = Array.from(document.querySelectorAll('embed, iframe, object'));
        return embeds.map(e => ({
            tag: e.tagName,
            src: e.getAttribute('src')?.substring(0, 100),
            type: e.getAttribute('type'),
        }));
    });
    console.log('Embeds/iframes:', embeds);

    // Check the shadow DOM for PDF viewer
    const shadowInfo = await page.evaluate(() => {
        const viewer = document.querySelector('pdf-viewer');
        if (!viewer) return null;
        return {
            tag: viewer.tagName,
            shadowRoot: !!viewer.shadowRoot,
        };
    });
    console.log('PDF viewer element:', shadowInfo);

    await browser.close();
}

main().catch(console.error);
