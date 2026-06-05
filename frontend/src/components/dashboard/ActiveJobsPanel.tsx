import { useState } from 'react';
import {
    Zap,
    Ban,
    RefreshCw,
    ChevronDown,
    ChevronUp,
    Clock,
    Loader2,
    CheckCircle2,
    AlertCircle,
    OctagonPause,
} from 'lucide-react';
import { ActiveDashboardJob, ClientObligation } from '../../types';
import { isPendingFilingJob } from '../../utils/dashboardUtils';

interface ActiveJobsPanelProps {
    clients: ClientObligation[];
    activeJobs: Record<string, ActiveDashboardJob>;
    onCancelJob: (client: ClientObligation) => void;
    cancellingClientIds?: Record<string, boolean>;
}

const STATE_META: Record<string, {
    label: string;
    color: string;
    bg: string;
    border: string;
    icon: React.ReactNode;
}> = {
    waiting: {
        label: 'Queued',
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        icon: <Clock className="h-3.5 w-3.5 text-amber-500" />,
    },
    active: {
        label: 'Running',
        color: 'text-blue-600',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />,
    },
    processing: {
        label: 'Running',
        color: 'text-blue-600',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />,
    },
    completed: {
        label: 'Done',
        color: 'text-emerald-600',
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
    },
    failed: {
        label: 'Failed',
        color: 'text-red-600',
        bg: 'bg-red-50',
        border: 'border-red-200',
        icon: <AlertCircle className="h-3.5 w-3.5 text-red-500" />,
    },
    cancelled: {
        label: 'Cancelled',
        color: 'text-slate-600',
        bg: 'bg-slate-50',
        border: 'border-slate-200',
        icon: <Ban className="h-3.5 w-3.5 text-slate-500" />,
    },
    cancelling: {
        label: 'Cancelling',
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        icon: <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-500" />,
    },
    delayed: {
        label: 'Delayed',
        color: 'text-purple-600',
        bg: 'bg-purple-50',
        border: 'border-purple-200',
        icon: <Clock className="h-3.5 w-3.5 text-purple-500" />,
    },
    unknown: {
        label: 'Unknown',
        color: 'text-slate-600',
        bg: 'bg-slate-50',
        border: 'border-slate-200',
        icon: <AlertCircle className="h-3.5 w-3.5 text-slate-500" />,
    },
};

export function ActiveJobsPanel({
    clients,
    activeJobs,
    onCancelJob,
    cancellingClientIds,
}: ActiveJobsPanelProps) {
    const [expanded, setExpanded] = useState(true);

    const jobs = Object.entries(activeJobs)
        .map(([clientId, job]) => {
            const client = clients.find((c) => c.id === clientId);
            return { clientId, job, client };
        })
        .filter(({ job }) => !!job)
        .sort((a, b) => {
            // Pending jobs first, then by progress descending
            const aPending = isPendingFilingJob(a.job) ? 1 : 0;
            const bPending = isPendingFilingJob(b.job) ? 1 : 0;
            if (aPending !== bPending) return bPending - aPending;
            return b.job.progress - a.job.progress;
        });

    if (jobs.length === 0) return null;

    const pendingCount = jobs.filter(({ job }) => isPendingFilingJob(job)).length;

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${pendingCount > 0 ? 'bg-blue-50' : 'bg-slate-100'}`}>
                        <Zap className={`h-4 w-4 ${pendingCount > 0 ? 'text-blue-600' : 'text-slate-500'}`} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-900">Active Jobs</h3>
                        <p className="text-[11px] text-slate-400">
                            {pendingCount > 0
                                ? `${pendingCount} job${pendingCount === 1 ? '' : 's'} running`
                                : `${jobs.length} recent job${jobs.length === 1 ? '' : 's'}`}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                >
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
            </div>

            {expanded && (
                <div className="space-y-3">
                    {jobs.map(({ clientId, job, client }) => {
                        const meta = STATE_META[job.state] || STATE_META.unknown;
                        const pending = isPendingFilingJob(job);
                        const isCancelling = cancellingClientIds?.[clientId] || job.state === 'cancelling';

                        return (
                            <div
                                key={clientId}
                                className={`rounded-xl border ${meta.border} ${meta.bg} p-3.5 transition`}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        {meta.icon}
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold text-slate-900 truncate">
                                                {client?.name || 'Unknown Client'}
                                            </p>
                                            <p className="text-[10px] text-slate-500 font-medium">
                                                {job.obligationType
                                                    ? job.obligationType.toUpperCase().replace(/_/g, ' ')
                                                    : 'Filing'}
                                                {' · '}
                                                <span className={meta.color}>{meta.label}</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        {/* Progress */}
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-16 bg-white rounded-full h-1.5 border border-slate-100 overflow-hidden">
                                                <div
                                                    className={`h-1.5 rounded-full transition-all duration-500 ${
                                                        job.state === 'completed'
                                                            ? 'bg-emerald-500'
                                                            : job.state === 'failed'
                                                            ? 'bg-red-500'
                                                            : 'bg-blue-500'
                                                    }`}
                                                    style={{ width: `${Math.max(job.progress, 2)}%` }}
                                                />
                                            </div>
                                            <span className={`text-[11px] font-bold ${meta.color}`}>
                                                {job.progress}%
                                            </span>
                                        </div>

                                        {/* Cancel button */}
                                        {pending && (
                                            <button
                                                onClick={() => client && onCancelJob(client)}
                                                disabled={isCancelling}
                                                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[10px] font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="Cancel job"
                                            >
                                                {isCancelling ? (
                                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                                ) : (
                                                    <OctagonPause className="h-3 w-3" />
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Message */}
                                <p className="mt-1.5 text-[11px] text-slate-600 leading-relaxed line-clamp-2">
                                    {job.state === 'failed'
                                        ? job.failedReason || 'An error occurred'
                                        : job.message}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
