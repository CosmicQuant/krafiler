import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Trash2, AlertCircle, DollarSign, RotateCcw, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../../../services/api';

interface Adjustment {
    id: number;
    employeeId: number;
    payrollEntryId: number | null;
    type: 'allowance' | 'deduction';
    label: string;
    amount: number;
    isStatutory: number; // SQLite stores boolean as 0/1
    createdAt: string;
}

interface EmployeeOption {
    employeeId: number;
    employeeName: string;
}

interface Step4AdjustmentsProps {
    clientId: string;
    runId: number;
}

export function Step4Adjustments({ clientId, runId }: Step4AdjustmentsProps) {
    const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
    const [employees, setEmployees] = useState<EmployeeOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLocked, setIsLocked] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [regenSuccess, setRegenSuccess] = useState<string | null>(null);

    const [form, setForm] = useState({
        employeeId: '',
        label: '',
        type: 'allowance' as 'allowance' | 'deduction',
        amount: 0,
        isStatutory: false,
    });

    const fetchAdjustments = useCallback(async () => {
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/adjustments`);
            if (res.ok) {
                const data = await res.json();
                setAdjustments(data);
            }
        } catch {
            setAdjustments([]);
        }
    }, [clientId, runId]);

    const fetchRunStatus = useCallback(async () => {
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs`);
            if (res.ok) {
                const runs = await res.json();
                const run = runs.find((r: any) => r.id === runId);
                if (run) {
                    setIsLocked(!!run.lockedAt);
                }
            }
        } catch {
            /* ignore */
        }
    }, [clientId, runId]);

    const fetchEmployees = useCallback(async () => {
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/entries`);
            if (res.ok) {
                const entries = await res.json();
                setEmployees(
                    entries.map((e: any) => ({
                        employeeId: e.employeeId,
                        employeeName: e.employeeName,
                    }))
                );
            }
        } catch {
            setEmployees([]);
        }
    }, [clientId, runId]);

    useEffect(() => {
        let mounted = true;
        (async () => {
            setLoading(true);
            setError(null);
            setRegenSuccess(null);
            try {
                await Promise.all([fetchAdjustments(), fetchRunStatus(), fetchEmployees()]);
            } catch (err: any) {
                if (mounted) setError(err.message || 'Failed to load adjustments');
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, [fetchAdjustments, fetchRunStatus, fetchEmployees]);

    const handleAdd = async () => {
        if (!form.employeeId || !form.label) return;
        setSaving(true);
        setError(null);
        setRegenSuccess(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/adjustments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeId: Number(form.employeeId),
                    label: form.label,
                    type: form.type,
                    amount: form.amount,
                    isStatutory: form.isStatutory ? 1 : 0,
                }),
            });
            if (res.ok) {
                setForm({ employeeId: '', label: '', type: 'allowance', amount: 0, isStatutory: false });
                await fetchAdjustments();
            } else {
                const d = await res.json();
                setError(d.message || 'Failed to add adjustment');
            }
        } catch {
            setError('Network error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (adjId: number) => {
        if (isLocked) return;
        setRegenSuccess(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/adjustments/${adjId}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                setAdjustments((prev) => prev.filter((a) => a.id !== adjId));
            }
        } catch {
            setError('Failed to delete adjustment');
        }
    };

    const handleRegenerate = async () => {
        setRegenerating(true);
        setError(null);
        setRegenSuccess(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prorate: true }),
            });
            if (res.ok) {
                setRegenSuccess('Entries regenerated successfully.');
                await fetchAdjustments();
            } else {
                const d = await res.json();
                setError(d.message || 'Failed to regenerate entries');
            }
        } catch {
            setError('Network error during regeneration');
        } finally {
            setRegenerating(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <AlertCircle className="h-4 w-4" /> {error}
                </div>
            )}

            {regenSuccess && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> {regenSuccess}
                </div>
            )}

            {isLocked && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    <AlertCircle className="h-4 w-4" />
                    This payroll run is finalized. Adjustments are read-only.
                </div>
            )}

            {/* Add Adjustment Form */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Add Adjustment
                    </h4>
                    <button
                        disabled={isLocked || regenerating}
                        onClick={handleRegenerate}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
                    >
                        {regenerating ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                            <RotateCcw className="h-3 w-3" />
                        )}
                        Re-generate Entries
                    </button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <select
                        value={form.employeeId}
                        onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
                        disabled={isLocked}
                        className="min-w-[10rem] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    >
                        <option value="">Select employee</option>
                        {employees.map((emp) => (
                            <option key={emp.employeeId} value={emp.employeeId}>
                                {emp.employeeName}
                            </option>
                        ))}
                    </select>
                    <input
                        type="text"
                        placeholder="Label e.g. Transport Allowance"
                        value={form.label}
                        onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                        disabled={isLocked}
                        className="min-w-[12rem] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <select
                        value={form.type}
                        onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'allowance' | 'deduction' }))}
                        disabled={isLocked}
                        className="min-w-[8rem] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    >
                        <option value="allowance">Allowance</option>
                        <option value="deduction">Deduction</option>
                    </select>
                    <input
                        type="number"
                        placeholder="Amount"
                        value={form.amount || ''}
                        onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                        disabled={isLocked}
                        className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-right text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <label className="flex items-center gap-1.5 text-sm text-slate-700">
                        <input
                            type="checkbox"
                            checked={form.isStatutory}
                            onChange={(e) => setForm((f) => ({ ...f, isStatutory: e.target.checked }))}
                            disabled={isLocked}
                            className="h-4 w-4 rounded border-slate-300 text-[#ff0613] focus:ring-[#ff0613]"
                        />
                        Statutory
                    </label>
                    <button
                        disabled={!form.employeeId || !form.label || isLocked || saving}
                        onClick={handleAdd}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                    >
                        {saving ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Plus className="h-3.5 w-3.5" />
                        )}
                        Add
                    </button>
                </div>
            </div>

            {/* Adjustments Table */}
            {adjustments.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 bg-slate-50">
                                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-slate-500 text-xs">
                                    Employee
                                </th>
                                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-slate-500 text-xs">
                                    Label
                                </th>
                                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-slate-500 text-xs">
                                    Type
                                </th>
                                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-slate-500 text-xs text-right">
                                    Amount
                                </th>
                                <th className="px-4 py-3 font-semibold uppercase tracking-wider text-slate-500 text-xs">
                                    Statutory
                                </th>
                                <th className="px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {adjustments.map((adj) => {
                                const emp = employees.find((e) => e.employeeId === adj.employeeId);
                                return (
                                    <tr key={adj.id} className="hover:bg-slate-50/50 transition">
                                        <td className="px-4 py-3 font-medium text-slate-900">
                                            {emp?.employeeName || `Employee #${adj.employeeId}`}
                                        </td>
                                        <td className="px-4 py-3 text-slate-700">{adj.label}</td>
                                        <td className="px-4 py-3">
                                            <span
                                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                    adj.type === 'allowance'
                                                        ? 'bg-emerald-50 text-emerald-700'
                                                        : 'bg-rose-50 text-rose-700'
                                                }`}
                                            >
                                                {adj.type}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-900">
                                            {Number(adj.amount).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 text-xs">
                                            {adj.isStatutory ? 'Yes' : 'No'}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                disabled={isLocked}
                                                onClick={() => handleDelete(adj.id)}
                                                className="rounded p-1.5 text-rose-400 hover:bg-rose-50 hover:text-rose-700 transition disabled:opacity-40"
                                                title="Delete adjustment"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-12 text-center">
                    <DollarSign className="h-8 w-8 text-slate-300 mb-3" />
                    <p className="text-sm font-medium text-slate-600">No adjustments yet</p>
                    <p className="text-xs text-slate-400 mt-1">
                        Add allowances or deductions for this payroll run.
                    </p>
                </div>
            )}
        </div>
    );
}
