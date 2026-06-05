import { useState } from 'react';
import {
    ChevronDown,
    ChevronUp,
    Ban,
    RefreshCw,
    X,
    Clock,
    Loader2,
    CheckCircle2,
    AlertCircle,
} from 'lucide-react';
import { ActiveDashboardJob } from '../../types';
import { getFilingStatusLabel, getFilingProgressTone, isPendingFilingJob, isTerminalFilingJob } from '../../utils/dashboardUtils';

interface JobStatusInlineProps {
    job: ActiveDashboardJob;
    clientName?: string;
    onCancel?: () => void;
    cancelling?: boolean;
}

export default function JobStatusInline({
    job,
    clientName: _clientName,
    onCancel,
    cancelling,
}: JobStatusInlineProps) {
    const [showLogs, setShowLogs] = useState(false);
    const pending = isPendingFilingJob(job);
    const terminal = isTerminalFilingJob(job);

    const statusIcon = () => {
        if (job.state === 'completed') return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
        if (job.state === 'failed') return <AlertCircle className="h-3 w-3 text-red-500" />;
        if (job.state === 'cancelled') return <Ban className="h-3 w-3 text-slate-500" />;
        if (job.state === 'cancelling') return <RefreshCw className="h-3 w-3 animate-spin text-amber-500" />;
        if (job.state === 'waiting') return <Clock className="h-3 w-3 text-amber-500" />;
        return <Loader2 className="h-3 w-3 animate-spin text-blue-500" />;
    };

    return (
        <div className="w-full bg-white border border-slate-100 rounded-lg p-3">
            {/* Header: status + progress */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                    {statusIcon()}
                    <span className="text-[10px] text-slate-600 font-medium font-mono uppercase tracking-wider truncate">
                        {getFilingStatusLabel(job)}
                    </span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono shrink-0">
                    {job.progress}%
                </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1.5 overflow-hidden">
                <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${getFilingProgressTone(job)}`}
                    style={{ width: `${Math.max(job.progress, terminal ? job.progress : 5)}%` }}
                />
            </div>

            {/* Message / failed reason */}
            <div className="text-[10px] text-slate-500 line-clamp-2 mb-1">
                {job.state === 'failed' ? (
                    <span className="text-red-600">
                        {job.failedReason || 'An error occurred during filing.'}
                    </span>
                ) : (
                    job.message
                )}
            </div>

            {/* Step logs toggle */}
            {Array.isArray(job.stepLogs) && job.stepLogs.length > 0 && (
                <div className="mb-1.5">
                    <button
                        onClick={() => setShowLogs(!showLogs)}
                        className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition"
                    >
                        {showLogs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {showLogs ? 'Hide' : 'Show'} worker logs ({job.stepLogs.length})
                    </button>

                    {showLogs && (
                        <div className="mt-1.5 rounded-lg border border-slate-100 bg-slate-50 p-2 max-h-40 overflow-y-auto space-y-1">
                            {job.stepLogs.map((log, i) => (
                                <div key={i} className="flex items-start gap-2 text-[10px]">
                                    <span className="text-slate-400 font-mono shrink-0">
                                        {new Date(log.timestamp).toLocaleTimeString()}
                                    </span>
                                    <span
                                        className={`${
                                            log.level === 'error'
                                                ? 'text-red-600'
                                                : log.level === 'warn'
                                                ? 'text-amber-600'
                                                : 'text-slate-600'
                                        }`}
                                    >
                                        {log.message}
                                    </span>
                                    {typeof log.progress === 'number' && (
                                        <span className="text-slate-400 font-mono ml-auto shrink-0">
                                            {log.progress}%
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Cancel button */}
            {pending && onCancel && (
                <button
                    onClick={onCancel}
                    disabled={cancelling || job.state === 'cancelling'}
                    className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-[#d80000] transition hover:bg-[#d80000] hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-white disabled:text-slate-500"
                >
                    {cancelling || job.state === 'cancelling' ? (
                        <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
                    ) : (
                        <X className="h-3 w-3 shrink-0" />
                    )}
                    <span>
                        {job.state === 'cancelling' ? 'Cancelling...' : 'Cancel Job'}
                    </span>
                </button>
            )}

            {/* Terminal state downloads */}
            {terminal && (job.receiptUrl || job.prnUrl || job.generatedZipUrl) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {job.receiptUrl && (
                        <a
                            href={job.receiptUrl}
                            download
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-500/20 px-2 py-1 text-[10px] font-bold text-blue-600 transition hover:bg-blue-100"
                        >
                            Receipt
                        </a>
                    )}
                    {job.prnUrl && (
                        <a
                            href={job.prnUrl}
                            download
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-red-50 border border-red-200 px-2 py-1 text-[10px] font-bold text-[#ff0613] transition hover:bg-red-100"
                        >
                            PRN
                        </a>
                    )}
                    {job.generatedZipUrl && (
                        <a
                            href={job.generatedZipUrl}
                            download
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-500/20 px-2 py-1 text-[10px] font-bold text-emerald-600 transition hover:bg-emerald-100"
                        >
                            ZIP
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
