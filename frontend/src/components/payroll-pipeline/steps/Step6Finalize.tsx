import { useState, useEffect, useCallback } from 'react';
import {
    RefreshCw,
    AlertCircle,
    CheckCircle2,
    Lock,
    Unlock,
    RotateCcw,
    Receipt,
    Download,
    AlertTriangle,
    FileText,
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';

interface PayrollRun {
    id: number;
    period: string;
    periodLabel: string;
    status: string;
    lockedAt: string | null;
    finalizedAt: string | null;
    notes: string | null;
}

interface PayrollEntry {
    employeeName: string;
    grossPay: number;
    netPay: number;
    payeTax: number;
    shaDeduction: number;
    nssfDeduction: number;
    ahlDeduction: number;
    basicPay: number;
    loanDeduction?: number;
}

interface Step6FinalizeProps {
    clientId: string;
    runId: number;
    onContinue?: () => void;
    onBack?: () => void;
}

export function Step6Finalize({ clientId, runId, onContinue, onBack }: Step6FinalizeProps) {
    const [run, setRun] = useState<PayrollRun | null>(null);
    const [entries, setEntries] = useState<PayrollEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [showWarnings, setShowWarnings] = useState(false);
    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [undoSeconds, setUndoSeconds] = useState(0);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [runRes, entriesRes] = await Promise.all([
                apiFetch(`/clients/${clientId}/payroll-runs`),
                apiFetch(`/clients/${clientId}/payroll-runs/${runId}/entries`),
            ]);

            if (runRes.ok) {
                const runs = await runRes.json();
                const found = runs.find((r: any) => r.id === runId);
                if (found) setRun(found);
            }

            if (entriesRes.ok) {
                setEntries(await entriesRes.json());
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load run data');
        } finally {
            setLoading(false);
        }
    }, [clientId, runId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (undoSeconds <= 0) return;
        const timer = setInterval(() => {
            setUndoSeconds((s) => (s <= 1 ? 0 : s - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [undoSeconds]);

    const oneThirdWarnings = entries
        .filter((e) => e.netPay < e.grossPay / 3)
        .map((e) => ({
            employeeName: e.employeeName,
            net: Math.round(e.netPay).toLocaleString(),
            gross: Math.round(e.grossPay / 3).toLocaleString(),
        }));

    const openModal = () => {
        setShowReceiptModal(true);
        setError(null);
        setSuccess(null);
    };

    const handleConfirmFinalize = async () => {
        if (!run || run.lockedAt) return;
        setActionLoading(true);
        setError(null);
        setSuccess(null);
        setWarnings([]);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/finalize`, {
                method: 'POST',
            });
            const data = await res.json();
            if (res.ok) {
                setRun((prev) =>
                    prev ? { ...prev, lockedAt: data.finalizedAt, status: 'closed', finalizedAt: data.finalizedAt } : prev
                );
                setSuccess(
                    data.warnings?.length
                        ? `Run finalized with ${data.warnings.length} warning(s)`
                        : 'Payroll run finalized successfully.'
                );
                if (data.warnings?.length) {
                    setWarnings(data.warnings);
                    setShowWarnings(true);
                }
                setShowReceiptModal(false);
                setUndoSeconds(30);
            } else {
                setError(data.message || 'Finalize failed');
            }
        } catch {
            setError('Network error during finalize');
        } finally {
            setActionLoading(false);
        }
    };

    const handleRollback = async () => {
        if (!run || !run.lockedAt) return;
        setActionLoading(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/rollback`, {
                method: 'POST',
            });
            const data = await res.json();
            if (res.ok) {
                setRun((prev) =>
                    prev ? { ...prev, lockedAt: null, status: 'completed', finalizedAt: null } : prev
                );
                setSuccess('Run rolled back successfully.');
                setWarnings([]);
            } else {
                setError(data.message || 'Rollback failed');
            }
        } catch {
            setError('Network error during rollback');
        } finally {
            setActionLoading(false);
        }
    };

    const handleUndo = async () => {
        if (!run || !run.lockedAt) return;
        setActionLoading(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/rollback`, {
                method: 'POST',
            });
            const data = await res.json();
            if (res.ok) {
                setRun((prev) =>
                    prev ? { ...prev, lockedAt: null, status: 'completed', finalizedAt: null } : prev
                );
                setSuccess('Run rolled back successfully.');
                setWarnings([]);
                setUndoSeconds(0);
            } else {
                setError(data.message || 'Rollback failed');
            }
        } catch {
            setError('Network error during rollback');
        } finally {
            setActionLoading(false);
        }
    };

    const handleRegenerate = async () => {
        if (!run || run.lockedAt) return;
        setActionLoading(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prorate: true }),
            });
            if (res.ok) {
                setSuccess('Entries regenerated. Reloading...');
                await fetchData();
            } else {
                const d = await res.json();
                setError(d.message || 'Regeneration failed');
            }
        } catch {
            setError('Network error during regeneration');
        } finally {
            setActionLoading(false);
        }
    };

    const totals = entries.reduce(
        (acc, e) => ({
            basicPay: acc.basicPay + Number(e.basicPay || 0),
            grossPay: acc.grossPay + Number(e.grossPay || 0),
            payeTax: acc.payeTax + Number(e.payeTax || 0),
            shaDeduction: acc.shaDeduction + Number(e.shaDeduction || 0),
            nssfDeduction: acc.nssfDeduction + Number(e.nssfDeduction || 0),
            ahlDeduction: acc.ahlDeduction + Number(e.ahlDeduction || 0),
            netPay: acc.netPay + Number(e.netPay || 0),
        }),
        { basicPay: 0, grossPay: 0, payeTax: 0, shaDeduction: 0, nssfDeduction: 0, ahlDeduction: 0, netPay: 0 }
    );

    const totalDeductions = entries.reduce((sum, e) => sum + (e.grossPay - e.netPay), 0);
    const totalLoanDeductions = entries.reduce((sum, e) => sum + (e.loanDeduction || 0), 0);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <AlertCircle className="h-4 w-4" /> {error}
                </div>
            )}

            {success && !run?.lockedAt && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> {success}
                </div>
            )}

            {run?.lockedAt && success && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-3">
                    <h3 className="text-lg font-bold text-emerald-900 flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5" /> Payroll Finalized
                    </h3>
                    <p className="text-sm text-emerald-700">
                        Finalized at {new Date(run.finalizedAt || '').toLocaleString()}
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Gross</p>
                            <p className="text-sm font-mono text-slate-900">{totals.grossPay.toLocaleString()}</p>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Net</p>
                            <p className="text-sm font-mono text-emerald-700 font-semibold">{totals.netPay.toLocaleString()}</p>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Loan Deductions</p>
                            <p className="text-sm font-mono text-slate-900">{totalLoanDeductions.toFixed(2)}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                        <button
                            onClick={() => onContinue?.()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 transition"
                        >
                            Continue to Compliance
                        </button>
                        <button
                            onClick={() => onBack?.()}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                        >
                            Back to Dashboard
                        </button>
                    </div>
                </div>
            )}

            {showWarnings && warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 mb-2">
                        <AlertTriangle className="h-4 w-4" /> Warnings
                    </div>
                    <ul className="list-disc list-inside text-xs text-amber-700 space-y-1">
                        {warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Run Status Card */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-slate-900">
                            {run?.periodLabel || 'Payroll Run'}
                        </h3>
                        <p className="text-sm text-slate-500 mt-0.5">{entries.length} employees</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {run?.lockedAt ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                <Lock className="h-3.5 w-3.5" /> Finalized
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                                <Unlock className="h-3.5 w-3.5" /> Open
                            </span>
                        )}
                    </div>
                </div>

                {/* Summary Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-5">
                    {[
                        { label: 'Total Basic Pay', value: totals.basicPay.toLocaleString(), color: 'text-slate-900' },
                        { label: 'Total Gross', value: totals.grossPay.toLocaleString(), color: 'text-slate-900' },
                        { label: 'Total PAYE', value: totals.payeTax.toFixed(2), color: 'text-rose-700' },
                        { label: 'Total SHA', value: totals.shaDeduction.toFixed(2), color: 'text-slate-700' },
                        { label: 'Total NSSF', value: totals.nssfDeduction.toFixed(2), color: 'text-slate-700' },
                        { label: 'Total AHL', value: totals.ahlDeduction.toFixed(2), color: 'text-slate-700' },
                        { label: 'Total Net Pay', value: totals.netPay.toLocaleString(), color: 'text-emerald-700 font-semibold' },
                    ].map((stat) => (
                        <div key={stat.label} className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{stat.label}</p>
                            <p className={`text-sm font-mono ${stat.color}`}>{stat.value}</p>
                        </div>
                    ))}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        disabled={!run || !!run.lockedAt || actionLoading}
                        onClick={openModal}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white transition',
                            !run || run.lockedAt
                                ? 'bg-slate-300 cursor-not-allowed'
                                : 'bg-emerald-600 hover:bg-emerald-700'
                        )}
                    >
                        {actionLoading && !run?.lockedAt ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Lock className="h-3.5 w-3.5" />
                        )}
                        Finalize Run
                    </button>

                    <button
                        disabled={!run || !run.lockedAt || actionLoading}
                        onClick={handleRollback}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-bold transition',
                            !run || !run.lockedAt
                                ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'border-rose-200 bg-white text-rose-600 hover:bg-rose-50'
                        )}
                    >
                        {actionLoading && run?.lockedAt ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        Rollback
                    </button>

                    <button
                        disabled={!run || !!run.lockedAt || actionLoading}
                        onClick={handleRegenerate}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-bold transition',
                            !run || run.lockedAt
                                ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        )}
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Regenerate
                    </button>

                    {run?.lockedAt && undoSeconds > 0 && (
                        <button
                            disabled={actionLoading}
                            onClick={handleUndo}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700 hover:bg-amber-100 transition disabled:opacity-40"
                        >
                            {actionLoading ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            Undo Finalize — {undoSeconds}s remaining
                        </button>
                    )}
                </div>
            </div>

            {/* Receipt / Output Placeholder (real compliance output is Step 7) */}
            {run?.lockedAt && (
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-slate-500" /> Receipt & Output
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={() => alert('Payslip downloads are available in Step 7 (Generate & File).')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed transition"
                        >
                            <FileText className="h-3.5 w-3.5" /> Payslips
                        </button>
                        <button
                            onClick={() => alert('Export is available in Step 7 (Generate & File).')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed transition"
                        >
                            <Download className="h-3.5 w-3.5" /> Export CSV
                        </button>
                    </div>
                    <p className="text-xs text-slate-400 mt-3">
                        Full compliance reports (P10, P9, SHA, NSSF) are available in Step 7.
                    </p>
                </div>
            )}

            {/* Finalize Modal */}
            {showReceiptModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-4">
                    <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
                        <h3 className="text-lg font-bold text-slate-900">
                            Finalize Payroll — {run?.periodLabel || 'Current Run'}
                        </h3>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Gross Pay</p>
                                <p className="text-sm font-mono text-slate-900">{totals.grossPay.toLocaleString()}</p>
                            </div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Deductions</p>
                                <p className="text-sm font-mono text-rose-700">{totalDeductions.toLocaleString()}</p>
                            </div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Net Pay</p>
                                <p className="text-sm font-mono text-emerald-700 font-semibold">{totals.netPay.toLocaleString()}</p>
                            </div>
                            <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Employees</p>
                                <p className="text-sm font-mono text-slate-900">{entries.length}</p>
                            </div>
                        </div>

                        {oneThirdWarnings.length > 0 && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
                                {oneThirdWarnings.map((w, i) => (
                                    <div key={i} className="text-xs text-amber-700 flex items-center gap-1">
                                        <span>⚠</span>
                                        <span>1/3 Rule Warning: {w.employeeName} net pay ({w.net}) &lt; 1/3 of gross ({w.gross})</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                                disabled={actionLoading}
                                onClick={() => setShowReceiptModal(false)}
                                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
                            >
                                Cancel
                            </button>
                            <button
                                disabled={!run || !!run.lockedAt || actionLoading}
                                onClick={handleConfirmFinalize}
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white transition',
                                    !run || run.lockedAt || actionLoading
                                        ? 'bg-slate-300 cursor-not-allowed'
                                        : 'bg-emerald-600 hover:bg-emerald-700'
                                )}
                            >
                                {actionLoading ? (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Lock className="h-3.5 w-3.5" />
                                )}
                                Confirm Finalize
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
