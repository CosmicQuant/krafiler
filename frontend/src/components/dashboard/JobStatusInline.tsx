import { useState, useMemo } from 'react';
import {
    ChevronDown,
    ChevronUp,
    Ban,
    RefreshCw,
    Clock,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Terminal,
    FileDown,
    Receipt,
    Package,
    OctagonPause,
} from 'lucide-react';
import { ActiveDashboardJob } from '../../types';
import { isPendingFilingJob, isTerminalFilingJob } from '../../utils/dashboardUtils';
import { downloadAuthFile } from '../../utils/downloadAuthFile';

interface JobStatusInlineProps {
    job: ActiveDashboardJob;
    clientName?: string;
    onCancel?: () => void;
    cancelling?: boolean;
}

const STATE_CONFIG: Record<string, {
    label: string;
    color: string;
    bg: string;
    border: string;
    icon: React.ReactNode;
    pulse?: boolean;
}> = {
    waiting: {
        label: 'Queued',
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        icon: <Clock className="h-4 w-4 text-amber-500" />,
    },
    active: {
        label: 'Filing in Progress',
        color: 'text-blue-600',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        icon: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
        pulse: true,
    },
    processing: {
        label: 'Processing',
        color: 'text-blue-600',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        icon: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
        pulse: true,
    },
    completed: {
        label: 'Completed',
        color: 'text-emerald-600',
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    },
    failed: {
        label: 'Failed',
        color: 'text-red-600',
        bg: 'bg-red-50',
        border: 'border-red-200',
        icon: <AlertCircle className="h-4 w-4 text-red-500" />,
    },
    cancelled: {
        label: 'Cancelled',
        color: 'text-slate-600',
        bg: 'bg-slate-50',
        border: 'border-slate-200',
        icon: <Ban className="h-4 w-4 text-slate-500" />,
    },
    cancelling: {
        label: 'Cancelling...',
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        icon: <RefreshCw className="h-4 w-4 animate-spin text-amber-500" />,
    },
    delayed: {
        label: 'Delayed',
        color: 'text-purple-600',
        bg: 'bg-purple-50',
        border: 'border-purple-200',
        icon: <Clock className="h-4 w-4 text-purple-500" />,
    },
    unknown: {
        label: 'Unknown',
        color: 'text-slate-600',
        bg: 'bg-slate-50',
        border: 'border-slate-200',
        icon: <AlertCircle className="h-4 w-4 text-slate-500" />,
    },
};

export default function JobStatusInline({
    job,
    clientName,
    onCancel,
    cancelling,
}: JobStatusInlineProps) {
    const [showLogs, setShowLogs] = useState(false);
    const pending = isPendingFilingJob(job);
    const terminal = isTerminalFilingJob(job);
    const config = STATE_CONFIG[job.state] || STATE_CONFIG.unknown;

    const latestLogs = useMemo(() => {
        if (!job.stepLogs || job.stepLogs.length === 0) return [];
        return job.stepLogs.slice(-10);
    }, [job.stepLogs]);

    const hasLogs = latestLogs.length > 0;

    return (
        <div className={`rounded-xl border ${config.border} ${config.bg} p-4 shadow-sm`}>
            {/* Header row */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white border ${config.border} shadow-sm`}>
                        {config.icon}
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${config.color}`}>
                                {config.label}
                            </span>
                            {config.pulse && (
                                <span className="inline-flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                            )}
                        </div>
                        {clientName && (
                            <p className="text-[11px] text-slate-500 font-medium truncate">
                                {clientName}
                            </p>
                        )}
                    </div>
                </div>

                {/* Progress percentage */}
                <div className="flex flex-col items-end shrink-0">
                    <span className={`text-lg font-black ${config.color}`}>
                        {job.progress}%
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">
                        {job.obligationType ? job.obligationType.toUpperCase().replace(/_/g, ' ') : 'Filing'}
                    </span>
                </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3 w-full bg-white rounded-full h-2 overflow-hidden border border-slate-100">
                <div
                    className={`h-2 rounded-full transition-all duration-700 ease-out ${
                        job.state === 'completed'
                            ? 'bg-emerald-500'
                            : job.state === 'failed'
                            ? 'bg-red-500'
                            : job.state === 'cancelled'
                            ? 'bg-slate-500'
                            : job.state === 'cancelling'
                            ? 'bg-amber-500'
                            : 'bg-blue-500'
                    }`}
                    style={{
                        width: `${Math.max(job.progress, terminal ? job.progress : 3)}%`,
                    }}
                />
            </div>

            {/* Message — show latest step log if available, otherwise fallback */}
            <div className="mt-2">
                {job.state === 'failed' ? (
                    <p className="text-xs text-red-600 font-medium leading-relaxed">
                        {job.failedReason || 'An error occurred during filing.'}
                    </p>
                ) : (
                    <p className="text-xs text-slate-600 font-medium leading-relaxed">
                        {latestLogs.length > 0 ? latestLogs[latestLogs.length - 1].message : (job.message || 'Processing...')}
                    </p>
                )}
            </div>

            {/* Action bar */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
                {/* Cancel button */}
                {pending && onCancel && (
                    <button
                        onClick={onCancel}
                        disabled={cancelling || job.state === 'cancelling'}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {cancelling || job.state === 'cancelling' ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                            <OctagonPause className="h-3 w-3" />
                        )}
                        {job.state === 'cancelling' ? 'Cancelling...' : 'Cancel'}
                    </button>
                )}

                {/* Logs toggle */}
                {hasLogs && (
                    <button
                        onClick={() => setShowLogs(!showLogs)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                    >
                        <Terminal className="h-3 w-3" />
                        {showLogs ? 'Hide' : 'Show'} logs
                        {showLogs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                )}

                {/* Terminal downloads */}
                {terminal && (
                    <>
                        {job.receiptUrl && (
                            <button
                                onClick={() => downloadAuthFile(job.receiptUrl!)}
                                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[11px] font-bold text-blue-600 transition hover:bg-blue-50"
                            >
                                <Receipt className="h-3 w-3" /> Receipt
                            </button>
                        )}
                        {job.prnUrl && (
                            <button
                                onClick={() => downloadAuthFile(job.prnUrl!)}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-bold text-red-600 transition hover:bg-red-50"
                            >
                                <FileDown className="h-3 w-3" /> PRN
                            </button>
                        )}
                        {job.generatedZipUrl && (
                            <button
                                onClick={() => downloadAuthFile(job.generatedZipUrl!)}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-bold text-emerald-600 transition hover:bg-emerald-50"
                            >
                                <Package className="h-3 w-3" /> ZIP
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Logs panel */}
            {showLogs && hasLogs && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 shadow-inner">
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {latestLogs.map((log, i) => (
                            <div
                                key={i}
                                className={`flex items-start gap-2 text-[11px] rounded-md px-2 py-1 ${
                                    log.level === 'error'
                                        ? 'bg-red-50/50'
                                        : log.level === 'warn'
                                        ? 'bg-amber-50/50'
                                        : 'hover:bg-slate-50'
                                }`}
                            >
                                <span className="text-slate-400 font-mono shrink-0 text-[10px] pt-0.5">
                                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                                <span
                                    className={`flex-1 leading-relaxed ${
                                        log.level === 'error'
                                            ? 'text-red-600 font-medium'
                                            : log.level === 'warn'
                                            ? 'text-amber-600'
                                            : 'text-slate-600'
                                    }`}
                                >
                                    {log.message}
                                </span>
                                {typeof log.progress === 'number' && (
                                    <span className="text-slate-400 font-mono shrink-0 text-[10px] font-bold">
                                        {log.progress}%
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
