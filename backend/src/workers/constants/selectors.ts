/**
 * selectors.ts
 *
 * Centralised DOM selectors, regex patterns, and error-matching constants
 * used across the KRA portal automation pipeline.
 */

import { TaxObligationType } from '../../types';

// ─── Tax Obligation Matching Patterns ────────────────────────────────────────

export const TAX_OBLIGATION_PATTERNS: Record<TaxObligationType, RegExp[]> = {
    income_tax_resident_individual: [
        /^income\s*tax\s*-\s*resident\s*individual$/i,
        /resident\s*individual/i,
        /^resident\s*individual$/i,
    ],
    monthly_rental_income: [
        /^income\s*tax\s*-\s*rent\s*income\s*\(mri\)$/i,
        /^income\s*tax\s*-\s*rent\s*income$/i,
        /rent\s*income/i,
        /monthly\s*rental\s*income/i,
        /\bmri\b/i,
    ],
    income_tax_non_resident_individual: [
        /^income\s*tax\s*-?\s*non-?resident\s*individual$/i,
        /non-?resident\s*individual/i,
    ],
    income_tax_company: [
        /^income\s*tax\s*-\s*company$/i,
        /^income\s*tax\s*company$/i,
        /company/i,
    ],
    vat: [
        /^value\s*added\s*tax$/i,
        /^vat$/i,
        /^Value\s*Added\s*Tax\s*\(VAT\)$/i,
        /value\s*added\s*tax/i,
    ],
    paye: [
        /^pay\s*as\s*you\s*earn$/i,
        /^paye$/i,
        /^Income\s*Tax\s*-\s*PAYE$/i,
        /pay\s*as\s*you\s*earn/i,
    ],
    turnover_tax: [
        /^turnover\s*tax$/i,
        /^tot$/i,
        /turnover\s*tax/i,
    ],
    nssf: [
        /^nssf$/i,
    ],
    excise_duty: [
        /^excise\s*duty$/i,
        /^excise$/i,
        /excise/i,
    ],
    nita: [
        /^nita\s*levy$/i,
        /^nita$/i,
        /nita/i,
    ],
    affordable_housing: [
        /^housing\s*levy$/i,
        /^affordable\s*housing\s*levy$/i,
        /housing\s*levy/i,
    ],
};

// ─── Login Patterns ──────────────────────────────────────────────────────────

export const LOGIN_FAILURE_PATTERNS = [
    /password\s+you\s+entered\s+is\s+incorrect/i,
    /incorrect\s+password/i,
    /invalid\s+password/i,
    /remaining\s+number\s+of\s+attempts/i,
    /account\s+(?:is\s+)?locked/i,
    /security\s+stamp.*incorrect/i,
    /captcha.*incorrect/i,
    /invalid\s+login/i,
];

export const AUTHENTICATED_DASHBOARD_SELECTORS = [
    '#homePageLink',
    'a:has-text("Logout")',
    'a:has-text("Returns")',
] as const;

export const PASSWORD_CHANGE_SELECTORS = [
    'text=YOUR PASSWORD HAS EXPIRED!',
    'text=Change Password',
    'text=FIRST TIME LOGIN!',
    'text=Security Question',
] as const;

export const MOBILE_VERIFICATION_SELECTORS = [
    'text=Mobile Number Verification',
    'button:has-text("Send Verification Code")',
] as const;

export const PASSWORD_EXPIRED_PATTERNS = [
    /your\s+password\s+has\s+expired/i,
    /change\s+password/i,
    /first\s*time\s*login/i,
];

export const FAVORITE_COLOR_SECURITY_QUESTION_PATTERNS = [
    /^what\s+is\s+your\s+favorite\s+color\??$/i,
];

export const FAVORITE_COLOR_SECURITY_ANSWER = 'Blue';

// ─── Submission Error Patterns ───────────────────────────────────────────────

export const TURNOVER_TAX_SUBMISSION_ERROR_PATTERNS = [
    /invalid\s+file/i,
    /period\s+already\s+filed/i,
    /already\s+submitted/i,
    /please\s+attach/i,
    /upload\s+file/i,
];

export const PAYE_SUBMISSION_ERROR_PATTERNS = [
    /please\s+upload\s+form/i,
    /please\s+attach/i,
    /upload\s+file/i,
    /invalid\s+file/i,
    /selected\s+tax\s+obligation/i,
    /error\s+occurred\s+while\s+uploading/i,
];

export const PAYE_RETRYABLE_UPLOAD_ERROR_PATTERNS = [
    /please\s+upload\s+form/i,
    /please\s+attach/i,
    /upload\s+file/i,
];

export const VAT_SUBMISSION_ERROR_PATTERNS = [
    /please\s+upload\s+form/i,
    /please\s+attach/i,
    /upload\s+file/i,
    /invalid\s+file/i,
    /error\s+occurred\s+while\s+uploading/i,
    /selected\s+tax\s+obligation/i,
];

// ─── Portal Element Selectors ────────────────────────────────────────────────

export const VAT_DOWNLOAD_TRIGGER_SELECTORS = [
    'a:has-text("Click Here")',
    'a:has-text("Download")',
    'button:has-text("Download")',
    'input[type="button"][value*="Download" i]',
    'input[type="submit"][value*="Download" i]',
    'input[type="button"][onclick*="download" i]',
    'input[type="submit"][onclick*="download" i]',
    'a[onclick*="download" i]',
    'button[onclick*="download" i]',
    'a[href*="download" i]',
    'a[href*="template" i]',
    'input[value*="Click Here" i]',
    'button:has-text("Template")',
    'a:has-text("Template")',
];

export const PAYE_UPLOAD_TRIGGER_SELECTORS = [
    'button:has-text("Upload")',
    'input[type="button"][value*="Upload" i]',
    'input[type="submit"][value*="Upload" i]',
    'input[type="image"][src*="upload" i]',
    'a:has-text("Upload")',
    'button[id*="upload" i]',
    'input[type="button"][id*="upload" i]',
    'input[type="submit"][id*="upload" i]',
    'input[type="image"][id*="upload" i]',
    'button[name*="upload" i]',
    'input[type="button"][name*="upload" i]',
    'input[type="submit"][name*="upload" i]',
    'input[type="image"][name*="upload" i]',
    'a[onclick*="upload" i]',
    'input[onclick*="upload" i]',
    'button[onclick*="upload" i]',
];

export const CAPTCHA_ELEMENT_SELECTORS = [
    '#loginCaptcha',
    '#captchaImg',
    '#captcha_img',
    'img[id*="captcha"]',
    'img[src*="GenerateCaptcha"]',
    'img[src*="captcha"]',
];
