import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../../../services/api';

export interface EmployeeEditModalProps {
    clientId: string;
    employee: Employee | null;
    open: boolean;
    onClose: () => void;
    onSaved: () => void;
}

export interface Employee {
    id: number;
    payrollNumber: string;
    employeeName: string;
    idNumber: string;
    kraPin: string;
    nssfNo: string;
    shaNo: string;
    phone: string;
    email: string;
    bankName: string;
    bankAccount: string;
    bankCode: string;
    department: string;
    jobTitle: string;
    employmentType: string;
    employmentStatus: string;
    dateJoined: string;
    dateLeft: string | null;
    basicPay: number;
    bonusPay: number;
    hourlyRate: number;
    role: string;
    departmentId: number | null;
    standardCheckIn: string;
    standardCheckOut: string;
    workScheduleId: number | null;
    offDay: string | null;
    payStructure?: string;
}

const emptyForm = {
    payrollNumber: '', employeeName: '', idNumber: '', kraPin: '',
    nssfNo: '', shaNo: '', phone: '', email: '', bankName: '',
    bankAccount: '', bankCode: '', department: '', jobTitle: '',
    employmentType: 'Permanent', employmentStatus: 'Active',
    dateJoined: '', dateLeft: '', basicPay: 0, bonusPay: 0,
    hourlyRate: 0,
    role: 'employee', departmentId: null, standardCheckOut: '17:00',
    standardCheckIn: '08:00', portalPassword: '', workScheduleId: '',
    offDay: '',
};

