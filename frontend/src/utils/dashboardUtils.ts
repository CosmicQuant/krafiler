import { ActiveDashboardJob, ClientObligation } from '../types';

export function normalizeClientObligation(value: string) {
    const normalized = value.trim().toLowerCase();

    if (!normalized) return normalized;
    if (normalized === 'monthly_rental_income' || normalized === 'monthly rental income') return 'mri';
    if (normalized === 'turnover_tax' || normalized === 'turnover tax') return 'tot';
    if (normalized === 'elevy') return 'elevy';

    return normalized;
}

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
    return client.paye !== 'na' || client.nssf !== 'na' || client.sha !== 'na';
}

export function markPayrollStatusesGenerated(client: ClientObligation): ClientObligation {
    const timestamp = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return {
        ...client,
        paye: client.paye === 'na' ? 'na' : 'generated',
        nssf: client.nssf === 'na' ? 'na' : 'generated',
        sha: client.sha === 'na' ? 'na' : 'generated',
        lastGeneratedAt: timestamp,
    };
}
