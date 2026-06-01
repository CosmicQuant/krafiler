import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Building2, Users } from 'lucide-react';
import { apiFetch } from '../../../services/api';

interface Loan {
    id: number;
    employeeId: number;
    employeeName: string;
    kraPin: string;
    loanType: string;
    principal: number;
    monthlyDeduction: number;
    installments: number;
    remainingInstallments: number;
    interestRate: number;
    totalInterest: number;
    totalRepayable: number;
    amountPaid: number;
    status: string;
    disbursedAt: string | null;
    notes: string;
}

interface Employee {
    id: number;
    employeeName: string;
    kraPin: string;
    employmentStatus: string;
}

interface LoanManagerProps {
    clientId: string;
    employeeId?: number;
    period?: string; // YYYY-MM format — filter loans disbursed in this period
}

const emptyForm = {
    employeeId: '', employeeName: '', kraPin: '', loanType: 'Salary Advance',
    principal: 0, monthlyDeduction: 0, installments: 1, remainingInstallments: 1,
    interestRate: 0, totalInterest: 0, totalRepayable: 0, amountPaid: 0,
    status: 'Approved', disbursedAt: '', notes: '',
};

export function LoanManager({ clientId, employeeId, period }: LoanManagerProps) {
    const [loans, setLoans] = useState<Loan[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState<Loan | null>(null);
    const [form, setForm] = useState<any>({ ...emptyForm });
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchEmployees = useCallback(async () => {
        try {
            const res = await apiFetch(`/clients/${clientId}/employees`);
            if (res.ok) {
                const data: Employee[] = await res.json();
                setEmployees(data.filter(e => e.employmentStatus === 'Active'));
            }
        } catch { /* ignore */ }
    }, [clientId]);

    const fetchLoans = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetch(`/clients/${clientId}/loans`);
            if (res.ok) {
                let data: Loan[] = await res.json();
                if (employeeId) {
                    data = data.filter(l => l.employeeId === employeeId);
                }
                if (period) {
                    const [year, month] = period.split('-');
                    data = data.filter(l => {
                        if (!l.disbursedAt) return true; // include loans without date
                        const d = new Date(l.disbursedAt);
                        return d.getFullYear() === parseInt(year, 10) && d.getMonth() + 1 === parseInt(month, 10);
                    });
                }
                setLoans(data);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [clientId, employeeId, period]);

    useEffect(() => {
        fetchEmployees();
        fetchLoans();
    }, [fetchEmployees, fetchLoans]);

    const handleSelectEmployee = (employeeId: string) => {
        const emp = employees.find(e => String(e.id) === employeeId);
        if (emp) {
            setForm((f: any) => ({
                ...f,
                employeeId: String(emp.id),
                employeeName: emp.employeeName,
                kraPin: emp.kraPin,
            }));
        } else {
            setForm((f: any) => ({
                ...f,
                employeeId: '',
                employeeName: '',
                kraPin: '',
            }));
        }
    };

    const openModal = (rec?: Loan) => {
        if (rec) {
            setEditing(rec);
            setForm({
                employeeId: String(rec.employeeId || ''),
                employeeName: rec.employeeName || '',
                kraPin: rec.kraPin || '',
                loanType: rec.loanType || 'Salary Advance',
                principal: rec.principal || 0,
                monthlyDeduction: rec.monthlyDeduction || 0,
                installments: rec.installments || 1,
                remainingInstallments: rec.remainingInstallments || 1,
                interestRate: rec.interestRate || 0,
                totalInterest: rec.totalInterest || 0,
                totalRepayable: rec.totalRepayable || 0,
                amountPaid: rec.amountPaid || 0,
                status: rec.status || 'Approved',
                disbursedAt: rec.disbursedAt || '',
                notes: rec.notes || '',
            });
        } else {
            setEditing(null);
            setForm({ ...emptyForm });
        }
        setShowModal(true);
    };

    const handleSave = async () => {
        try {
            const payload = {
                ...form,
                totalRepayable: (parseFloat(form.principal) || 0) + (parseFloat(form.totalInterest) || 0),
            };
            const url = editing
                ? `/clients/${clientId}/loans/${editing.id}`
                : `/clients/${clientId}/loans`;
            const method = editing ? 'PUT' : 'POST';
            const res = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                setMessage(editing ? 'Loan updated' : 'Loan created');
                setShowModal(false);
                setEditing(null);
                await fetchLoans();
            } else {
                const err = await res.json().catch(() => ({}));
                setError(err.message || 'Save failed');
            }
        } catch {
            setError('Network error saving loan');
        }
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm('Delete this loan record?')) return;
        try {
            const res = await apiFetch(`/clients/${clientId}/loans/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setMessage('Loan deleted');
                await fetchLoans();
            }
        } catch { /* ignore */ }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <Building2 className="h-4 w-4" /> Loans
                </h3>
                <button
                    onClick={() => openModal()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff0613] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#d80000] transition"
                >
                    <Plus className="h-3.5 w-3.5" /> Add
                </button>
            </div>

            {message && <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">{message}</div>}
            {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>}

            {loading ? (
                <div className="text-xs text-slate-400 py-4">Loading loans...</div>
            ) : loans.length === 0 ? (
                <div className="text-xs text-slate-500 py-4">No loans found.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                <th className="pb-2">Employee</th>
                                <th className="pb-2">Type</th>
                                <th className="pb-2 text-right">Principal</th>
                                <th className="pb-2 text-right">Monthly</th>
                                <th className="pb-2">Remaining</th>
                                <th className="pb-2">Status</th>
                                <th className="pb-2 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loans.map((ln) => (
                                <tr
                                    key={ln.id}
                                    className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                                    onClick={() => openModal(ln)}
                                >
                                    <td className="py-2 font-medium text-slate-900">{ln.employeeName}</td>
                                    <td className="py-2 text-slate-600">{ln.loanType}</td>
                                    <td className="py-2 text-right">KES {Number(ln.principal || 0).toLocaleString()}</td>
                                    <td className="py-2 text-right">KES {Number(ln.monthlyDeduction || 0).toLocaleString()}</td>
                                    <td className="py-2">{ln.remainingInstallments}/{ln.installments}</td>
                                    <td className="py-2">
                                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                            ln.status === 'Approved' || ln.status === 'Active' ? 'bg-emerald-50 text-emerald-600' :
                                            ln.status === 'Paid' ? 'bg-blue-50 text-blue-600' :
                                            'bg-red-50 text-red-600'
                                        }`}>{ln.status}</span>
                                    </td>
                                    <td className="py-2 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <button onClick={(e) => { e.stopPropagation(); openModal(ln); }} className="p-1 rounded hover:bg-blue-50 text-blue-600 transition"><Pencil className="h-3.5 w-3.5" /></button>
                                            <button onClick={(e) => { e.stopPropagation(); handleDelete(ln.id); }} className="p-1 rounded hover:bg-red-50 text-red-500 transition"><Trash2 className="h-3.5 w-3.5" /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Loan Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                            <h3 className="text-sm font-bold text-slate-900">{editing ? 'Edit Loan' : 'Add Loan'}</h3>
                            <button onClick={() => setShowModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition"><X className="h-4 w-4" /></button>
                        </div>
                        <div className="px-6 py-4 space-y-3">
                            {/* Employee Selector */}
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                    <Users className="h-3 w-3" /> Employee
                                </label>
                                <select
                                    value={form.employeeId || ''}
                                    onChange={e => handleSelectEmployee(e.target.value)}
                                    disabled={!!editing}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
                                >
                                    <option value="">Select an employee</option>
                                    {employees.map(emp => (
                                        <option key={emp.id} value={String(emp.id)}>{emp.employeeName}</option>
                                    ))}
                                </select>
                                {form.employeeName && (
                                    <div className="mt-1.5 flex gap-3 text-[10px] text-slate-500">
                                        <span>KRA PIN: <span className="font-mono text-slate-700">{form.kraPin || 'N/A'}</span></span>
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Loan Type</label><select value={form.loanType} onChange={e => setForm((f: any) => ({ ...f, loanType: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"><option>Salary Advance</option><option>Emergency Loan</option><option>Normal Loan</option><option>Other</option></select></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Principal</label><input type="number" value={form.principal} onChange={e => setForm((f: any) => ({ ...f, principal: parseFloat(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Monthly Deduction</label><input type="number" value={form.monthlyDeduction} onChange={e => setForm((f: any) => ({ ...f, monthlyDeduction: parseFloat(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Installments</label><input type="number" value={form.installments} onChange={e => setForm((f: any) => ({ ...f, installments: parseInt(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Remaining</label><input type="number" value={form.remainingInstallments} onChange={e => setForm((f: any) => ({ ...f, remainingInstallments: parseInt(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Interest Rate (%)</label><input type="number" value={form.interestRate} onChange={e => setForm((f: any) => ({ ...f, interestRate: parseFloat(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Total Interest</label><input type="number" value={form.totalInterest} onChange={e => setForm((f: any) => ({ ...f, totalInterest: parseFloat(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Amount Paid</label><input type="number" value={form.amountPaid} onChange={e => setForm((f: any) => ({ ...f, amountPaid: parseFloat(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</label><select value={form.status} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"><option>Approved</option><option>Active</option><option>Paid</option><option>Defaulted</option><option>Rejected</option></select></div>
                            </div>
                            <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Disbursed Date</label><input type="text" value={form.disbursedAt} onChange={e => setForm((f: any) => ({ ...f, disbursedAt: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
                            <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Notes</label><textarea value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} rows={3} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" /></div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
                            <button onClick={() => setShowModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">Cancel</button>
                            <button onClick={handleSave} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition">{editing ? 'Update' : 'Create'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
