import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CalendarCheck, CheckCircle2, Pencil, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { EmployeeEditModal, type Employee } from './EmployeeEditModal';
import { getCurrentFilingPeriod } from '../../../utils/taxPeriods';

interface AttendanceRecord {
    id: number;
    employeeId: number;
    date: string;
    status: string;
    checkIn: string;
    checkOut: string;
    notes: string;
}

interface WorkSchedule {
    id: number;
    name: string;
    config: string;
}

interface AttendanceSummary {
    employeeId: number;
    absentDays: number;
    lateHours: number;
    halfDays: number;
    overtimeHours: number;
    overtimeRate: number;
    overtimeMultiplier: number;
    overtimeAmount: number;
}

interface AttendanceCalendarGridProps {
    clientId: string;
    onApproved?: () => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUS_OPTIONS = ['Present', 'Absent', 'Late', 'Half-Day', 'On Leave', 'Off Day'];

function daysInMonth(year: number, month: number) {
    return new Date(year, month, 0).getDate();
}

function parseConfig(config: string) {
    try { return JSON.parse(config); } catch { return null; }
}

function getScheduledWorkDays(config: any, year: number, month: number, offDay: string | null): number {
    const total = daysInMonth(year, month);
    let count = 0;
    for (let d = 1; d <= total; d++) {
        const date = new Date(year, month - 1, d);
        const dayName = DAY_LABELS[date.getDay()];
        let isWork = true;
        if (config && config[dayName] === 0) isWork = false;
        else if (!config && (date.getDay() === 0 || date.getDay() === 6)) isWork = false;
        if (offDay && offDay.startsWith(FULL_DAY_NAMES[date.getDay()])) isWork = false;
        if (isWork) count++;
    }
    return count || 30;
}

function getStandardWorkingHours(checkIn: string, checkOut: string) {
    const [siH, siM] = (checkIn || '08:00').split(':').map(Number);
    const [soH, soM] = (checkOut || '17:00').split(':').map(Number);
    const mins = (soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0));
    return Math.max(1, mins / 60);
}

