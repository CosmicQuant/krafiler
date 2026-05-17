import { useState, useEffect } from 'react';
import { apiFetch } from '../../../services/api';
import { Plus, Trash2, Pencil, X, Check } from 'lucide-react';

interface Department {
    id: number;
    clientId: number;
    name: string;
    headEmployeeId: number | null;
    createdAt: string;
    updatedAt: string;
}

interface Employee {
    id: number;
    employeeName: string;
    departmentId: number | null;
}

export function DepartmentsView({ client }: { client: { id: number | string; name: string } }) {
    const [depts, setDepts] = useState<Department[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editHeadId, setEditHeadId] = useState<number | null>(null);
    const [newName, setNewName] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [newHeadId, setNewHeadId] = useState<number | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [d, e] = await Promise.all([
                apiFetch(`/clients/${client.id}/departments`),
                apiFetch(`/clients/${client.id}/employees`),
            ]);
            if (d.ok) setDepts(await d.json());
            if (e.ok) setEmployees(await e.json());
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, [client.id]);

    const createDept = async () => {
        if (!newName.trim()) return;
        const r = await apiFetch(`/clients/${client.id}/departments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName.trim(), headEmployeeId: newHeadId }),
        });
        if (r.ok) {
            setNewName('');
            setNewHeadId(null);
            setShowNew(false);
            fetchData();
        }
    };

    const updateDept = async (id: number) => {
        if (!editName.trim()) return;
        const r = await apiFetch(`/clients/${client.id}/departments/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: editName.trim(), headEmployeeId: editHeadId }),
        });
        if (r.ok) {
            setEditingId(null);
            fetchData();
        }
    };

    const deleteDept = async (id: number) => {
        if (!confirm('Delete this department?')) return;
        const r = await apiFetch(`/clients/${client.id}/departments/${id}`, { method: 'DELETE' });
        if (r.ok) fetchData();
    };

    const startEdit = (d: Department) => {
        setEditingId(d.id);
        setEditName(d.name);
        setEditHeadId(d.headEmployeeId);
    };

    const getHeadName = (id: number | null) => {
        if (!id) return '—';
        const emp = employees.find(e => e.id === id);
        return emp?.employeeName || '—';
    };

    const getEmployeeCount = (deptId: number) => employees.filter(e => e.departmentId === deptId).length;

    if (loading) return <div className="p-6 text-sm text-slate-500">Loading departments...</div>;

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-800">Departments</h3>
                <button onClick={() => setShowNew(!showNew)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition">
                    <Plus className="h-3.5 w-3.5" /> Add Department
                </button>
            </div>

            {showNew && (
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                    <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Department name" className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs" />
                    <select value={newHeadId || ''} onChange={e => setNewHeadId(e.target.value ? parseInt(e.target.value) : null)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs">
                        <option value="">No head</option>
                        {employees.map(e => <option key={e.id} value={e.id}>{e.employeeName}</option>)}
                    </select>
                    <button onClick={createDept} className="rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 transition"><Check className="h-4 w-4" /></button>
                    <button onClick={() => setShowNew(false)} className="rounded-lg bg-slate-200 p-1.5 text-slate-600 hover:bg-slate-300 transition"><X className="h-4 w-4" /></button>
                </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-slate-50 text-left text-slate-500">
                            <th className="px-4 py-2.5 font-semibold">Name</th>
                            <th className="px-4 py-2.5 font-semibold">Head</th>
                            <th className="px-4 py-2.5 font-semibold">Employees</th>
                            <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {depts.map(d => (
                            <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                                {editingId === d.id ? (
                                    <>
                                        <td className="px-4 py-2">
                                            <input value={editName} onChange={e => setEditName(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs" />
                                        </td>
                                        <td className="px-4 py-2">
                                            <select value={editHeadId || ''} onChange={e => setEditHeadId(e.target.value ? parseInt(e.target.value) : null)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
                                                <option value="">—</option>
                                                {employees.map(e => <option key={e.id} value={e.id}>{e.employeeName}</option>)}
                                            </select>
                                        </td>
                                        <td className="px-4 py-2">{getEmployeeCount(d.id)}</td>
                                        <td className="px-4 py-2 text-right">
                                            <button onClick={() => updateDept(d.id)} className="rounded p-1 text-emerald-600 hover:bg-emerald-50"><Check className="h-3.5 w-3.5" /></button>
                                            <button onClick={() => setEditingId(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td className="px-4 py-2 font-medium text-slate-800">{d.name}</td>
                                        <td className="px-4 py-2 text-slate-500">{getHeadName(d.headEmployeeId)}</td>
                                        <td className="px-4 py-2 text-slate-500">{getEmployeeCount(d.id)}</td>
                                        <td className="px-4 py-2 text-right">
                                            <button onClick={() => startEdit(d)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="h-3.5 w-3.5" /></button>
                                            <button onClick={() => deleteDept(d.id)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
                                        </td>
                                    </>
                                )}
                            </tr>
                        ))}
                        {depts.length === 0 && (
                            <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No departments yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
