/**
 * portal-helpers.ts
 *
 * Generic KRA portal page-state detection utilities.
 */

import { JobContext } from '../../types';
import { assertJobNotCancelled, appendJobLog } from './job-helpers';
import { navigationDelay } from './delays';
import {
    AUTHENTICATED_DASHBOARD_SELECTORS,
    PASSWORD_CHANGE_SELECTORS,
    MOBILE_VERIFICATION_SELECTORS,
    PASSWORD_EXPIRED_PATTERNS,
    LOGIN_FAILURE_PATTERNS,
} from '../constants/selectors';

export async function waitForAnySelector(
    page: any, selectors: string[], timeout = 20_000,
    cancellation?: { job?: JobContext; context?: string; progress?: number }
): Promise<string | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (cancellation?.job) {
            await assertJobNotCancelled(cancellation.job, cancellation.context ?? 'a portal wait', cancellation.progress);
        }
        for (const selector of selectors) {
            const found = await page.locator(selector).first().count().then((c: number) => c > 0).catch(() => false);
            if (found) return selector;
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    return null;
}

export async function findVisibleSelector(page: any, selectors: readonly string[]): Promise<string | null> {
    for (const selector of selectors) {
        if (await page.locator(selector).first().isVisible().catch(() => false)) return selector;
    }
    return null;
}

export async function findMatchingPortalMessage(page: any, patterns: RegExp[]): Promise<string | null> {
    const candidates = await page.evaluate(() => {
        const texts = new Set<string>();
        ['#errorDiv','.error-message','.ui-message-error','.ui-messages-error','[id*="error"]','[class*="error"]','font[color="red"]']
            .forEach(s => document.querySelectorAll(s).forEach(el => { const t = (el.textContent ?? '').replace(/\s+/g,' ').trim(); if(t) texts.add(t); }));
        (document.body?.innerText ?? '').split(/\r?\n/).map(l => l.replace(/\s+/g,' ').trim()).filter(Boolean).forEach(l => texts.add(l));
        return Array.from(texts);
    });
    return candidates.find((c: string) => patterns.some(p => p.test(c))) ?? null;
}

export async function waitForMatchingPortalMessage(page: any, patterns: RegExp[], timeout = 8_000): Promise<string | null> {
    if (!patterns.length) return null;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const msg = await findMatchingPortalMessage(page, patterns).catch(() => null);
        if (msg) return msg;
        await new Promise(r => setTimeout(r, 250));
    }
    return null;
}

export async function waitForDialogMessage(page: any, timeout = 5_000): Promise<string | null> {
    try {
        const dialog = await page.waitForEvent('dialog', { timeout });
        const message = dialog.message();
        await dialog.accept();
        return message;
    } catch { return null; }
}

export async function summariseCurrentPage(page: any): Promise<string> {
    return page.evaluate(() => {
        const bodyText = (document.body?.innerText ?? '').replace(/\s+/g,' ').trim().slice(0,240);
        return JSON.stringify({ title: document.title ?? '', readyState: document.readyState ?? '', url: window.location.href, bodyText });
    }).catch(() => 'unavailable');
}

export async function snapshotPageControls(page: any): Promise<string> {
    return page.evaluate(() => {
        const bodyText = (document.body?.innerText ?? '').replace(/\s+/g,' ').trim().slice(0,320);
        const controlSelectors = ['input','button','a','label','select','textarea','iframe'];
        const controls = controlSelectors.flatMap(sel =>
            Array.from(document.querySelectorAll(sel)).slice(0,80).map(element => {
                const el = element as HTMLElement; const style = window.getComputedStyle(el); const inp = element as HTMLInputElement;
                return { tag: element.tagName, id: el.id??'', name: inp.name??'', type: inp.type??'',
                    text: (el.textContent??'').replace(/\s+/g,' ').trim().slice(0,80), value: (inp.value??'').slice(0,120),
                    href: el.getAttribute('href')??'', onclick: el.getAttribute('onclick')??'',
                    visible: style.display!=='none' && style.visibility!=='hidden',
                    disabled: 'disabled' in inp ? Boolean(inp.disabled) : false };
            })
        );
        return JSON.stringify({ title: document.title??'', readyState: document.readyState??'', url: window.location.href, bodyText, controls });
    }).catch(() => 'unavailable');
}

export async function isBlankKraLoginShell(page: any): Promise<boolean> {
    return page.evaluate(() => {
        const bodyText = (document.body?.innerText ?? '').replace(/\s+/g,' ').trim();
        const visibleControls = Array.from(document.querySelectorAll('input,button,a,select,textarea')).some(element => {
            const el = element as HTMLElement; const style = window.getComputedStyle(el); const rect = el.getBoundingClientRect();
            return style.display!=='none' && style.visibility!=='hidden' && rect.width>0 && rect.height>0;
        });
        return /\/KRA-Portal\/login\.htm/i.test(window.location.href) && ['interactive','complete'].includes(document.readyState) && bodyText.length===0 && !visibleControls;
    }).catch(() => false);
}

