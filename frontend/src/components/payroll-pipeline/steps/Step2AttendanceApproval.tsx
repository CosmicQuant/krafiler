import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CalendarCheck, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { getCurrentFilingPeriod } from '../../../utils/taxPeriods';

interface AttendanceEmployee {
    employeeId: number;
    employeeName: string;
    absentDays: number;
    lateHours: number;
    overtimeHours: number;
    overtimeRate: number;
    overtimeMultiplier: number;
    approved: boolean;
}

interface Step2AttendanceApprovalProps {
    clientId: string;
    onApproved?: () => void;
    onValidationChange?: (valid: boolean) => void;
}

export function Step2AttendanceApproval({ clientId, onApproved, onValidationChange }: Step2AttendanceApprovalProps) {
    const [period, setPeriod] = useState(getCurrentFilingPeriod().period);
    const [employees, setEmployees] = useState<AttendanceEmployee[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadPreview = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/attendance-payroll-preview?period=${period}`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                setEmployees(data.employees || []);
            } else {
                setError('Failed to load attendance preview');
            }
        } catch {
            setError('Network error loading attendance preview');
        } finally {
            setLoading(false);
        }
    }, [clientId, period]);

    useEffect(() => {
        loadPreview();
    }, [loadPreview]);

    useEffect(() => {
        const valid = employees.length === 0 || employees.every((e) => e.approved);
        onValidationChange?.(valid);
    }, [employees, onValidationChange]);

    const updateField = (employeeId: number, field: keyof AttendanceEmployee, value: number) => {
        setEmployees((prev) =>
            prev.map((e) =>
                e.employeeId === employeeId ? { ...e, [field]: value } : e
            )
        );
    };

    const handleApprove = async () => {
        setSaving(true);
        setError(null);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
            const res = await apiFetch(`/clients/${clientId}/attendance-payroll-approve`, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    period,
                    employees: employees.map((e) => ({
                        employeeId: e.employeeId,
                        employeeName: e.employeeName,
                        absentDays: e.absentDays,
                        lateHours: e.lateHours,
                        overtimeHours: e.overtimeHours,
                        overtimeRate: e.overtimeRate,
                        overtimeMultiplier: e.overtimeMultiplier,
                        overtimeAmount: e.overtimeHours * e.overtimeRate * e.overtimeMultiplier,
                    })),
                    approvedBy: 'admin',
                }),
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                setMessage('Attendance data approved and saved.');
                onApproved?.();
            } else {
                setError('Failed to save approval');
            }
        } catch (err: any) {
            if (err?.name === 'AbortError') setError('Request timed out. Please try again.');
            else setError('Network error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <CalendarCheck className="h-5 w-5 text-slate-500" />
                    <div>
                        <h3 className="text-sm font-bold text-slate-900">Attendance Review & Approval</h3>
                        <p className="text-xs text-slate-500">Review and adjust attendance before payroll generation</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500">Period:</label>
                    <input
                        type="month"
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <button
                        onClick={loadPreview}
                        disabled={loading}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition disabled:opacity-40"
                        title="Reload preview"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Messages */}
            {message && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> {message}
                </div>
            )}
            {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                    {error}
                </div>
            )}

            {/* Table */}
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
                </div>
            ) : employees.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-8">No attendance data found for this period.</div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                    <table className="w-full text-left text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Absent Days</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Late Hours</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">OT Hours</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">OT Rate</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">OT Multiplier</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">OT Amount</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {employees.map((emp) => {
                                const otAmount = emp.overtimeHours * emp.overtimeRate * emp.overtimeMultiplier;
                                return (
                                    <tr key={emp.employeeId} className="hover:bg-slate-50/50 transition">
                                        <td className="px-3 py-2 font-medium text-slate-900">{emp.employeeName}</td>
                                        <td className="px-3 py-2 text-right">
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={emp.absentDays}
                                                onChange={(e) => updateField(emp.employeeId, 'absentDays', parseFloat(e.target.value) || 0)}
                                                className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={emp.lateHours}
                                                onChange={(e) => updateField(emp.employeeId, 'lateHours', parseFloat(e.target.value) || 0)}
                                                className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={emp.overtimeHours}
                                                onChange={(e) => updateField(emp.employeeId, 'overtimeHours', parseFloat(e.target.value) || 0)}
                                                className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <input
                                                type="number"
                                                value={emp.overtimeRate}
                                                onChange={(e) => updateField(emp.employeeId, 'overtimeRate', parseFloat(e.target.value) || 0)}
                                                className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={emp.overtimeMultiplier}
                                                onChange={(e) => updateField(emp.employeeId, 'overtimeMultiplier', parseFloat(e.target.value) || 1)}
                                                className="w-14 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">
                                            {otAmount.toFixed(2)}
                                        </td>
                                        <td className="px-3 py-2">
                                            {emp.approved ? (
                                                <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                                    Approved
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                                    Draft
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* OT Summary */}
            {employees.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                        Computed Overtime Summary
                    </h4>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-[10px]">
                            <thead>
                                <tr className="border-b border-slate-200">
                                    <th className="px-2 py-1 font-semibold text-slate-500">Employee</th>
                                    <th className="px-2 py-1 font-semibold text-slate-500 text-right">OT Rate</th>
                                    <th className="px-2 py-1 font-semibold text-slate-500 text-right">Multiplier</th>
                                    <th className="px-2 py-1 font-semibold text-slate-500 text-right">OT Hours</th>
                                    <th className="px-2 py-1 font-semibold text-slate-500 text-right">OT Amount</th>
                                    <th className="px-2 py-1 font-semibold text-slate-500">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map((emp) => {
                                    const otAmount = emp.overtimeHours * emp.overtimeRate * emp.overtimeMultiplier;
                                    return (
                                        <tr key={`sum-${emp.employeeId}`} className="border-b border-slate-100 last:border-0">
                                            <td className="px-2 py-1 font-medium text-slate-900">{emp.employeeName}</td>
                                            <td className="px-2 py-1 text-right font-mono text-slate-700">{emp.overtimeRate.toFixed(2)}</td>
                                            <td className="px-2 py-1 text-right font-mono text-slate-700">{emp.overtimeMultiplier.toFixed(1)}x</td>
                                            <td className="px-2 py-1 text-right font-mono text-slate-700">{emp.overtimeHours.toFixed(1)}</td>
                                            <td className="px-2 py-1 text-right font-mono font-semibold text-slate-900">{otAmount.toFixed(2)}</td>
                                            <td className="px-2 py-1">
                                                {emp.approved ? (
                                                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">Approved</span>
                                                ) : (
                                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">Draft</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                <tr className="border-t-2 border-slate-200 bg-slate-100/50">
                                    <td className="px-2 py-1.5 font-bold text-slate-900">Total</td>
                                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-900">
                                        {(employees.reduce((s, e) => s + e.overtimeRate, 0) / employees.length).toFixed(2)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-900">
                                        {(employees.reduce((s, e) => s + e.overtimeMultiplier, 0) / employees.length).toFixed(1)}x
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-900">
                                        {employees.reduce((s, e) => s + e.overtimeHours, 0).toFixed(1)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-900">
                                        {employees.reduce((s, e) => s + e.overtimeHours * e.overtimeRate * e.overtimeMultiplier, 0).toFixed(2)}
                                    </td>
                                    <td className="px-2 py-1.5" />
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-400">{employees.length} employees</p>
                <button
                    disabled={saving || employees.length === 0}
                    onClick={handleApprove}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                >
                    {saving ? 'Saving...' : 'Approve & Save'}
                </button>
            </div>
        </div>
    );
}
