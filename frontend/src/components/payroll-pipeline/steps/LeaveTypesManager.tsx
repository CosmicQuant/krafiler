import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X, ClipboardList } from 'lucide-react';
import { apiFetch } from '../../../services/api';

interface LeaveType {
    id: number;
    name: string;
    isPaid: number;
    maxDaysPerYear: number | null;
}

interface LeaveTypesManagerProps {
    clientId: string;
}

export function LeaveTypesManager({ clientId }: LeaveTypesManagerProps) {
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [name, setName] = useState('');
    const [isPaid, setIsPaid] = useState(true);
    const [defaultDays, setDefaultDays] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchLeaveTypes = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetch(`/clients/${clientId}/leave-types`);
            if (res.ok) setLeaveTypes(await res.json());
        } catch { /* ignore */ }
        setLoading(false);
    }, [clientId]);

    useEffect(() => {
        fetchLeaveTypes();
    }, [fetchLeaveTypes]);

    const handleAdd = async () => {
        if (!name.trim()) {
            setError('Leave type name is required');
            return;
        }
        try {
            const res = await apiFetch(`/clients/${clientId}/leave-types`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    isPaid,
                    maxDaysPerYear: defaultDays ? parseInt(defaultDays, 10) : null,
                }),
            });
            if (res.ok) {
                setMessage('Leave type added');
                setShowModal(false);
                setName('');
                setIsPaid(true);
                setDefaultDays('');
                fetchLeaveTypes();
            } else {
                const err = await res.json().catch(() => ({}));
                setError(err.message || 'Failed to add leave type');
            }
        } catch {
            setError('Network error adding leave type');
        }
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm('Delete this leave type?')) return;
        try {
            const res = await apiFetch(`/clients/${clientId}/leave-types/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setMessage('Leave type deleted');
                fetchLeaveTypes();
            }
        } catch { /* ignore */ }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <ClipboardList className="h-4 w-4" /> Leave Types
                </h3>
                <button
                    onClick={() => setShowModal(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff0613] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#d80000] transition"
                >
                    <Plus className="h-3.5 w-3.5" /> Add
                </button>
            </div>

            {message && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
                    {message}
                </div>
            )}
            {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="text-xs text-slate-400 py-4">Loading leave types...</div>
            ) : leaveTypes.length === 0 ? (
                <div className="text-xs text-slate-500 py-4">No leave types found.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                <th className="pb-2">Name</th>
                                <th className="pb-2">Paid</th>
                                <th className="pb-2">Default Days</th>
                                <th className="pb-2 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leaveTypes.map((lt) => (
                                <tr key={lt.id} className="border-b border-slate-50 hover:bg-slate-50">
                                    <td className="py-2 font-medium text-slate-900">{lt.name}</td>
                                    <td className="py-2">
                                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                            lt.isPaid
                                                ? 'bg-emerald-50 text-emerald-600'
                                                : 'bg-slate-100 text-slate-500'
                                        }`}>
                                            {lt.isPaid ? 'Yes' : 'No'}
                                        </span>
                                    </td>
                                    <td className="py-2 text-slate-600">{lt.maxDaysPerYear ?? '-'}</td>
                                    <td className="py-2 text-right">
                                        <button
                                            onClick={() => handleDelete(lt.id)}
                                            className="p-1 rounded hover:bg-red-50 text-red-500 transition"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Add Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                            <h3 className="text-sm font-bold text-slate-900">Add Leave Type</h3>
                            <button onClick={() => setShowModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="px-6 py-4 space-y-3">
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="isPaid"
                                    checked={isPaid}
                                    onChange={(e) => setIsPaid(e.target.checked)}
                                    className="h-4 w-4 rounded border-slate-300 text-[#ff0613] focus:ring-[#ff0613]"
                                />
                                <label htmlFor="isPaid" className="text-xs text-slate-700">Paid leave</label>
                            </div>
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Default Days per Year</label>
                                <input
                                    type="number"
                                    value={defaultDays}
                                    onChange={(e) => setDefaultDays(e.target.value)}
                                    placeholder="Leave blank for unlimited"
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
                            <button onClick={() => setShowModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">Cancel</button>
                            <button onClick={handleAdd} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition">Add</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