export type PostLoginOutcome =
    | { type: 'dashboard'; selector: string } | { type: 'password-change'; selector: string }
    | { type: 'mobile-verification'; selector: string } | { type: 'dialog'; message: string }
    | { type: 'login-failure'; message: string } | { type: 'blank-login-shell' } | { type: 'timeout' };

export async function waitForPostLoginOutcome(page: any, job: JobContext, progress: number, timeout = 18_000): Promise<PostLoginOutcome> {
    let dialogMessage: string | null = null;
    void waitForDialogMessage(page, 4_000).then(m => { dialogMessage = m; }).catch(() => undefined);
    const deadline = Date.now() + timeout;
    let blankShellDetectedAt: number | null = null;
    while (Date.now() < deadline) {
        await assertJobNotCancelled(job, 'post-login landing selector', progress);
        if (dialogMessage) return { type: 'dialog', message: dialogMessage };
        const loginFail = await findMatchingPortalMessage(page, LOGIN_FAILURE_PATTERNS).catch(() => null);
        if (loginFail) return { type: 'login-failure', message: loginFail };
        const dash = await findVisibleSelector(page, AUTHENTICATED_DASHBOARD_SELECTORS);
        if (dash) return { type: 'dashboard', selector: dash };
        const pwChange = await findVisibleSelector(page, PASSWORD_CHANGE_SELECTORS);
        if (pwChange) return { type: 'password-change', selector: pwChange };
        const mobileV = await findVisibleSelector(page, MOBILE_VERIFICATION_SELECTORS);
        if (mobileV) return { type: 'mobile-verification', selector: mobileV };
        const blank = await isBlankKraLoginShell(page);
        if (blank) { blankShellDetectedAt ??= Date.now(); if (Date.now()-blankShellDetectedAt>=1500) return { type: 'blank-login-shell' }; } else { blankShellDetectedAt = null; }
        await new Promise(r => setTimeout(r, 250));
    }
    return { type: 'timeout' };
}

export async function detectAuthenticatedPortalState(page: any, timeout = 30_000): Promise<'dashboard'|'login'|'mobile-verification'|'password-change'|null> {
    const sel = await waitForAnySelector(page, [...AUTHENTICATED_DASHBOARD_SELECTORS,'#logid','#loginButton','input[name="captcahText"]',...MOBILE_VERIFICATION_SELECTORS,...PASSWORD_CHANGE_SELECTORS], timeout);
    if (!sel) return null;
    if (/Mobile Number Verification|Send Verification Code/i.test(sel)) return 'mobile-verification';
    if (PASSWORD_EXPIRED_PATTERNS.some(p => p.test(sel))) return 'password-change';
    if (/#logid|#loginButton|captcahText/.test(sel)) return 'login';
    if (/#homePageLink|Logout|Returns/.test(sel)) return 'dashboard';
    return null;
}

export async function waitForPortalReadyWithReload(page: any, job: JobContext, options: {
    description: string; selectors: string[]; timeout?: number; reloadAttempts?: number; waitForNetworkIdle?: boolean;
}): Promise<void> {
    const { description, selectors, timeout = 20_000, reloadAttempts = 1, waitForNetworkIdle = false } = options;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= reloadAttempts; attempt++) {
        try {
            await assertJobNotCancelled(job, description, typeof job.progress==='number' ? job.progress : undefined);
            const loaded = await page.evaluate(() => ['interactive','complete'].includes(document.readyState)).catch(() => false);
            if (!loaded) await page.waitForLoadState('domcontentloaded', { timeout: Math.max(5_000, timeout) }).catch(() => {});
            if (waitForNetworkIdle) await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
            const errorSels = [...selectors,'text=An Error Occured','text=session has timed out','text=page re-submit'];
            const matched = await waitForAnySelector(page, errorSels, timeout, { job, context: description, progress: typeof job.progress==='number' ? job.progress : undefined });
            if (matched && (matched.includes('Error Occured')||matched.includes('session has timed out')||matched.includes('page re-submit'))) {
                const snippet = (await page.locator('body').innerText().catch(() => '')).slice(0,300);
                throw new Error(`KRA displayed an error page: ${snippet}`);
            }
            if (matched) { if (attempt>0) await appendJobLog(job, `${description} recovered after reloading the page`, { progress: typeof job.progress==='number' ? job.progress : undefined }); return; }
            lastError = new Error(`${description} did not expose the expected UI controls`);
        } catch (e) { lastError = e as Error; }
        if (attempt < reloadAttempts) {
            await assertJobNotCancelled(job, `${description} reload`, typeof job.progress==='number' ? job.progress : undefined);
            await appendJobLog(job, `${description} is taking too long to load; reloading and retrying`, { progress: typeof job.progress==='number' ? job.progress : undefined });
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
            await navigationDelay();
        }
    }
    throw lastError ?? new Error(`${description} did not finish loading`);
}
