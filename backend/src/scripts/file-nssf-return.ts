import { chromium } from 'playwright-extra';
import * as path from 'path';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { PDFDocument } from 'pdf-lib';

async function resolveNssfFile(filePath: string): Promise<string> {
    // If it's already a local absolute path, use it directly
    if (path.isAbsolute(filePath) && !filePath.startsWith('http')) {
        return filePath;
    }

    let ext = '.xlsx';
    try {
        ext = path.extname(new URL(filePath).pathname) || '.xlsx';
    } catch {
        ext = path.extname(filePath.split('?')[0]) || '.xlsx';
    }
    const tmpPath = path.join(tmpdir(), `nssf-upload-${Date.now()}${ext}`);

    // If it's a GCS signed URL, use the SDK directly (more reliable than fetch)
    if (filePath.includes('storage.googleapis.com')) {
        try {
            const url = new URL(filePath);
            const parts = url.pathname.split('/').filter(Boolean);
            parts.shift(); // remove bucket name
            const gcsPath = parts.join('/');
            if (!gcsPath) {
                throw new Error('Could not parse GCS path from URL');
            }
            const { downloadToTemp } = await import('../lib/cloudStorage');
            return await downloadToTemp(gcsPath, tmpdir());
        } catch (e: any) {
            console.error('[resolveNssfFile] GCS download failed:', e.message, 'URL:', filePath.substring(0, 200));
            throw new Error(`Failed to download from GCS: ${e.message}`);
        }
    }

    // Fallback: fetch via HTTP
    const url = filePath.startsWith('http') ? filePath : `http://localhost:3000${filePath.startsWith('/') ? '' : '/'}${filePath}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download NSSF file: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(tmpPath, buffer);
    return tmpPath;
}

function normalizePeriod(p: string) {
    return p.replace(/^0+/, '').replace(/\/0+/, '/');
}

interface SubmissionRow {
    period: string;
    state: string;
    action: string;
    rowIndex: number;
}

async function scanSubmissions(page: any): Promise<SubmissionRow[]> {
    return await page.evaluate(() => {
        const rows = document.querySelectorAll('.ui-datatable-data tr, .ui-datatable tbody tr');
        const results: SubmissionRow[] = [];
        rows.forEach((row, idx) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 6) return;
            const period = cells[1]?.textContent?.trim() || '';
            const state = cells[4]?.textContent?.trim() || '';
            const action = cells[5]?.textContent?.trim() || '';
            if (period) {
                results.push({ period, state, action, rowIndex: idx });
            }
        });
        return results;
    });
}

function delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

export async function fileNssfReturn(job: any, username: string, password: string, filePath: string, submissionPeriod: string, outputDir?: string): Promise<{ paymentOrderPath: string | null }> {
    const resolvedFilePath = await resolveNssfFile(filePath);
    const isHeadless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
    const browser = await chromium.launch({ headless: isHeadless });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1200, height: 1600 },
        deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    async function updateProgress(step: number, message: string, progress: number, level: string = 'info') {
        if (job) {
            await job.log(JSON.stringify({ timestamp: new Date().toISOString(), message: `[Step ${step}/4] ${message}`, progress, level }));
            await job.updateProgress(progress);
        }
    }

    try {
        // ── 1. Log in ──────────────────────────────────────────────────
        await updateProgress(1, 'Navigating to NSSF login page...', 10);
        console.log('Navigating to NSSF login page...');
        await page.goto('https://eservice.nssfkenya.co.ke/eSF24/faces/login.xhtml', {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        });
        await delay(2000);

        // Strip session ID from form action to avoid JSF 404 on login
        await page.evaluate(() => {
            const forms = document.querySelectorAll('form');
            forms.forEach((f) => {
                if (f.action && f.action.includes(';eSF24SESSIONID=')) {
                    f.action = f.action.split(';')[0];
                }
            });
        });

        await updateProgress(1, 'Logging into NSSF portal...', 20);
        console.log('Logging in...');
        await page.fill('input[id$="username"]', username);
        await page.fill('input[id$="password"]', password);
        await page.click('input[value="Login"]');
        await delay(3000);

        // ── 2. Navigate to SF24 Submissions ──────────────────────────────
        await updateProgress(2, 'Navigating to SF24 Submissions...', 30);
        console.log('Navigating to SF24 Submissions page...');
        await page.goto('https://eservice.nssfkenya.co.ke/eSF24/faces/secureAdmin/submissions.xhtml', {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        });
        await delay(3000);

        // ── 3. Scan table for target period ────────────────────────────
        console.log('Scanning submission table for existing period...');
        let tableRows = await scanSubmissions(page);
        console.log('Table rows found:', tableRows.map((r) => `${r.period} -> ${r.state}`));

        const targetPeriodNorm = normalizePeriod(submissionPeriod);
        let targetRow: SubmissionRow | null = tableRows.find((r) => normalizePeriod(r.period) === targetPeriodNorm) || null;

        // ── 4. Create period if not found ──────────────────────────────
        if (!targetRow) {
            console.log(`  Period ${submissionPeriod} not found — creating new one...`);
            await updateProgress(2, 'Creating new submission period...', 35);

            const createBtn = page.locator('text="Create Submission Period"').first();
            if (await createBtn.isHidden()) {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await delay(1000);
            }
            await createBtn.click({ force: true });
            await delay(2000);

            // Wait for modal dialog
            await page.waitForSelector('text=Submission Mode:*', { state: 'visible', timeout: 15000 });
            const visibleDialog = page.locator('div.ui-dialog:visible');

            // Fill period
            const periodInput = visibleDialog.locator('input[type="text"]').first();
            await periodInput.click();
            await delay(500);
            await periodInput.fill('');
            await delay(200);
            await periodInput.pressSequentially(submissionPeriod, { delay: 100 });
            console.log(`  Filled period: ${submissionPeriod}`);

            // Select Normal / Standard from dropdowns
            const dropdownTriggers = await visibleDialog.locator('.ui-selectonemenu-trigger').all();
            for (const trigger of dropdownTriggers) {
                await trigger.click({ force: true });
                await delay(1000);
                const optionsPanel = page.locator('div.ui-selectonemenu-panel:visible').first();
                if (await optionsPanel.isVisible()) {
                    const optionItems = await optionsPanel.locator('li.ui-selectonemenu-item').all();
                    let foundMatch = false;
                    for (const item of optionItems) {
                        const text = await item.textContent();
                        const lower = text?.toLowerCase() || '';
                        if (lower.includes('normal') || lower.includes('standard')) {
                            console.log(`  Selecting: ${text}`);
                            await item.click({ force: true });
                            foundMatch = true;
                            break;
                        }
                    }
                    if (!foundMatch) {
                        await page.keyboard.press('Escape');
                    }
                    await delay(500);
                }
            }

            // Click Open
            const openBtn = visibleDialog.locator('text="Open"').first();
            await openBtn.evaluate((node: HTMLElement) => node.click());
            await delay(2000);

            // Handle any response dialog
            const anyDialog = page.locator('div.ui-dialog:visible').first();
            if (await anyDialog.isVisible()) {
                const dialogText = (await anyDialog.textContent()) || '';
                if (dialogText.includes('pending submissions')) {
                    await anyDialog.locator('button', { hasText: /Close/i }).first().click({ force: true });
                } else {
                    await anyDialog.locator('button', { hasText: /OK/i }).first().click({ force: true });
                }
                await delay(1500);
            }

            // Re-scan until period appears
            console.log('  Re-scanning table for newly created period...');
            for (let attempt = 0; attempt < 10; attempt++) {
                await page.reload();
                await delay(3000);
                tableRows = await scanSubmissions(page);
                console.log(`    Scan attempt ${attempt + 1}: found ${tableRows.length} rows`);
                targetRow = tableRows.find((r) => normalizePeriod(r.period) === targetPeriodNorm) || null;
                if (targetRow) {
                    console.log(`    Found new row: ${targetRow.period} -> ${targetRow.state}`);
                    break;
                }
            }
        }

        if (!targetRow) {
            throw new Error(`Could not find or create submission period for ${submissionPeriod}`);
        }

        console.log(`  Target row: period=${targetRow.period}, state=${targetRow.state}, action=${targetRow.action}`);

        // ── Helper: refresh and re-scan target row ─────────────────────
        async function refreshTarget() {
            try {
                await page.reload();
            } catch {
                await page.goto('https://eservice.nssfkenya.co.ke/eSF24/faces/secureAdmin/submissions.xhtml', { waitUntil: 'domcontentloaded', timeout: 30000 });
            }
            await delay(3000);
            const rows = await scanSubmissions(page);
            const found = rows.find((r) => normalizePeriod(r.period) === targetPeriodNorm) || null;
            if (found) {
                console.log(`  Refreshed state: ${found.state} | Action: ${found.action}`);
            }
            return found;
        }

        function checkStructuralErrors(row: SubmissionRow) {
            if (!row) return;
            const state = row.state.toUpperCase();
            if (state.includes('FILE STRUCTURAL ERRORS') || state.includes('ERRONEOUS') || state.includes('INVALID') || state.includes('REJECTED')) {
                throw new Error(`NSSF file has structural errors: state="${row.state}" action="${row.action}" — fix the generated file and try again`);
            }
        }

        // ── State Machine ─────────────────────────────────────────────
        let currentRow: SubmissionRow | null = targetRow;
        const MAX_RETRIES = 30;

        // State 1: OPENED PERIOD → Upload file
        if (currentRow.state.includes('OPENED PERIOD')) {
            await updateProgress(3, 'Uploading NSSF file...', 50);
            console.log('State is OPENED PERIOD — uploading file...');

            // Locate the File Upload link within the correct row
            const allRows = await page.locator('.ui-datatable-data tr, .ui-datatable tbody tr').all();
            const targetIdx = currentRow.rowIndex;
            const targetDomRow = allRows[targetIdx];
            if (!targetDomRow) {
                throw new Error(`Could not locate DOM row at index ${targetIdx}`);
            }
            const fileUploadLink = targetDomRow.locator('a').filter({ hasText: 'File Upload' }).first();
            await fileUploadLink.click({ force: true });
            await delay(3000);

            // Upload real file
            console.log('  Uploading file...');
            const fileInput = page.locator('input[type="file"]');
            await fileInput.setInputFiles(path.resolve(resolvedFilePath));
            await delay(2000);

            const uploadBtn = page.locator('button, a').filter({ hasText: /Upload/i }).first();
            await uploadBtn.click({ force: true });
            await delay(5000);

            // Click Back
            const backBtn = page.locator('button, a').filter({ hasText: /^Back$/i }).first();
            await backBtn.click({ force: true });
            await delay(3000);

            // Wait for state to change from OPENED PERIOD
            console.log('  Waiting for state to change from OPENED PERIOD...');
            for (let i = 0; i < MAX_RETRIES; i++) {
                currentRow = await refreshTarget();
                if (!currentRow) break;
                checkStructuralErrors(currentRow);
                if (!currentRow.state.includes('OPENED PERIOD')) {
                    console.log(`  State changed to: ${currentRow.state}`);
                    break;
                }
                await delay(2000);
            }
        }

        // State 2: SUBMISSION CHECK → Click Check Submission
        if (currentRow && currentRow.state.includes('SUBMISSION CHECK') && !currentRow.state.includes('IN PROGRESS')) {
            await updateProgress(4, 'Running submission error check...', 60);
            console.log('State is SUBMISSION CHECK — clicking Check Submission...');

            const checkSubBtn = page.locator('a').filter({ hasText: 'Check Submission' }).first();
            await checkSubBtn.click({ force: true });
            await delay(3000);

            // Handle "initiated" modal
            const initiatedDialog = page.locator('div.ui-dialog:visible', { hasText: 'initiated' }).first();
            if (await initiatedDialog.isVisible()) {
                await initiatedDialog.locator('button', { hasText: 'OK' }).first().click({ force: true });
                await delay(1000);
            }

            // Wait for state to change to IN PROGRESS
            console.log('  Waiting for state to change to IN PROGRESS...');
            for (let i = 0; i < MAX_RETRIES; i++) {
                currentRow = await refreshTarget();
                if (!currentRow) break;
                checkStructuralErrors(currentRow);
                if (currentRow.state.includes('IN PROGRESS')) {
                    console.log(`  State changed to: ${currentRow.state}`);
                    break;
                }
                await delay(3000);
            }
        }

        // State 3: IN PROGRESS → Click Progress Update
        if (currentRow && currentRow.state.includes('IN PROGRESS')) {
            await updateProgress(5, 'Checking submission progress...', 70);
            console.log('State is IN PROGRESS — clicking Progress Update...');

            const progressUpdateBtn = page.locator('a').filter({ hasText: /Progress Update/i }).first();
            if (await progressUpdateBtn.isVisible()) {
                await progressUpdateBtn.click({ force: true });
                await delay(3000);

                const modifiedDialog = page.locator('div.ui-dialog:visible', { hasText: 'modified' }).first();
                if (await modifiedDialog.isVisible()) {
                    await modifiedDialog.locator('button', { hasText: 'OK' }).first().click({ force: true });
                    await delay(1000);
                }
            }

            // Wait for state to change to TO BE SUBMITTED
            console.log('  Waiting for state to change to TO BE SUBMITTED...');
            for (let i = 0; i < MAX_RETRIES; i++) {
                currentRow = await refreshTarget();
                if (!currentRow) break;
                checkStructuralErrors(currentRow);
                if (currentRow.state.includes('TO BE SUBMITTED')) {
                    console.log(`  State changed to: ${currentRow.state}`);
                    break;
                }
                await delay(3000);
            }
        }

        // State 4: TO BE SUBMITTED → Click Submission
        if (currentRow && currentRow.state.includes('TO BE SUBMITTED')) {
            await updateProgress(6, 'Finalizing submission...', 80);
            console.log('State is TO BE SUBMITTED — clicking Submission...');

            const submitActionLink = page.locator('a').filter({ hasText: /^Submission$/i }).first();
            await submitActionLink.click({ force: true });
            await delay(5000);

            // Verify final state
            currentRow = await refreshTarget();
            if (currentRow && currentRow.state.includes('SUBMISSION') && !currentRow.state.includes('CHECK') && !currentRow.state.includes('TO BE')) {
                console.log(`  Final state: ${currentRow.state} — SUBMISSION COMPLETE!`);
            }
        }

        // State 5: Already SUBMITTED
        if (currentRow && currentRow.state.includes('SUBMISSION') && !currentRow.state.includes('CHECK') && !currentRow.state.includes('TO BE')) {
            console.log(`  State is already ${currentRow.state} — filing was already complete!`);
        }

        // ── 7. Proceed to Payment Order ─────────────────────────────────
        await updateProgress(7, 'Creating Payment Order...', 90);
        console.log('Navigating to Payment Order...');
        const paymentOrderLink = page.locator('a, span').filter({ hasText: 'Payment Order' }).first();
        if (await paymentOrderLink.isVisible()) {
            await paymentOrderLink.click({ force: true });
            await delay(4000);

            console.log('Entering Bank Code...');
            try {
                const bankLabel = page.locator('label').filter({ hasText: /Bank Code/i }).first();
                const bankInputId = await bankLabel.getAttribute('for');
                if (bankInputId) {
                    await page.fill(`[id="${bankInputId}"]`, '1');
                }
            } catch (e) {}
            await delay(2000);

            // Drag unpaid SF24 row into "Selected SF24s for Payment"
            await updateProgress(8, 'Attaching SF24 to Payment Order...', 95);
            console.log('Adding unpaid SF24 to Selected SF24s for Payment...');
            try {
                const periodNorm = normalizePeriod(submissionPeriod);

                // ── Robust drag: find elements via DOM, get precise coordinates, drag with mouse ──
                const dragResult = await page.evaluate((periodText) => {
                    const isVisible = (el: Element) => {
                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        return rect.width > 0 && rect.height > 0 &&
                            style.display !== 'none' && style.visibility !== 'hidden' &&
                            style.opacity !== '0';
                    };

                    // 1. Find the panel/fieldset/div containing "Unpaid SF24s" header AND a table
                    //    We need the SMALLEST visible element that has "Unpaid SF24s" in its text
                    //    AND contains a <table> descendant. This is the Unpaid panel.
                    const allElements = Array.from(document.querySelectorAll('*'));
                    let sourcePanel: Element | null = null;
                    let sourceTable: Element | null = null;
                    for (const el of allElements) {
                        if (!isVisible(el)) continue;
                        if (!el.textContent || !el.textContent.includes('Unpaid SF24s')) continue;
                        // Must contain at least one visible table
                        const innerTable = Array.from(el.querySelectorAll('table')).find((t) => isVisible(t));
                        if (!innerTable) continue;
                        // Prefer the smallest (most specific) panel
                        if (!sourcePanel || (el.getBoundingClientRect().width * el.getBoundingClientRect().height) <
                            (sourcePanel.getBoundingClientRect().width * sourcePanel.getBoundingClientRect().height)) {
                            sourcePanel = el;
                            sourceTable = innerTable;
                        }
                    }

                    if (!sourcePanel || !sourceTable) {
                        return {
                            ok: false,
                            reason: 'Unpaid SF24s panel not found',
                            sourceFound: false,
                            targetFound: false,
                            dropFound: false,
                        };
                    }

                    // 2. Find the row in the source table matching the period
                    const rows = sourceTable.querySelectorAll('tbody tr');
                    let sourceRow: Element | null = null;
                    for (const r of Array.from(rows)) {
                        if (!isVisible(r)) continue;
                        if (r.textContent && r.textContent.includes(periodText)) {
                            sourceRow = r;
                            break;
                        }
                    }

                    if (!sourceRow) {
                        return {
                            ok: false,
                            reason: `no row in Unpaid table matches period "${periodText}"`,
                            sourceFound: false,
                            targetFound: !!sourcePanel,
                            dropFound: false,
                            panelText: (sourcePanel.textContent || '').substring(0, 300),
                        };
                    }

                    // 3. Find the + icon in the source row (it's in the first column)
                    //    PrimeFaces orderList uses class names like ui-icon-plus, ui-icon-arrowreturn-1-s,
                    //    or the row-toggler. The + can also be a <span> with class containing "plus" or
                    //    just the first clickable <a> in the row.
                    const firstCell = sourceRow.querySelector('td');
                    const plusCandidates = firstCell
                        ? Array.from(firstCell.querySelectorAll('a, button, span, .ui-icon, .ui-row-toggler, .ui-commandlink'))
                        : [];
                    let plusIcon: Element | null = null;
                    for (const cand of plusCandidates) {
                        if (!isVisible(cand)) continue;
                        const cls = (cand.className && typeof cand.className === 'string') ? cand.className : '';
                        const txt = (cand.textContent || '').trim();
                        if (cls.includes('ui-icon-plus') || cls.includes('ui-icon-add') ||
                            cls.includes('ui-row-toggler') || txt === '+' ||
                            cls.includes('ui-commandlink')) {
                            plusIcon = cand;
                            break;
                        }
                    }
                    // Fallback: first clickable/link in the row
                    if (!plusIcon) {
                        for (const cand of plusCandidates) {
                            if (!isVisible(cand)) continue;
                            const tag = cand.tagName;
                            if (tag === 'A' || tag === 'BUTTON') {
                                plusIcon = cand;
                                break;
                            }
                        }
                    }
                    // Final fallback: first cell center
                    const dragHandle = plusIcon || firstCell || sourceRow;

                    // 4. Find the drop zone by looking for "!!!Drop Unpaid SF24s here!!!" text
                    //    directly, then walk up to find the smallest visible container that
                    //    also has "Selected SF24s for Payment" in its text.
                    let dropZone: Element | null = null;
                    for (const el of Array.from(document.querySelectorAll('*'))) {
                        if (!isVisible(el)) continue;
                        if (!el.textContent) continue;
                        // Direct child match: text contains the placeholder exactly
                        if (el.children.length === 0 && el.textContent.includes('!!!Drop Unpaid SF24s here!!!')) {
                            // Walk up to the smallest visible parent that contains "Selected SF24s for Payment"
                            let p: Element | null = el;
                            let bestParent: Element = el;
                            for (let i = 0; i < 15 && p; i++) {
                                if (isVisible(p) && p.textContent && p.textContent.includes('Selected SF24s for Payment')) {
                                    bestParent = p;
                                    break;
                                }
                                p = p.parentElement;
                            }
                            dropZone = bestParent;
                            break;
                        }
                    }
                    // If still not found, look for ANY element with the placeholder text
                    if (!dropZone) {
                        for (const el of Array.from(document.querySelectorAll('*'))) {
                            if (!isVisible(el)) continue;
                            if (el.textContent && el.textContent.includes('!!!Drop Unpaid SF24s here!!!')) {
                                dropZone = el;
                                break;
                            }
                        }
                    }

                    if (!dropZone) {
                        return {
                            ok: false,
                            reason: 'drop zone not found (no element contains !!!Drop Unpaid SF24s here!!!)',
                            sourceFound: true,
                            targetFound: false,
                            dropFound: false,
                        };
                    }

                    const sRect = dragHandle.getBoundingClientRect();
                    const dRect = dropZone.getBoundingClientRect();

                    return {
                        ok: true,
                        sx: sRect.left + sRect.width / 2,
                        sy: sRect.top + sRect.height / 2,
                        dx: dRect.left + dRect.width / 2,
                        dy: dRect.top + dRect.height / 2,
                        sourceBox: { x: sRect.x, y: sRect.y, w: sRect.width, h: sRect.height },
                        dropBox: { x: dRect.x, y: dRect.y, w: dRect.width, h: dRect.height },
                        handleTag: dragHandle.tagName,
                        handleClass: (dragHandle.className && typeof dragHandle.className === 'string') ? dragHandle.className.substring(0, 100) : '',
                    };
                }, periodNorm);

                console.log('  Drag discovery result:', JSON.stringify(dragResult, null, 2));

                if (dragResult.ok) {
                    const { sx, sy, dx, dy, handleTag, handleClass } = dragResult as any;
                    console.log(`  Dragging from ${handleTag}.${handleClass} at (${Math.round(sx)},${Math.round(sy)}) to drop zone at (${Math.round(dx)},${Math.round(dy)})`);

                    // jQuery UI draggable needs mousedown → small move to exceed threshold → drag to target → mouseup
                    // PrimeFaces orderList items are registered as jQuery UI draggable
                    await page.mouse.move(sx, sy);
                    await page.mouse.down();
                    await delay(150);
                    // First small move to exceed jQuery UI drag threshold (typically 3-5px)
                    await page.mouse.move(sx + 5, sy + 5, { steps: 3 });
                    await delay(150);
                    // Move to mid-point
                    await page.mouse.move((sx + dx) / 2, (sy + dy) / 2, { steps: 10 });
                    await delay(200);
                    // Final approach to drop zone
                    await page.mouse.move(dx, dy, { steps: 20 });
                    await delay(800); // hover time for jQuery UI droppable to register
                    await page.mouse.up();
                    console.log('  Manual drag completed');
                    await delay(2000);
                } else {
                    const r = dragResult as any;
                    console.log('  Drag discovery failed:', r.reason);
                    if (r.panelText) console.log('  Source panel text:', r.panelText);
                }

                // ── Fallback: click the + button directly if drag didn't move the row ──
                // PrimeFaces orderList has a + commandLink that adds the row via AJAX.
                // If the row is now in the "Selected" panel, skip; otherwise click +.
                const moveCheck = await page.evaluate((periodText) => {
                    const isVisible = (el: Element) => {
                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        return rect.width > 0 && rect.height > 0 &&
                            style.display !== 'none' && style.visibility !== 'hidden';
                    };
                    // Look in the Selected panel for a row containing the period
                    const tables = Array.from(document.querySelectorAll('table'));
                    for (const t of tables) {
                        if (!isVisible(t)) continue;
                        let p: Element | null = t;
                        for (let i = 0; i < 10 && p; i++) {
                            if (isVisible(p) && p.textContent && p.textContent.includes('Selected SF24s for Payment')) {
                                const rows = t.querySelectorAll('tbody tr');
                                for (const r of Array.from(rows)) {
                                    if (r.textContent && r.textContent.includes(periodText)) {
                                        return { moved: true };
                                    }
                                }
                                return { moved: false };
                            }
                            p = p.parentElement;
                        }
                    }
                    return { moved: false, noSelectedPanel: true };
                }, periodNorm);

                console.log('  After-drag check:', moveCheck);

                if (!moveCheck.moved) {
                    console.log('  Row not in Selected panel — trying click + as fallback...');
                    const clickResult = await page.evaluate((periodText) => {
                        const isVisible = (el: Element) => {
                            const rect = el.getBoundingClientRect();
                            const style = window.getComputedStyle(el);
                            return rect.width > 0 && rect.height > 0 &&
                                style.display !== 'none' && style.visibility !== 'hidden';
                        };
                        // Find Unpaid panel + its table
                        const tables = Array.from(document.querySelectorAll('table'));
                        for (const t of tables) {
                            if (!isVisible(t)) continue;
                            let p: Element | null = t;
                            for (let i = 0; i < 10 && p; i++) {
                                if (isVisible(p) && p.textContent && p.textContent.includes('Unpaid SF24s')) {
                                    const rows = t.querySelectorAll('tbody tr');
                                    for (const r of Array.from(rows)) {
                                        if (!isVisible(r)) continue;
                                        if (r.textContent && r.textContent.includes(periodText)) {
                                            // Find the + link in the first cell
                                            const firstCell = r.querySelector('td');
                                            if (!firstCell) return { clicked: false, reason: 'no first cell' };
                                            const candidates = Array.from(firstCell.querySelectorAll('a, button, .ui-commandlink, .ui-row-toggler, .ui-icon-plus, .ui-icon-add'));
                                            for (const c of candidates) {
                                                if (!isVisible(c)) continue;
                                                (c as HTMLElement).click();
                                                return { clicked: true, tag: c.tagName, class: (c.className && typeof c.className === 'string') ? c.className.substring(0, 80) : '' };
                                            }
                                            return { clicked: false, reason: 'no + candidate in first cell' };
                                        }
                                    }
                                    return { clicked: false, reason: 'period row not in Unpaid table' };
                                }
                                p = p.parentElement;
                            }
                        }
                        return { clicked: false, reason: 'Unpaid table not found' };
                    }, periodNorm);

                    console.log('  + click result:', clickResult);
                    await delay(3000);
                }
            } catch (dragErr: any) {
                console.error('Drag-and-drop failed:', dragErr.message);
            }

            // Save Payment Order
            console.log('Clicking Save on Payment Order...');
            const saveBtn = page.locator('button').filter({ hasText: /^Save$/i }).first();
            if (await saveBtn.isVisible()) {
                await saveBtn.click();
            } else {
                await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const btn = btns.find((b) => b.innerHTML.includes('ui-icon-disk') || (b.title && b.title.includes('Save')));
                    if (btn) btn.click();
                });
            }

            // ── Wait for success dialog ───────────────────────────────────────
            console.log('Waiting for post-save dialog (up to 30s)...');
            let okClicked = false;
            let receiptPage: any = null;
            for (let i = 0; i < 30; i++) {
                await delay(1000);
                const dialogs = await page.locator('.ui-dialog:visible').all();
                for (const dlg of dialogs) {
                    const txt = (await dlg.textContent()) || '';
                    if (txt.includes('successfully saved') || txt.includes('System Notice') || txt.includes('Payment Order')) {
                        console.log('Dialog:', txt.substring(0, 120).replace(/\s+/g, ' '));
                        const ok = dlg.locator('button').filter({ hasText: /^OK$/i }).first();
                        if (await ok.isVisible()) {
                            // Capture the actual response that populates the new window.
                            // The response captured here is the real bytes NSSF sends to the
                            // browser — it may be a PDF (rendered in Chrome's PDF viewer)
                            // or HTML. This is more reliable than refetching the URL.
                            // We match on URL pattern because receiptPage is still null
                            // when the response fires.
                            let capturedResponse: any = null;
                            const responseHandler = (response: any) => {
                                try {
                                    const u = response.url() || '';
                                    if (u.includes('paymentOrder') || u.includes('receipt') || u.includes('PaymentOrder')) {
                                        capturedResponse = response;
                                    }
                                } catch {}
                            };
                            context.on('response', responseHandler);

                            // Set up listener RIGHT BEFORE clicking OK
                            const newPagePromise = context.waitForEvent('page', { timeout: 30000 });
                            await ok.click();
                            console.log('Clicked OK');
                            okClicked = true;
                            await delay(3000);

                            // Now wait for the new receipt window
                            try {
                                receiptPage = await newPagePromise;
                                console.log('New receipt window opened');
                                console.log('  Receipt URL:', receiptPage.url());
                                console.log('  Receipt title:', await receiptPage.title().catch(() => 'n/a'));
                            } catch (e: any) {
                                console.log('No new window opened; will capture current page. Err:', e.message);
                            }
                            context.off('response', responseHandler);
                            (globalThis as any).__lastCapturedResponse = capturedResponse;
                            break;
                        }
                    }
                }
                if (okClicked) break;
            }
            if (!okClicked) {
                console.log('No post-save dialog detected within 30s');
            }

            // Capture payment order receipt as PDF
            let paymentOrderPath: string | null = null;
            try {
                const pdfDir = outputDir || tmpdir();
                paymentOrderPath = path.join(pdfDir, `nssf-payment-order-${Date.now()}.pdf`);

                if (receiptPage) {
                    const receiptUrl = receiptPage.url();
                    console.log('Receipt window URL:', receiptUrl);

                    // Capture the actual PDF bytes. We try two paths, in order:
                    //  (1) the response that populated the new window (set up by the
                    //      responseHandler before OK was clicked) — this is the real
                    //      bytes NSSF sent to the browser, including any PDF stream
                    //      that the Chrome PDF viewer is rendering.
                    //  (2) a fresh in-page fetch using the browser's SSL trust store.
                    let downloaded = false;
                    let downloadedBuf: Buffer | null = null;
                    let downloadedContentType = '';
                    let downloadedContentDisp = '';
                    const captured = (globalThis as any).__lastCapturedResponse;
                    if (captured && false /* disabled: captured response is often partial */) {
                        try {
                            const buf = await captured.body();
                            const headers = captured.headers();
                            downloadedContentType = headers['content-type'] || '';
                            downloadedContentDisp = headers['content-disposition'] || '';
                            const firstBytes = buf.slice(0, 8).toString('ascii');
                            console.log(`  Captured response: status=${captured.status()} content-type="${downloadedContentType}" content-disposition="${downloadedContentDisp}" size=${buf.length} firstBytes="${firstBytes.replace(/[^\x20-\x7e]/g, '.')}"`);
                            if ((downloadedContentType || '').includes('application/pdf') || firstBytes.startsWith('%PDF')) {
                                downloadedBuf = buf;
                                downloaded = true;
                                console.log('  -> Got actual PDF bytes from captured response (no re-rasterization)');
                            } else if (buf.length > 0) {
                                downloadedBuf = buf;
                                downloadedContentType = 'text/html';
                                console.log('  -> Captured response is HTML; will use it for clean-page render');
                            } else {
                                console.log('  -> Captured response is empty; will try browser fetch');
                            }
                        } catch (capErr: any) {
                            console.log('  captured.body() failed:', capErr.message);
                        }
                    }
                    if (!downloaded) {
                        try {
                            // Wait for the receipt page to fully render after the post-save
                            // navigation. The page first loads the payment-order FORM, then
                            // re-renders with receipt data (UPN, employer, amount, etc.).
                            // We poll until the HTML contains receipt markers.
                            await receiptPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
                            await delay(2000); // give the page time to render receipt data

                            const fetchResult = await receiptPage.evaluate(async (url) => {
                                try {
                                    const r = await fetch(url, { credentials: 'include', redirect: 'follow' });
                                    const ab = await r.arrayBuffer();
                                    // Encode ArrayBuffer to base64 so it can cross the evaluate boundary
                                    const bytes = new Uint8Array(ab);
                                    let bin = '';
                                    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
                                    const b64 = btoa(bin);
                                    return {
                                        ok: r.ok,
                                        status: r.status,
                                        contentType: r.headers.get('content-type') || '',
                                        contentDisposition: r.headers.get('content-disposition') || '',
                                        size: bytes.byteLength,
                                        b64,
                                    };
                                } catch (e: any) {
                                    return { ok: false, error: e?.message || String(e) };
                                }
                            }, receiptUrl);

                            if (fetchResult && (fetchResult as any).ok) {
                                const r = fetchResult as any;
                                downloadedContentType = r.contentType;
                                downloadedContentDisp = r.contentDisposition;
                                const buf = Buffer.from(r.b64, 'base64');
                                const firstBytes = buf.slice(0, 8).toString('ascii');
                                console.log(`  Browser fetch: status=${r.status} content-type="${r.contentType}" content-disposition="${r.contentDisposition}" size=${buf.length} firstBytes="${firstBytes.replace(/[^\x20-\x7e]/g, '.')}"`);

                                if (r.contentType.includes('application/pdf') || firstBytes.startsWith('%PDF')) {
                                    downloadedBuf = buf;
                                    downloaded = true;
                                    console.log('  -> Got actual PDF bytes from NSSF (no re-rasterization)');
                                } else if (buf.length > 0) {
                                    // Treat as HTML and keep the buffer for the clean-page render
                                    downloadedBuf = buf;
                                    downloadedContentType = 'text/html';
                                    console.log('  -> Browser fetch returned HTML; will use it for clean-page render');
                                } else {
                                    console.log('  -> Receipt URL returned no usable content; will fall back to page.pdf()');
                                }
                            } else {
                                console.log('  Browser fetch failed:', (fetchResult as any)?.error || 'unknown');
                            }
                        } catch (dlErr: any) {
                            console.log('  Direct download failed, falling back to page.pdf():', dlErr.message);
                        }
                    }

                    if (!downloaded) {
                        // The new window opens Chrome's built-in PDF viewer. The receipt is
                        // a PDF file rendered inside Chrome's viewer. The viewer's UI (toolbar,
                        // zoom, dark background) is part of the browser, not the page.
                        //
                        // Chrome's PDF viewer does NOT respect emulateMedia('print') — it
                        // always renders its own chrome (toolbar, zoom, dark background).
                        // Using page.pdf() produces a PDF-of-the-PDF-viewer, which looks
                        // distorted (double-rasterization).
                        //
                        // Professional solution: capture the rendered pixels via screenshot,
                        // then create a clean PDF using pdf-lib. The screenshot captures the
                        // exact visual output without the PDF viewer's chrome artifacts.
                        try {
                            await receiptPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
                            await delay(800);

                            // Detect the white content area (the actual receipt page) to clip out
                            // the PDF viewer chrome (toolbar, zoom controls, dark background).
                            const clipBox = await receiptPage.evaluate(() => {
                                // Chrome's PDF viewer renders the page inside a <div class="pdfViewer">
                                const viewer = document.querySelector('div.pdfViewer');
                                if (viewer) {
                                    const rect = viewer.getBoundingClientRect();
                                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                                }
                                // Fallback: embed element
                                const embed = document.querySelector('embed[type="application/pdf"]');
                                if (embed) {
                                    const rect = embed.getBoundingClientRect();
                                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                                }
                                // Fallback: the main content div
                                const main = document.querySelector('body > div');
                                if (main) {
                                    const rect = main.getBoundingClientRect();
                                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                                }
                                return null;
                            });

                            const screenshotOptions: any = {
                                type: 'png',
                                fullPage: true,
                            };
                            if (clipBox && clipBox.width > 0 && clipBox.height > 0) {
                                screenshotOptions.clip = {
                                    x: Math.max(0, Math.round(clipBox.x)),
                                    y: Math.max(0, Math.round(clipBox.y)),
                                    width: Math.round(clipBox.width),
                                    height: Math.round(clipBox.height),
                                };
                                console.log('  Clipping to content area:', screenshotOptions.clip);
                            } else {
                                console.log('  Could not detect content area, capturing full page');
                            }

                            const screenshot = await receiptPage.screenshot(screenshotOptions);

                            // Create a clean PDF with the screenshot as the single page.
                            const pdfDoc = await PDFDocument.create();
                            const image = await pdfDoc.embedPng(screenshot);
                            const { width, height } = image.size();
                            const pdfPage = pdfDoc.addPage([width, height]);
                            pdfPage.drawImage(image, {
                                x: 0,
                                y: 0,
                                width: width,
                                height: height,
                            });

                            const pdfBytes = await pdfDoc.save();
                            await fs.writeFile(paymentOrderPath, pdfBytes);

                            console.log('Captured receipt PDF via screenshot + pdf-lib:', paymentOrderPath, `(${pdfBytes.length} bytes)`);
                            await receiptPage.close();
                            console.log('Receipt window closed');
                            console.log('Payment order receipt PDF saved to:', paymentOrderPath);
                            await updateProgress(10, 'Payment order receipt captured', 99);
                            return { paymentOrderPath };
                        } catch (pdfErr: any) {
                            console.error('Screenshot + pdf-lib approach failed:', pdfErr.message);
                            // Fall through to the screenshot-based approach below
                        }

                    } else if (downloadedBuf) {
                        // Write the actual PDF bytes to a tmp path; the worker will read+upload+delete
                        const tmpPath = path.join(tmpdir(), `nssf-payment-order-${Date.now()}.pdf`);
                        await fs.writeFile(tmpPath, downloadedBuf);
                        paymentOrderPath = tmpPath;
                        console.log('Wrote actual PDF bytes to tmp path:', paymentOrderPath, `(${downloadedBuf.length} bytes)`);
                    }
                    await receiptPage.close();
                    console.log('Receipt window closed');
                } else {
                    console.log('Capturing PDF from current page...');
                    await page.pdf({
                        path: paymentOrderPath,
                        format: 'A4',
                        printBackground: true,
                        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
                    });
                }
                console.log('Payment order receipt PDF saved to:', paymentOrderPath);
                await updateProgress(10, 'Payment order receipt captured', 99);
                return { paymentOrderPath };
            } catch (pdfErr: any) {
                console.error('Failed to capture payment order PDF:', pdfErr.message);
                return { paymentOrderPath: null };
            }
        }

        // If payment order link not visible, return null
        console.log('Payment Order link not visible — skipping');
        return { paymentOrderPath: null };
    } catch (error: any) {
        if (job) {
            await job.log(
                JSON.stringify({
                    timestamp: new Date().toISOString(),
                    message: `Execution error: ${error.message}`,
                    progress: null,
                    level: 'error',
                })
            );
        }
        try {
            await page.screenshot({ path: 'nssf-stuck.png' });
            const links = await page.$$eval('a, div, span, button', (els) =>
                els.map((e) => e.textContent?.trim()).filter(Boolean)
            );
            console.log('Available UI text blocks:', Array.from(new Set(links)));
        } catch (e) {}
        console.error('Error during NSSF upload:', error);
        throw error;
    } finally {
        await browser.close();
    }
}
