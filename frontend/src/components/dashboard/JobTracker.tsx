/**
 * JobTracker.tsx
 *
 * Modern, sleek job progress/status display for the dashboard.
 * Shows generation progress, filing status, queue position, and completion.
 */

import { useState, useEffect } from 'react';
import {
    Loader2,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Clock,
    Download,
    FileText,
    Rocket,
    Zap,
    Receipt,
    CreditCard,
    ChevronDown,
    ChevronUp,
    Ban,
    RotateCcw,
} from 'lucide-react';

export type JobStatus = 'idle' | 'queued' | 'preparing' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface JobLog {
    timestamp: string;
    message: string;
    level: 'info' | 'warn' | 'error';
    progress?: number;
}

export interface JobTrackerProps {
    jobId: string;
    clientName: string;
    clientPin: string;
    obligationType: 'paye' | 'nssf' | 'vat' | 'tot' | 'mri' | 'nil' | 'prn';
    status: JobStatus;
    progress: number;
    message: string;
    queuePosition?: number;
    estimatedStartTime?: string;
    logs: JobLog[];
    receiptUrl?: string;
    prnUrl?: string;
    generatedZipUrl?: string;
    error?: string;
    onCancel?: () => void;
    onRetry?: () => void;
}

const obligationLabels: Record<string, string> = {
    paye: 'PAYE Return',
    nssf: 'NSSF Filing',
    vat: 'VAT Return',
    tot: 'Turnover Tax',
    mri: 'Monthly Rental Income',
    nil: 'Nil Return',
    prn: 'PRN Generation',
};

const obligationColors: Record<string, { bg: string; text: string; border: string; glow: string }> = {
    paye: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', glow: 'shadow-emerald-500/10' },
    nssf: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', glow: 'shadow-blue-500/10' },
    vat: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20', glow: 'shadow-purple-500/10' },
    tot: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', glow: 'shadow-amber-500/10' },
    mri: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', glow: 'shadow-rose-500/10' },
    nil: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', glow: 'shadow-cyan-500/10' },
    prn: { bg: 'bg-slate-500/10', text: 'text-slate-300', border: 'border-slate-500/20', glow: 'shadow-slate-500/10' },
};

const filingSteps = [
    { icon: Rocket, label: 'Launching browser', progress: 5 },
    { icon: Zap, label: 'Navigating KRA portal', progress: 15 },
    { icon: FileText, label: 'Logging in', progress: 30 },
    { icon: CreditCard, label: 'Solving captcha', progress: 40 },
    { icon: FileText, label: 'Selecting return type', progress: 55 },
    { icon: Zap, label: 'Filling return data', progress: 70 },
    { icon: Rocket, label: 'Submitting to KRA', progress: 85 },
    { icon: Receipt, label: 'Downloading receipt', progress: 95 },
    { icon: CheckCircle2, label: 'Completed', progress: 100 },
];

function ProgressBar({ progress, colorClass }: { progress: number; colorClass: string }) {
    return (
        <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
                className={`h-full rounded-full transition-all duration-500 ease-out ${colorClass}`}
                style={{
                    width: `${Math.min(100, Math.max(0, progress))}%`,
                    background: 'linear-gradient(90deg, rgba(212,175,55,0.8) 0%, rgba(245,158,11,0.9) 100%)',
                }}
            />
        </div>
    );
}

