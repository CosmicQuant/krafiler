import { useState, useEffect, useCallback } from 'react';
import { X, Save, CalendarCheck, Banknote, User, FileText, Eye } from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';
import { calculatePayrollPreview } from '../../../utils/payrollEngine';
import { AttendanceCalendarGrid } from '../steps/AttendanceCalendarGrid';

interface PayrollDetailDrawerProps {
    entry: PayrollEntry;
    clientId: string;
    runId?: number;
    period?: string;
    onClose: () => void;
    onSaved: () => void;
}

interface PayrollEntry {
    id: number;
    employeeId: number;
    employeeName: string;
    kraPin: string;
    basicPay: number;
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    housingBenefit: number;
    otherBenefits: number;
    bonusPay: number;
    overtimePay: number;
    grossPay: number;
    shaDeduction: number;
    nssfDeduction: number;
    ahlDeduction: number;
    taxablePay: number;
    payeTax: number;
    loanDeduction: number;
    otherDeductions: number;
    totalDeductions: number;
    netPay: number;
    daysWorked: number;
    personalRelief: number;
    otherPension?: number;
    postRetMedical?: number;
    mortgageInterest?: number;
    insuranceRelief?: number;
}

export function PayrollDetailDrawer({ entry, clientId, runId, period, onClose, onSaved }: PayrollDetailDrawerProps) {
    const [activeTab, setActiveTab] = useState<'attendance' | 'payroll' | 'payslip' | 'employee'>('payroll');
    const [showFullGrid, setShowFullGrid] = useState(false);

    const [draft, setDraft] = useState<Partial<PayrollEntry>>({ ...entry });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
    const [loans, setLoans] = useState<any[]>([]);
    const [employee, setEmployee] = useState<any>(null);

    const fetchAttendance = useCallback(async () => {
        if (!period) return;
        try {
            const [year, month] = period.split('-');
            const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
            const res = await apiFetch(`/clients/${clientId}/attendance?dateFrom=${period}-01&dateTo=${period}-${String(lastDay).padStart(2, '0')}`);
            if (res.ok) {
                const data = await res.json();
                setAttendanceRecords(data.filter((r: any) => r.employeeId === entry.employeeId));
            }
        } catch { /* ignore */ }
    }, [clientId, entry.employeeId, period]);

    const fetchLoans = useCallback(async () => {
        try {
            const res = await apiFetch(`/clients/${clientId}/loans?employeeId=${entry.employeeId}`);
            if (res.ok) setLoans(await res.json());
        } catch { /* ignore */ }
    }, [clientId, entry.employeeId]);

    const fetchEmployee = useCallback(async () => {
        try {
            const res = await apiFetch(`/clients/${clientId}/employees/${entry.employeeId}`);
            if (res.ok) {
                setEmployee(await res.json());
                return;
            }
        } catch { /* ignore */ }
        // Fallback: fetch all employees and filter
        try {
            const res = await apiFetch(`/clients/${clientId}/employees`);
            if (res.ok) {
                const list = await res.json();
                const match = list.find((e: any) => String(e.id) === String(entry.employeeId));
                if (match) setEmployee(match);
            }
        } catch { /* ignore */ }
    }, [clientId, entry.employeeId]);

    useEffect(() => {
        fetchAttendance();
        fetchLoans();
        fetchEmployee();
    }, [fetchAttendance, fetchLoans, fetchEmployee]);

    const handleSavePayroll = async () => {
        if (!runId) return;
        setSaving(true);
        setError(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/update-entry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeId: entry.employeeId,
                    basicPay: draft.basicPay,
                    carBenefit: draft.carBenefit,
                    mealsBenefit: draft.mealsBenefit,
                    nonCashBenefits: draft.nonCashBenefits,
                    housingBenefit: draft.housingBenefit,
                    otherBenefits: draft.otherBenefits,
                    bonusPay: draft.bonusPay,
                    overtimePay: draft.overtimePay,
                    otherDeductions: draft.otherDeductions,
                    loanDeduction: draft.loanDeduction,
                }),
            });
            if (res.ok) {
                onSaved();
            } else {
                const d = await res.json().catch(() => ({}));
                setError(d.message || 'Save failed');
            }
        } catch {
            setError('Network error');
        } finally {
            setSaving(false);
        }
    };

    const updateDraft = (field: keyof PayrollEntry, value: any) => {
        setDraft((prev) => ({ ...prev, [field]: value }));
    };

    const preview = calculatePayrollPreview({
        employeeId: entry.employeeId,
        employeeName: entry.employeeName,
        kraPin: entry.kraPin,
        payrollNumber: '',
        basicPay: draft.basicPay ?? entry.basicPay,
        carBenefit: draft.carBenefit ?? entry.carBenefit,
        mealsBenefit: draft.mealsBenefit ?? entry.mealsBenefit,
        nonCashBenefits: draft.nonCashBenefits ?? entry.nonCashBenefits,
        housingBenefit: draft.housingBenefit ?? entry.housingBenefit,
        otherBenefits: draft.otherBenefits ?? entry.otherBenefits,
        dateJoined: employee?.dateJoined || '',
        dateLeft: null,
        employmentStatus: employee?.employmentStatus || 'Active',
        otherPension: draft.otherPension ?? 0,
        postRetMedical: draft.postRetMedical ?? 0,
        mortgageInterest: draft.mortgageInterest ?? 0,
        insuranceRelief: draft.insuranceRelief ?? 0,
        bonusPay: draft.bonusPay ?? entry.bonusPay,
        pwd: employee?.pwd || 'No',
    }, period || '2026-01', false);

    const attMap = new Map<string, any>();
    for (const r of attendanceRecords) attMap.set(r.date, r);

    const [year, month] = (period || '2026-01').split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    const tabs = [
        { key: 'attendance' as const, label: 'Attendance', icon: CalendarCheck },
        { key: 'payroll' as const, label: 'Payroll', icon: Banknote },
        { key: 'payslip' as const, label: 'Payslip', icon: FileText },
        { key: 'employee' as const, label: 'Employee', icon: User },
    ];

    return (
        <>
            <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg border-l border-slate-200 bg-white shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
                            <User className="h-4 w-4 text-slate-600" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-900">{entry.employeeName}</h3>
                            <p className="text-xs text-slate-500">{entry.kraPin}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-100">
                    {tabs.map((t) => {
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setActiveTab(t.key)}
                                className={cn(
                                    'flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold transition border-b-2',
                                    activeTab === t.key ? 'text-[#ff0613] border-[#ff0613]' : 'text-slate-500 border-transparent hover:text-slate-700'
                                )}
                            >
                                <Icon className="h-3.5 w-3.5" />
                                {t.label}
                            </button>
                        );
                    })}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {error && (
                        <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {error}
                        </div>
                    )}

                    {activeTab === 'attendance' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">May 2026 Attendance</h4>
                                <button
                                    onClick={() => setShowFullGrid(true)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                                >
                                    <Eye className="h-3 w-3" /> Open Full Grid
                                </button>
                            </div>

                            {/* Compact 31-day badges */}
                            <div className="flex flex-wrap gap-1">
                                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                                    const dateStr = `${period}-${String(day).padStart(2, '0')}`;
                                    const rec = attMap.get(dateStr);
                                    const status = rec?.status || 'Present';
                                    const badge = (
                                        status === 'Present' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                        status === 'Absent' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                        status === 'Late' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                        status === 'Half-Day' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                        'bg-slate-50 text-slate-500 border-slate-200'
                                    );
                                    return (
                                        <div key={day} className="flex flex-col items-center">
                                            <span className="text-[9px] text-slate-400">{day}</span>
                                            <button
                                                className={cn('h-7 w-7 rounded border flex items-center justify-center text-[10px] font-bold transition hover:opacity-80', badge)}
                                                title={status}
                                            >
                                                {status.charAt(0)}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Summary */}
                            <div className="grid grid-cols-4 gap-2">
                                {[
                                    { label: 'Present', count: attendanceRecords.filter((r) => r.status === 'Present').length, color: 'text-emerald-700 bg-emerald-50' },
                                    { label: 'Absent', count: attendanceRecords.filter((r) => r.status === 'Absent').length, color: 'text-rose-700 bg-rose-50' },
                                    { label: 'Late', count: attendanceRecords.filter((r) => r.status === 'Late').length, color: 'text-amber-700 bg-amber-50' },
                                    { label: 'Half-Day', count: attendanceRecords.filter((r) => r.status === 'Half-Day').length, color: 'text-blue-700 bg-blue-50' },
                                ].map((s) => (
                                    <div key={s.label} className={cn('rounded-lg border p-2 text-center', s.color)}>
                                        <p className="text-lg font-bold">{s.count}</p>
                                        <p className="text-[10px] font-semibold">{s.label}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === 'payroll' && (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Edit Payroll</h4>
                            {[
                                { key: 'basicPay', label: 'Basic Pay' },
                                { key: 'carBenefit', label: 'Car Benefit' },
                                { key: 'mealsBenefit', label: 'Meals' },
                                { key: 'nonCashBenefits', label: 'Non-Cash' },
                                { key: 'housingBenefit', label: 'Housing' },
                                { key: 'otherBenefits', label: 'Other Benefits' },
                                { key: 'bonusPay', label: 'Bonus Pay' },
                                { key: 'overtimePay', label: 'Overtime' },
                                { key: 'loanDeduction', label: 'Loan Deduction' },
                                { key: 'otherDeductions', label: 'Other Deductions' },
                            ].map((f) => (
                                <div key={f.key} className="flex items-center justify-between gap-3">
                                    <label className="text-xs font-medium text-slate-600">{f.label}</label>
                                    <input
                                        type="number"
                                        value={(draft as any)[f.key] ?? (entry as any)[f.key] ?? 0}
                                        onChange={(e) => updateDraft(f.key as keyof PayrollEntry, parseFloat(e.target.value) || 0)}
                                        className="w-28 rounded border border-slate-200 bg-white px-2 py-1 text-right font-mono text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                                    />
                                </div>
                            ))}
                            <div className="flex items-center justify-end gap-2 pt-2">
                                <button onClick={() => setDraft({ ...entry })} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Reset</button>
                                <button onClick={handleSavePayroll} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40">
                                    {saving ? 'Saving...' : <><Save className="h-3 w-3" /> Save</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'payslip' && (
                        <div className="space-y-4">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Payslip Preview</h4>
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { label: 'Basic Pay', value: (draft.basicPay ?? entry.basicPay) },
                                    { label: 'Gross Pay', value: preview.grossPay },
                                    { label: 'Taxable Pay', value: preview.taxablePay },
                                    { label: 'Net Pay', value: preview.netPay },
                                ].map((item) => (
                                    <div key={item.label} className="rounded-lg bg-slate-50 p-3">
                                        <p className="text-[10px] font-semibold text-slate-500 uppercase">{item.label}</p>
                                        <p className={cn('text-sm font-mono font-bold', item.label === 'Net Pay' ? 'text-emerald-700' : 'text-slate-900')}>
                                            {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                                        </p>
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-2">
                                {[
                                    { label: 'SHA', value: preview.shaDeduction },
                                    { label: 'NSSF', value: preview.nssfDeduction },
                                    { label: 'AHL', value: preview.ahlDeduction },
                                    { label: 'PAYE', value: preview.payeTax },
                                    { label: 'Total Deductions', value: preview.totalDeductions },
                                    { label: 'Days Worked', value: preview.daysWorked },
                                ].map((item) => (
                                    <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                                        <span className="text-xs text-slate-500">{item.label}</span>
                                        <span className="text-xs font-mono text-slate-700">{typeof item.value === 'number' ? item.value.toFixed(2) : item.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === 'employee' && (
                        <div className="space-y-3">
                            {employee ? (
                                <>
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Employee Details</h4>
                                    {[
                                        { label: 'Full Name', value: employee.employeeName },
                                        { label: 'KRA PIN', value: employee.kraPin },
                                        { label: 'ID Number', value: employee.idNumber },
                                        { label: 'Phone', value: employee.phone },
                                        { label: 'Email', value: employee.email },
                                        { label: 'Department', value: employee.department },
                                        { label: 'Job Title', value: employee.jobTitle },
                                        { label: 'Employment Type', value: employee.employmentType },
                                        { label: 'Status', value: employee.employmentStatus },
                                        { label: 'Date Joined', value: employee.dateJoined },
                                        { label: 'Bank Name', value: employee.bankName },
                                        { label: 'Account Number', value: employee.bankAccount },
                                        { label: 'NSSF No', value: employee.nssfNo },
                                        { label: 'SHA No', value: employee.shaNo },
                                    ].map((f) => (
                                        <div key={f.label} className="flex items-center justify-between">
                                            <span className="text-xs font-medium text-slate-500">{f.label}</span>
                                            <span className="text-xs font-mono text-slate-700">{f.value || '-'}</span>
                                        </div>
                                    ))}
                                </>
                            ) : (
                                <p className="text-xs text-slate-400">Loading employee details...</p>
                            )}

                            {/* Loans */}
                            <div className="pt-4 border-t border-slate-100">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-1.5">
                                    <Banknote className="h-3.5 w-3.5" /> Active Loans
                                </h4>
                                {loans.length === 0 ? (
                                    <p className="text-xs text-slate-400">No active loans.</p>
                                ) : (
                                    <div className="space-y-1.5">
                                        {loans.map((loan: any) => (
                                            <div key={loan.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                                                <span className="text-xs font-medium text-slate-700">{loan.type || 'Loan'}</span>
                                                <div className="flex items-center gap-3 text-xs text-slate-500">
                                                    <span>KES {Number(loan.amount || 0).toLocaleString()}</span>
                                                    <span>{loan.remainingInstallments || 0} left</span>
                                                    <span className="font-mono">KES {Number(loan.monthlyDeduction || 0).toLocaleString()}/mo</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Full attendance grid modal */}
            {showFullGrid && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="relative max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-slate-900">Attendance Calendar — {entry.employeeName}</h3>
                            <button onClick={() => setShowFullGrid(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <AttendanceCalendarGrid
                            clientId={clientId}
                            period={period}
                            onPeriodChange={() => {}}
                            onApproved={() => {}}
                        />
                    </div>
                </div>
            )}
        </>
    );
}
