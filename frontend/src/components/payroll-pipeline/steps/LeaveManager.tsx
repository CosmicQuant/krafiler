import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2, XCircle, Calendar, User, Plus, Pencil } from 'lucide-react';
import { apiFetch } from '../../../services/api';

interface LeaveRequest {
    id: number;
    employeeId: number;
    employeeName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    startTime?: string | null;
    endTime?: string | null;
    daysCount: number;
    hours: number;
    reason: string;
    status: 'Pending' | 'Approved' | 'Rejected';
    isPaid: number;
    createdAt: string;
}

interface LeaveType {
    id: number;
    name: string;
    isPaid: number;
    maxDaysPerYear: number | null;
}

interface Employee {
    id: number;
    employeeName: string;
}

interface LeaveManagerProps {
    clientId: string;
    employeeId?: number;
    period?: string; // YYYY-MM format — filter leave overlapping this period
}

export function LeaveManager({ clientId, employeeId, period }: LeaveManagerProps) {
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [filter, setFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);

    // Form state
    const [formEmployeeId, setFormEmployeeId] = useState('');
    const [formLeaveType, setFormLeaveType] = useState('');
    const [formStartDate, setFormStartDate] = useState('');
    const [formEndDate, setFormEndDate] = useState('');
    const [formStartTime, setFormStartTime] = useState('');
    const [formEndTime, setFormEndTime] = useState('');
    const [formDaysCount, setFormDaysCount] = useState('1');
    const [formHours, setFormHours] = useState('');
    const [formReason, setFormReason] = useState('');
    const [formIsPaid, setFormIsPaid] = useState(true);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [reqRes, typesRes, empRes] = await Promise.all([
                apiFetch(`/clients/${clientId}/leave`),
                apiFetch(`/clients/${clientId}/leave-types`),
                apiFetch(`/clients/${clientId}/employees`),
            ]);
            let reqs: LeaveRequest[] = [];
            if (reqRes.ok) reqs = await reqRes.json();
            if (typesRes.ok) setLeaveTypes(await typesRes.json());
            if (empRes.ok) {
                const emps = await empRes.json();
                setEmployees(emps);
            }

            if (employeeId) {
                reqs = reqs.filter(r => r.employeeId === employeeId);
            }
            if (period) {
                const [year, month] = period.split('-').map(Number);
                const monthStart = new Date(year, month - 1, 1);
                const monthEnd = new Date(year, month, 0);
                reqs = reqs.filter(r => {
                    const start = new Date(r.startDate);
                    const end = new Date(r.endDate);
                    // Include if leave overlaps the period at all
                    return start <= monthEnd && end >= monthStart;
                });
            }
            setRequests(reqs);
        } catch {
            setError('Failed to load leave data');
        } finally {
            setLoading(false);
        }
    }, [clientId, employeeId, period]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const resetForm = () => {
        setFormEmployeeId('');
        setFormLeaveType(leaveTypes[0]?.name || '');
        setFormStartDate('');
        setFormEndDate('');
        setFormStartTime('');
        setFormEndTime('');
        setFormDaysCount('1');
        setFormHours('');
        setFormReason('');
        setFormIsPaid(true);
        setEditingId(null);
    };

    const openAddModal = () => {
        resetForm();
        setShowAddModal(true);
    };

    const openEditModal = (req: LeaveRequest) => {
        setEditingId(req.id);
        setFormEmployeeId(String(req.employeeId));
        setFormLeaveType(req.leaveType);
        setFormStartDate(req.startDate);
        setFormEndDate(req.endDate);
        setFormStartTime((req as any).startTime || '');
        setFormEndTime((req as any).endTime || '');
        setFormDaysCount(String(req.daysCount || 1));
        setFormHours(req.hours ? String(req.hours) : '');
        setFormReason(req.reason || '');
        setFormIsPaid(req.isPaid === 1);
        setShowAddModal(true);
    };

    const handleSave = async () => {
        setError(null);
        setMessage(null);

        if (!formEmployeeId || !formLeaveType || !formStartDate || !formEndDate) {
            setError('Employee, leave type, start date, and end date are required.');
            return;
        }

        const payload = {
            employeeId: parseInt(formEmployeeId, 10),
            leaveType: formLeaveType,
            startDate: formStartDate,
            endDate: formEndDate,
            startTime: formStartTime || null,
            endTime: formEndTime || null,
            daysCount: parseInt(formDaysCount, 10) || 1,
            hours: formHours ? parseFloat(formHours) : 0,
            reason: formReason,
            isPaid: formIsPaid ? 1 : 0,
            status: editingId ? undefined : 'Pending',
        };

        try {
            const res = editingId
                ? await apiFetch(`/clients/${clientId}/leave/${editingId}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                  })
                : await apiFetch(`/clients/${clientId}/leave`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                  });

            if (res.ok) {
                const record = await res.json();
                if (editingId) {
                    setRequests((prev) => prev.map((r) => (r.id === editingId ? record : r)));
                    setMessage('Leave request updated.');
                } else {
                    setRequests((prev) => [record, ...prev]);
                    setMessage('Leave request created.');
                }
                setShowAddModal(false);
                resetForm();
            } else {
                const d = await res.json();
                setError(d.message || 'Failed to save leave request');
            }
        } catch {
            setError('Network error');
        }
    };

    const handleStatusChange = async (id: number, status: 'Approved' | 'Rejected') => {
        setError(null);
        setMessage(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/leave/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            if (res.ok) {
                setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
                setMessage(`Leave request ${status.toLowerCase()}.`);
            } else {
                const d = await res.json();
                setError(d.message || 'Failed to update status');
            }
        } catch {
            setError('Network error');
        }
    };

    const handleTogglePaid = async (id: number, currentIsPaid: number) => {
        setError(null);
        setMessage(null);
        const newIsPaid = currentIsPaid === 1 ? 0 : 1;
        try {
            const res = await apiFetch(`/clients/${clientId}/leave/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isPaid: newIsPaid }),
            });
            if (res.ok) {
                setRequests((prev) =>
                    prev.map((r) => (r.id === id ? { ...r, isPaid: newIsPaid } : r))
                );
                setMessage(`Marked as ${newIsPaid === 1 ? 'paid' : 'unpaid'} leave.`);
            } else {
                const d = await res.json();
                setError(d.message || 'Failed to update paid status');
            }
        } catch {
            setError('Network error');
        }
    };

    const getUsedDays = (employeeId: number, leaveType: string) => {
        return requests
            .filter((r) => r.employeeId === employeeId && r.leaveType === leaveType && r.status === 'Approved')
            .reduce((sum, r) => sum + (r.daysCount || 0), 0);
    };

    const getAllowedDays = (leaveType: string) => {
        const lt = leaveTypes.find((t) => t.name === leaveType);
        return lt?.maxDaysPerYear ?? 0;
    };

    const getDefaultPaid = (leaveTypeName: string) => {
        const lt = leaveTypes.find((t) => t.name === leaveTypeName);
        return lt ? lt.isPaid === 1 : true;
    };

    const filtered = filter === 'All' ? requests : requests.filter((r) => r.status === filter);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <Calendar className="h-4 w-4" /> Leave Requests
                </h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={openAddModal}
                        className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-slate-700 transition"
                    >
                        <Plus className="h-3 w-3" /> New Request
                    </button>
                    {(['All', 'Pending', 'Approved', 'Rejected'] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
                                filter === f
                                    ? 'bg-slate-900 text-white'
                                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {message && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> {message}
                </div>
            )}
            {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" /> {error}
                </div>
            )}

            {requests.length === 0 ? (
                <div className="text-xs text-slate-500 py-4">No leave requests found.</div>
            ) : filtered.length === 0 ? (
                <div className="text-xs text-slate-500 py-4">No {filter.toLowerCase()} requests.</div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-left text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Type</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Period</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Days</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Hrs</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Paid</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Status</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Balance</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filtered.map((req) => {
                                const used = getUsedDays(req.employeeId, req.leaveType);
                                const allowed = getAllowedDays(req.leaveType);
                                const remaining = Math.max(0, allowed - used);
                                return (
                                    <tr key={req.id} className="hover:bg-slate-50/50 transition">
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-1.5">
                                                <User className="h-3 w-3 text-slate-400" />
                                                <span className="font-medium text-slate-900">{req.employeeName}</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-slate-700">{req.leaveType}</td>
                                        <td className="px-3 py-2 text-slate-500">
                                            {req.startDate} – {req.endDate}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-900">{req.daysCount}</td>
                                        <td className="px-3 py-2 text-right font-mono text-slate-600">
                                            {req.hours ? req.hours : '—'}
                                        </td>
                                        <td className="px-3 py-2">
                                            <button
                                                onClick={() => handleTogglePaid(req.id, req.isPaid)}
                                                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold transition ${
                                                    req.isPaid === 1
                                                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                                        : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                                                }`}
                                                title="Toggle paid/unpaid"
                                            >
                                                {req.isPaid === 1 ? 'Paid' : 'Unpaid'}
                                            </button>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                                    req.status === 'Approved'
                                                        ? 'bg-emerald-100 text-emerald-700'
                                                        : req.status === 'Rejected'
                                                          ? 'bg-rose-100 text-rose-700'
                                                          : 'bg-amber-100 text-amber-700'
                                                }`}
                                            >
                                                {req.status}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {allowed > 0 ? (
                                                <span className={`font-mono text-[10px] ${remaining === 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                                                    {used}/{allowed} left
                                                </span>
                                            ) : (
                                                <span className="text-slate-400 text-[10px]">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => openEditModal(req)}
                                                    className="rounded p-1 text-slate-500 hover:bg-slate-100 transition"
                                                    title="Edit"
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </button>
                                                {req.status === 'Pending' && (
                                                    <>
                                                        <button
                                                            onClick={() => handleStatusChange(req.id, 'Approved')}
                                                            className="rounded p-1 text-emerald-600 hover:bg-emerald-50 transition"
                                                            title="Approve"
                                                        >
                                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleStatusChange(req.id, 'Rejected')}
                                                            className="rounded p-1 text-rose-600 hover:bg-rose-50 transition"
                                                            title="Reject"
                                                        >
                                                            <XCircle className="h-3.5 w-3.5" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Add/Edit Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">
                            {editingId ? 'Edit Leave Request' : 'New Leave Request'}
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Employee</label>
                                <select
                                    value={formEmployeeId}
                                    onChange={(e) => setFormEmployeeId(e.target.value)}
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                                >
                                    <option value="">Select employee</option>
                                    {employees.map((emp) => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.employeeName}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Leave Type</label>
                                <select
                                    value={formLeaveType}
                                    onChange={(e) => {
                                        setFormLeaveType(e.target.value);
                                        setFormIsPaid(getDefaultPaid(e.target.value));
                                    }}
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                                >
                                    <option value="">Select type</option>
                                    {leaveTypes.map((lt) => (
                                        <option key={lt.id} value={lt.name}>
                                            {lt.name} {lt.maxDaysPerYear ? `(${lt.maxDaysPerYear}/yr)` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Start Date</label>
                                    <input
                                        type="date"
                                        value={formStartDate}
                                        onChange={(e) => setFormStartDate(e.target.value)}
                                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">End Date</label>
                                    <input
                                        type="date"
                                        value={formEndDate}
                                        onChange={(e) => setFormEndDate(e.target.value)}
                                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Start Time</label>
                                    <input
                                        type="time"
                                        value={formStartTime}
                                        onChange={(e) => setFormStartTime(e.target.value)}
                                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">End Time</label>
                                    <input
                                        type="time"
                                        value={formEndTime}
                                        onChange={(e) => setFormEndTime(e.target.value)}
                                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Days</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={formDaysCount}
                                        onChange={(e) => setFormDaysCount(e.target.value)}
                                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Hours (optional)</label>
                                    <input
                                        type="number"
                                        min={0}
                                        step={0.5}
                                        value={formHours}
                                        onChange={(e) => setFormHours(e.target.value)}
                                        placeholder="e.g. 4"
                                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Reason</label>
                                <input
                                    type="text"
                                    value={formReason}
                                    onChange={(e) => setFormReason(e.target.value)}
                                    placeholder="Optional reason"
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="isPaid"
                                    checked={formIsPaid}
                                    onChange={(e) => setFormIsPaid(e.target.checked)}
                                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                />
                                <label htmlFor="isPaid" className="text-xs text-slate-700">
                                    Paid leave
                                </label>
                            </div>
                        </div>
                        <div className="mt-5 flex items-center justify-end gap-2">
                            <button
                                onClick={() => {
                                    setShowAddModal(false);
                                    resetForm();
                                }}
                                className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 transition"
                            >
                                {editingId ? 'Update' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
