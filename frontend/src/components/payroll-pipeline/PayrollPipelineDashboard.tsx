import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus, ArrowLeft, Users, Save, Download, Pencil, Trash2,
    RefreshCw, CheckCircle2, XCircle
} from 'lucide-react';
import { apiFetch } from '../../services/api';
import type { ClientObligation } from '../../types';
import { cn } from '../../utils/cn';
import { KpiHeroCards } from './KpiHeroCards';
import { RunHistoryTable } from './RunHistoryTable';
import { ActiveRunCard, NoActiveRun } from './ActiveRunCard';
import { LoanManager } from './steps/LoanManager';
import { LeaveManager } from './steps/LeaveManager';

interface Employee {
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
}

interface ComputedRow {
    grossSalary: number;
    shaContribution: number;
    nssfContribution: number;
    ahl: number;
    taxablePay: number;
    personalRelief: number;
    paye: number;
    selfAssessedPaye: number;
}

interface PayrollRun {
    id: number;
    period: string;
    periodLabel: string;
    status: string;
    totalEmployees: number;
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
    lockedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

interface PayrollPipelineDashboardProps {
    client: ClientObligation;
    onBack: () => void;
}

const dropdownOptions: Record<string, string[]> = {
    identityType: ['National ID', 'Passport', 'Alien ID', 'Military ID'],
    residentialStatus: ['Resident', 'Non-Resident'],
    typeOfEmployee: ['Primary Employee', 'Secondary Employee', 'Casual'],
    pwd: ['No', 'Yes'],
    employmentStatus: ['Active', 'Terminated', 'Resigned', 'Suspended'],
    employmentType: ['Permanent', 'Contract', 'Casual', 'Intern'],
    typeOfHousing: ['Benefit not given', 'Own House', 'Rented', 'Company Provided', 'Living with Parents'],
    payStructure: ['fixed', 'prorated'],
};

function computeRow(emp: Partial<Employee>): ComputedRow {
    const totalCashPay = emp.basicPay || 0;
    const car = emp.carBenefit || 0;
    const meals = emp.mealsBenefit || 0;
    const nonCash = emp.nonCashBenefits || 0;
    const housing = emp.housingBenefit || 0;
    const other = emp.otherBenefits || 0;
    const gross = totalCashPay + car + meals + nonCash + housing + other;
    const sha = Math.round(gross * 0.0275 * 100) / 100;
    const nssf = Math.round((Math.min(gross, 9000) * 0.06 + Math.max(0, Math.min(gross - 9000, 99000)) * 0.06) * 100) / 100;
    const ahl = Math.round(gross * 0.015 * 100) / 100;
    const taxable = Math.max(0, gross - sha - nssf - ahl - (emp.otherPension || 0) - (emp.postRetMedical || 0) - (emp.mortgageInterest || 0));
    const personalRelief = 2400;
    const insuranceRelief = emp.insuranceRelief || 0;
    let paye = 0;
    if (taxable > 0) {
        let remaining = taxable;
        paye += Math.min(remaining, 24000) * 0.10;
        remaining = Math.max(0, remaining - 24000);
        if (remaining > 0) { paye += Math.min(remaining, 8333) * 0.15; remaining = Math.max(0, remaining - 8333); }
        if (remaining > 0) { paye += Math.min(remaining, 467667) * 0.20; remaining = Math.max(0, remaining - 467667); }
        if (remaining > 0) { paye += Math.min(remaining, 300000) * 0.25; remaining = Math.max(0, remaining - 300000); }
        if (remaining > 0) { paye += remaining * 0.30; }
        paye = Math.max(0, paye - personalRelief - insuranceRelief);
    }
    return {
        grossSalary: Math.round(gross * 100) / 100,
        shaContribution: sha,
        nssfContribution: nssf,
        ahl,
        taxablePay: Math.round(taxable * 100) / 100,
        personalRelief,
        paye: Math.round(paye * 100) / 100,
        selfAssessedPaye: Math.round(paye * 100) / 100,
    };
}

const emptyEmployee: Partial<Employee> = {
    payrollNumber: '', employeeName: '', idNumber: '', kraPin: '', nssfNo: '', shaNo: '',
    phone: '', email: '', bankName: '', bankAccount: '', bankCode: '',
    department: '', jobTitle: '', employmentType: 'Permanent', employmentStatus: 'Active',
    dateJoined: '', identityType: 'National ID', residentialStatus: 'Resident',
    typeOfEmployee: 'Primary Employee', pwd: 'No', exemptionCert: '',
    typeOfHousing: 'Benefit not given', payStructure: 'fixed',
    basicPay: 0, carBenefit: 0, mealsBenefit: 0, nonCashBenefits: 0,
    housingBenefit: 0, otherBenefits: 0, otherPension: 0,
    postRetMedical: 0, mortgageInterest: 0, insuranceRelief: 0, bonusPay: 0,
};

export function PayrollPipelineDashboard({ client, onBack }: PayrollPipelineDashboardProps) {
    const navigate = useNavigate();
    const employeeSectionRef = useRef<HTMLDivElement>(null);

    // Payroll runs state
    const [runs, setRuns] = useState<PayrollRun[]>([]);
    const [runsLoading, setRunsLoading] = useState(true);
    const [runsError, setRunsError] = useState<string | null>(null);
    const [kpiData, setKpiData] = useState({
        totalEmployees: 0,
        totalPayroll: 0,
        activeRuns: 0,
        pendingApprovals: 0,
    });

    // Employees state
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [empLoading, setEmpLoading] = useState(true);
    const [empMessage, setEmpMessage] = useState<string | null>(null);
    const [empError, setEmpError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState<Partial<Employee>>({ ...emptyEmployee });
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [masterUrl, setMasterUrl] = useState<string | null>(client.masterFileUrl || null);

    const fetchRuns = useCallback(async () => {
        setRunsLoading(true);
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs`);
            if (res.ok) {
                const data = await res.json();
                setRuns(data);
                const totalPayroll = data.reduce((s: number, r: PayrollRun) => s + r.totalGross, 0);
                const activeRuns = data.filter((r: PayrollRun) => !r.lockedAt).length;
                setKpiData((prev) => ({
                    ...prev,
                    totalPayroll,
                    activeRuns,
                }));
            } else {
                setRunsError('Failed to load payroll runs');
            }
        } catch {
            setRunsError('Network error loading runs');
        } finally {
            setRunsLoading(false);
        }
    }, [client.id]);

    const fetchEmployees = useCallback(async () => {
        setEmpLoading(true);
        try {
            const res = await apiFetch(`/clients/${client.id}/employees`);
            if (res.ok) {
                const data = await res.json();
                setEmployees(data);
                const active = data.filter((e: any) => e.employmentStatus === 'Active');
                setKpiData((prev) => ({
                    ...prev,
                    totalEmployees: active.length,
                }));
            }
        } catch {
            setEmpError('Failed to load employees');
        } finally {
            setEmpLoading(false);
        }
    }, [client.id]);

    useEffect(() => {
        fetchRuns();
        fetchEmployees();
    }, [fetchRuns, fetchEmployees]);

    const handleNewRun = () => {
        navigate(`/dashboard/client/${client.id}/payroll/new`);
    };

    const handleViewRun = (runId: number) => {
        navigate(`/dashboard/client/${client.id}/payroll/run/${runId}`);
    };

    const handleDeleteRun = async (runId: number) => {
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}`, {
                method: 'DELETE',
            });
            if (res.ok) fetchRuns();
        } catch { /* ignore */ }
    };

    const handleRollbackRun = async (runId: number) => {
        if (!window.confirm('Rollback this finalized payroll run? All loan transactions will be reversed.')) return;
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}/rollback`, {
                method: 'POST',
            });
            if (res.ok) fetchRuns();
        } catch { /* ignore */ }
    };

    const scrollToEmployees = () => {
        employeeSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // Employee CRUD handlers
    const handleSaveEmployee = async () => {
        if (!draft.employeeName) {
            setEmpError('Employee name is required');
            return;
        }
        setSaving(true);
        setEmpError(null);
        setEmpMessage(null);
        try {
            const url = editingId != null
                ? `/clients/${client.id}/employees/${editingId}`
                : `/clients/${client.id}/employees`;
            const method = editingId != null ? 'PUT' : 'POST';
            const payload = { ...draft, clientId: client.id };
            const res = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                setEmpMessage(editingId != null ? 'Employee updated' : 'Employee created');
                setEditingId(null);
                setAdding(false);
                setDraft({ ...emptyEmployee });
                await fetchEmployees();
                await handleSyncCsv();
            } else {
                const d = await res.json().catch(() => ({}));
                setEmpError(d.message || 'Save failed');
            }
        } catch {
            setEmpError('Network error saving employee');
        } finally {
            setSaving(false);
        }
    };

    const handleSyncCsv = async () => {
        setSyncing(true);
        try {
            const res = await apiFetch(`/clients/${client.id}/sync-master-csv`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                setMasterUrl(data.fileUrl);
                setEmpMessage((prev) => (prev ? `${prev} · Master CSV synced` : 'Master CSV synced'));
            }
        } catch {
            setEmpError('Failed to sync master CSV');
        } finally {
            setSyncing(false);
        }
    };

    const handleDeleteEmployee = async (id: number) => {
        if (!window.confirm('Delete this employee?')) return;
        try {
            const res = await apiFetch(`/clients/${client.id}/employees/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setEmpMessage('Employee deleted');
                await fetchEmployees();
                await handleSyncCsv();
            }
        } catch {
            setEmpError('Delete failed');
        }
    };

    const startEdit = (emp: Employee) => {
        setEditingId(emp.id);
        setAdding(false);
        setDraft({ ...emp });
    };

    const startAdd = () => {
        setAdding(true);
        setEditingId(null);
        setDraft({ ...emptyEmployee });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setAdding(false);
        setDraft({ ...emptyEmployee });
        setEmpError(null);
    };

    const updateDraft = (field: keyof Employee, value: any) => {
        setDraft((prev) => ({ ...prev, [field]: value }));
    };

    const isEditing = editingId != null || adding;
    const displayEmployees = adding ? [...employees, draft as Employee] : employees;

    const headers = [
        'Payroll #', 'Name', 'KRA PIN', 'ID Number', 'NSSF', 'SHA', 'Phone', 'Email',
        'Bank', 'Account', 'Code', 'Dept', 'Job Title', 'Type', 'Status', 'Joined',
        'Identity', 'Residential', 'Emp Type', 'PWD', 'Exempt Cert',
        'Basic Pay', 'Car', 'Meals', 'Non-Cash', 'Housing Type', 'Housing', 'Other',
        'Other Pension', 'PRMF', 'Mortgage', 'Insurance Relief', 'Bonus',
        'Gross Pay', 'SHA Ded', 'NSSF Ded', 'AHL', 'Taxable', 'Relief', 'PAYE', 'Self-Assessed',
    ];

    const headerKeys = [
        'payrollNumber', 'employeeName', 'kraPin', 'idNumber', 'nssfNo', 'shaNo',
        'phone', 'email', 'bankName', 'bankAccount', 'bankCode', 'department',
        'jobTitle', 'employmentType', 'employmentStatus', 'dateJoined',
        'identityType', 'residentialStatus', 'typeOfEmployee', 'pwd', 'exemptionCert',
        'basicPay', 'carBenefit', 'mealsBenefit', 'nonCashBenefits', 'typeOfHousing',
        'housingBenefit', 'otherBenefits', 'otherPension', 'postRetMedical',
        'mortgageInterest', 'insuranceRelief', 'bonusPay',
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900">Payroll Pipeline</h2>
                        <p className="text-sm text-slate-500">{client.name}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={scrollToEmployees}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                    >
                        <Users className="h-4 w-4" /> Employee Master
                    </button>
                    <button
                        onClick={handleNewRun}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#ff0613] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#d80000]"
                    >
                        <Plus className="h-4 w-4" /> New Payroll Run
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <KpiHeroCards data={kpiData} />

            {/* Active Run */}
            {runsLoading ? (
                <div className="rounded-xl border border-slate-200 bg-white p-5 animate-pulse">
                    <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-lg bg-slate-200" />
                        <div className="space-y-2 flex-1">
                            <div className="h-4 w-32 rounded bg-slate-200" />
                            <div className="h-3 w-48 rounded bg-slate-200" />
                        </div>
                        <div className="h-9 w-24 rounded-lg bg-slate-200" />
                    </div>
                </div>
            ) : (
                (() => {
                    const activeRuns = runs.filter((r) => !r.lockedAt);
                    const mostRecent = activeRuns.sort(
                        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    )[0];
                    return mostRecent ? (
                        <ActiveRunCard
                            clientId={String(client.id)}
                            run={mostRecent}
                            onDelete={handleDeleteRun}
                        />
                    ) : (
                        <NoActiveRun onNewRun={handleNewRun} />
                    );
                })()
            )}

            {/* Error */}
            {runsError && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {runsError}
                </div>
            )}

            {/* Run History */}
            <div className="rounded-xl border border-slate-200 bg-white">
                <div className="px-4 py-4 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                        Payroll Run History
                    </h3>
                </div>
                <div className="p-2">
                    {runsLoading ? (
                        <div className="space-y-3 p-4">
                            <div className="h-8 w-full rounded bg-slate-200 animate-pulse" />
                            <div className="h-8 w-full rounded bg-slate-200 animate-pulse" />
                            <div className="h-8 w-full rounded bg-slate-200 animate-pulse" />
                            <div className="h-8 w-full rounded bg-slate-200 animate-pulse" />
                        </div>
                    ) : (
                        <RunHistoryTable
                            runs={runs}
                            onViewRun={handleViewRun}
                            onDeleteRun={handleDeleteRun}
                            onRollbackRun={handleRollbackRun}
                            onNewRun={handleNewRun}
                        />
                    )}
                </div>
            </div>

            {/* ── Employee Master Section ── */}
            <div ref={employeeSectionRef} className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-slate-400" />
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                            Employee Master
                        </h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {masterUrl && (
                            <a
                                href={masterUrl}
                                download
                                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                            >
                                <Download className="h-3.5 w-3.5" /> Master CSV
                            </a>
                        )}
                        <button
                            onClick={handleSyncCsv}
                            disabled={syncing}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                        >
                            {syncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            Sync CSV
                        </button>
                        {!isEditing && (
                            <button
                                onClick={startAdd}
                                className="inline-flex items-center gap-2 rounded-xl bg-[#ff0613] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#d80000]"
                            >
                                <Plus className="h-3.5 w-3.5" /> Add Employee
                            </button>
                        )}
                    </div>
                </div>

                {/* Employee Messages */}
                {empMessage && (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" /> {empMessage}
                        <button onClick={() => setEmpMessage(null)} className="ml-auto rounded p-1 hover:bg-emerald-100"><XCircle className="h-3.5 w-3.5" /></button>
                    </div>
                )}
                {empError && (
                    <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        <XCircle className="h-4 w-4" /> {empError}
                        <button onClick={() => setEmpError(null)} className="ml-auto rounded p-1 hover:bg-red-100"><XCircle className="h-3.5 w-3.5" /></button>
                    </div>
                )}

                {/* Employee Table */}
                <div className="rounded-xl border border-slate-200 bg-white">
                    <div className="overflow-x-auto">
                        <table className="w-full text-[10px]">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50 text-left font-semibold text-slate-600 uppercase tracking-wider">
                                    <th className="px-2 py-2">Actions</th>
                                    {headers.map((h) => (
                                        <th key={h} className="px-2 py-2 whitespace-nowrap">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {empLoading ? (
                                    <tr><td colSpan={headers.length + 1} className="py-8 text-center text-slate-400">Loading...</td></tr>
                                ) : displayEmployees.length === 0 ? (
                                    <tr><td colSpan={headers.length + 1} className="py-8 text-center text-slate-400">No employees.</td></tr>
                                ) : (
                                    displayEmployees.map((emp, idx) => {
                                        const isRowEditing = (editingId === emp.id) || (adding && idx === employees.length);
                                        const computed = computeRow(emp);
                                        return (
                                            <tr key={emp.id || `new-${idx}`} className={cn('transition', isRowEditing ? 'bg-amber-50/30' : 'hover:bg-slate-50/50')}>
                                                <td className="px-2 py-1.5">
                                                    <div className="flex items-center gap-1">
                                                        {isRowEditing ? (
                                                            <>
                                                                <button onClick={handleSaveEmployee} disabled={saving} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 transition"><Save className="h-3.5 w-3.5" /></button>
                                                                <button onClick={cancelEdit} className="rounded p-1 text-slate-500 hover:bg-slate-100 transition"><XCircle className="h-3.5 w-3.5" /></button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button onClick={() => startEdit(emp)} className="rounded p-1 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition"><Pencil className="h-3.5 w-3.5" /></button>
                                                                <button onClick={() => emp.id && handleDeleteEmployee(emp.id)} className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 transition"><Trash2 className="h-3.5 w-3.5" /></button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                                {headerKeys.map((key) => {
                                                    const val = (emp as any)[key];
                                                    if (isRowEditing) {
                                                        const options = dropdownOptions[key];
                                                        if (options) {
                                                            return (
                                                                <td key={key} className="px-1 py-1">
                                                                    <select
                                                                        value={(draft as any)[key] ?? ''}
                                                                        onChange={(e) => updateDraft(key as keyof Employee, e.target.value)}
                                                                        className="w-20 rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
                                                                    >
                                                                        {options.map((o) => <option key={o} value={o}>{o}</option>)}
                                                                    </select>
                                                                </td>
                                                            );
                                                        }
                                                        if (typeof val === 'number') {
                                                            return (
                                                                <td key={key} className="px-1 py-1">
                                                                    <input
                                                                        type="number"
                                                                        value={(draft as any)[key] ?? 0}
                                                                        onChange={(e) => updateDraft(key as keyof Employee, parseFloat(e.target.value) || 0)}
                                                                        className="w-16 rounded border border-slate-200 bg-white px-1 py-0.5 text-right text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
                                                                    />
                                                                </td>
                                                            );
                                                        }
                                                        return (
                                                            <td key={key} className="px-1 py-1">
                                                                <input
                                                                    type="text"
                                                                    value={(draft as any)[key] ?? ''}
                                                                    onChange={(e) => updateDraft(key as keyof Employee, e.target.value)}
                                                                    className="w-20 rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
                                                                />
                                                            </td>
                                                        );
                                                    }
                                                    return (
                                                        <td key={key} className={cn('px-2 py-1.5 whitespace-nowrap text-slate-900', typeof val === 'number' ? 'text-right font-mono' : '')}>
                                                            {typeof val === 'number' ? val.toLocaleString() : (val || '')}
                                                        </td>
                                                    );
                                                })}
                                                {/* Computed columns */}
                                                <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-900">{computed.grossSalary.toLocaleString()}</td>
                                                <td className="px-2 py-1.5 text-right font-mono text-slate-700">{computed.shaContribution.toFixed(2)}</td>
                                                <td className="px-2 py-1.5 text-right font-mono text-slate-700">{computed.nssfContribution.toFixed(2)}</td>
                                                <td className="px-2 py-1.5 text-right font-mono text-slate-700">{computed.ahl.toFixed(2)}</td>
                                                <td className="px-2 py-1.5 text-right font-mono text-slate-700">{computed.taxablePay.toFixed(2)}</td>
                                                <td className="px-2 py-1.5 text-right font-mono text-slate-700">{computed.personalRelief.toFixed(2)}</td>
                                                <td className="px-2 py-1.5 text-right font-mono text-slate-700">{computed.paye.toFixed(2)}</td>
                                                <td className="px-2 py-1.5 text-right font-mono text-slate-700">{computed.selfAssessedPaye.toFixed(2)}</td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Loans & Leaves */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                    <LoanManager clientId={String(client.id)} />
                    <LeaveManager clientId={String(client.id)} />
                </div>
            </div>
        </div>
    );
}
