import * as cheerio from 'cheerio';

export type SelectOption = { value: string; text: string };

export interface KraLoginFormFields {
    actionCode: string;
    tokenKey: string;
    generator: string;
    modulus: string;
    senderIntrmKey: string;
    rcpntIntrmKey?: string;
    encryptPassword: string;
    keyImgChk: string;
    passwordInputName: string;
    captchaInputName: string;
    captchaResultName?: string;
    [extra: string]: string | undefined;
}

export function loadHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html);
}

export function parseTokenKey(html: string): string | null {
    const $ = loadHtml(html);
    const value = $('input[name="token_key"]').attr('value');
    return value?.trim() ?? null;
}

export function parseLoginFormFields(html: string): KraLoginFormFields | null {
    const $ = loadHtml(html);
    const form = $('form#loginForm, form[action*="login.htm"]').first();
    if (!form.length) {
        return null;
    }

    const getValue = (name: string): string | undefined =>
        form.find(`input[name="${name}"]`).first().attr('value')?.trim() ??
        form.find(`input#${name}`).first().attr('value')?.trim();

    const passwordInput = form.find('input[type="password"]').first();
    const passwordInputName = passwordInput.attr('name')?.trim();
    if (!passwordInputName) {
        return null;
    }

    const captchaInput =
        form.find('input[name="captcahText"]').first() ||
        form.find('input[name*="captcha"]').first() ||
        form.find('input[name*="captchaResult"]').first();
    const captchaInputName = captchaInput.attr('name')?.trim();
    if (!captchaInputName) {
        return null;
    }

    return {
        actionCode: getValue('actionCode') ?? '',
        tokenKey: getValue('token_key') ?? '',
        generator: getValue('generator') ?? '',
        modulus: getValue('modulus') ?? '',
        senderIntrmKey: getValue('senderIntrmKey') ?? '',
        rcpntIntrmKey: getValue('rcpntIntrmKey') ?? '',
        encryptPassword: getValue('encryptPassword') ?? '',
        keyImgChk: getValue('keyImgChk') ?? 'false',
        passwordInputName,
        captchaInputName,
        captchaResultName: getValue('captchaResult_') ? 'captchaResult_' : undefined,
    };
}

export function parseCaptchaImageUrl(html: string, baseUrl: string): string | null {
    const $ = loadHtml(html);
    const selectors = [
        'img#loginCaptcha',
        'img#captchaImg',
        'img#captcha_img',
        'img[src*="GenerateCaptcha"]',
        'img[src*="captcha"]',
    ];

    for (const selector of selectors) {
        const src = $(selector).attr('src');
        if (src) {
            return resolveUrl(src, baseUrl);
        }
    }

    // Fallback: any image near a captcha input
    const captchaInput = $('input[name="captcahText"], input[name*="captcha"]');
    if (captchaInput.length) {
        const img = captchaInput.closest('tr, td, div, form').find('img').first();
        const src = img.attr('src');
        if (src) {
            return resolveUrl(src, baseUrl);
        }
    }

    return null;
}

