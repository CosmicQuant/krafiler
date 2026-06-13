import { ActiveDashboardJob, ClientObligation } from '../types';

export function normalizeClientObligation(value: string) {
    const normalized = value.trim().toLowerCase();

    if (!normalized) return normalized;
    if (normalized === 'monthly_rental_income' || normalized === 'monthly rental income') return 'mri';
    if (normalized === 'turnover_tax' || normalized === 'turnover tax') return 'tot';
    if (normalized === 'elevy') return 'elevy';
    if (normalized === 'income_tax_resident_individual' || normalized === 'income tax resident individual') return 'income_tax_resident_individual';
    if (normalized === 'income_tax_non_resident_individual' || normalized === 'income tax non-resident individual') return 'income_tax_non_resident_individual';
    if (normalized === 'income_tax_company' || normalized === 'income tax company') return 'income_tax_company';
    if (normalized === 'excise_duty' || normalized === 'excise duty') return 'excise_duty';

    return normalized;
}

export { getClientFilingPeriod } from './taxPeriods';

export function buildStoredArtifactUrl(resultPath?: string) {
    if (!resultPath) {
        return undefined;
    }

    const normalized = resultPath.replace(/\\/g, '/');

    if (/^https?:\/\//i.test(normalized)) {
        return normalized;
    }

    if (normalized.startsWith('/api/')) {
        return normalized;
    }

    if (normalized.startsWith('/clients/')) {
        return normalized;
    }

    if (/^[A-Za-z]:\//.test(normalized)) {
        const receiptsMarkerIndex = normalized.toLowerCase().indexOf('/receipts/');
        if (receiptsMarkerIndex >= 0) {
            return `/api${normalized.slice(receiptsMarkerIndex)}`;
        }
        return undefined;
    }

    // Worker stores receipt paths as "data/receipts/<jobId>/receipt.pdf" relative to RECEIPTS_DIR.
    // Strip the "data/" prefix so the URL maps to /api/receipts/... which matches the middleware route.
    if (normalized.startsWith('data/receipts/')) {
        return `/api/receipts/${normalized.slice('data/receipts/'.length)}`;
    }

    return `/api/${normalized.replace(/^\/+/, '')}`;
}

export function formatTaxAmount(value?: number) {
    return (value ?? 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export function isSameMoney(left?: number, right?: number) {
    return Math.abs((left ?? 0) - (right ?? 0)) < 0.01;
}

export function getReceiptUrlForObligation(client: ClientObligation, type: string) {
    switch (type) {
        case 'VAT':
            return client.vatReceiptUrl;
        case 'TOT':
            return client.totReceiptUrl;
        case 'MRI':
            return client.mriReceiptUrl;
        case 'DST':
            return client.dstReceiptUrl;
        case 'PAYE':
            return client.payeReceiptUrl;
        case 'NSSF':
            return client.nssfReceiptUrl;
        case 'SHA':
            return client.shaReceiptUrl;
        case 'IT_RESIDENT_INDIVIDUAL':
            return client.incomeTaxResidentIndividualReceiptUrl;
        case 'IT_NON_RESIDENT_INDIVIDUAL':
            return client.incomeTaxNonResidentIndividualReceiptUrl;
        case 'IT_COMPANY':
            return client.incomeTaxCompanyReceiptUrl;
        case 'EXCISE_DUTY':
            return client.exciseDutyReceiptUrl;
        default:
            return undefined;
    }
}

export function isPendingFilingJob(job?: ActiveDashboardJob | null) {
    return !!job && (job.state === 'waiting' || job.state === 'active' || job.state === 'delayed' || job.state === 'cancelling');
}

export function isTerminalFilingJob(job?: ActiveDashboardJob | null) {
    return !!job && (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled');
}

export function getAutoFileLabel(job?: ActiveDashboardJob | null) {
    if (!job) {
        return 'AutoFile PAYE';
    }

    if (job.state === 'waiting' || job.state === 'delayed') {
        return 'Queued...';
    }

    if (job.state === 'active') {
        return 'Filing...';
    }

    if (job.state === 'cancelling') {
        return 'Cancelling...';
    }

    return 'Auto-File';
}

export function getFilingStatusLabel(job: ActiveDashboardJob) {
    if (job.state === 'completed') {
        return '✓ Finished';
    }

    if (job.state === 'failed') {
        return '⚠ Failed';
    }

    if (job.state === 'cancelled') {
        return '■ Cancelled';
    }

    if (job.state === 'cancelling') {
        return '◌ Cancelling';
    }

    return '⚙ Filing...';
}

export function getFilingProgressTone(job: ActiveDashboardJob) {
    if (job.state === 'completed') {
        return 'bg-emerald-500';
    }

    if (job.state === 'failed') {
        return 'bg-red-500';
    }

    if (job.state === 'cancelled') {
        return 'bg-slate-500';
    }

    if (job.state === 'cancelling') {
        return 'bg-amber-500';
    }

    return 'bg-blue-500';
}

export function isPayrollDeskClient(client: ClientObligation) {
    const hasObligation = (val: string | null | undefined) => !!val && val !== 'na';
    return hasObligation(client.paye) || hasObligation(client.nssf) || hasObligation(client.sha);
}

export function markPayrollStatusesGenerated(client: ClientObligation): ClientObligation {
    const timestamp = new Date().toISOString();
    return {
        ...client,
        paye: client.paye === 'na' ? 'na' : 'generated',
        nssf: client.nssf === 'na' ? 'na' : 'generated',
        sha: client.sha === 'na' ? 'na' : 'generated',
        lastGeneratedAt: timestamp,
    };
}

export function formatGeneratedDate(dateValue?: string | null): string {
    if (!dateValue || dateValue === 'null' || dateValue === 'undefined') {
        return '';
    }
    try {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) {
            return '';
        }
        return date.toLocaleString();
    } catch {
        return '';
    }
}