function StatusBadge({ status }: { status: JobStatus }) {
    const styles: Record<JobStatus, { icon: React.ElementType; text: string; className: string }> = {
        idle: { icon: Clock, text: 'Ready', className: 'bg-slate-800 text-slate-400 border-slate-700' },
        queued: { icon: Clock, text: 'Queued', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
        preparing: { icon: Loader2, text: 'Preparing', className: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
        processing: { icon: Loader2, text: 'Processing', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
        completed: { icon: CheckCircle2, text: 'Completed', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
        failed: { icon: XCircle, text: 'Failed', className: 'bg-red-500/10 text-red-400 border-red-500/20' },
        cancelled: { icon: Ban, text: 'Cancelled', className: 'bg-slate-800 text-slate-400 border-slate-700' },
    };

    const style = styles[status];
    const Icon = style.icon;

    return (
        <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${style.className}`}>
            <Icon className={`h-3.5 w-3.5 ${status === 'processing' || status === 'preparing' ? 'animate-spin' : ''}`} />
            {style.text}
        </div>
    );
}

export default function JobTracker({
    jobId,
    clientName,
    clientPin,
    obligationType,
    status,
    progress,
    message,
    queuePosition,
    estimatedStartTime,
    logs,
    receiptUrl,
    prnUrl,
    generatedZipUrl,
    error,
    onCancel,
    onRetry,
}: JobTrackerProps) {
    const [showLogs, setShowLogs] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const colors = obligationColors[obligationType] || obligationColors.paye;

    // Track elapsed time for active jobs
    useEffect(() => {
        if (status !== 'processing' && status !== 'preparing') return;
        const interval = setInterval(() => setElapsedTime(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, [status]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Determine current step
    const currentStepIndex = filingSteps.findIndex(s => progress <= s.progress);
    const activeStepIndex = currentStepIndex === -1 ? filingSteps.length - 1 : currentStepIndex;

    return (
        <div className={`rounded-2xl border ${colors.border} bg-slate-900/60 backdrop-blur-sm overflow-hidden shadow-lg ${colors.glow}`}>
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-800/50">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors.bg} ${colors.text}`}>
                            <FileText className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">{clientName}</span>
                                <span className="text-xs text-slate-500 font-mono">{clientPin}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className={`text-xs font-semibold ${colors.text}`}>{obligationLabels[obligationType]}</span>
                                <span className="text-slate-600">|</span>
                                <span className="text-xs text-slate-500 font-mono">{jobId.slice(0, 8)}</span>
                            </div>
                        </div>
                    </div>
                    <StatusBadge status={status} />
                </div>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
                {/* Queue Info */}
                {status === 'queued' && (
                    <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-4">
                        <div className="flex items-center gap-3">
                            <Clock className="h-5 w-5 text-amber-400 animate-pulse" />
                            <div>
                                <div className="text-sm font-semibold text-amber-400">
                                    {queuePosition !== undefined && queuePosition > 0
                                        ? `Position #${queuePosition} in queue`
                                        : 'Waiting to start'}
                                </div>
                                {estimatedStartTime && (
                                    <div className="text-xs text-slate-400 mt-0.5">
                                        Estimated start: {new Date(estimatedStartTime).toLocaleTimeString()}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Progress */}
                {(status === 'preparing' || status === 'processing') && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300">{message || 'Processing...'}</span>
                            <span className="text-sm font-mono text-amber-400">{progress}%</span>
                        </div>
                        <ProgressBar progress={progress} colorClass={colors.text} />
                        
                        {/* Step indicators */}
                        <div className="flex items-center gap-1 pt-2">
                            {filingSteps.slice(0, 5).map((_step, i) => {
                                const isActive = i === activeStepIndex;
                                const isDone = i < activeStepIndex;
                                return (
                                    <div key={i} className="flex items-center gap-1 flex-1">
                                        <div
                                            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                                                isDone ? 'bg-emerald-500/60' : isActive ? 'bg-amber-500' : 'bg-slate-800'
                                            }`}
                                        />
                                    </div>
                                );
                            })}
                        </div>

                        {/* Current step detail */}
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
                            Step {activeStepIndex + 1} of {filingSteps.length}: {filingSteps[activeStepIndex]?.label}
                            {elapsedTime > 0 && (
                                <span className="ml-auto font-mono">{formatTime(elapsedTime)}</span>
                            )}
                        </div>
                    </div>
                )}

                {/* Completion */}
                {status === 'completed' && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                            <span className="text-sm font-semibold text-emerald-400">Filing completed successfully</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {receiptUrl && (
                                <a
                                    href={receiptUrl}
                                    download
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/20"
                                >
                                    <Receipt className="h-3.5 w-3.5" />
                                    Download Receipt
                                </a>
                            )}
                            {prnUrl && (
                                <a
                                    href={prnUrl}
                                    download
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs font-bold text-amber-400 transition hover:bg-amber-500/20"
                                >
                                    <CreditCard className="h-3.5 w-3.5" />
                                    Download PRN
                                </a>
                            )}
                            {generatedZipUrl && (
                                <a
                                    href={generatedZipUrl}
                                    download
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-xs font-bold text-blue-400 transition hover:bg-blue-500/20"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    Download ZIP
                                </a>
                            )}
                        </div>
                    </div>
                )}

                {/* Failure */}
                {status === 'failed' && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-red-400" />
                            <span className="text-sm font-semibold text-red-400">Filing failed</span>
                        </div>
                        {error && (
                            <p className="text-xs text-slate-400 leading-relaxed">{error}</p>
                        )}
                        {onRetry && (
                            <button
                                onClick={onRetry}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs font-bold text-red-400 transition hover:bg-red-500/20"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Retry Filing
                            </button>
                        )}
                    </div>
                )}

                {/* Cancelled */}
                {status === 'cancelled' && (
                    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                        <div className="flex items-center gap-2">
                            <Ban className="h-5 w-5 text-slate-500" />
                            <span className="text-sm font-semibold text-slate-400">Filing was cancelled</span>
                        </div>
                    </div>
                )}

                {/* Logs Toggle */}
                {logs.length > 0 && (
                    <div>
                        <button
                            onClick={() => setShowLogs(!showLogs)}
                            className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-300 transition"
                        >
                            {showLogs ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {showLogs ? 'Hide' : 'Show'} logs ({logs.length})
                        </button>
                        
                        {showLogs && (
                            <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3 max-h-48 overflow-y-auto space-y-1.5">
                                {logs.map((log, i) => (
                                    <div key={i} className="flex items-start gap-2 text-xs">
                                        <span className="text-slate-600 font-mono shrink-0">
                                            {new Date(log.timestamp).toLocaleTimeString()}
                                        </span>
                                        <span className={`${
                                            log.level === 'error' ? 'text-red-400' :
                                            log.level === 'warn' ? 'text-amber-400' :
                                            'text-slate-400'
                                        }`}>
                                            {log.message}
                                        </span>
                                        {log.progress !== undefined && (
                                            <span className="text-amber-400 font-mono ml-auto">{log.progress}%</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Footer Actions */}
            {(status === 'queued' || status === 'processing' || status === 'preparing') && onCancel && (
                <div className="px-5 py-3 border-t border-slate-800/50 bg-slate-950/30">
                    <button
                        onClick={onCancel}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-400 transition"
                    >
                        <Ban className="h-3.5 w-3.5" />
                        Cancel Filing
                    </button>
                </div>
            )}
        </div>
    );
}
