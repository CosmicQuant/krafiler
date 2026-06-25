import { useState, useEffect, useCallback } from 'react';
import { X, Save, CalendarCheck, Banknote, User, Pencil } from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';
import { calculatePayrollPreview } from '../../../utils/payrollEngine';

interface EmployeeDetailModalProps {
    employee: Employee;
    clientId: string;
    runId?: number;
    period?: string;
    onClose: () => void;
    onSaved: () => void;
}

interface Employee {
    id: string | number;
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
    basicPay: number;
    hourlyRate: number;
    payStructure: string;
    identityType: string;
    residentialStatus: string;
    typeOfEmployee: string;
    pwd: string;
    exemptionCert: string;
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    typeOfHousing: string;
    housingBenefit: number;
    otherBenefits: number;
    otherPension: number;
    postRetMedical: number;
    mortgageInterest: number;
    insuranceRelief: number;
    bonusPay: number;
    standardCheckIn?: string;
    standardCheckOut?: string;
    offDay?: string;
    workScheduleId?: number;
}

const dropdownOptions: Record<string, string[]> = {
    identityType: ['National ID', 'Passport', 'Alien ID', 'Military ID'],
    residentialStatus: ['Resident', 'Non-Resident'],
    typeOfEmployee: ['Primary Employee', 'Secondary Employee', 'Casual'],
    pwd: ['No', 'Yes'],
    employmentStatus: ['Active', 'Terminated', 'Resigned', 'Suspended'],
    employmentType: ['Permanent', 'Contract', 'Casual', 'Intern'],
    typeOfHousing: ['Benefit not given', "Employer's Owned House", "Employer's Rented House", 'Agriculture Farm', 'House to Non full time service Director'],
    payStructure: ['fixed', 'prorated'],
};

const fieldGroups = [
    {
        title: 'Personal',
        fields: [
            { key: 'employeeName', label: 'Full Name', type: 'text' },
            { key: 'idNumber', label: 'ID Number', type: 'text' },
            { key: 'kraPin', label: 'KRA PIN', type: 'text' },
            { key: 'phone', label: 'Phone', type: 'text' },
            { key: 'email', label: 'Email', type: 'text' },
            { key: 'identityType', label: 'Identity Type', type: 'select', options: dropdownOptions.identityType },
            { key: 'residentialStatus', label: 'Residential Status', type: 'select', options: dropdownOptions.residentialStatus },
            { key: 'pwd', label: 'PWD', type: 'select', options: dropdownOptions.pwd },
        ],
    },
    {
        title: 'Employment',
        fields: [
            { key: 'payrollNumber', label: 'Payroll #', type: 'text' },
            { key: 'department', label: 'Department', type: 'text' },
            { key: 'jobTitle', label: 'Job Title', type: 'text' },
            { key: 'employmentType', label: 'Employment Type', type: 'select', options: dropdownOptions.employmentType },
            { key: 'employmentStatus', label: 'Status', type: 'select', options: dropdownOptions.employmentStatus },
            { key: 'dateJoined', label: 'Date Joined', type: 'text' },
            { key: 'typeOfEmployee', label: 'Employee Type', type: 'select', options: dropdownOptions.typeOfEmployee },
            { key: 'payStructure', label: 'Pay Structure', type: 'select', options: dropdownOptions.payStructure },
        ],
    },
    {
        title: 'Compensation',
        fields: [
            { key: 'basicPay', label: 'Basic Pay', type: 'number' },
            { key: 'carBenefit', label: 'Car Benefit', type: 'number' },
            { key: 'mealsBenefit', label: 'Meals', type: 'number' },
            { key: 'nonCashBenefits', label: 'Non-Cash', type: 'number' },
            { key: 'typeOfHousing', label: 'Housing Type', type: 'select', options: dropdownOptions.typeOfHousing },
            { key: 'housingBenefit', label: 'Housing Benefit', type: 'number' },
            { key: 'otherBenefits', label: 'Other Benefits', type: 'number' },
            { key: 'otherPension', label: 'Other Pension', type: 'number' },
            { key: 'postRetMedical', label: 'Post-Ret Medical', type: 'number' },
            { key: 'mortgageInterest', label: 'Mortgage Interest', type: 'number' },
            { key: 'insuranceRelief', label: 'Insurance Relief', type: 'number' },
            { key: 'bonusPay', label: 'Bonus Pay', type: 'number' },
        ],
    },
    {
        title: 'Banking',
        fields: [
            { key: 'bankName', label: 'Bank Name', type: 'text' },
            { key: 'bankAccount', label: 'Account Number', type: 'text' },
            { key: 'bankCode', label: 'Bank Code', type: 'text' },
        ],
    },
    {
        title: 'Statutory',
        fields: [
            { key: 'nssfNo', label: 'NSSF No', type: 'text' },
            { key: 'shaNo', label: 'SHA No', type: 'text' },
            { key: 'exemptionCert', label: 'Exemption Cert', type: 'text' },
        ],
    },
];

