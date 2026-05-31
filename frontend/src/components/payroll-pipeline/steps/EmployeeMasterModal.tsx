import { useState, useEffect, useCallback, Fragment } from 'react';
import {
    X, FileSpreadsheet, ChevronDown, ChevronRight, Pencil, Trash2, Plus,
    Building2, Calendar, CheckCircle2, XCircle
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';

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
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    housingBenefit: number;
    otherBenefits: number;
    bonusPay: number;
    insuranceRelief: number;
    otherPension: number;
    postRetMedical: number;
    mortgageInterest: number;
}

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

interface LeaveRequest {
    id: number;
    employeeId: number;
    employeeName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    startTime?: string | null;
    endTime?: string | null;
    daysCount: number;
    hours: number;
    reason: string;
    status: 'Pending' | 'Approved' | 'Rejected';
    isPaid: number;
}

interface EmployeeMasterModalProps {
    clientId: string;
    open: boolean;
    onClose: () => void;
}

const emptyLoanForm = {
    employeeId: '', employeeName: '', kraPin: '', loanType: 'Salary Advance',
    principal: 0, monthlyDeduction: 0, installments: 1, remainingInstallments: 1,
    interestRate: 0, totalInterest: 0, totalRepayable: 0, amountPaid: 0,
    status: 'Approved', disbursedAt: '', notes: '',
};