export function AttendanceCalendarGrid({ clientId, onApproved }: AttendanceCalendarGridProps) {
    const [period, setPeriod] = useState(getCurrentFilingPeriod().period);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [attendanceMap, setAttendanceMap] = useState<Map<string, AttendanceRecord>>(new Map());
    const [schedules, setSchedules] = useState<Map<number, WorkSchedule>>(new Map());
    const [summaries, setSummaries] = useState<Map<number, AttendanceSummary>>(new Map());
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [approved, setApproved] = useState(false);

    // Modals
    const [modalEmployee, setModalEmployee] = useState<Employee | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [cellModal, setCellModal] = useState<{ employeeId: number; day: number; record?: AttendanceRecord } | null>(null);
    const [cellForm, setCellForm] = useState({ status: 'Present', checkIn: '', checkOut: '', notes: '' });

    const [year, month] = period.split('-').map(Number);
    const totalDays = daysInMonth(year, month);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [empsRes, attRes, schedRes] = await Promise.all([
                apiFetch(`/clients/${clientId}/employees`),
                apiFetch(`/clients/${clientId}/attendance?dateFrom=${period}-01&dateTo=${period}-${String(totalDays).padStart(2, '0')}`),
                apiFetch(`/clients/${clientId}/work-schedules`),
            ]);

            let emps: Employee[] = [];
            if (empsRes.ok) {
                emps = (await empsRes.json()).filter((e: any) => e.employmentStatus === 'Active');
                setEmployees(emps);
            }

            const attMap = new Map<string, AttendanceRecord>();
            if (attRes.ok) {
                const records: AttendanceRecord[] = await attRes.json();
                for (const r of records) {
                    attMap.set(`${r.employeeId}-${r.date}`, r);
                }
            }
            setAttendanceMap(attMap);

            const schedMap = new Map<number, WorkSchedule>();
            if (schedRes.ok) {
                const list: WorkSchedule[] = await schedRes.json();
                for (const s of list) schedMap.set(s.id, s);
            }
            setSchedules(schedMap);

            // Build summaries from attendance data
            const sumMap = new Map<number, AttendanceSummary>();
            for (const emp of emps) {
                let absent = 0;
                let late = 0;
                let half = 0;
                for (let d = 1; d <= totalDays; d++) {
                    const dateStr = `${period}-${String(d).padStart(2, '0')}`;
                    const rec = attMap.get(`${emp.id}-${dateStr}`);
                    if (!rec) continue;
                    if (rec.status === 'Absent') absent += 1;
                    else if (rec.status === 'Half-Day') half += 1;
                    else if (rec.status === 'Late') {
                        const [cH, cM] = (rec.checkIn || '').split(':').map(Number);
                        const [sH, sM] = (emp.standardCheckIn || '08:00').split(':').map(Number);
                        if (!isNaN(cH) && !isNaN(sH)) {
                            const lateMins = Math.max(0, (cH * 60 + (cM || 0)) - (sH * 60 + (sM || 0)));
                            late += lateMins / 60;
                        }
                    }
                }
                const ws = emp.workScheduleId ? schedMap.get(emp.workScheduleId) : null;
                const config = ws ? parseConfig(ws.config) : null;
                const schedDays = getScheduledWorkDays(config, year, month, emp.offDay);
                const monthlyHours = getStandardWorkingHours(emp.standardCheckIn, emp.standardCheckOut) * schedDays;
                const hourlyRate = Math.round(((emp.basicPay || 0) / Math.max(1, monthlyHours)) * 100) / 100;
                sumMap.set(emp.id, {
                    employeeId: emp.id,
                    absentDays: absent,
                    lateHours: Math.round(late * 100) / 100,
                    halfDays: half,
                    overtimeHours: 0,
                    overtimeRate: hourlyRate,
                    overtimeMultiplier: 1.5,
                    overtimeAmount: 0,
                });
            }
            setSummaries(sumMap);
            setApproved(false);
        } catch {
            setError('Failed to load attendance data');
        } finally {
            setLoading(false);
        }
    }, [clientId, period, totalDays]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const openCellModal = (employeeId: number, day: number) => {
        const dateStr = `${period}-${String(day).padStart(2, '0')}`;
        const key = `${employeeId}-${dateStr}`;
        const existing = attendanceMap.get(key);
        setCellModal({ employeeId, day, record: existing });
        setCellForm({
            status: existing?.status || 'Present',
            checkIn: existing?.checkIn || '',
            checkOut: existing?.checkOut || '',
            notes: existing?.notes || '',
        });
    };

    const saveCell = async () => {
        if (!cellModal) return;
        const { employeeId, day, record } = cellModal;
        const dateStr = `${period}-${String(day).padStart(2, '0')}`;
        const key = `${employeeId}-${dateStr}`;
        const emp = employees.find(e => e.id === employeeId);

        try {
            if (record && record.id > 0) {
                await apiFetch(`/clients/${clientId}/attendance/${record.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        status: cellForm.status,
                        checkIn: cellForm.checkIn,
                        checkOut: cellForm.checkOut,
                        notes: cellForm.notes,
                    }),
                });
            } else {
                const res = await apiFetch(`/clients/${clientId}/attendance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        employeeId,
                        employeeName: emp?.employeeName || '',
                        kraPin: emp?.kraPin || '',
                        date: dateStr,
                        status: cellForm.status,
                        checkIn: cellForm.checkIn,
                        checkOut: cellForm.checkOut,
                        notes: cellForm.notes,
                    }),
                });
                if (res.ok) {
                    const created = await res.json();
                    setAttendanceMap(prev => {
                        const updated = new Map(prev);
                        updated.set(key, created);
                        return updated;
                    });
                }
            }
            // Refresh attendance map for this cell
            const attRes = await apiFetch(`/clients/${clientId}/attendance?dateFrom=${period}-01&dateTo=${period}-${String(totalDays).padStart(2, '0')}`);
            if (attRes.ok) {
                const records: AttendanceRecord[] = await attRes.json();
                const newMap = new Map<string, AttendanceRecord>();
                for (const r of records) newMap.set(`${r.employeeId}-${r.date}`, r);
                setAttendanceMap(newMap);
                recomputeAllSummaries(newMap);
            }
            setCellModal(null);
        } catch {
            setError('Failed to save attendance record');
        }
    };

    const recomputeAllSummaries = (map: Map<string, AttendanceRecord>) => {
        setSummaries(prev => {
            const next = new Map(prev);
            for (const emp of employees) {
                let absent = 0;
                let late = 0;
                let half = 0;
                for (let d = 1; d <= totalDays; d++) {
                    const dateStr = `${period}-${String(d).padStart(2, '0')}`;
                    const rec = map.get(`${emp.id}-${dateStr}`);
                    if (!rec) continue;
                    if (rec.status === 'Absent') absent += 1;
                    else if (rec.status === 'Half-Day') half += 1;
                    else if (rec.status === 'Late') {
                        const [cH, cM] = (rec.checkIn || '').split(':').map(Number);
                        const [sH, sM] = (emp.standardCheckIn || '08:00').split(':').map(Number);
                        if (!isNaN(cH) && !isNaN(sH)) {
                            const lateMins = Math.max(0, (cH * 60 + (cM || 0)) - (sH * 60 + (sM || 0)));
                            late += lateMins / 60;
                        }
                    }
                }
                const existing = next.get(emp.id);
                if (existing) {
                    next.set(emp.id, { ...existing, absentDays: absent, lateHours: Math.round(late * 100) / 100, halfDays: half });
                }
            }
            return next;
        });
    };

    const updateSummaryField = (employeeId: number, field: keyof AttendanceSummary, value: number) => {
        setSummaries(prev => {
            const next = new Map(prev);
            const s = next.get(employeeId);
            if (!s) return prev;
            const updated = { ...s, [field]: value };
            updated.overtimeAmount = Math.round(updated.overtimeHours * updated.overtimeRate * updated.overtimeMultiplier * 100) / 100;
            next.set(employeeId, updated);
            return next;
        });
    };

    const computedBasicPay = (emp: Employee): number => {
        const s = summaries.get(emp.id);
        if (!s) return emp.basicPay;
        const ws = emp.workScheduleId ? schedules.get(emp.workScheduleId) : null;
        const config = ws ? parseConfig(ws.config) : null;
        const schedDays = getScheduledWorkDays(config, year, month, emp.offDay);
        const dailyRate = emp.basicPay / Math.max(1, schedDays);
        const presentDays = Math.max(0, schedDays - s.absentDays - s.halfDays * 0.5);
        const stdHours = getStandardWorkingHours(emp.standardCheckIn, emp.standardCheckOut);
        const lateDeduction = dailyRate * (s.lateHours / Math.max(1, stdHours));
        const computed = presentDays * dailyRate + s.overtimeAmount - lateDeduction;
        return Math.max(0, Math.round(computed * 100) / 100);
    };

    const handleDeleteEmployee = async (id: number) => {
        if (!window.confirm('Delete this employee?')) return;
        try {
            const res = await apiFetch(`/clients/${clientId}/employees/${id}`, { method: 'DELETE' });
            if (res.ok) loadData();
        } catch { /* ignore */ }
    };

    const handleApprove = async () => {
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            const payload = employees.map(emp => {
                const s = summaries.get(emp.id);
                return {
                    employeeId: emp.id,
                    employeeName: emp.employeeName,
                    absentDays: s?.absentDays || 0,
                    lateHours: s?.lateHours || 0,
                    overtimeHours: s?.overtimeHours || 0,
                    overtimeRate: s?.overtimeRate || 0,
                    overtimeMultiplier: s?.overtimeMultiplier || 1.5,
                    overtimeAmount: s?.overtimeAmount || 0,
                };
            });
            const res = await apiFetch(`/clients/${clientId}/attendance-payroll-approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ period, employees: payload, approvedBy: 'admin' }),
            });
            if (res.ok) {
                setMessage('Attendance approved and saved.');
                setApproved(true);
                onApproved?.();
            } else {
                const d = await res.json();
                setError(d.message || 'Failed to save approval');
            }
        } catch {
            setError('Network error during approval');
        } finally {
            setSaving(false);
        }
    };

    const cellClass = (status: string | undefined) => {
        if (!status) return 'bg-white text-slate-300 border-slate-100';
        switch (status) {
            case 'Present': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
            case 'Absent': return 'bg-rose-50 text-rose-700 border-rose-200';
            case 'Late': return 'bg-amber-50 text-amber-700 border-amber-200';
            case 'Half-Day': return 'bg-blue-50 text-blue-700 border-blue-200';
            case 'On Leave': return 'bg-purple-50 text-purple-700 border-purple-200';
            case 'Off Day': return 'bg-slate-100 text-slate-400 border-slate-200';
            default: return 'bg-white text-slate-300 border-slate-100';
        }
    };

    const cellLabel = (status: string | undefined) => {
        if (!status) return '·';
        const map: Record<string, string> = { 'Present': 'P', 'Absent': 'A', 'Late': 'L', 'Half-Day': 'H', 'On Leave': 'V', 'Off Day': 'O' };
        return map[status] || '·';
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <CalendarCheck className="h-5 w-5 text-slate-500" />
                    <div>
                        <h3 className="text-sm font-bold text-slate-900">Attendance Calendar</h3>
                        <p className="text-xs text-slate-500">Click a day cell to record attendance details</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500">Period:</label>
                    <input
                        type="month"
                        value={period}
                        onChange={(e) => { setPeriod(e.target.value); setApproved(false); }}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition disabled:opacity-40"
                        title="Reload"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-[10px]">
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center font-bold text-[8px]">P</span> Present</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center font-bold text-[8px]">A</span> Absent</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center font-bold text-[8px]">L</span> Late</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center font-bold text-[8px]">H</span> Half-Day</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-50 border border-purple-200 text-purple-700 flex items-center justify-center font-bold text-[8px]">V</span> On Leave</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center font-bold text-[8px]">O</span> Off Day</span>
            </div>

            {message && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> {message}
                </div>
            )}
            {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
                </div>
            ) : employees.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-8">No active employees found.</div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                    <table className="w-full text-left text-[10px]">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                                <th className="px-2 py-1.5 font-semibold uppercase tracking-wider text-slate-500 sticky left-0 bg-slate-50 z-10 min-w-[140px]">Employee</th>
                                {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => {
                                    const date = new Date(year, month - 1, d);
                                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                                    return (
                                        <th key={d} className={`px-1 py-1.5 font-semibold text-center w-7 ${isWeekend ? 'text-slate-300' : 'text-slate-400'}`}>{d}</th>
                                    );
                                })}
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Absent</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Late</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">OT Hrs</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">OT Rate</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">OT Mult</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">OT Amt</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Computed Pay</th>
                                <th className="px-2 py-1.5 font-semibold text-center text-slate-500">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {employees.map((emp) => {
                                const s = summaries.get(emp.id);
                                const cbp = computedBasicPay(emp);
                                return (
                                    <tr key={emp.id} className="hover:bg-slate-50/50 transition">
                                        <td className="px-2 py-1 sticky left-0 bg-white z-10 border-r border-slate-100">
                                            <div className="flex items-center justify-between gap-2">
                                                <button
                                                    onClick={() => { setModalEmployee(emp); setModalOpen(true); }}
                                                    className="font-medium text-slate-900 hover:text-[#ff0613] transition text-left whitespace-nowrap truncate"
                                                >
                                                    {emp.employeeName}
                                                </button>
                                            </div>
                                        </td>
                                        {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => {
                                            const dateStr = `${period}-${String(d).padStart(2, '0')}`;
                                            const rec = attendanceMap.get(`${emp.id}-${dateStr}`);
                                            const date = new Date(year, month - 1, d);
                                            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                                            return (
                                                <td key={d} className="px-0.5 py-1 text-center">
                                                    <button
                                                        onClick={() => openCellModal(emp.id, d)}
                                                        className={`w-6 h-6 rounded border text-[9px] font-bold transition ${cellClass(rec?.status)} ${isWeekend ? 'opacity-60' : ''}`}
                                                        title={rec ? `${rec.status} (${rec.checkIn || '--:--'} - ${rec.checkOut || '--:--'})` : 'Present (default)'}
                                                    >
                                                        {cellLabel(rec?.status)}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                        <td className="px-2 py-1 text-right font-mono text-rose-600">{s?.absentDays ?? 0}</td>
                                        <td className="px-2 py-1 text-right font-mono text-amber-600">{s?.lateHours?.toFixed(1) ?? '0.0'}</td>
                                        <td className="px-2 py-1 text-right">
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={s?.overtimeHours ?? 0}
                                                onChange={(e) => updateSummaryField(emp.id, 'overtimeHours', parseFloat(e.target.value) || 0)}
                                                className="w-12 rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
                                            />
                                        </td>
                                        <td className="px-2 py-1 text-right">
                                            <input
                                                type="number"
                                                value={s?.overtimeRate ?? 0}
                                                onChange={(e) => updateSummaryField(emp.id, 'overtimeRate', parseFloat(e.target.value) || 0)}
                                                className="w-14 rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
                                            />
                                        </td>
                                        <td className="px-2 py-1 text-right">
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={s?.overtimeMultiplier ?? 1.5}
                                                onChange={(e) => updateSummaryField(emp.id, 'overtimeMultiplier', parseFloat(e.target.value) || 1)}
                                                className="w-10 rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
                                            />
                                        </td>
                                        <td className="px-2 py-1 text-right font-mono font-semibold text-slate-900">{s?.overtimeAmount?.toFixed(2) ?? '0.00'}</td>
                                        <td className="px-2 py-1 text-right font-mono font-bold text-emerald-700">{cbp.toLocaleString()}</td>
                                        <td className="px-2 py-1 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() => { setModalEmployee(emp); setModalOpen(true); }}
                                                    className="p-1 rounded hover:bg-blue-50 text-blue-600 transition"
                                                    title="Edit employee"
                                                >
                                                    <Pencil className="h-3 w-3" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteEmployee(emp.id)}
                                                    className="p-1 rounded hover:bg-red-50 text-red-500 transition"
                                                    title="Delete employee"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-400">
                    {employees.length} employees
                    {approved && <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 font-semibold"><CheckCircle2 className="h-3 w-3" /> Approved</span>}
                </p>
                <button
                    disabled={saving || employees.length === 0 || approved}
                    onClick={handleApprove}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                >
                    {saving ? 'Saving...' : approved ? 'Approved' : 'Approve & Save'}
                </button>
            </div>

            {/* Employee Edit Modal */}
            <EmployeeEditModal
                clientId={clientId}
                employee={modalEmployee}
                open={modalOpen}
                onClose={() => { setModalOpen(false); setModalEmployee(null); }}
                onSaved={loadData}
            />

            {/* Cell Detail Modal */}
            {cellModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                            <h3 className="text-sm font-bold text-slate-900">
                                {employees.find(e => e.id === cellModal.employeeId)?.employeeName} — {period}-{String(cellModal.day).padStart(2, '0')}
                            </h3>
                            <button onClick={() => setCellModal(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="px-5 py-4 space-y-3">
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</label>
                                <select
                                    value={cellForm.status}
                                    onChange={(e) => setCellForm(f => ({ ...f, status: e.target.value }))}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                                >
                                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Check-In</label>
                                    <input
                                        type="time"
                                        value={cellForm.checkIn}
                                        onChange={(e) => setCellForm(f => ({ ...f, checkIn: e.target.value }))}
                                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Check-Out</label>
                                    <input
                                        type="time"
                                        value={cellForm.checkOut}
                                        onChange={(e) => setCellForm(f => ({ ...f, checkOut: e.target.value }))}
                                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Notes</label>
                                <textarea
                                    value={cellForm.notes}
                                    onChange={(e) => setCellForm(f => ({ ...f, notes: e.target.value }))}
                                    rows={2}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none resize-none"
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
                            <button onClick={() => setCellModal(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">Cancel</button>
                            <button onClick={saveCell} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition">Save</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
