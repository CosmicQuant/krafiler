// ─── Form ─────────────────────────────────────────────────────────────────────

export const TAX_OBLIGATION_OPTIONS = [
    {
        value: 'income_tax_resident_individual',
        label: 'Income Tax - Resident Individual',
        description: 'Nil filing for resident individual income tax.',
        filingMode: 'nil',
    },
    {
        value: 'monthly_rental_income',
        label: 'Income Tax - Rent Income (MRI)',
        description: 'Transaction-based MRI filing that requires the rental income amount.',
        filingMode: 'transactional',
    },
    {
        value: 'income_tax_non_resident_individual',
        label: 'Income Tax - Non-Resident Individual',
        description: 'Nil filing for non-resident individual income tax.',
        filingMode: 'nil',
    },
    {
        value: 'income_tax_company',
        label: 'Income Tax - Company',
        description: 'Nil filing for company income tax.',
        filingMode: 'nil',
    },
    {
        value: 'vat',
        label: 'VAT',
        description: 'Nil filing for VAT.',
        filingMode: 'nil',
    },
    {
        value: 'paye',
        label: 'PAYE',
        description: 'Nil filing for PAYE.',
        filingMode: 'nil',
    },
    {
        value: 'turnover_tax',
        label: 'Turnover Tax (TOT)',
        description: 'Transaction-based turnover tax filing that calculates 1.5% tax directly from your Gross Turnover input.',
        filingMode: 'transactional',
    },
] as const;

export type TaxObligationType = (typeof TAX_OBLIGATION_OPTIONS)[number]['value'];
export type FilingMode = (typeof TAX_OBLIGATION_OPTIONS)[number]['filingMode'];

export interface FilingFormData {
    kraPin: string;
    kraPassword: string;
    periodFrom: string;
    periodTo: string;
    taxObligationType: TaxObligationType;
    ownsRentalProperty: boolean;
    rentalIncomeAmount?: number;
    totYear?: number;
    totMonth?: number;
    totTurnover?: number;
    payeZipUrl?: string;
    otpCode?: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export interface FilingResponse {
    success: boolean;
    message: string;
    jobId?: string;
}

export interface FilingStepLog {
    timestamp: string;
    message: string;
    progress: number | null;
    level: 'info' | 'error';
}

export interface CredentialUpdate {
    passwordChanged: boolean;
    newPassword: string;
    changedAt: string;
}

export interface FilingResult {
    receiptPath?: string;
    receiptNumber?: string | null;
    credentialUpdate?: CredentialUpdate | null;
}

export interface FilingStatusResponse {
    jobId: string;
    state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
    progress: number | object;
    attemptsMade: number;
    failedReason: string | null;
    stepLogs: FilingStepLog[];
    lastStep: FilingStepLog | null;
    credentialUpdate: CredentialUpdate | null;
    result: FilingResult | null;
    processedOn: string | null;
    finishedOn: string | null;
}
