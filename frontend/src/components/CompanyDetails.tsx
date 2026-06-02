import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowLeft,
    Save,
    Building2,
    FileSpreadsheet,
    Percent,
    Calculator,
    FileArchive,
    Cloud,
    Calendar,
    Clock,
    Trash2,
    Edit,
    Plus,
    ClipboardList,
    Briefcase,
    LayoutDashboard,
} from 'lucide-react';
import { ClientObligation } from '../types';
import { apiFetchJson } from '../services/api';
import { DepartmentsView } from './dashboard/views/DepartmentsView';

interface CompanyDetailsProps {
    client: ClientObligation;
    onBack: () => void;
    onSave: (updatedClient: ClientObligation) => void | Promise<void>;
    onGoToPayrollView?: () => void;
}

const ALL_OBLIGATIONS = [
    { key: 'paye', label: 'PAYE' },
    { key: 'nssf', label: 'NSSF' },
    { key: 'sha', label: 'SHA' },
    { key: 'vat', label: 'VAT' },
    { key: 'tot', label: 'TOT' },
    { key: 'mri', label: 'MRI' },
    { key: 'eLevy', label: 'E-Levy' },
    { key: 'dst', label: 'DST' },
    { key: 'incomeTaxResidentIndividual', label: 'IT - Resident Individual' },
    { key: 'incomeTaxNonResidentIndividual', label: 'IT - Non-Resident Individual' },
    { key: 'incomeTaxCompany', label: 'IT - Company' },
    { key: 'exciseDuty', label: 'Excise Duty' },
];

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ─── Helpers ─── */

function safeJsonStringify(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value ?? {});
    } catch {
        return '{}';
    }
}

function safeJsonParse(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object') return value as Record<string, unknown>;
    try {
        return JSON.parse(typeof value === 'string' ? value : '{}') as Record<string, unknown>;
    } catch {
        return {};
    }
}

function formatConfigPreview(value: unknown): string {
    const c = safeJsonParse(value);
    return DAYS_OF_WEEK.map((d) => `${d}:${(c[d] as number) || 0}h`).join(' ');
}

/* ─── Component ─── */