export function EmployeeEditModal({ clientId, employee, open, onClose, onSaved }: EmployeeEditModalProps) {
    const [form, setForm] = useState<any>({ ...emptyForm });
    const [workSchedules, setWorkSchedules] = useState<any[]>([]);
    const [departments, setDepartments] = useState<any[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        apiFetch(`/clients/${clientId}/work-schedules`)
            .then(r => r.ok ? r.json() : [])
            .then(setWorkSchedules)
            .catch(() => setWorkSchedules([]));
        apiFetch(`/clients/${clientId}/departments`)
            .then(r => r.ok ? r.json() : [])
            .then(setDepartments)
            .catch(() => setDepartments([]));
    }, [open, clientId]);

    const getTotalScheduledHours = (workScheduleId: string | number | null) => {
        const ws = workSchedules.find((s: any) => String(s.id) === String(workScheduleId));
        if (!ws || !ws.config) return 0;
        const config = JSON.parse(ws.config);
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const daysInMonth = new Date(year, month, 0).getDate();
        let totalHours = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month - 1, d);
            const dayName = dayNames[date.getDay()];
            const hours = config[dayName] || 0;
            if (hours > 0) totalHours += hours;
        }
        return totalHours;
    };

    const computeHourly = (basicPay: number, workScheduleId: string | number | null) => {
        const totalHours = getTotalScheduledHours(workScheduleId);
        if (totalHours <= 0) {
            // Fallback: use check-in/check-out for a generic 22-day month
            const [siH, siM] = (form.standardCheckIn || '08:00').split(':').map(Number);
            const [soH, soM] = (form.standardCheckOut || '17:00').split(':').map(Number);
            const dailyHours = Math.max(1, ((soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0))) / 60);
            const monthlyHours = dailyHours * 22;
            return monthlyHours > 0 ? Math.round((basicPay / monthlyHours) * 100) / 100 : 0;
        }
        return totalHours > 0 ? Math.round((basicPay / totalHours) * 100000000) / 100000000 : 0;
    };

    const computeBasicPay = (hourlyRate: number, workScheduleId: string | number | null) => {
        const totalHours = getTotalScheduledHours(workScheduleId);
        if (totalHours <= 0) {
            // Fallback: use check-in/check-out for a generic 22-day month
            const [siH, siM] = (form.standardCheckIn || '08:00').split(':').map(Number);
            const [soH, soM] = (form.standardCheckOut || '17:00').split(':').map(Number);
            const dailyHours = Math.max(1, ((soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0))) / 60);
            const monthlyHours = dailyHours * 22;
            return monthlyHours > 0 ? Math.round((hourlyRate * monthlyHours) * 100) / 100 : 0;
        }
        return totalHours > 0 ? Math.round((hourlyRate * totalHours) * 100) / 100 : 0;
    };

    useEffect(() => {
        if (!open) return;
        if (employee) {
            const computedHourly = computeHourly(employee.basicPay || 0, employee.workScheduleId);
            setForm({
                payrollNumber: employee.payrollNumber || '', employeeName: employee.employeeName || '',
                idNumber: employee.idNumber || '', kraPin: employee.kraPin || '',
                nssfNo: employee.nssfNo || '', shaNo: employee.shaNo || '',
                phone: employee.phone || '', email: employee.email || '',
                bankName: employee.bankName || '', bankAccount: employee.bankAccount || '',
                bankCode: employee.bankCode || '', department: employee.department || '',
                jobTitle: employee.jobTitle || '', employmentType: employee.employmentType || 'Permanent',
                employmentStatus: employee.employmentStatus || 'Active',
                dateJoined: employee.dateJoined || '', dateLeft: employee.dateLeft || '',
                basicPay: employee.basicPay || 0, bonusPay: employee.bonusPay || 0,
                hourlyRate: (employee.hourlyRate || computedHourly) || 0,
                role: employee.role || 'employee', departmentId: employee.departmentId || null,
                standardCheckIn: employee.standardCheckIn || '08:00',
                standardCheckOut: employee.standardCheckOut || '17:00',
                workScheduleId: employee.workScheduleId || '', offDay: employee.offDay || '',
            });
        } else {
            setForm({ ...emptyForm });
        }
        setError(null);
    }, [open, employee]);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const url = employee
                ? `/clients/${clientId}/employees/${employee.id}`
                : `/clients/${clientId}/employees`;
            const method = employee ? 'PUT' : 'POST';
            const res = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            if (res.ok) {
                if (form.portalPassword && form.portalPassword.length >= 6) {
                    await apiFetch('/auth/employee/set-password', {
                        method: 'POST',
                        body: JSON.stringify({ kraPin: form.kraPin, password: form.portalPassword }),
                    });
                }
                onSaved();
                onClose();
            } else {
                const err = await res.json().catch(() => ({}));
                setError(err.message || 'Save failed');
            }
        } catch {
            setError('Network error saving employee');
        } finally {
            setSaving(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                    <h3 className="text-sm font-bold text-slate-900">
                        {employee ? 'Edit Employee' : 'Add Employee'}
                    </h3>
                    <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                {error && (
                    <div className="mx-6 mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                        {error}
                    </div>
                )}
                <div className="px-6 py-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { key: 'employeeName', label: 'Full Name' },
                            { key: 'payrollNumber', label: 'Payroll No' },
                            { key: 'idNumber', label: 'ID Number' },
                            { key: 'kraPin', label: 'KRA PIN' },
                            { key: 'nssfNo', label: 'NSSF No' },
                            { key: 'shaNo', label: 'SHA No' },
                            { key: 'phone', label: 'Phone' },
                            { key: 'email', label: 'Email' },
                            { key: 'bankName', label: 'Bank Name' },
                            { key: 'bankAccount', label: 'Bank Account' },
                            { key: 'bankCode', label: 'Bank Code' },
                            { key: 'jobTitle', label: 'Job Title' },
                            { key: 'dateJoined', label: 'Date Joined' },
                        ].map(({ key, label }) => (
                            <div key={key}>
                                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
                                <input
                                    type="text"
                                    value={form[key] || ''}
                                    onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value }))}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                />
                            </div>
                        ))}
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Department</label>
                            {departments.length > 0 ? (
                                <select
                                    value={form.departmentId || ''}
                                    onChange={e => {
                                        const deptId = e.target.value ? parseInt(e.target.value, 10) : null;
                                        const dept = departments.find((d: any) => d.id === deptId);
                                        setForm((f: any) => ({
                                            ...f,
                                            departmentId: deptId,
                                            department: dept?.name || '',
                                        }));
                                    }}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                >
                                    <option value="">None</option>
                                    {departments.map((d: any) => (
                                        <option key={d.id} value={String(d.id)}>{d.name}</option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type="text"
                                    value={form.department || ''}
                                    onChange={e => setForm((f: any) => ({ ...f, department: e.target.value }))}
                                    placeholder="No departments configured — type manually"
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                />
                            )}
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Date Left</label>
                            <input type="text" value={form.dateLeft || ''} onChange={e => setForm((f: any) => ({ ...f, dateLeft: e.target.value }))} placeholder="Leave blank if active" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Employment Type</label>
                            <select value={form.employmentType} onChange={e => setForm((f: any) => ({ ...f, employmentType: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400">
                                <option>Permanent</option><option>Contract</option><option>Casual</option><option>Intern</option>
                            </select>
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</label>
                            <select value={form.employmentStatus} onChange={e => setForm((f: any) => ({ ...f, employmentStatus: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400">
                                <option>Active</option><option>Terminated</option><option>Resigned</option><option>Suspended</option>
                            </select>
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Basic Pay (KES)</label>
                            <input type="number" value={form.basicPay} onChange={e => {
                                const newBasicPay = parseFloat(e.target.value) || 0;
                                const newHourly = computeHourly(newBasicPay, form.workScheduleId);
                                setForm((f: any) => ({ ...f, basicPay: newBasicPay, hourlyRate: newHourly }));
                            }} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Hourly Rate (KES)</label>
                            <input type="number" step="0.01" value={form.hourlyRate} onChange={e => {
                                const newHourlyRate = parseFloat(e.target.value) || 0;
                                const newBasicPay = computeBasicPay(newHourlyRate, form.workScheduleId);
                                setForm((f: any) => ({ ...f, hourlyRate: newHourlyRate, basicPay: newBasicPay }));
                            }} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Bonus Pay (KES)</label>
                            <input type="number" value={form.bonusPay} onChange={e => setForm((f: any) => ({ ...f, bonusPay: parseFloat(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Work Schedule</label>
                            <select
                                value={form.workScheduleId || ''}
                                onChange={e => {
                                    const wsId = e.target.value ? parseInt(e.target.value, 10) : '';
                                    const ws = workSchedules.find((w: any) => String(w.id) === String(wsId));
                                    const newCheckIn = ws?.standardCheckIn || form.standardCheckIn || '08:00';
                                    const newCheckOut = ws?.standardCheckOut || form.standardCheckOut || '17:00';
                                    const newHourly = computeHourly(form.basicPay || 0, wsId);
                                    setForm((f: any) => ({
                                        ...f,
                                        workScheduleId: wsId,
                                        standardCheckIn: newCheckIn,
                                        standardCheckOut: newCheckOut,
                                        hourlyRate: newHourly,
                                    }));
                                }}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            >
                                <option value="">None / Custom</option>
                                {workSchedules.map((ws: any) => (
                                    <option key={ws.id} value={String(ws.id)}>{ws.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Std Check-In</label>
                            <input type="time" value={form.standardCheckIn || '08:00'} onChange={e => setForm((f: any) => ({ ...f, standardCheckIn: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Std Check-Out</label>
                            <input type="time" value={form.standardCheckOut || '17:00'} onChange={e => setForm((f: any) => ({ ...f, standardCheckOut: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Role</label>
                            <select value={form.role || 'employee'} onChange={e => setForm((f: any) => ({ ...f, role: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400">
                                <option value="employee">Employee</option><option value="hr">HR</option><option value="manager">Manager</option><option value="admin">Admin</option>
                            </select>
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Off Day</label>
                            <select value={form.offDay || ''} onChange={e => setForm((f: any) => ({ ...f, offDay: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400">
                                <option value="">None</option>
                                {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Portal Password</label>
                            <div className="flex gap-2">
                                <input type="text" value={form.portalPassword || ''} onChange={e => setForm((f: any) => ({ ...f, portalPassword: e.target.value }))} placeholder="Set to update portal login" className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                                <button
                                    type="button"
                                    onClick={() => {
                                        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
                                        let pwd = '';
                                        for (let i = 0; i < 8; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length));
                                        setForm((f: any) => ({ ...f, portalPassword: pwd }));
                                    }}
                                    className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition whitespace-nowrap"
                                >
                                    Generate
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
                    <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">Cancel</button>
                    <button onClick={handleSave} disabled={saving} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-50">{saving ? 'Saving...' : (employee ? 'Update' : 'Create')}</button>
                </div>
            </div>
        </div>
    );
}
