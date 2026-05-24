import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2, XCircle, Calendar, User } from 'lucide-react';
import { apiFetch } from '../../../services/api';

interface LeaveRequest {
    id: number;
    employeeId: number;
    employeeName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    daysCount: number;
    reason: string;
    status: 'Pending' | 'Approved' | 'Rejected';
    isPaid: number;
    createdAt: string;
}

interface LeaveType {
    id: number;
    name: string;
    daysAllowed: number;
}

interface LeaveManagerProps {
    clientId: string;
}

export function LeaveManager({ clientId }: LeaveManagerProps) {
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [filter, setFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [reqRes, typesRes] = await Promise.all([
                apiFetch(`/clients/${clientId}/leave`),
                apiFetch(`/clients/${clientId}/leave-types`),
            ]);
            if (reqRes.ok) setRequests(await reqRes.json());
            if (typesRes.ok) setLeaveTypes(await typesRes.json());
        } catch {
            setError('Failed to load leave data');
        } finally {
            setLoading(false);
        }
    }, [clientId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

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
                setRequests((prev) =>
                    prev.map((r) => (r.id === id ? { ...r, status } : r))
                );
                setMessage(`Leave request ${status.toLowerCase()}.`);
            } else {
                const d = await res.json();
                setError(d.message || 'Failed to update status');
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
        return lt?.daysAllowed ?? 0;
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
                                            {req.status === 'Pending' && (
                                                <div className="flex items-center gap-1">
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
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