export default function CompanyDetails({ client, onBack, onSave, onGoToPayrollView }: CompanyDetailsProps) {
    const [formData, setFormData] = useState<ClientObligation>({ ...client });
    const [selectedObligations, setSelectedObligations] = useState<string[]>(() => {
        if (Array.isArray(client.obligations)) {
            return client.obligations.map((s) => String(s).trim()).filter(Boolean);
        }
        if (typeof client.obligations === 'string' && client.obligations) {
            return client.obligations.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
        }
        return [];
    });

    const [vatInput, setVatInput] = useState('');
    const [vatOutput, setVatOutput] = useState('');
    const [totSales, setTotSales] = useState('');
    const [isUploadingCSV, setIsUploadingCSV] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [activeSection, setActiveSection] = useState('profile');

    /* ─── Work Schedules ─── */
    const [workSchedules, setWorkSchedules] = useState<any[]>([]);
    const [scheduleLoading, setScheduleLoading] = useState(false);
    const [showScheduleForm, setShowScheduleForm] = useState(false);
    const [editingSchedule, setEditingSchedule] = useState<any>(null);
    const [scheduleForm, setScheduleForm] = useState({
        name: '',
        config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 0, Sun: 0 }),
        standardCheckIn: '08:00',
        standardCheckOut: '17:00',
        saturdayCheckOut: '',
    });
    const [scheduleError, setScheduleError] = useState<string | null>(null);

    /* ─── Holidays ─── */
    const [holidays, setHolidays] = useState<any[]>([]);
    const [holidayLoading, setHolidayLoading] = useState(false);
    const [showHolidayForm, setShowHolidayForm] = useState(false);
    const [editingHoliday, setEditingHoliday] = useState<any>(null);
    const [holidayForm, setHolidayForm] = useState({ name: '', date: '', isRecurring: false, holidayType: 'Public' });
    const [holidayError, setHolidayError] = useState<string | null>(null);

    /* ─── Leave Types ─── */
    const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
    const [leaveTypeLoading, setLeaveTypeLoading] = useState(false);
    const [showLeaveTypeForm, setShowLeaveTypeForm] = useState(false);
    const [editingLeaveType, setEditingLeaveType] = useState<any>(null);
    const [leaveTypeForm, setLeaveTypeForm] = useState({ name: '', isPaid: true, maxDaysPerYear: '' });
    const [leaveTypeError, setLeaveTypeError] = useState<string | null>(null);

    /* ─── Data Loading ─── */

    const loadWorkSchedules = useCallback(async () => {
        setScheduleLoading(true);
        try {
            const data = await apiFetchJson<any[]>(`/clients/${client.id}/work-schedules`);
            setWorkSchedules(data || []);
        } catch (err: any) {
            console.error('Failed to load work schedules:', err);
        }
        setScheduleLoading(false);
    }, [client.id]);

    const loadHolidays = useCallback(async () => {
        setHolidayLoading(true);
        try {
            const data = await apiFetchJson<any[]>(`/clients/${client.id}/holidays`);
            setHolidays(data || []);
        } catch (err: any) {
            console.error('Failed to load holidays:', err);
        }
        setHolidayLoading(false);
    }, [client.id]);

    const loadLeaveTypes = useCallback(async () => {
        setLeaveTypeLoading(true);
        try {
            const data = await apiFetchJson<any[]>(`/clients/${client.id}/leave-types`);
            setLeaveTypes(data || []);
        } catch (err: any) {
            console.error('Failed to load leave types:', err);
        }
        setLeaveTypeLoading(false);
    }, [client.id]);

    useEffect(() => {
        loadWorkSchedules();
        loadHolidays();
        loadLeaveTypes();
    }, [loadWorkSchedules, loadHolidays, loadLeaveTypes]);

    /* ─── Handlers ─── */

    const handleUploadCSV = async (file: File) => {
        setIsUploadingCSV(true);
        const data = new FormData();
        data.append('masterCsv', file);
        try {
            const responseData = await apiFetchJson<any>(`/clients/${client.id}/master-csv`, {
                method: 'POST',
                body: data,
            });
            setFormData((prev) => ({
                ...prev,
                masterFileUrl: responseData.masterFileUrl,
                masterFileLabel: responseData.masterFileLabel,
            }));
            try {
                const importData = await apiFetchJson<any>(`/clients/${client.id}/employees/import`, {
                    method: 'POST',
                    body: JSON.stringify({}),
                });
                if (importData.imported > 0) {
                    alert(`Imported ${importData.imported} employees from Master CSV.`);
                } else {
                    alert('Master CSV uploaded. No new employees found to import (they may already exist).');
                }
            } catch (importErr) {
                console.warn('Employee import failed:', importErr);
            }
        } catch (err) {
            console.error('Upload failed:', err);
            alert(err instanceof Error ? err.message : 'Network error while uploading Master CSV.');
        } finally {
            setIsUploadingCSV(false);
        }
    };

    const calculatedVat = (parseFloat(vatOutput) || 0) - (parseFloat(vatInput) || 0);
    const calculatedTot = (parseFloat(totSales) || 0) * 0.015;

    const handleSave = async () => {
        if (isSaving) return;
        setIsSaving(true);
        setSaveError(null);
        try {
            await onSave({
                ...formData,
                obligations: selectedObligations.join(','),
            });
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Failed to save client details.');
        } finally {
            setIsSaving(false);
        }
    };

    const toggleObligation = (key: string) => {
        setSelectedObligations((prev) =>
            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
        );
    };

    /* ─── Work Schedule CRUD ─── */

    const openAddSchedule = () => {
        setEditingSchedule(null);
        setScheduleForm({
            name: '',
            config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 0, Sun: 0 }),
            standardCheckIn: '08:00',
            standardCheckOut: '17:00',
            saturdayCheckOut: '',
        });
        setScheduleError(null);
        setShowScheduleForm(true);
    };

    const openEditSchedule = (s: any) => {
        setEditingSchedule(s);
        setScheduleForm({
            name: s.name || '',
            config: safeJsonStringify(s.config),
            standardCheckIn: s.standardCheckIn || '08:00',
            standardCheckOut: s.standardCheckOut || '17:00',
            saturdayCheckOut: s.saturdayCheckOut || '',
        });
        setScheduleError(null);
        setShowScheduleForm(true);
    };

    const handleSaveSchedule = async () => {
        setScheduleError(null);
        let parsedConfig: any;
        try {
            parsedConfig = JSON.parse(scheduleForm.config);
        } catch {
            setScheduleError('Config must be valid JSON');
            return;
        }
        const body = JSON.stringify({
            name: scheduleForm.name,
            config: parsedConfig,
            standardCheckIn: scheduleForm.standardCheckIn,
            standardCheckOut: scheduleForm.standardCheckOut,
            saturdayCheckOut: scheduleForm.saturdayCheckOut || null,
        });
        const method = editingSchedule ? 'PUT' : 'POST';
        const path = editingSchedule
            ? `/clients/${client.id}/work-schedules/${editingSchedule.id}`
            : `/clients/${client.id}/work-schedules`;
        try {
            const data = await apiFetchJson<any>(path, { method, body });
            if (editingSchedule) {
                setWorkSchedules((prev) => prev.map((s) => (s.id === editingSchedule.id ? { ...s, ...data } : s)));
            } else {
                setWorkSchedules((prev) => [...prev, data]);
            }
            setShowScheduleForm(false);
            setEditingSchedule(null);
        } catch {
            setScheduleError('Failed to save work schedule');
        }
    };

    const handleDeleteSchedule = async (id: string) => {
        if (!window.confirm('Delete this work schedule?')) return;
        try {
            await apiFetchJson(`/clients/${client.id}/work-schedules/${id}`, { method: 'DELETE' });
            setWorkSchedules((prev) => prev.filter((s) => s.id !== id));
        } catch {
            alert('Failed to delete work schedule');
        }
    };

    const handleSeedSchedules = async () => {
        try {
            await apiFetchJson(`/clients/${client.id}/work-schedules/seed-defaults`, { method: 'POST' });
            await loadWorkSchedules();
        } catch {
            alert('Failed to seed default work schedules');
        }
    };

    /* ─── Holiday CRUD ─── */

    const openAddHoliday = () => {
        setEditingHoliday(null);
        setHolidayForm({ name: '', date: '', isRecurring: false, holidayType: 'Public' });
        setHolidayError(null);
        setShowHolidayForm(true);
    };

    const openEditHoliday = (h: any) => {
        setEditingHoliday(h);
        setHolidayForm({
            name: h.name || '',
            date: h.date || '',
            isRecurring: !!h.isRecurring,
            holidayType: h.holidayType || 'Public',
        });
        setHolidayError(null);
        setShowHolidayForm(true);
    };

    const handleSaveHoliday = async () => {
        setHolidayError(null);
        if (!holidayForm.name || !holidayForm.date) {
            setHolidayError('Name and date are required');
            return;
        }
        const body = JSON.stringify({
            name: holidayForm.name,
            date: holidayForm.date,
            isRecurring: holidayForm.isRecurring,
            holidayType: holidayForm.holidayType,
        });
        const method = editingHoliday ? 'PUT' : 'POST';
        const path = editingHoliday
            ? `/clients/${client.id}/holidays/${editingHoliday.id}`
            : `/clients/${client.id}/holidays`;
        try {
            const data = await apiFetchJson<any>(path, { method, body });
            if (editingHoliday) {
                setHolidays((prev) => prev.map((h) => (h.id === editingHoliday.id ? { ...h, ...data } : h)));
            } else {
                setHolidays((prev) => [...prev, data]);
            }
            setShowHolidayForm(false);
            setEditingHoliday(null);
        } catch {
            setHolidayError('Failed to save holiday');
        }
    };

    const handleDeleteHoliday = async (id: string) => {
        if (!window.confirm('Delete this holiday?')) return;
        try {
            await apiFetchJson(`/clients/${client.id}/holidays/${id}`, { method: 'DELETE' });
            setHolidays((prev) => prev.filter((h) => h.id !== id));
        } catch {
            alert('Failed to delete holiday');
        }
    };

    const handleSeedHolidays = async () => {
        try {
            await apiFetchJson(`/clients/${client.id}/holidays/seed-kenyan`, { method: 'POST' });
            await loadHolidays();
        } catch (err: any) {
            alert(err?.message || 'Failed to seed Kenyan holidays');
        }
    };

    /* ─── Leave Type CRUD ─── */

    const openAddLeaveType = () => {
        setEditingLeaveType(null);
        setLeaveTypeForm({ name: '', isPaid: true, maxDaysPerYear: '' });
        setLeaveTypeError(null);
        setShowLeaveTypeForm(true);
    };

    const openEditLeaveType = (lt: any) => {
        setEditingLeaveType(lt);
        setLeaveTypeForm({
            name: lt.name || '',
            isPaid: lt.isPaid !== false && lt.isPaid !== 0,
            maxDaysPerYear: lt.maxDaysPerYear ? String(lt.maxDaysPerYear) : '',
        });
        setLeaveTypeError(null);
        setShowLeaveTypeForm(true);
    };

    const handleSaveLeaveType = async () => {
        setLeaveTypeError(null);
        if (!leaveTypeForm.name.trim()) {
            setLeaveTypeError('Leave type name is required');
            return;
        }
        const body = JSON.stringify({
            name: leaveTypeForm.name.trim(),
            isPaid: leaveTypeForm.isPaid,
            maxDaysPerYear: leaveTypeForm.maxDaysPerYear ? parseInt(leaveTypeForm.maxDaysPerYear, 10) : null,
        });
        const method = editingLeaveType ? 'PUT' : 'POST';
        const path = editingLeaveType
            ? `/clients/${client.id}/leave-types/${editingLeaveType.id}`
            : `/clients/${client.id}/leave-types`;
        try {
            const data = await apiFetchJson<any>(path, { method, body });
            if (editingLeaveType) {
                setLeaveTypes((prev) => prev.map((lt) => (lt.id === editingLeaveType.id ? { ...lt, ...data } : lt)));
            } else {
                setLeaveTypes((prev) => [...prev, data]);
            }
            setShowLeaveTypeForm(false);
            setEditingLeaveType(null);
        } catch {
            setLeaveTypeError('Failed to save leave type');
        }
    };

    const handleDeleteLeaveType = async (id: string) => {
        if (!window.confirm('Delete this leave type?')) return;
        try {
            await apiFetchJson(`/clients/${client.id}/leave-types/${id}`, { method: 'DELETE' });
            setLeaveTypes((prev) => prev.filter((lt) => lt.id !== id));
        } catch {
            alert('Failed to delete leave type');
        }
    };

    /* ─── Sidebar Navigation ─── */

    const sections = [
        { key: 'profile', label: 'Company Profile', icon: Building2 },
        { key: 'schedules', label: 'Work Schedules', icon: Clock },
        { key: 'holidays', label: 'Holidays', icon: Calendar },
        { key: 'leave', label: 'Leave Types', icon: ClipboardList },
        { key: 'departments', label: 'Departments', icon: Briefcase },
        { key: 'tax', label: 'Tax Calculators', icon: Calculator },
    ];

    const scrollToSection = (key: string) => {
        setActiveSection(key);
        const el = document.getElementById(`section-${key}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    /* ─── Render ─── */

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition"
                >
                    <ArrowLeft className="h-4 w-4" /> Back to Dashboard
                </button>
                <button
                    onClick={() => void handleSave()}
                    disabled={isSaving}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
                        isSaving
                            ? 'cursor-not-allowed bg-[#ff0613]/60 text-slate-900/70'
                            : 'bg-[#ff0613] hover:bg-[#d80000] text-slate-950'
                    }`}
                >
                    <Save className="h-4 w-4" /> {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>

            {saveError && (
                <div className="rounded-xl border border-red-500/40 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {saveError}
                </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
                {/* Main Content */}
                <div className="space-y-6">
                    {/* ── Profile ── */}
                    <div id="section-profile" className="rounded-2xl border border-slate-200 bg-white p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <Building2 className="h-6 w-6 text-emerald-500" />
                            <h2 className="text-xl font-bold text-slate-900">Company Profile</h2>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">Company Name</label>
                                <input
                                    type="text"
                                    value={formData.name || ''}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">KRA PIN</label>
                                <input
                                    type="text"
                                    value={formData.pin || ''}
                                    onChange={(e) => setFormData({ ...formData, pin: e.target.value.toUpperCase() })}
                                    maxLength={11}
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">Email Address</label>
                                <input
                                    type="email"
                                    value={formData.email || ''}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="client@example.com"
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">Phone Number</label>
                                <input
                                    type="tel"
                                    value={formData.phone || ''}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="07XXXXXXXX"
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">iTax Password</label>
                                <input
                                    type="password"
                                    value={formData.iTaxPassword || ''}
                                    onChange={(e) => setFormData({ ...formData, iTaxPassword: e.target.value })}
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">Industry / Sector</label>
                                <input
                                    type="text"
                                    value={formData.sector || ''}
                                    onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                                    placeholder="e.g. Technology, Retail"
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                        </div>

                        {/* Portal Credentials */}
                        <div className="mt-6 pt-6 border-t border-slate-100">
                            <h3 className="text-sm font-bold text-slate-900 mb-3">Portal Credentials</h3>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">NSSF Employer No</label>
                                    <input
                                        type="text"
                                        value={formData.nssfNo || ''}
                                        onChange={(e) => setFormData({ ...formData, nssfNo: e.target.value })}
                                        placeholder="N00000000"
                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">NSSF Password</label>
                                    <input
                                        type="password"
                                        value={formData.nssfPassword || ''}
                                        onChange={(e) => setFormData({ ...formData, nssfPassword: e.target.value })}
                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">SHA Login</label>
                                    <input
                                        type="text"
                                        value={formData.shaLogin || ''}
                                        onChange={(e) => setFormData({ ...formData, shaLogin: e.target.value })}
                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">SHA Password</label>
                                    <input
                                        type="password"
                                        value={formData.shaPassword || ''}
                                        onChange={(e) => setFormData({ ...formData, shaPassword: e.target.value })}
                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">HELB Login</label>
                                    <input
                                        type="text"
                                        value={formData.helbLogin || ''}
                                        onChange={(e) => setFormData({ ...formData, helbLogin: e.target.value })}
                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">HELB Password</label>
                                    <input
                                        type="password"
                                        value={formData.helbPassword || ''}
                                        onChange={(e) => setFormData({ ...formData, helbPassword: e.target.value })}
                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Logo */}
                        <div className="mt-6 pt-6 border-t border-slate-100">
                            <h3 className="text-sm font-bold text-slate-900 mb-3">Company Logo</h3>
                            <div className="flex items-center gap-4">
                                {formData.logoUrl ? (
                                    <img src={formData.logoUrl} alt="Company logo" className="h-16 w-16 rounded-lg object-contain border border-slate-200" />
                                ) : (
                                    <div className="h-16 w-16 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 text-xs">No logo</div>
                                )}
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-500 hover:border-slate-400 hover:text-slate-700 transition shadow-sm">
                                    <Cloud className="h-4 w-4" />
                                    {formData.logoUrl ? 'Replace Logo' : 'Upload Logo'}
                                    <input
                                        type="file"
                                        className="hidden"
                                        accept="image/png,image/jpeg,image/jpg,image/webp"
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            const data = new FormData();
                                            data.append('logo', file);
                                            try {
                                                const d = await apiFetchJson<any>(`/clients/${client.id}/logo`, { method: 'POST', body: data });
                                                setFormData((prev) => ({ ...prev, logoUrl: d.logoUrl }));
                                            } catch {
                                                alert('Failed to upload logo');
                                            }
                                        }}
                                    />
                                </label>
                            </div>
                            <p className="mt-2 text-[10px] text-slate-400">PNG, JPG, or WEBP. Used on payslips and P9 forms.</p>
                        </div>
                    </div>

                    {/* ── Obligations ── */}
                    <div id="section-obligations" className="rounded-2xl border border-slate-200 bg-white p-6">
                        <h2 className="text-xl font-bold text-slate-900 mb-4">Obligations</h2>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {ALL_OBLIGATIONS.map((obs) => (
                                <label
                                    key={obs.key}
                                    className={`flex items-center gap-2 rounded-xl border p-3 cursor-pointer transition ${
                                        selectedObligations.includes(obs.key)
                                            ? 'border-[#ff0613]/30 bg-red-50'
                                            : 'border-slate-200 bg-slate-50'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedObligations.includes(obs.key)}
                                        onChange={() => toggleObligation(obs.key)}
                                        className="rounded border-slate-300 text-[#ff0613] focus:ring-[#ff0613] h-4 w-4"
                                    />
                                    <span className="text-sm font-semibold text-slate-700">{obs.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* ── Work Schedules ── */}
                    <div id="section-schedules" className="rounded-2xl border border-slate-200 bg-white p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <Clock className="h-6 w-6 text-indigo-500" />
                                <h2 className="text-xl font-bold text-slate-900">Work Schedules</h2>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={openAddSchedule}
                                    className="flex items-center gap-1 rounded-xl bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-600 transition"
                                >
                                    <Plus className="h-3 w-3" /> Add
                                </button>
                                <button
                                    onClick={handleSeedSchedules}
                                    className="flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                                >
                                    Seed Defaults
                                </button>
                            </div>
                        </div>

                        {workSchedules.length > 0 && (
                            <div className="mb-4 flex items-center gap-2 rounded-xl bg-slate-50 p-3 border border-slate-100">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Default Schedule</label>
                                <select
                                    value={formData.defaultWorkScheduleId ?? ''}
                                    onChange={(e) => {
                                        const val = e.target.value || null;
                                        setFormData((prev) => ({ ...prev, defaultWorkScheduleId: val as any }));
                                    }}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-indigo-400 transition"
                                >
                                    <option value="">None</option>
                                    {workSchedules.map((s: any) => (
                                        <option key={s.id} value={String(s.id)}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
                                <span className="text-[10px] text-slate-400">Applied automatically to new employees</span>
                            </div>
                        )}

                        {scheduleLoading ? (
                            <p className="text-xs text-slate-400 py-4 text-center">Loading work schedules...</p>
                        ) : workSchedules.length === 0 && !showScheduleForm ? (
                            <p className="text-xs text-slate-500 py-4 text-center">No work schedules yet. Add one or seed defaults.</p>
                        ) : (
                            <div className="space-y-2">
                                {workSchedules.map((s) => (
                                    <div
                                        key={s.id}
                                        className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3"
                                    >
                                        <div className="flex flex-col gap-0.5 min-w-0">
                                            <span className="text-sm font-bold text-slate-900 truncate">{s.name}</span>
                                            <span className="text-[10px] text-slate-500 font-mono truncate">
                                                {formatConfigPreview(s.config)}
                                            </span>
                                            <span className="text-[10px] text-slate-400">
                                                {s.standardCheckIn}-{s.standardCheckOut}
                                                {s.saturdayCheckOut ? ` / Sat: ${s.standardCheckIn}-${s.saturdayCheckOut}` : ''}
                                            </span>
                                        </div>
                                        <div className="flex gap-1 shrink-0">
                                            <button
                                                onClick={() => openEditSchedule(s)}
                                                className="rounded-lg p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition"
                                                title="Edit"
                                            >
                                                <Edit className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteSchedule(s.id)}
                                                className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                                                title="Delete"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {scheduleError && (
                            <div className="mt-3 rounded-xl border border-red-500/40 bg-red-50 px-3 py-2 text-xs text-red-700">
                                {scheduleError}
                            </div>
                        )}

                        {showScheduleForm && (
                            <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                                <h4 className="text-sm font-bold text-slate-900">
                                    {editingSchedule ? 'Edit Work Schedule' : 'Add Work Schedule'}
                                </h4>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">Name</label>
                                        <input
                                            type="text"
                                            value={scheduleForm.name}
                                            onChange={(e) => setScheduleForm((p) => ({ ...p, name: e.target.value }))}
                                            placeholder="e.g. Standard 5-Day"
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-400 transition"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">Config JSON</label>
                                        <input
                                            type="text"
                                            value={scheduleForm.config}
                                            onChange={(e) => setScheduleForm((p) => ({ ...p, config: e.target.value }))}
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 outline-none focus:border-indigo-400 transition"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">Check-In</label>
                                        <input
                                            type="time"
                                            value={scheduleForm.standardCheckIn}
                                            onChange={(e) => setScheduleForm((p) => ({ ...p, standardCheckIn: e.target.value }))}
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-400 transition"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">Check-Out</label>
                                        <input
                                            type="time"
                                            value={scheduleForm.standardCheckOut}
                                            onChange={(e) => setScheduleForm((p) => ({ ...p, standardCheckOut: e.target.value }))}
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-400 transition"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">Sat Check-Out (optional)</label>
                                        <input
                                            type="time"
                                            value={scheduleForm.saturdayCheckOut}
                                            onChange={(e) => setScheduleForm((p) => ({ ...p, saturdayCheckOut: e.target.value }))}
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-400 transition"
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button
                                        onClick={() => {
                                            setShowScheduleForm(false);
                                            setEditingSchedule(null);
                                            setScheduleError(null);
                                        }}
                                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSaveSchedule}
                                        className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-600 transition"
                                    >
                                        {editingSchedule ? 'Update' : 'Add'} Schedule
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Holidays ── */}
                    <div id="section-holidays" className="rounded-2xl border border-slate-200 bg-white p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <Calendar className="h-6 w-6 text-rose-500" />
                                <h2 className="text-xl font-bold text-slate-900">Holidays</h2>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={openAddHoliday}
                                    className="flex items-center gap-1 rounded-xl bg-rose-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-600 transition"
                                >
                                    <Plus className="h-3 w-3" /> Add
                                </button>
                                <button
                                    onClick={handleSeedHolidays}
                                    className="flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                                >
                                    Seed Kenyan
                                </button>
                            </div>
                        </div>

                        {holidayLoading ? (
                            <p className="text-xs text-slate-400 py-4 text-center">Loading holidays...</p>
                        ) : holidays.length === 0 && !showHolidayForm ? (
                            <p className="text-xs text-slate-500 py-4 text-center">No holidays added yet. Add one or seed Kenyan holidays.</p>
                        ) : (
                            <div className="space-y-2">
                                {holidays.map((h) => (
                                    <div
                                        key={h.id}
                                        className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3"
                                    >
                                        <div className="flex flex-col gap-0.5 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-slate-900 truncate">{h.name}</span>
                                                {!!h.isRecurring && (
                                                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700">
                                                        Recurring
                                                    </span>
                                                )}
                                                <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-semibold text-slate-600">
                                                    {h.holidayType || 'Public'}
                                                </span>
                                            </div>
                                            <span className="text-[10px] text-slate-500">
                                                {h.date
                                                    ? new Date(h.date + 'T12:00:00').toLocaleDateString('en-GB', {
                                                          weekday: 'short',
                                                          day: 'numeric',
                                                          month: 'long',
                                                          year: 'numeric',
                                                      })
                                                    : ''}
                                            </span>
                                        </div>
                                        <div className="flex gap-1 shrink-0">
                                            <button
                                                onClick={() => openEditHoliday(h)}
                                                className="rounded-lg p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition"
                                                title="Edit"
                                            >
                                                <Edit className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteHoliday(h.id)}
                                                className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                                                title="Delete"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {holidayError && (
                            <div className="mt-3 rounded-xl border border-red-500/40 bg-red-50 px-3 py-2 text-xs text-red-700">
                                {holidayError}
                            </div>
                        )}

                        {showHolidayForm && (
                            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4 space-y-3">
                                <h4 className="text-sm font-bold text-slate-900">
                                    {editingHoliday ? 'Edit Holiday' : 'Add Holiday'}
                                </h4>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">Holiday Name</label>
                                        <input
                                            type="text"
                                            value={holidayForm.name}
                                            onChange={(e) => setHolidayForm((p) => ({ ...p, name: e.target.value }))}
                                            placeholder="e.g. Labour Day"
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-rose-400 transition"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">Date</label>
                                        <input
                                            type="date"
                                            value={holidayForm.date}
                                            onChange={(e) => setHolidayForm((p) => ({ ...p, date: e.target.value }))}
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-rose-400 transition"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">Type</label>
                                        <select
                                            value={holidayForm.holidayType}
                                            onChange={(e) => setHolidayForm((p) => ({ ...p, holidayType: e.target.value }))}
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-rose-400 transition"
                                        >
                                            <option value="Public">Public</option>
                                            <option value="Observed">Observed</option>
                                            <option value="Company">Company</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-2 pt-5">
                                        <input
                                            type="checkbox"
                                            id="isRecurring"
                                            checked={holidayForm.isRecurring}
                                            onChange={(e) => setHolidayForm((p) => ({ ...p, isRecurring: e.target.checked }))}
                                            className="rounded border-slate-300 text-rose-500 focus:ring-rose-400 h-4 w-4"
                                        />
                                        <label htmlFor="isRecurring" className="text-xs font-semibold text-slate-600">
                                            Recurring yearly
                                        </label>
                                    </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button
                                        onClick={() => {
                                            setShowHolidayForm(false);
                                            setEditingHoliday(null);
                                            setHolidayError(null);
                                        }}
                                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSaveHoliday}
                                        className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-600 transition"
                                    >
                                        {editingHoliday ? 'Update' : 'Add'} Holiday
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Leave Types ── */}
                    <div id="section-leave" className="rounded-2xl border border-slate-200 bg-white p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <ClipboardList className="h-6 w-6 text-emerald-500" />
                                <h2 className="text-xl font-bold text-slate-900">Leave Types</h2>
                            </div>
                            <button
                                onClick={openAddLeaveType}
                                className="flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 transition"
                            >
                                <Plus className="h-3 w-3" /> Add
                            </button>
                        </div>

                        {leaveTypeLoading ? (
                            <p className="text-xs text-slate-400 py-4 text-center">Loading leave types...</p>
                        ) : leaveTypes.length === 0 && !showLeaveTypeForm ? (
                            <p className="text-xs text-slate-500 py-4 text-center">No leave types configured yet.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-200 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                            <th className="pb-2">Name</th>
                                            <th className="pb-2">Paid</th>
                                            <th className="pb-2">Max Days/Year</th>
                                            <th className="pb-2 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {leaveTypes.map((lt) => (
                                            <tr key={lt.id} className="border-b border-slate-50 hover:bg-slate-50">
                                                <td className="py-2 font-medium text-slate-900">{lt.name}</td>
                                                <td className="py-2">
                                                    <span
                                                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                            lt.isPaid !== false && lt.isPaid !== 0
                                                                ? 'bg-emerald-50 text-emerald-600'
                                                                : 'bg-slate-100 text-slate-500'
                                                        }`}
                                                    >
                                                        {lt.isPaid !== false && lt.isPaid !== 0 ? 'Yes' : 'No'}
                                                    </span>
                                                </td>
                                                <td className="py-2 text-slate-600">{lt.maxDaysPerYear ?? '-'}</td>
                                                <td className="py-2 text-right">
                                                    <button
                                                        onClick={() => openEditLeaveType(lt)}
                                                        className="rounded p-1 hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition mr-1"
                                                        title="Edit"
                                                    >
                                                        <Edit className="h-3.5 w-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteLeaveType(lt.id)}
                                                        className="rounded p-1 hover:bg-red-50 text-slate-400 hover:text-red-600 transition"
                                                        title="Delete"
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

                        {leaveTypeError && (
                            <div className="mt-3 rounded-xl border border-red-500/40 bg-red-50 px-3 py-2 text-xs text-red-700">
                                {leaveTypeError}
                            </div>
                        )}

                        {showLeaveTypeForm && (
                            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                                <h4 className="text-sm font-bold text-slate-900">
                                    {editingLeaveType ? 'Edit Leave Type' : 'Add Leave Type'}
                                </h4>
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <div>
                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">Name</label>
                                        <input
                                            type="text"
                                            value={leaveTypeForm.name}
                                            onChange={(e) => setLeaveTypeForm((p) => ({ ...p, name: e.target.value }))}
                                            placeholder="e.g. Annual Leave"
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-400 transition"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-[10px] font-bold text-slate-500">Max Days/Year</label>
                                        <input
                                            type="number"
                                            value={leaveTypeForm.maxDaysPerYear}
                                            onChange={(e) => setLeaveTypeForm((p) => ({ ...p, maxDaysPerYear: e.target.value }))}
                                            placeholder="Leave blank for unlimited"
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-400 transition"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 pt-5">
                                        <input
                                            type="checkbox"
                                            id="ltIsPaid"
                                            checked={leaveTypeForm.isPaid}
                                            onChange={(e) => setLeaveTypeForm((p) => ({ ...p, isPaid: e.target.checked }))}
                                            className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-400 h-4 w-4"
                                        />
                                        <label htmlFor="ltIsPaid" className="text-xs font-semibold text-slate-600">
                                            Paid leave
                                        </label>
                                    </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button
                                        onClick={() => {
                                            setShowLeaveTypeForm(false);
                                            setEditingLeaveType(null);
                                            setLeaveTypeError(null);
                                        }}
                                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSaveLeaveType}
                                        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 transition"
                                    >
                                        {editingLeaveType ? 'Update' : 'Add'} Leave Type
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Departments ── */}
                    <div id="section-departments" className="rounded-2xl border border-slate-200 bg-white p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <Briefcase className="h-6 w-6 text-blue-500" />
                            <h2 className="text-xl font-bold text-slate-900">Departments</h2>
                        </div>
                        <DepartmentsView client={{ id: client.id, name: client.name }} />
                    </div>

                    {/* ── Tax Calculators ── */}
                    {selectedObligations.includes('vat') && (
                        <div id="section-tax" className="rounded-2xl border border-blue-500/20 bg-white p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <Percent className="h-6 w-6 text-blue-600" />
                                <h2 className="text-xl font-bold text-slate-900">VAT Calculator</h2>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">Total Output TAX (Sales)</label>
                                    <input
                                        type="number"
                                        placeholder="Ksh."
                                        value={vatOutput}
                                        onChange={(e) => setVatOutput(e.target.value)}
                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:bg-white transition"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">Total Input TAX (Purchases)</label>
                                    <input
                                        type="number"
                                        placeholder="Ksh."
                                        value={vatInput}
                                        onChange={(e) => setVatInput(e.target.value)}
                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:bg-white transition"
                                    />
                                </div>
                            </div>
                            <div className="mt-4 flex items-center justify-between rounded-xl bg-blue-50 p-4 border border-blue-500/20">
                                <span className="text-sm font-semibold text-blue-700">Payable VAT (Output - Input):</span>
                                <span
                                    className={`text-lg font-black ${
                                        calculatedVat > 0 ? 'text-red-600' : 'text-emerald-600'
                                    }`}
                                >
                                    {calculatedVat > 0
                                        ? `Ksh. ${calculatedVat.toLocaleString()}`
                                        : calculatedVat < 0
                                        ? `(Refund) Ksh. ${Math.abs(calculatedVat).toLocaleString()}`
                                        : 'Ksh. 0'}
                                </span>
                            </div>
                        </div>
                    )}

                    {selectedObligations.includes('tot') && (
                        <div className="rounded-2xl border border-amber-500/20 bg-white p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <Calculator className="h-6 w-6 text-[#ff0613]" />
                                <h2 className="text-xl font-bold text-slate-900">TOT (Turnover Tax) Calculator</h2>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">Gross Monthly Sales (Turnover)</label>
                                <input
                                    type="number"
                                    placeholder="Ksh."
                                    value={totSales}
                                    onChange={(e) => setTotSales(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div className="mt-4 flex items-center justify-between rounded-xl bg-red-50 p-4 border border-amber-500/20">
                                <span className="text-sm font-semibold text-amber-700">Calculated TOT (1.5%):</span>
                                <span className="text-lg font-black text-[#ff0613]">
                                    Ksh. {calculatedTot.toLocaleString()}
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Sidebar */}
                <div className="space-y-6 lg:sticky lg:top-4 lg:self-start">
                    {/* Quick Nav */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                            <LayoutDashboard className="h-3.5 w-3.5" /> Quick Nav
                        </h3>
                        <div className="space-y-1">
                            {sections.map((sec) => {
                                const Icon = sec.icon;
                                const isActive = activeSection === sec.key;
                                return (
                                    <button
                                        key={sec.key}
                                        onClick={() => scrollToSection(sec.key)}
                                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                                            isActive
                                                ? 'bg-slate-100 text-slate-900'
                                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                                        }`}
                                    >
                                        <Icon className="h-3.5 w-3.5" />
                                        {sec.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Payroll Data */}
                    {(selectedObligations.includes('paye') ||
                        selectedObligations.includes('nssf') ||
                        selectedObligations.includes('sha')) && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-5">
                            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500">Payroll Data</h3>
                            <div className="space-y-3">
                                {onGoToPayrollView && (
                                    <Link
                                        to={`/dashboard/client/${client.id}/payroll`}
                                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 hover:text-slate-900 transition"
                                    >
                                        <FileArchive className="h-4 w-4" />
                                        Open Payroll View
                                    </Link>
                                )}
                                {formData.masterFileUrl ? (
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <div className="flex items-center gap-3 truncate">
                                                <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-500" />
                                                <div className="flex flex-col truncate">
                                                    <span className="text-xs font-semibold text-slate-900 truncate">
                                                        {formData.masterFileLabel || 'Master CSV'}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500">Uploaded ready for processing</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <a
                                                    href={formData.masterFileUrl}
                                                    download
                                                    className="text-xs font-medium text-blue-600 hover:underline"
                                                >
                                                    View
                                                </a>
                                                <label className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline">
                                                    {isUploadingCSV ? '...' : 'Replace'}
                                                    <input
                                                        type="file"
                                                        className="hidden"
                                                        accept=".csv,.xlsx"
                                                        onChange={(e) => {
                                                            if (e.target.files?.[0]) handleUploadCSV(e.target.files[0]);
                                                        }}
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center hover:bg-slate-50 transition">
                                        {isUploadingCSV ? (
                                            <span className="text-xs font-medium text-slate-500 animate-pulse">Uploading...</span>
                                        ) : (
                                            <>
                                                <Cloud className="mb-2 h-6 w-6 text-slate-500" />
                                                <span className="text-xs font-medium text-slate-600">Upload Master CSV</span>
                                                <span className="mt-1 text-[10px] text-slate-500">Auto-generates ZIPs &amp; records</span>
                                            </>
                                        )}
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept=".csv,.xlsx"
                                            onChange={(e) => {
                                                if (e.target.files?.[0]) handleUploadCSV(e.target.files[0]);
                                            }}
                                        />
                                    </label>
                                )}

                                {client.payeZipUrl ? (
                                    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="flex items-center gap-3">
                                            <FileArchive className="h-5 w-5 text-amber-500" />
                                            <div className="flex flex-col">
                                                <span className="text-xs font-semibold text-slate-900">Generated PAYE</span>
                                                <span className="text-[10px] text-slate-500">Ready to file</span>
                                            </div>
                                        </div>
                                        <a href={client.payeZipUrl} download className="text-xs text-blue-600 hover:underline">
                                            ZIP
                                        </a>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4">
                                        <span className="text-xs font-medium text-slate-500">No Payroll ZIP</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Active Obligations */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                        <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500">Active Obligations</h3>
                        <div className="flex flex-wrap gap-2">
                            {ALL_OBLIGATIONS.map((obs) => {
                                const isActive = selectedObligations.includes(obs.key);
                                if (!isActive) return null;
                                return (
                                    <span
                                        key={obs.key}
                                        className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase text-slate-600 border border-slate-200"
                                    >
                                        {obs.label}
                                    </span>
                                );
                            })}
                            {selectedObligations.length === 0 && (
                                <span className="text-xs text-slate-500">No obligations selected</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
