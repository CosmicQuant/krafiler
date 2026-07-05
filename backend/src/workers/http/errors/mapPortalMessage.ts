import { KraErrorCode } from './KraErrorCode';
import { KraError } from './KraError';

const ERROR_PATTERNS: Array<{ code: KraErrorCode; patterns: RegExp[]; retryable: boolean }> = [
    {
        code: KraErrorCode.SESSION_INVALID,
        retryable: true,
        patterns: [
            /session\s+has\s+timed\s+out/i,
            /session\s+expired/i,
            /session\s+invalid/i,
            /page\s+re-submit/i,
            /\b4002\b/,
        ],
    },
    {
        code: KraErrorCode.CREDENTIALS_INVALID,
        retryable: false,
        patterns: [
            /password\s+you\s+entered\s+is\s+incorrect/i,
            /incorrect\s+password/i,
            /invalid\s+password/i,
            /invalid\s+login/i,
            /remaining\s+number\s+of\s+attempts/i,
        ],
    },
    {
        code: KraErrorCode.CAPTCHA_INCORRECT,
        retryable: true,
        patterns: [
            /security\s+stamp.*incorrect/i,
            /captcha.*incorrect/i,
            /invalid\s+security\s+stamp/i,
        ],
    },
    {
        code: KraErrorCode.ACCOUNT_LOCKED,
        retryable: false,
        patterns: [
            /account\s+(?:is\s+)?locked/i,
            /account\s+has\s+been\s+locked/i,
        ],
    },
    {
        code: KraErrorCode.PASSWORD_EXPIRED,
        retryable: false,
        patterns: [
            /your\s+password\s+has\s+expired/i,
            /change\s+password/i,
            /first\s*time\s*login/i,
        ],
    },
    {
        code: KraErrorCode.MOBILE_VERIFICATION_REQUIRED,
        retryable: false,
        patterns: [
            /mobile\s+number\s+verification/i,
            /send\s+verification\s+code/i,
        ],
    },
    {
        code: KraErrorCode.ALREADY_FILED,
        retryable: false,
        patterns: [
            /period\s+already\s+filed/i,
            /already\s+submitted/i,
            /return\s+already\s+filed/i,
        ],
    },
    {
        code: KraErrorCode.PORTAL_UNAVAILABLE,
        retryable: true,
        patterns: [
            /502\s+bad\s+gateway/i,
            /504\s+gateway\s+time-?out/i,
            /service\s+unavailable/i,
        ],
    },
];

export function mapPortalMessage(
    text: string,
    options: { defaultCode?: KraErrorCode; context?: string } = {}
): KraError | null {
    if (!text || typeof text !== 'string') {
        return null;
    }

    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return null;
    }

    for (const { code, patterns, retryable } of ERROR_PATTERNS) {
        if (patterns.some((pattern) => pattern.test(normalized))) {
            return new KraError(code, `${options.context ? `${options.context}: ` : ''}${normalized}`, {
                retryable,
                rawResponse: normalized,
            });
        }
    }

    return null;
}

export function classifyHttpError(
    statusCode: number,
    statusMessage: string,
    bodyText: string
): KraError | null {
    if (statusCode >= 500 || /ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED/i.test(statusMessage)) {
        return new KraError(
            KraErrorCode.PORTAL_UNAVAILABLE,
            `KRA portal returned ${statusCode} ${statusMessage}`,
            { retryable: true, rawResponse: bodyText }
        );
    }

    return mapPortalMessage(bodyText, { context: `HTTP ${statusCode}` });
}
