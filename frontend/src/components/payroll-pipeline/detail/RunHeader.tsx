import { useState, useMemo } from 'react';
import {
    Calendar, Plus, Play, Lock, RotateCcw, ChevronDown, Trash2,
    Users, Banknote, Wallet, AlertCircle, X
} from 'lucide-react';
import { cn } from '../../../utils/cn';
import type { ClientObligation } from '../../../types';

interface PayrollRun {
    id: number;
    period: string;
    periodLabel: string;
    status: string;
    totalEmployees: number;
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
    lockedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

type RunStatus = 'draft' | 'approved' | 'finalized' | 'filed';

interface RunHeaderProps {
    client: ClientObligation;
    period: string;
    onChangePeriod: (period: string) => void;
    currentRun: PayrollRun | null;
    runStatus: RunStatus;
    runs: PayrollRun[];
    onSelectRun: (run: PayrollRun | null) => void;
    onCreateRun: () => void;
    onGenerateEntries: () => void;
    onFinalize: () => void;
    onRollback: () => void;
    onDelete: () => void;
    loading: boolean;
    error: string | null;
    onClearError: () => void;
}

const statusConfig: Record<RunStatus, { label: string; color: string; bg: string; border: string }> = {
    draft: { label: 'Draft', color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' },
    approved: { label: 'Approved', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
    finalized: { label: 'Finalized', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    filed: { label: 'Filed', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
};

export function RunHeader({
    client,
    period,
    onChangePeriod,
    currentRun,
    runStatus,
    runs,
    onSelectRun,
    onCreateRun,
    onGenerateEntries,
    onFinalize,
    onRollback,
    onDelete,
    loading,
    error,
    onClearError,
}: RunHeaderProps) {
    const [showRunPicker, setShowRunPicker] = useState(false);

    const cfg = statusConfig[runStatus];

    const runOptions = useMemo(() => {
        return runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [runs]);

    const totalEmployees = currentRun?.totalEmployees || 0;
    const totalGross = currentRun?.totalGross || 0;
    const totalNet = currentRun?.totalNet || 0;

    return (
        <div className="space-y-3">
            {/* Error banner */}
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                    <button onClick={onClearError} className="ml-auto rounded p-1 hover:bg-red-100">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {/* Main header card */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Title + Period + Status */}
                    <div className="flex items-center gap-4">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900">Payroll Pipeline</h2>
                            <p className="text-sm text-slate-500">{client.name}</p>
                        </div>
                        <div className="h-8 w-px bg-slate-200" />
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <input
                                    type="month"
                                    value={period}
                                    onChange={(e) => onChangePeriod(e.target.value)}
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                />
                            </div>
                            {currentRun && (
                                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold', cfg.bg, cfg.border, cfg.color)}>
                                    {runStatus === 'finalized' && <Lock className="h-3 w-3" />}
                                    {cfg.label}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Center: KPIs */}
                    {currentRun && (
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                                <Users className="h-4 w-4 text-slate-400" />
                                <span className="text-xs font-bold text-slate-700">{totalEmployees}</span>
                                <span className="text-[10px] text-slate-400">employees</span>
                            </div>
                            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                                <Banknote className="h-4 w-4 text-slate-400" />
                                <span className="text-xs font-bold text-slate-700">KES {totalGross.toLocaleString()}</span>
                                <span className="text-[10px] text-slate-400">gross</span>
                            </div>
                            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                                <Wallet className="h-4 w-4 text-slate-400" />
                                <span className="text-xs font-bold text-slate-700">KES {totalNet.toLocaleString()}</span>
                                <span className="text-[10px] text-slate-400">net</span>
                            </div>
                        </div>
                    )}

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2">
                        {!currentRun ? (
                            <button
                                onClick={onCreateRun}
                                disabled={loading}
                                className="inline-flex items-center gap-2 rounded-lg bg-[#ff0613] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#d80000] disabled:opacity-40"
                            >
                                <Plus className="h-3.5 w-3.5" /> New Run
                            </button>
                        ) : (
                            <>
                                {/* Run picker */}
                                <div className="relative">
                                    <button
                                        onClick={() => setShowRunPicker((s) => !s)}
                                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                    >
                                        <Calendar className="h-3.5 w-3.5" />
                                        {currentRun.periodLabel || currentRun.period}
                                        <ChevronDown className="h-3 w-3" />
                                    </button>
                                    {showRunPicker && (
                                        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                                            {runOptions.map((run) => (
                                                <button
                                                    key={run.id}
                                                    onClick={() => {
                                                        onSelectRun(run);
                                                        setShowRunPicker(false);
                                                    }}
                                                    className={cn(
                                                        'flex w-full items-center justify-between px-3 py-2 text-left text-xs transition hover:bg-slate-50',
                                                        run.id === currentRun.id ? 'bg-slate-50 font-semibold' : ''
                                                    )}
                                                >
                                                    <span>{run.periodLabel || run.period}</span>
                                                    <span className={cn(
                                                        'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                                                        run.lockedAt ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                                                    )}>
                                                        {run.lockedAt ? 'Finalized' : 'Draft'}
                                                    </span>
                                                </button>
                                            ))}
                                            <div className="border-t border-slate-100 px-3 py-2">
                                                <button
                                                    onClick={() => {
                                                        onCreateRun();
                                                        setShowRunPicker(false);
                                                    }}
                                                    className="flex w-full items-center gap-1 text-xs font-semibold text-[#ff0613] transition hover:text-[#d80000]"
                                                >
                                                    <Plus className="h-3 w-3" /> New Run for {period}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {runStatus === 'draft' && (
                                    <button
                                        onClick={onGenerateEntries}
                                        disabled={loading}
                                        className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-40"
                                    >
                                        <Play className="h-3.5 w-3.5" /> Generate
                                    </button>
                                )}

                                {runStatus === 'approved' && (
                                    <>
                                        <button
                                            onClick={onGenerateEntries}
                                            disabled={loading}
                                            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-40"
                                        >
                                            <Play className="h-3.5 w-3.5" /> Regenerate
                                        </button>
                                        <button
                                            onClick={onFinalize}
                                            disabled={loading}
                                            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                                        >
                                            <Lock className="h-3.5 w-3.5" /> Finalize
                                        </button>
                                    </>
                                )}

                                {runStatus === 'finalized' && (
                                    <button
                                        onClick={onRollback}
                                        disabled={loading}
                                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                                    >
                                        <RotateCcw className="h-3.5 w-3.5" /> Rollback
                                    </button>
                                )}

                                {/* Delete run button (available for draft or finalized) */}
                                {(runStatus === 'draft' || runStatus === 'finalized') && (
                                    <button
                                        onClick={onDelete}
                                        disabled={loading}
                                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-40"
                                        title="Delete this payroll run"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" /> Delete
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
