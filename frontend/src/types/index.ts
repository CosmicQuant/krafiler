// ─── Form ─────────────────────────────────────────────────────────────────────

export const TAX_OBLIGATION_OPTIONS = [
    {
        value: 'income_tax_resident_individual',
        label: 'Income Tax - Resident Individual',
        description: 'For resident individual income tax nil returns.',
    },
    {
        value: 'income_tax_non_resident_individual',
        label: 'Income Tax - Non-Resident Individual',
        description: 'For non-resident individual income tax nil returns.',
    },
    {
        value: 'income_tax_company',
        label: 'Income Tax - Company',
        description: 'For company income tax nil returns.',
    },
    {
        value: 'vat',
        label: 'VAT',
        description: 'For value added tax nil returns.',
    },
    {
        value: 'paye',
        label: 'PAYE',
        description: 'For pay-as-you-earn nil returns.',
    },
    {
        value: 'turnover_tax',
        label: 'Turnover Tax (TOT)',
        description: 'For turnover tax nil returns.',
    },
] as const;

export type TaxObligationType = (typeof TAX_OBLIGATION_OPTIONS)[number]['value'];

export interface NilReturnFormData {
    kraPin: string;
    kraPassword: string;
    periodFrom: string;
    periodTo: string;
    taxObligationType: TaxObligationType;
    ownsRentalProperty: boolean;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export interface FilingResponse {
    success: boolean;
    message: string;
    jobId?: string;
}

export interface FilingStatusResponse {
    jobId: string;
    state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
    progress: number | object;
    attemptsMade: number;
    failedReason: string | null;
    processedOn: string | null;
    finishedOn: string | null;
}
