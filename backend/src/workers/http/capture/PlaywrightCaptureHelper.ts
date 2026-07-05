import fs from 'fs/promises';
import path from 'path';
import type { Page } from 'playwright';
import { CaptureContext } from './CaptureContext';
import { CaptureConsoleEntry, CaptureDialogEntry, CaptureStep } from './types';

/**
 * Captures Playwright page artifacts (HTML snapshots, console logs, dialogs)
 * and uploads them to Cloud Storage via a CaptureContext.
 */
export class PlaywrightCaptureHelper {
    private page: Page;
    private context: CaptureContext;
    private consoleEntries: CaptureConsoleEntry[] = [];
    private dialogEntries: CaptureDialogEntry[] = [];
    private disposed = false;
    private harLocalPath?: string;

    constructor(page: Page, context: CaptureContext, harLocalPath?: string) {
        this.page = page;
        this.context = context;
        this.harLocalPath = harLocalPath;

        page.on('console', (msg) => {
            this.consoleEntries.push({
                type: this.mapConsoleType(msg.type()),
                text: msg.text(),
                timestamp: new Date().toISOString(),
                location: msg.location(),
            });
        });

        page.on('pageerror', (err) => {
            this.consoleEntries.push({
                type: 'error',
                text: err.message,
                timestamp: new Date().toISOString(),
            });
        });

        page.on('dialog', async (dialog) => {
            this.dialogEntries.push({
                type: dialog.type(),
                message: dialog.message(),
                timestamp: new Date().toISOString(),
            });
        });
    }

    private mapConsoleType(type: string): CaptureConsoleEntry['type'] {
        switch (type) {
            case 'error':
                return 'error';
            case 'warning':
                return 'warn';
            case 'info':
                return 'info';
            case 'debug':
                return 'debug';
            default:
                return 'log';
        }
    }

    async snapshot(step: CaptureStep, label?: string): Promise<void> {
        if (this.disposed) return;
        try {
            const html = await this.page.content();
            await this.context.uploadText(step, 'snapshot', html, 'html', 'text/html; charset=utf-8', {
                url: this.page.url(),
                ...(label ? { label } : {}),
            });

            if (this.context.captureScreenshots) {
                const screenshot = await this.page.screenshot({ type: 'png', fullPage: false });
                await this.context.uploadBuffer(step, 'screenshot', screenshot, 'png', 'image/png', {
                    url: this.page.url(),
                    ...(label ? { label } : {}),
                });
            }
        } catch (err: any) {
            // Capture failures must not break filing.
            console.warn('[PlaywrightCaptureHelper] Snapshot failed:', err.message);
        }
    }

    async flushBuffers(): Promise<void> {
        if (this.disposed) return;
        await this.context.flushConsoleBuffer();
        await this.context.flushDialogBuffer();
    }

    async uploadHar(): Promise<void> {
        if (!this.harLocalPath) return;
        try {
            const stats = await fs.stat(this.harLocalPath).catch(() => null);
            if (!stats || stats.size === 0) return;
            const buffer = await fs.readFile(this.harLocalPath);
            await this.context.uploadBuffer('custom', 'har', buffer, 'har', 'application/json', {
                label: 'playwright-network-log',
            });
        } catch (err: any) {
            console.warn('[PlaywrightCaptureHelper] HAR upload failed:', err.message);
        }
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        await this.flushBuffers();
        await this.uploadHar();
    }
}
