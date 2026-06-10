/**
 * config.ts
 *
 * Environment-driven configuration constants for the KRA filing worker.
 * All environment variable reads are centralised here.
 */

import path from 'path';

export const TMP_DIR = path.join(
    process.env.TEMP_DIR ?? (process.platform === 'win32' ? 'C:\\Temp' : '/tmp'),
    'kra-receipts'
);

export const KRA_BROWSER_PROFILE_DIR = process.env.KRA_BROWSER_PROFILE_DIR ?? path.join(TMP_DIR, 'browser-profile');
export const KRA_REUSE_BROWSER_PROFILE = process.env.KRA_REUSE_BROWSER_PROFILE !== 'false';

export const KRA_PORTAL_URL = 'https://itax.kra.go.ke/KRA-Portal/';
export const KRA_DEBUG_ARTIFACTS = process.env.KRA_DEBUG_ARTIFACTS === 'true';

export const GEMMA4_API_KEY = process.env.GEMMA4_API_KEY;
export const GEMMA4_MODEL = process.env.GEMMA4_MODEL ?? 'gemma-4-31b-it';

export const PLAYWRIGHT_SLOW_MO = Math.max(0, Number.parseInt(process.env.PLAYWRIGHT_SLOW_MO ?? '0', 10) || 0);
export const PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false';
export const KRA_BROWSER_CHANNEL = (process.env.KRA_BROWSER_CHANNEL ?? 'chrome').trim().toLowerCase();
export const KRA_BROWSER_EXECUTABLE_PATH = process.env.KRA_BROWSER_EXECUTABLE_PATH?.trim() ?? '';

export const WINDOWS_BROWSER_EXECUTABLE_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
] as const;

export type BrowserLaunchPreference = {
    label: string;
    executablePath?: string;
    channel?: 'chrome' | 'msedge';
};
