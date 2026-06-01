import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Pencil, Trash2, Users, Upload } from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { EmployeeEditModal, type Employee } from './EmployeeEditModal';

interface EmployeeManagerProps {
    clientId: string;
    onEmployeeClick?: (employee: Employee) => void;
}

export function EmployeeManager({ clientId, onEmployeeClick }: EmployeeManagerProps) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchEmployees = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetch(`/clients/${clientId}/employees`);
            if (res.ok) setEmployees(await res.json());
        } catch { /* ignore */ }
        setLoading(false);
    }, [clientId]);

    useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

    const openModal = (emp?: Employee) => {
        setEditingEmployee(emp ?? null);
        setModalOpen(true);
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm('Delete this employee?')) return;
        try {
            const res = await apiFetch(`/clients/${clientId}/employees/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setMessage('Employee deleted');
                fetchEmployees();
            }
        } catch { /* ignore */ }
    };

    const handleImportCSV = async (file: File) => {
        setMessage(null);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('masterCsv', file);
            const uploadRes = await apiFetch(`/clients/${clientId}/master-csv`, {
                method: 'POST',
                body: formData,
            });
            if (!uploadRes.ok) {
                const err = await uploadRes.json().catch(() => ({}));
                setError(err.message || 'Failed to upload Master CSV');
                return;
            }
            const importRes = await apiFetch(`/clients/${clientId}/employees/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (importRes.ok) {
                const data = await importRes.json();
                setMessage(`Imported ${data.imported || 0} employees from CSV`);
                fetchEmployees();
            } else {
                const err = await importRes.json().catch(() => ({}));
                setError(err.message || 'Import failed');
            }
        } catch {
            setError('Network error during CSV import');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <Users className="h-4 w-4" /> Employees
                </h3>
                <div className="flex items-center gap-2">
                    <input
                        type="file"
                        accept=".csv"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleImportCSV(file);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                    >
                        <Upload className="h-3.5 w-3.5" /> Import from CSV
                    </button>
                    <button
                        onClick={() => openModal()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff0613] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#d80000] transition"
                    >
                        <Plus className="h-3.5 w-3.5" /> Add
                    </button>
                </div>
            </div>

            {message && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">{message}</div>
            )}
            {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
            )}

            {loading ? (
                <div className="text-xs text-slate-400 py-4">Loading employees...</div>
            ) : employees.length === 0 ? (
                <div className="text-xs text-slate-500 py-4">No employees found.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                <th className="pb-2">Name</th>
                                <th className="pb-2">PIN</th>
                                <th className="pb-2">Dept</th>
                                <th className="pb-2">Status</th>
                                <th className="pb-2 text-right">Basic Pay</th>
                                <th className="pb-2 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {employees.map((emp) => (
                                <tr key={emp.id} className="border-b border-slate-50 hover:bg-slate-50">
                                    <td className="py-2">
                                        <button
                                            onClick={() => onEmployeeClick ? onEmployeeClick(emp) : openModal(emp)}
                                            className="font-medium text-slate-900 hover:text-[#ff0613] transition text-left"
                                        >
                                            {emp.employeeName}
                                        </button>
                                    </td>
                                    <td className="py-2 text-slate-600">{emp.kraPin}</td>
                                    <td className="py-2 text-slate-600">{emp.department}</td>
                                    <td className="py-2">
                                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                            emp.employmentStatus === 'Active'
                                                ? 'bg-emerald-50 text-emerald-600'
                                                : 'bg-slate-100 text-slate-500'
                                        }`}>
                                            {emp.employmentStatus}
                                        </span>
                                    </td>
                                    <td className="py-2 text-right font-medium text-slate-700">
                                        KES {Number(emp.basicPay || 0).toLocaleString()}
                                    </td>
                                    <td className="py-2 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => openModal(emp)}
                                                className="p-1 rounded hover:bg-blue-50 text-blue-600 transition"
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(emp.id)}
                                                className="p-1 rounded hover:bg-red-50 text-red-500 transition"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <EmployeeEditModal
                clientId={clientId}
                employee={editingEmployee}
                open={modalOpen}
                onClose={() => { setModalOpen(false); setEditingEmployee(null); }}
                onSaved={fetchEmployees}
            />
        </div>
    );
}