export function EmployeeMasterModal({ clientId, open, onClose }: EmployeeMasterModalProps) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loans, setLoans] = useState<Loan[]>([]);
    const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedEmployee, setExpandedEmployee] = useState<number | null>(null);
    const [search, setSearch] = useState('');

    // Loan modal state
    const [showLoanModal, setShowLoanModal] = useState(false);
    const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
    const [loanForm, setLoanForm] = useState<any>({ ...emptyLoanForm });
    const [loanMessage, setLoanMessage] = useState<string | null>(null);

    // Leave modal state
    const [showLeaveModal, setShowLeaveModal] = useState(false);
    const [editingLeaveId, setEditingLeaveId] = useState<number | null>(null);
    const [leaveForm, setLeaveForm] = useState({
        employeeId: '', leaveType: '', startDate: '', endDate: '',
        startTime: '', endTime: '', daysCount: '1', hours: '', reason: '', isPaid: true,
    });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [empRes, loanRes, leaveRes] = await Promise.all([
                apiFetch(`/clients/${clientId}/employees`),
                apiFetch(`/clients/${clientId}/loans`),
                apiFetch(`/clients/${clientId}/leave`),
            ]);
            if (empRes.ok) setEmployees(await empRes.json());
            if (loanRes.ok) setLoans(await loanRes.json());
            if (leaveRes.ok) setLeaves(await leaveRes.json());
        } catch {
            /* ignore */
        } finally {
            setLoading(false);
        }
    }, [clientId]);

    useEffect(() => {
        if (open) fetchData();
    }, [open, fetchData]);

    const filteredEmployees = employees.filter((e) =>
        e.employeeName.toLowerCase().includes(search.toLowerCase()) ||
        e.kraPin.toLowerCase().includes(search.toLowerCase()) ||
        e.payrollNumber.toLowerCase().includes(search.toLowerCase())
    );

    const getEmployeeLoans = (empId: number) => loans.filter((l) => l.employeeId === empId);
    const getEmployeeLeaves = (empId: number) => leaves.filter((l) => l.employeeId === empId);

    // ─── Loan CRUD ───
    const openLoanModal = (rec?: Loan, emp?: Employee) => {
        if (rec) {
            setEditingLoan(rec);
            setLoanForm({
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
        } else if (emp) {
            setEditingLoan(null);
            setLoanForm({
                ...emptyLoanForm,
                employeeId: String(emp.id),
                employeeName: emp.employeeName,
                kraPin: emp.kraPin,
            });
        } else {
            setEditingLoan(null);
            setLoanForm({ ...emptyLoanForm });
        }
        setShowLoanModal(true);
        setLoanMessage(null);
    };

    const handleSaveLoan = async () => {
        try {
            const payload = {
                ...loanForm,
                totalRepayable: (parseFloat(loanForm.principal) || 0) + (parseFloat(loanForm.totalInterest) || 0),
            };
            const url = editingLoan
                ? `/clients/${clientId}/loans/${editingLoan.id}`
                : `/clients/${clientId}/loans`;
            const method = editingLoan ? 'PUT' : 'POST';
            const res = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                setLoanMessage(editingLoan ? 'Loan updated' : 'Loan created');
                setShowLoanModal(false);
                setEditingLoan(null);
                const loanRes = await apiFetch(`/clients/${clientId}/loans`);
                if (loanRes.ok) setLoans(await loanRes.json());
            }
        } catch {
            setLoanMessage('Save failed');
        }
    };

    const handleDeleteLoan = async (id: number) => {
        if (!window.confirm('Delete this loan record?')) return;
        try {
            const res = await apiFetch(`/clients/${clientId}/loans/${id}`, { method: 'DELETE' });
            if (res.ok) {
                const loanRes = await apiFetch(`/clients/${clientId}/loans`);
                if (loanRes.ok) setLoans(await loanRes.json());
            }
        } catch { /* ignore */ }
    };

    // ─── Leave CRUD ───
    const openLeaveModal = (rec?: LeaveRequest, emp?: Employee) => {
        if (rec) {
            setEditingLeaveId(rec.id);
            setLeaveForm({
                employeeId: String(rec.employeeId),
                leaveType: rec.leaveType,
                startDate: rec.startDate,
                endDate: rec.endDate,
                startTime: rec.startTime || '',
                endTime: rec.endTime || '',
                daysCount: String(rec.daysCount || 1),
                hours: rec.hours ? String(rec.hours) : '',
                reason: rec.reason || '',
                isPaid: rec.isPaid === 1,
            });
        } else if (emp) {
            setEditingLeaveId(null);
            setLeaveForm({
                employeeId: String(emp.id), leaveType: '', startDate: '', endDate: '',
                startTime: '', endTime: '', daysCount: '1', hours: '', reason: '', isPaid: true,
            });
        } else {
            setEditingLeaveId(null);
            setLeaveForm({
                employeeId: '', leaveType: '', startDate: '', endDate: '',
                startTime: '', endTime: '', daysCount: '1', hours: '', reason: '', isPaid: true,
            });
        }
        setShowLeaveModal(true);
    };

    const handleSaveLeave = async () => {
        try {
            const payload = {
                employeeId: parseInt(leaveForm.employeeId, 10),
                leaveType: leaveForm.leaveType,
                startDate: leaveForm.startDate,
                endDate: leaveForm.endDate,
                startTime: leaveForm.startTime || null,
                endTime: leaveForm.endTime || null,
                daysCount: parseInt(leaveForm.daysCount, 10) || 1,
                hours: leaveForm.hours ? parseFloat(leaveForm.hours) : 0,
                reason: leaveForm.reason,
                isPaid: leaveForm.isPaid ? 1 : 0,
                status: editingLeaveId ? undefined : 'Pending',
            };
            const url = editingLeaveId
                ? `/clients/${clientId}/leave/${editingLeaveId}`
                : `/clients/${clientId}/leave`;
            const method = editingLeaveId ? 'PUT' : 'POST';
            const res = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                setShowLeaveModal(false);
                setEditingLeaveId(null);
                const leaveRes = await apiFetch(`/clients/${clientId}/leave`);
                if (leaveRes.ok) setLeaves(await leaveRes.json());
            }
        } catch { /* ignore */ }
    };

    const handleDeleteLeave = async (id: number) => {
        if (!window.confirm('Delete this leave request?')) return;
        try {
            const res = await apiFetch(`/clients/${clientId}/leave/${id}`, { method: 'DELETE' });
            if (res.ok) {
                const leaveRes = await apiFetch(`/clients/${clientId}/leave`);
                if (leaveRes.ok) setLeaves(await leaveRes.json());
            }
        } catch { /* ignore */ }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-4">
            <div className="w-full max-w-7xl rounded-xl border border-slate-200 bg-white shadow-2xl my-4">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                    <div className="flex items-center gap-3">
                        <FileSpreadsheet className="h-5 w-5 text-slate-500" />
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Employee Master</h3>
                        <span className="text-xs text-slate-400">{filteredEmployees.length} employees</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search employee, PIN, payroll #..."
                            className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                <th className="px-3 py-2.5 w-8" />
                                <th className="px-3 py-2.5">Payroll #</th>
                                <th className="px-3 py-2.5">Name</th>
                                <th className="px-3 py-2.5">KRA PIN</th>
                                <th className="px-3 py-2.5">ID Number</th>
                                <th className="px-3 py-2.5">NSSF</th>
                                <th className="px-3 py-2.5">SHA</th>
                                <th className="px-3 py-2.5">Phone</th>
                                <th className="px-3 py-2.5">Email</th>
                                <th className="px-3 py-2.5">Bank</th>
                                <th className="px-3 py-2.5">Account</th>
                                <th className="px-3 py-2.5">Dept</th>
                                <th className="px-3 py-2.5">Job Title</th>
                                <th className="px-3 py-2.5">Type</th>
                                <th className="px-3 py-2.5">Status</th>
                                <th className="px-3 py-2.5">Joined</th>
                                <th className="px-3 py-2.5 text-right">Basic Pay</th>
                                <th className="px-3 py-2.5 text-right">Hourly Rate</th>
                                <th className="px-3 py-2.5">Structure</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {loading ? (
                                <tr><td colSpan={19} className="py-8 text-center text-slate-400">Loading...</td></tr>
                            ) : filteredEmployees.length === 0 ? (
                                <tr><td colSpan={19} className="py-8 text-center text-slate-400">No employees found.</td></tr>
                            ) : (
                                filteredEmployees.map((emp) => {
                                    const isExpanded = expandedEmployee === emp.id;
                                    const empLoans = getEmployeeLoans(emp.id);
                                    const empLeaves = getEmployeeLeaves(emp.id);
                                    return (
                                        <Fragment key={emp.id}>
                                            <tr
                                                className={cn('transition cursor-pointer', isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/50')}
                                                onClick={() => setExpandedEmployee(isExpanded ? null : emp.id)}
                                            >
                                                <td className="px-3 py-2">
                                                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                                                </td>
                                                <td className="px-3 py-2 font-mono text-slate-700">{emp.payrollNumber}</td>
                                                <td className="px-3 py-2 font-medium text-slate-900">{emp.employeeName}</td>
                                                <td className="px-3 py-2 font-mono text-slate-700">{emp.kraPin}</td>
                                                <td className="px-3 py-2 font-mono text-slate-700">{emp.idNumber}</td>
                                                <td className="px-3 py-2 font-mono text-slate-700">{emp.nssfNo}</td>
                                                <td className="px-3 py-2 font-mono text-slate-700">{emp.shaNo}</td>
                                                <td className="px-3 py-2 text-slate-600">{emp.phone}</td>
                                                <td className="px-3 py-2 text-slate-600">{emp.email}</td>
                                                <td className="px-3 py-2 text-slate-600">{emp.bankName}</td>
                                                <td className="px-3 py-2 font-mono text-slate-700">{emp.bankAccount}</td>
                                                <td className="px-3 py-2 text-slate-600">{emp.department}</td>
                                                <td className="px-3 py-2 text-slate-600">{emp.jobTitle}</td>
                                                <td className="px-3 py-2 text-slate-600">{emp.employmentType}</td>
                                                <td className="px-3 py-2">
                                                    <span className={cn(
                                                        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold',
                                                        emp.employmentStatus === 'Active' ? 'bg-emerald-50 text-emerald-700' :
                                                        emp.employmentStatus === 'Terminated' ? 'bg-rose-50 text-rose-700' :
                                                        'bg-amber-50 text-amber-700'
                                                    )}>{emp.employmentStatus}</span>
                                                </td>
                                                <td className="px-3 py-2 text-slate-600">{emp.dateJoined}</td>
                                                <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{emp.basicPay?.toLocaleString()}</td>
                                                <td className="px-3 py-2 text-right font-mono text-slate-700">{emp.hourlyRate?.toFixed(4)}</td>
                                                <td className="px-3 py-2 text-slate-600">{emp.payStructure}</td>
                                            </tr>
                                            {isExpanded && (
                                                <tr className="bg-slate-50/50">
                                                    <td colSpan={19} className="px-3 py-4">
                                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                            {/* Loans */}
                                                            <div className="space-y-3">
                                                                <div className="flex items-center justify-between">
                                                                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                                                                        <Building2 className="h-3.5 w-3.5 text-slate-500" /> Loans ({empLoans.length})
                                                                    </h4>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); openLoanModal(undefined, emp); }}
                                                                        className="inline-flex items-center gap-1 rounded-lg bg-[#ff0613] px-2 py-1 text-[10px] font-bold text-white hover:bg-[#d80000] transition"
                                                                    >
                                                                        <Plus className="h-3 w-3" /> Add Loan
                                                                    </button>
                                                                </div>
                                                                {empLoans.length === 0 ? (
                                                                    <p className="text-xs text-slate-400">No loans.</p>
                                                                ) : (
                                                                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                                                                        <table className="w-full text-[10px]">
                                                                            <thead>
                                                                                <tr className="border-b border-slate-100 bg-slate-50 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                                                                    <th className="px-2 py-1.5">Type</th>
                                                                                    <th className="px-2 py-1.5 text-right">Principal</th>
                                                                                    <th className="px-2 py-1.5 text-right">Monthly</th>
                                                                                    <th className="px-2 py-1.5">Rem</th>
                                                                                    <th className="px-2 py-1.5">Status</th>
                                                                                    <th className="px-2 py-1.5 text-right">Actions</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-slate-50">
                                                                                {empLoans.map((ln) => (
                                                                                    <tr
                                                                                        key={ln.id}
                                                                                        className="hover:bg-slate-50 cursor-pointer"
                                                                                        onClick={(e) => { e.stopPropagation(); openLoanModal(ln); }}
                                                                                    >
                                                                                        <td className="px-2 py-1.5 font-medium text-slate-900">{ln.loanType}</td>
                                                                                        <td className="px-2 py-1.5 text-right font-mono">{ln.principal?.toLocaleString()}</td>
                                                                                        <td className="px-2 py-1.5 text-right font-mono">{ln.monthlyDeduction?.toLocaleString()}</td>
                                                                                        <td className="px-2 py-1.5">{ln.remainingInstallments}/{ln.installments}</td>
                                                                                        <td className="px-2 py-1.5">
                                                                                            <span className={cn(
                                                                                                'inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                                                                                                ln.status === 'Approved' || ln.status === 'Active' ? 'bg-emerald-50 text-emerald-600' :
                                                                                                ln.status === 'Paid' ? 'bg-blue-50 text-blue-600' :
                                                                                                'bg-red-50 text-red-600'
                                                                                            )}>{ln.status}</span>
                                                                                        </td>
                                                                                        <td className="px-2 py-1.5 text-right">
                                                                                            <div className="flex items-center justify-end gap-1">
                                                                                                <button
                                                                                                    onClick={(e) => { e.stopPropagation(); openLoanModal(ln); }}
                                                                                                    className="rounded p-1 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition"
                                                                                                >
                                                                                                    <Pencil className="h-3 w-3" />
                                                                                                </button>
                                                                                                <button
                                                                                                    onClick={(e) => { e.stopPropagation(); handleDeleteLoan(ln.id); }}
                                                                                                    className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 transition"
                                                                                                >
                                                                                                    <Trash2 className="h-3 w-3" />
                                                                                                </button>
                                                                                            </div>
                                                                                        </td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Leaves */}
                                                            <div className="space-y-3">
                                                                <div className="flex items-center justify-between">
                                                                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                                                                        <Calendar className="h-3.5 w-3.5 text-slate-500" /> Leave ({empLeaves.length})
                                                                    </h4>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); openLeaveModal(undefined, emp); }}
                                                                        className="inline-flex items-center gap-1 rounded-lg bg-[#ff0613] px-2 py-1 text-[10px] font-bold text-white hover:bg-[#d80000] transition"
                                                                    >
                                                                        <Plus className="h-3 w-3" /> Add Leave
                                                                    </button>
                                                                </div>
                                                                {empLeaves.length === 0 ? (
                                                                    <p className="text-xs text-slate-400">No leave requests.</p>
                                                                ) : (
                                                                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                                                                        <table className="w-full text-[10px]">
                                                                            <thead>
                                                                                <tr className="border-b border-slate-100 bg-slate-50 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                                                                    <th className="px-2 py-1.5">Type</th>
                                                                                    <th className="px-2 py-1.5">From</th>
                                                                                    <th className="px-2 py-1.5">To</th>
                                                                                    <th className="px-2 py-1.5">Days</th>
                                                                                    <th className="px-2 py-1.5">Status</th>
                                                                                    <th className="px-2 py-1.5">Paid</th>
                                                                                    <th className="px-2 py-1.5 text-right">Actions</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-slate-50">
                                                                                {empLeaves.map((lv) => (
                                                                                    <tr key={lv.id} className="hover:bg-slate-50">
                                                                                        <td className="px-2 py-1.5 font-medium text-slate-900">{lv.leaveType}</td>
                                                                                        <td className="px-2 py-1.5 text-slate-600">{lv.startDate}</td>
                                                                                        <td className="px-2 py-1.5 text-slate-600">{lv.endDate}</td>
                                                                                        <td className="px-2 py-1.5">{lv.daysCount}</td>
                                                                                        <td className="px-2 py-1.5">
                                                                                            <span className={cn(
                                                                                                'inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                                                                                                lv.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' :
                                                                                                lv.status === 'Rejected' ? 'bg-rose-50 text-rose-700' :
                                                                                                'bg-amber-50 text-amber-700'
                                                                                            )}>{lv.status}</span>
                                                                                        </td>
                                                                                        <td className="px-2 py-1.5">
                                                                                            {lv.isPaid === 1 ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <XCircle className="h-3 w-3 text-rose-600" />}
                                                                                        </td>
                                                                                        <td className="px-2 py-1.5 text-right">
                                                                                            <div className="flex items-center justify-end gap-1">
                                                                                                <button
                                                                                                    onClick={(e) => { e.stopPropagation(); openLeaveModal(lv); }}
                                                                                                    className="rounded p-1 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition"
                                                                                                >
                                                                                                    <Pencil className="h-3 w-3" />
                                                                                                </button>
                                                                                                <button
                                                                                                    onClick={(e) => { e.stopPropagation(); handleDeleteLeave(lv.id); }}
                                                                                                    className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 transition"
                                                                                                >
                                                                                                    <Trash2 className="h-3 w-3" />
                                                                                                </button>
                                                                                            </div>
                                                                                        </td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Loan Modal */}
            {showLoanModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                            <h3 className="text-sm font-bold text-slate-900">{editingLoan ? 'Edit Loan' : 'Add Loan'}</h3>
                            <button onClick={() => setShowLoanModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition"><X className="h-4 w-4" /></button>
                        </div>
                        <div className="px-6 py-4 space-y-3">
                            {loanMessage && <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">{loanMessage}</div>}
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Employee</label>
                                <input type="text" value={loanForm.employeeName} disabled className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Loan Type</label><select value={loanForm.loanType} onChange={e => setLoanForm((f: any) => ({ ...f, loanType: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><option>Salary Advance</option><option>Emergency Loan</option><option>Normal Loan</option><option>Other</option></select></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Principal</label><input type="number" value={loanForm.principal} onChange={e => setLoanForm((f: any) => ({ ...f, principal: parseFloat(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Monthly Deduction</label><input type="number" value={loanForm.monthlyDeduction} onChange={e => setLoanForm((f: any) => ({ ...f, monthlyDeduction: parseFloat(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Installments</label><input type="number" value={loanForm.installments} onChange={e => setLoanForm((f: any) => ({ ...f, installments: parseInt(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Remaining</label><input type="number" value={loanForm.remainingInstallments} onChange={e => setLoanForm((f: any) => ({ ...f, remainingInstallments: parseInt(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Interest Rate (%)</label><input type="number" value={loanForm.interestRate} onChange={e => setLoanForm((f: any) => ({ ...f, interestRate: parseFloat(e.target.value) || 0 }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                            </div>
                            <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Notes</label><textarea value={loanForm.notes} onChange={e => setLoanForm((f: any) => ({ ...f, notes: e.target.value }))} rows={3} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
                            <button onClick={() => setShowLoanModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                            <button onClick={handleSaveLoan} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">{editingLoan ? 'Update' : 'Create'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Leave Modal */}
            {showLeaveModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                            <h3 className="text-sm font-bold text-slate-900">{editingLeaveId ? 'Edit Leave' : 'Add Leave'}</h3>
                            <button onClick={() => setShowLeaveModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition"><X className="h-4 w-4" /></button>
                        </div>
                        <div className="px-5 py-4 space-y-3">
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Employee</label>
                                <input type="text" value={employees.find(e => String(e.id) === leaveForm.employeeId)?.employeeName || ''} disabled className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Leave Type</label><input type="text" value={leaveForm.leaveType} onChange={e => setLeaveForm(f => ({ ...f, leaveType: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Days</label><input type="number" value={leaveForm.daysCount} onChange={e => setLeaveForm(f => ({ ...f, daysCount: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Start Date</label><input type="date" value={leaveForm.startDate} onChange={e => setLeaveForm(f => ({ ...f, startDate: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">End Date</label><input type="date" value={leaveForm.endDate} onChange={e => setLeaveForm(f => ({ ...f, endDate: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Start Time</label><input type="time" value={leaveForm.startTime} onChange={e => setLeaveForm(f => ({ ...f, startTime: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                                <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">End Time</label><input type="time" value={leaveForm.endTime} onChange={e => setLeaveForm(f => ({ ...f, endTime: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                            </div>
                            <div><label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Reason</label><input type="text" value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" /></div>
                            <div className="flex items-center gap-2">
                                <input type="checkbox" id="isPaid" checked={leaveForm.isPaid} onChange={e => setLeaveForm(f => ({ ...f, isPaid: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                                <label htmlFor="isPaid" className="text-xs text-slate-700">Paid leave</label>
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
                            <button onClick={() => setShowLeaveModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                            <button onClick={handleSaveLeave} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">{editingLeaveId ? 'Update' : 'Create'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