export function EmployeeDetailModal({ employee, clientId, period, onClose, onSaved }: EmployeeDetailModalProps) {
    const [activeTab, setActiveTab] = useState<'details' | 'payslip'>('details');
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<Partial<Employee>>({ ...employee });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
    const [loans, setLoans] = useState<any[]>([]);

    const fetchAttendance = useCallback(async () => {
        if (!period) return;
        try {
            const [year, month] = period.split('-');
            const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
            const res = await apiFetch(`/clients/${clientId}/attendance?dateFrom=${period}-01&dateTo=${period}-${String(lastDay).padStart(2, '0')}`);
            if (res.ok) {
                const data = await res.json();
                setAttendanceRecords(data.filter((r: any) => r.employeeId === Number(employee.id)));
            }
        } catch { /* ignore */ }
    }, [clientId, employee.id, period]);

    const fetchLoans = useCallback(async () => {
        try {
            const res = await apiFetch(`/clients/${clientId}/loans?employeeId=${employee.id}`);
            if (res.ok) {
                const data = await res.json();
                setLoans(data);
            }
        } catch { /* ignore */ }
    }, [clientId, employee.id]);

    useEffect(() => {
        fetchAttendance();
        fetchLoans();
    }, [fetchAttendance, fetchLoans]);

    const handleSave = async () => {
        if (!draft.employeeName) {
            setError('Employee name is required');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/employees/${employee.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...draft, clientId }),
            });
            if (res.ok) {
                setEditing(false);
                onSaved();
            } else {
                const d = await res.json().catch(() => ({}));
                setError(d.message || 'Save failed');
            }
        } catch {
            setError('Network error saving employee');
        } finally {
            setSaving(false);
        }
    };

    const updateDraft = (field: keyof Employee, value: any) => {
        setDraft((prev) => ({ ...prev, [field]: value }));
    };

    const preview = calculatePayrollPreview({
        employeeId: Number(employee.id),
        employeeName: employee.employeeName,
        kraPin: employee.kraPin,
        payrollNumber: employee.payrollNumber,
        basicPay: employee.basicPay,
        carBenefit: employee.carBenefit,
        mealsBenefit: employee.mealsBenefit,
        nonCashBenefits: employee.nonCashBenefits,
        housingBenefit: employee.housingBenefit,
        otherBenefits: employee.otherBenefits,
        dateJoined: employee.dateJoined,
        dateLeft: null,
        employmentStatus: employee.employmentStatus,
        otherPension: employee.otherPension,
        postRetMedical: employee.postRetMedical,
        mortgageInterest: employee.mortgageInterest,
        insuranceRelief: employee.insuranceRelief,
        bonusPay: employee.bonusPay,
        pwd: employee.pwd,
    }, period || '2026-01', false);

    // Build attendance map
    const attMap = new Map<string, any>();
    for (const r of attendanceRecords) {
        attMap.set(r.date, r);
    }

    const [year, month] = (period || '2026-01').split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
                            <User className="h-4 w-4 text-slate-600" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-900">{employee.employeeName}</h3>
                            <p className="text-xs text-slate-500">{employee.kraPin} · {employee.department || 'No dept'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setEditing((e) => !e)}
                            className={cn(
                                'rounded-lg px-3 py-1.5 text-xs font-bold transition',
                                editing ? 'bg-slate-100 text-slate-700' : 'bg-slate-950 text-white hover:bg-slate-800'
                            )}
                        >
                            {editing ? 'Cancel' : <span className="flex items-center gap-1"><Pencil className="h-3 w-3" /> Edit</span>}
                        </button>
                        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {error}
                    </div>
                )}

                {/* Tabs */}
                <div className="flex border-b border-slate-100 px-5">
                    <button
                        onClick={() => setActiveTab('details')}
                        className={cn(
                            'px-3 py-2.5 text-xs font-bold transition border-b-2',
                            activeTab === 'details' ? 'text-[#ff0613] border-[#ff0613]' : 'text-slate-500 border-transparent hover:text-slate-700'
                        )}
                    >
                        Details
                    </button>
                    <button
                        onClick={() => setActiveTab('payslip')}
                        className={cn(
                            'px-3 py-2.5 text-xs font-bold transition border-b-2',
                            activeTab === 'payslip' ? 'text-[#ff0613] border-[#ff0613]' : 'text-slate-500 border-transparent hover:text-slate-700'
                        )}
                    >
                        Payslip Preview
                    </button>
                </div>

                <div className="p-5">
                    {activeTab === 'details' && (
                        <div className="space-y-4">
                            {/* Field groups */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                                {fieldGroups.map((group) => (
                                    <div key={group.title} className="space-y-2">
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">{group.title}</h4>
                                        {group.fields.map((field) => (
                                            <div key={field.key}>
                                                <label className="block text-xs font-semibold text-slate-500 mb-0.5">{field.label}</label>
                                                {editing ? (
                                                    field.type === 'select' ? (
                                                        <select
                                                            value={(draft as any)[field.key] ?? ''}
                                                            onChange={(e) => updateDraft(field.key as keyof Employee, e.target.value)}
                                                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                                                        >
                                                            {field.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                                                        </select>
                                                    ) : (
                                                        <input
                                                            type={field.type}
                                                            value={(draft as any)[field.key] ?? (field.type === 'number' ? 0 : '')}
                                                            onChange={(e) => updateDraft(field.key as keyof Employee, field.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                                                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                                                        />
                                                    )
                                                ) : (
                                                    <p className="text-xs font-mono text-slate-700">
                                                        {typeof (employee as any)[field.key] === 'number'
                                                            ? Number((employee as any)[field.key]).toLocaleString()
                                                            : ((employee as any)[field.key] || '-')}
                                                    </p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>

                            {editing && (
                                <div className="flex items-center justify-end gap-2 pt-2">
                                    <button onClick={() => setEditing(false)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                                    <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40">
                                        {saving ? 'Saving...' : <><Save className="h-3 w-3" /> Save</>}
                                    </button>
                                </div>
                            )}

                            {/* Attendance mini-calendar */}
                            {period && (
                                <div className="pt-4 border-t border-slate-100">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-1.5">
                                        <CalendarCheck className="h-3.5 w-3.5" /> Attendance — {period}
                                    </h4>
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
                                                    <span className={cn('h-6 w-6 rounded border flex items-center justify-center text-[10px] font-bold', badge)}>
                                                        {status.charAt(0)}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Loans */}
                            <div className="pt-4 border-t border-slate-100">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-1.5">
                                    <Banknote className="h-3.5 w-3.5" /> Active Loans / Advances
                                </h4>
                                {loans.length === 0 ? (
                                    <p className="text-xs text-slate-400">No active loans.</p>
                                ) : (
                                    <div className="space-y-1.5">
                                        {loans.map((loan: any) => (
                                            <div key={loan.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                                                <span className="text-xs font-medium text-slate-700">{loan.loanType || 'Loan'} <span className="text-slate-500">{loan.employeeName || employee.employeeName || ''}</span></span>
                                                <div className="flex items-center gap-3 text-xs text-slate-500">
                                                    <span>KES {Number(loan.principal || 0).toLocaleString()}</span>
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

                    {activeTab === 'payslip' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="rounded-lg bg-slate-50 p-3">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase">Basic Pay</p>
                                    <p className="text-sm font-mono font-bold text-slate-900">{employee.basicPay.toLocaleString()}</p>
                                </div>
                                <div className="rounded-lg bg-slate-50 p-3">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase">Gross Pay</p>
                                    <p className="text-sm font-mono font-bold text-slate-900">{preview.grossPay.toLocaleString()}</p>
                                </div>
                                <div className="rounded-lg bg-slate-50 p-3">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase">Taxable Pay</p>
                                    <p className="text-sm font-mono font-bold text-slate-900">{preview.taxablePay.toLocaleString()}</p>
                                </div>
                                <div className="rounded-lg bg-slate-50 p-3">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase">Net Pay</p>
                                    <p className="text-sm font-mono font-bold text-emerald-700">{preview.netPay.toLocaleString()}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                <div className="rounded-lg border border-slate-100 p-3">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase">SHA</p>
                                    <p className="text-xs font-mono text-slate-700">{preview.shaDeduction.toFixed(2)}</p>
                                </div>
                                <div className="rounded-lg border border-slate-100 p-3">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase">NSSF</p>
                                    <p className="text-xs font-mono text-slate-700">{preview.nssfDeduction.toFixed(2)}</p>
                                </div>
                                <div className="rounded-lg border border-slate-100 p-3">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase">AHL</p>
                                    <p className="text-xs font-mono text-slate-700">{preview.ahlDeduction.toFixed(2)}</p>
                                </div>
                                <div className="rounded-lg border border-slate-100 p-3">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase">PAYE</p>
                                    <p className="text-xs font-mono text-slate-700">{preview.payeTax.toFixed(2)}</p>
                                </div>
                                <div className="rounded-lg border border-slate-100 p-3">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase">Total Deductions</p>
                                    <p className="text-xs font-mono text-slate-700">{preview.totalDeductions?.toFixed(2)}</p>
                                </div>
                                <div className="rounded-lg border border-slate-100 p-3">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase">Days Worked</p>
                                    <p className="text-xs font-mono text-slate-700">{preview.daysWorked}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
