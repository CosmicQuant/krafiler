import { useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Rocket,
    Globe,
    ShieldCheck,
    LogIn,
    FileText,
    ListChecks,
    Edit3,
    CheckCircle2,
    Receipt,
    AlertCircle,
    XCircle,
    Clock,
    Loader2,
    Terminal,
} from 'lucide-react';
import type { FilingStepLog } from '../types';

type LogLevel = 'info' | 'warn' | 'error' | undefined;

interface FilingStepTimelineProps {
    logs: FilingStepLog[];
    isActive: boolean;
    maxHeight?: string;
}

interface StepMeta {
    icon: React.ReactNode;
    color: string;
    bg: string;
    border: string;
}

function inferStepMeta(message: string, level: LogLevel): StepMeta {
    const lower = message.toLowerCase();

    if (level === 'error' || lower.includes('failed') || lower.includes('error')) {
        return {
            icon: <XCircle className="h-3.5 w-3.5" />,
            color: 'text-red-600',
            bg: 'bg-red-50',
            border: 'border-red-200',
        };
    }

    if (lower.includes('warning') || level === 'warn') {
        return {
            icon: <AlertCircle className="h-3.5 w-3.5" />,
            color: 'text-amber-600',
            bg: 'bg-amber-50',
            border: 'border-amber-200',
        };
    }

    if (lower.includes('receipt') || lower.includes('download')) {
        return {
            icon: <Receipt className="h-3.5 w-3.5" />,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50',
            border: 'border-emerald-200',
        };
    }

    if (lower.includes('filed successfully') || lower.includes('submitted successfully') || lower.includes('job completed')) {
        return {
            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50',
            border: 'border-emerald-200',
        };
    }

    if (lower.includes('captcha')) {
        return {
            icon: <ShieldCheck className="h-3.5 w-3.5" />,
            color: 'text-purple-600',
            bg: 'bg-purple-50',
            border: 'border-purple-200',
        };
    }

    if (lower.includes('login') || lower.includes('credential') || lower.includes('password')) {
        return {
            icon: <LogIn className="h-3.5 w-3.5" />,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
            border: 'border-blue-200',
        };
    }

    if (lower.includes('selecting') || lower.includes('obligation')) {
        return {
            icon: <ListChecks className="h-3.5 w-3.5" />,
            color: 'text-cyan-600',
            bg: 'bg-cyan-50',
            border: 'border-cyan-200',
        };
    }

    if (lower.includes('filling') || lower.includes('nil return details')) {
        return {
            icon: <Edit3 className="h-3.5 w-3.5" />,
            color: 'text-indigo-600',
            bg: 'bg-indigo-50',
            border: 'border-indigo-200',
        };
    }

    if (lower.includes('nil return page') || lower.includes('return page')) {
        return {
            icon: <FileText className="h-3.5 w-3.5" />,
            color: 'text-sky-600',
            bg: 'bg-sky-50',
            border: 'border-sky-200',
        };
    }

    if (lower.includes('navigating') || lower.includes('portal')) {
        return {
            icon: <Globe className="h-3.5 w-3.5" />,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
            border: 'border-blue-200',
        };
    }

    if (lower.includes('received task') || lower.includes('starting job')) {
        return {
            icon: <Rocket className="h-3.5 w-3.5" />,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
            border: 'border-blue-200',
        };
    }

    return {
        icon: <Clock className="h-3.5 w-3.5" />,
        color: 'text-slate-600',
        bg: 'bg-slate-50',
        border: 'border-slate-200',
    };
}

function formatTime(timestamp: string): string {
    try {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    } catch {
        return timestamp;
    }
}

export default function FilingStepTimeline({ logs, isActive, maxHeight = 'max-h-72' }: FilingStepTimelineProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    const visibleLogs = useMemo(() => {
        // Deduplicate by timestamp+message to avoid flicker if the API returns overlapping entries
        const seen = new Set<string>();
        return logs.filter((log) => {
            const key = `${log.timestamp}::${log.message}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }, [logs]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [visibleLogs]);

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-slate-400" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Execution Timeline
                    </p>
                </div>
                {isActive && (
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-blue-600">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                        </span>
                        Live
                    </span>
                )}
            </div>

            <div
                ref={scrollRef}
                className={`space-y-2 overflow-y-auto pr-1 ${maxHeight}`}
            >
                <AnimatePresence mode="popLayout">
                    {visibleLogs.map((log, index) => {
                        const meta = inferStepMeta(log.message, log.level);
                        const isLast = index === visibleLogs.length - 1;

                        return (
                            <motion.div
                                key={`${log.timestamp}-${index}`}
                                layout
                                initial={{ opacity: 0, x: -40, scale: 0.9 }}
                                animate={{ opacity: 1, x: 0, scale: 1 }}
                                exit={{ opacity: 0, x: 20, scale: 0.95 }}
                                transition={{
                                    type: 'spring',
                                    stiffness: 380,
                                    damping: 22,
                                    delay: Math.min(index * 0.04, 0.3),
                                }}
                                className={[
                                    'rounded-lg border px-3 py-2 text-xs',
                                    meta.bg,
                                    meta.border,
                                    isLast && isActive ? 'ring-2 ring-blue-200 shadow-sm' : '',
                                ].join(' ')}
                            >
                                <div className="flex items-start gap-2.5">
                                    <motion.div
                                        initial={{ scale: 0, rotate: -45 }}
                                        animate={{ scale: 1, rotate: 0 }}
                                        transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.05 + index * 0.04 }}
                                        className={[
                                            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-white',
                                            meta.border,
                                            meta.color,
                                        ].join(' ')}
                                    >
                                        {meta.icon}
                                    </motion.div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className={[
                                                'text-[10px] font-mono uppercase tracking-wide',
                                                meta.color,
                                            ].join(' ')}
                                            >
                                                {formatTime(log.timestamp)}
                                            </span>
                                            {typeof log.progress === 'number' && (
                                                <span className="text-[10px] font-mono font-bold text-slate-500 shrink-0">
                                                    {log.progress}%
                                                </span>
                                            )}
                                        </div>
                                        <motion.p
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ duration: 0.35, delay: 0.1 + index * 0.04 }}
                                            className={[
                                                'mt-0.5 text-sm leading-relaxed',
                                                log.level === 'error'
                                                    ? 'text-red-800 font-medium'
                                                    : log.level === 'warn'
                                                        ? 'text-amber-800'
                                                        : 'text-slate-700',
                                            ].join(' ')}
                                        >
                                            {log.message}
                                        </motion.p>
                                    </div>
                                </div>
                                {isLast && isActive && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: [0, 1, 0] }}
                                        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                                        className="mt-2 h-0.5 rounded-full bg-blue-400/50"
                                    />
                                )}
                            </motion.div>
                        );
                    })}
                </AnimatePresence>

                {isActive && (
                    <motion.div
                        key="waiting-indicator"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.3 }}
                        className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500"
                    >
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                        Waiting for next worker update…
                    </motion.div>
                )}
            </div>
        </div>
    );
}