export function parseLoginOutcome(
    html: string
): { type: 'success' | 'failure' | 'password-change' | 'mobile-verification'; message?: string } {
    const text = normalizeText(html);

    if (/mobile\s+number\s+verification/i.test(text) || /send\s+verification\s+code/i.test(text)) {
        return { type: 'mobile-verification' };
    }

    const hasPostLoginMenu = /logout|file\s+return|showe?returns|my\s+ledger/i.test(text);
    const hasForcedPasswordChange =
        /your\s+password\s+has\s+expired/i.test(text) ||
        /password\s+has\s+expired/i.test(text) ||
        /password\s+expired/i.test(text) ||
        /please\s+change\s+your\s+password/i.test(text) ||
        /first\s*time\s*login/i.test(text);

    if (hasForcedPasswordChange && !hasPostLoginMenu) {
        return { type: 'password-change' };
    }

    const failurePatterns = [
        /password\s+you\s+entered\s+is\s+incorrect/i,
        /incorrect\s+password/i,
        /invalid\s+password/i,
        /invalid\s+login/i,
        /security\s+stamp.*incorrect/i,
        /captcha.*incorrect/i,
        /account\s+(?:is\s+)?locked/i,
        /remaining\s+number\s+of\s+attempts/i,
        /enter\s+answer\s+of\s+the\s+arithmetic/i,
        /please\s+enter\s+the\s+captcha/i,
        /invalid\s+security\s+stamp/i,
    ];

    for (const pattern of failurePatterns) {
        const match = text.match(pattern);
        if (match) {
            return { type: 'failure', message: match[0] };
        }
    }

    // If the login form is still present (password field, captcha image), the login failed.
    // This catches wrong-captcha responses where KRA returns the login page without
    // an explicit error message.
    const hasLoginForm = /id=["']xx[Zz]TT9p2wQ["']/i.test(html) ||
        /name=["']xx[Zz]TT9p2wQ["']/i.test(html) ||
        /generateCaptchaServlet/i.test(html);
    if (hasLoginForm) {
        return { type: 'failure', message: 'Login form still present after submission (likely wrong captcha or credentials)' };
    }

    const successPatterns = [
        /homePageLink/i,
        /logout/i,
        /showOnlineServicesHome/i,
        /afterLoginHomeLayout/i,
        /welcome\s+/i,
        /pinNo\s*=/i,
    ];

    const hasSuccessIndicator = successPatterns.some((pattern) => pattern.test(text));
    if (hasSuccessIndicator) {
        return { type: 'success' };
    }

    return { type: 'failure', message: 'Login outcome could not be determined' };
}

export function parseObligationOptions(html: string, selectName?: string): SelectOption[] {
    const $ = loadHtml(html);
    let select: any;

    if (selectName) {
        select = $(`select[name="${selectName}"], select#${selectName}`).first();
    } else {
        select = $('select').filter((_: number, el: any) => {
            const text = $(el).find('option').map((_: number, opt: any) => $(opt).text()).get().join(' ');
            return /income|vat|paye|turnover|rent|excise|nssf/i.test(text);
        }).first();
    }

    return select.find('option')
        .map((_: any, el: any) => ({
            value: $(el).attr('value')?.trim() ?? '',
            text: $(el).text().trim(),
        }))
        .get()
        .filter((opt: any) => opt.value && opt.text && !/^--select--$/i.test(opt.text));
}

export function findObligationValue(
    html: string,
    patterns: RegExp[],
    selectName?: string
): { value: string; text: string } | null {
    const options = parseObligationOptions(html, selectName);
    const match = options.find((opt) => patterns.some((pattern) => pattern.test(opt.text)));
    return match ?? null;
}

export function parseReturnPeriodFields(html: string): { fromName?: string; toName?: string } {
    const $ = loadHtml(html);
    const fromInput = $('input#txtPeriodFrom, input[name="txtPeriodFrom"]').first();
    const toInput = $('input#txtPeriodTo, input[name="txtPeriodTo"]').first();

    return {
        fromName: fromInput.attr('name'),
        toName: toInput.attr('name'),
    };
}

export function parseFormFields(html: string, formSelector = 'form'): Record<string, string> {
    const $ = loadHtml(html);
    const form = $(formSelector).first();
    if (!form.length) {
        return {};
    }

    const fields: Record<string, string> = {};

    form.find('input, select, textarea').each((_: number, el: any) => {
        const $el = $(el);
        const name = $el.attr('name');
        if (!name) return;

        // Browsers do not submit disabled controls.
        if ($el.attr('disabled') !== undefined) {
            return;
        }

        const tag = el.tagName.toLowerCase();
        let value = '';

        if (tag === 'input') {
            const type = ($el.attr('type') ?? 'text').toLowerCase();
            if (type === 'checkbox' || type === 'radio') {
                if ($el.is(':checked')) {
                    value = $el.attr('value') ?? 'on';
                } else {
                    return;
                }
            } else {
                value = $el.attr('value') ?? '';
            }
        } else if (tag === 'select') {
            const selected = $el.find('option:selected').first();
            value = selected.attr('value') ?? selected.text() ?? '';
        } else if (tag === 'textarea') {
            value = $el.text() ?? '';
        }

        fields[name] = value;
    });

    return fields;
}

const GENERIC_RECEIPT_WORDS = new Set([
    'receipt', 'generated', 'number', 'acknowledgement', 'acknowledgment',
    'return', 'submitted', 'successfully', 'success', 'available', 'download',
    'nil', 'original', 'amended',
]);

function isValidReceiptNumber(value: string | undefined): value is string {
    if (!value || value.length < 3) return false;
    const lower = value.toLowerCase();
    // Must contain at least one digit (real KRA receipt numbers are alphanumeric with digits)
    if (!/\d/.test(value)) return false;
    // Must not be a generic placeholder word
    if (GENERIC_RECEIPT_WORDS.has(lower)) return false;
    return true;
}

export function parseSubmissionResult(html: string): {
    success: boolean;
    receiptNumber: string | null;
    message: string | null;
    downloadUrl: string | null;
    noticeId: string | null;
} {
    const normalizedText = normalizeText(html);
    const $ = loadHtml(html);
    const rawText = $('body').text().replace(/\s+/g, ' ').trim();

    // ── Error / informational indicators that KRA shows instead of a real success page ──
    const failurePhrases = [
        /already\s+(?:filed|submitted)/i,
        /return\s+already\s+exists/i,
        /cannot\s+file\s+(?:this|the)\s+return/i,
        /not\s+allowed\s+to\s+file/i,
        /invalid\s+period/i,
        /period\s+(?:is\s+)?(?:invalid|not\s+(?:allowed|permitted|open))/i,
        /no\s+records\s+found/i,
        /information(?:al)?\s*(?:dialog|message|box)/i,
        /problem\s+encountered/i,
        /please\s+contact\s+(?:the\s+)?kra/i,
        /return\s+has\s+been\s+rejected/i,
        /submission\s+failed/i,
        /failed\s+to\s+submit/i,
    ];
    const failureMatch = failurePhrases.find((pattern) => pattern.test(rawText));

    // ── Receipt number extraction (strict) ──
    const receiptMatch = rawText.match(/Acknowledgement\s*Number\s*[:\-]?\s*([A-Z0-9\-/]+)/i) ||
        rawText.match(/Acknowledgment\s*Number\s*[:\-]?\s*([A-Z0-9\-/]+)/i) ||
        rawText.match(/(?:Receipt|Acknowledg(?:e)?ment)\s*(?:Number|No\.?|#)?\s*[:\-]?\s*([A-Z0-9\-/]+)/i);
    const receiptNumber = isValidReceiptNumber(receiptMatch?.[1]) ? receiptMatch[1] : null;

    // ── Success detection ──
    // We require an explicit success phrase AND a valid-looking receipt number,
    // OR a real download receipt link/noticeId. This avoids marking info/error pages as success.
    const hasExplicitSuccessPhrase =
        /return\s+submitted\s+successfully/i.test(normalizedText) ||
        /return\s+receipt\s+generated/i.test(normalizedText) ||
        /acknowledg(?:e)?ment\s+number\s*[:\-]?\s*[A-Z0-9]/i.test(rawText);

    let downloadUrl: string | null = null;
    let noticeId: string | null = null;
    $('a, input[type="button"], button').each((_: number, el: any) => {
        const onclick = ($(el).attr('onclick') ?? '').toLowerCase();
        const href = ($(el).attr('href') ?? '').toLowerCase();
        if (onclick.includes('downloadreturnsreceipt') || onclick.includes('downloadreceipt') || href.includes('downloadreturnsreceipt')) {
            const raw = $(el).attr('onclick') || $(el).attr('href') || '';
            downloadUrl = extractDownloadUrl(raw);
            noticeId = extractNoticeId(raw);
            return false;
        }
        return true;
    });

    // If the link invokes a JS function, extract the real URL/noticeId from the function body.
    if (downloadUrl === 'downloadReturnsReceipt()' && !noticeId) {
        const functionBody = extractReceiptFunctionBody(html);
        if (functionBody) {
            downloadUrl = extractDownloadUrl(functionBody) ?? downloadUrl;
            noticeId = extractNoticeId(functionBody) ?? noticeId;
        }
    }

    const hasReceiptEvidence = !!(receiptNumber || (downloadUrl && downloadUrl !== 'downloadReturnsReceipt()') || noticeId);
    // A real success requires actual receipt evidence: a valid receipt number, a real download URL,
    // or a noticeId. The word "Receipt" alone on the page is not enough.
    const success = Boolean(!failureMatch && hasReceiptEvidence);

    // ── Human-readable message ──
    let message: string | null = null;
    if (success) {
        message = rawText.match(/Return\s+(?:Submitted|submitted)\s+(?:Successfully|successfully)[^.]*/i)?.[0] ??
            rawText.match(/Return\s+Receipt\s+Generated[^.]*/i)?.[0] ??
            `Return submitted successfully. Receipt: ${receiptNumber ?? 'N/A'}`;
    } else if (failureMatch) {
        // Try to extract the sentence/phrase containing the failure indicator
        const sentencePattern = new RegExp(`[^.!?]*${failureMatch.source}[^.!?]*[.!?]?`, 'i');
        message = rawText.match(sentencePattern)?.[0]?.trim() ?? rawText.slice(0, 300);
    } else {
        message = rawText.slice(0, 300);
    }

    return { success, receiptNumber, message, downloadUrl, noticeId };
}

function extractReceiptFunctionBody(html: string): string | null {
    const $ = loadHtml(html);
    let body: string | null = null;
    $('script').each((_: number, el: any) => {
        const text = $(el).text();
        if (text.includes('function downloadReturnsReceipt')) {
            const match = text.match(/function\s+downloadReturnsReceipt\s*\(\s*\)\s*\{([^}]+)\}/i);
            if (match) {
                body = match[1];
                return false;
            }
        }
        return true;
    });
    return body;
}

export function parsePortalErrors(html: string): string[] {
    const $ = loadHtml(html);
    const errors: string[] = [];

    const selectors = [
        '#errorDiv',
        '.error-message',
        '.ui-message-error',
        '.ui-messages-error',
        '.ui-messages-info',       // KRA shows "already filed" and other informational dialogs here
        '.ui-message-info',
        '[id*="error"]',
        '[class*="error"]',
        'font[color="red"]',
        // KRA renders server-side errors in red-styled labels/spans inside
        // tables (e.g. "System Error Occured. Please contact System
        // Administrator." on the Returns Summary page).
        'label[style*="color: red"]',
        'label[style*="color:red"]',
        'span[style*="color: red"]',
        'span[style*="color:red"]',
        'td[style*="color: red"]',
        'td[style*="color:red"]',
    ];

    for (const selector of selectors) {
        $(selector).each((_: number, el: any) => {
            const text = $(el).text().replace(/\s+/g, ' ').trim();
            if (text && !errors.includes(text)) {
                errors.push(text);
            }
        });
    }

    return errors;
}

function normalizeText(html: string): string {
    const $ = loadHtml(html);
    return $('body').text().replace(/\s+/g, ' ').trim().toLowerCase();
}

function resolveUrl(src: string, baseUrl: string): string {
    if (src.startsWith('http')) {
        return src;
    }
    if (src.startsWith('/')) {
        const origin = new URL(baseUrl).origin;
        return `${origin}${src}`;
    }
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return `${base}${src}`;
}

function extractDownloadUrl(onclickOrHref: string): string | null {
    const match = onclickOrHref.match(/(?:href|location|window\.open)\s*[=\(]\s*["']([^"']+)["']/i);
    if (match) {
        return match[1];
    }
    return onclickOrHref.includes('downloadReturnsReceipt')
        ? 'downloadReturnsReceipt()'
        : null;
}

function extractNoticeId(onclickOrHref: string): string | null {
    const match = onclickOrHref.match(/noticeId=([0-9]+)/i);
    return match?.[1] ?? null;
}

/**
 * Parse KRA's "Returns Summary" validation error table.
 *
 * When KRA rejects a VAT/Excise return upload due to data validation
 * errors, it renders an HTML table with columns:
 *   Sr.No. | File Section | Error Description
 *
 * Example rows:
 *   1 | B_General_Rated_Sales_Dtls | Please note that the Total General Rated Sales cannot be less than...
 *   2 | F_General_Rated_Purchases_Dtls | PIN entered should not be same as Taxpayer's PIN.
 *
 * Without this parser, the error message shown to the user is the raw
 * page JavaScript ("Insert title here var parts = window.location..."),
 * not the actual validation text.
 */
export function parseReturnsSummaryErrors(html: string): Array<{ section: string; description: string }> {
    const errors: Array<{ section: string; description: string }> = [];

    try {
        const $ = loadHtml(html);

        // KRA renders the summary table with various possible structures.
        // Strategy 1: Look for a table containing "Error Description" header.
        let summaryTable: any = null;
        const tables = $('table');
        tables.each((_: number, el: any) => {
            const headerText = $(el).find('th, td, .headerText').text();
            if (/Error\s+Description/i.test(headerText) && /File\s+Section/i.test(headerText)) {
                summaryTable = $(el);
                return false;
            }
            return true;
        });

        if (summaryTable) {
            const rows = summaryTable.find('tr');
            rows.each((_: number, row: any) => {
                const cells = $(row).find('td');
                if (cells.length >= 3) {
                    const section = $(cells.get(1)).text().trim();
                    const description = $(cells.last()).text().trim();
                    if (section && description && !/Sr\.?No|File\s+Section/i.test(section)) {
                        errors.push({ section, description });
                    }
                }
            });
        }

        // Strategy 2: Look for the "Returns Summary" heading and parse the
        // table(s) that follow it.
        if (errors.length === 0) {
            const summaryHeading = $('h2, h3, h4, td, div, span')
                .filter((__: number, el: any) => /Returns\s+Summary/i.test($(el).text().trim()))
                .first();
            if (summaryHeading.length > 0) {
                let tableEl = summaryHeading.nextAll('table').first();
                if (!tableEl.length) {
                    tableEl = summaryHeading.closest('table');
                }
                tableEl.find('tr').each((_: number, row: any) => {
                    const cells = $(row).find('td');
                    if (cells.length >= 3) {
                        const section = $(cells.get(1)).text().trim();
                        const description = $(cells.last()).text().trim();
                        if (section && description && !/Sr\.?No|File\s+Section/i.test(section)) {
                            errors.push({ section, description });
                        }
                    }
                });
            }
        }

        // Strategy 3: Look for rows with B_ or F_ or C_ or D_ prefixes (file section
        // names KRA uses for VAT validation errors)
        if (errors.length === 0) {
            const allRows = $('table tr, tr');
            allRows.each((_: number, row: any) => {
                const cells = $(row).find('td');
                if (cells.length >= 2) {
                    const section = $(cells.get(0)).text().trim();
                    const description = $(cells.eq(1)).text().trim();
                    if (/^(?:B_|C_|D_|E_|F_|G_|H_|I_|J_)/.test(section) && description) {
                        errors.push({ section, description });
                    }
                }
            });
        }
    } catch (e) {
        // Parsing errors must not bubble up — the caller falls back to the
        // generic error message.
    }

    return errors;
}
