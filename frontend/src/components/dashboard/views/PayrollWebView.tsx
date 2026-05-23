import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, Calendar, Download, Save, Plus, Trash2, RefreshCw, AlertCircle, FileSpreadsheet, Cloud, X, Users, Pencil, FileText, Banknote, CalendarCheck, BarChart3, DollarSign, Briefcase, TrendingUp, Mail, Globe, LogIn, User, FolderOpen, Upload } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { ClientObligation } from '../../../types';
import { apiFetch } from '../../../services/api';
import helbLogo from '../../../../assests/HELB.png';
import { DepartmentsView } from './DepartmentsView';
import { AuditView } from './AuditView';
import { getCurrentFilingPeriod, isPastDeadline } from '../../../utils/taxPeriods';

const STANDARD_HEADERS = [
  'Payroll Number', 'PIN of Employee', 'ID Number', 'Identity Type', 'Name of Employee',
  'SHA No', 'NSSF No', 'Residential Status', 'Type of Employee', 'Persons with Disability(PWD)',
  'Exemption Certificate', 'Total Cash Pay (A)', 'Value of Car Benefit (B)', 'Value of Meals (C)',
  'Non Cash Benefits (D)', 'Type of Housing', 'Housing Benefit (F)', 'Other Benefits (G)',
  'Total Gross Pay (Ksh) (H)', 'Social Health Insurance Fund (I)', 'NSSF Contribution (J)',
  'Other Pension Contribution (K)', 'Post Retirement Medical Fund (L)', 'Mortgage Interest (M)',
  'Affordable Housing Levy (N)', 'Taxable Pay(Ksh) (O)', 'Monthly Personal Relief (Ksh) (P)',
  'Amount of Insurance Relief (Q)', 'PAYE Tax (Ksh) (R)', 'Self Assessed PAYE Tax (Ksh) (S)',
];

const COMPUTED_COLUMNS = new Set([
  'Total Gross Pay (Ksh) (H)', 'Social Health Insurance Fund (I)', 'NSSF Contribution (J)',
  'Affordable Housing Levy (N)', 'Taxable Pay(Ksh) (O)', 'Monthly Personal Relief (Ksh) (P)',
  'PAYE Tax (Ksh) (R)', 'Self Assessed PAYE Tax (Ksh) (S)',
]);

const PAYE_COLUMNS = [
  'KRA PIN', 'Full Name', 'Residential Status', 'Employee Type', 'PWD',
  'Exemption Cert', 'Total Cash Pay', 'Car Benefit', 'Meals', 'Non Cash',
  'Housing Type', 'Housing Benefit', 'Gross Salary', 'SHA', 'NSSF',
  'Other Pension', 'Post Ret Medical', 'Mortgage', 'AHL', 'Taxable Pay',
  'Personal Relief', 'Insurance Relief', 'PAYE Tax', 'Self Assessed PAYE',
  'Emp Code', 'Res Code',
];

const NSSF_COLUMNS = [
  'Payroll No', 'Last Name', 'First Name', 'ID No', 'KRA PIN', 'NSSF No',
  'Type', 'Gross', 'Income Type', 'Member', 'Employer', 'Total',
];

const SHA_COLUMNS = [
  'Payroll No', 'First Name', 'Last Name', 'Identity Type',
  'ID No', 'KRA PIN', 'SHA No', 'Contribution', 'Phone',
];

type PayrollEmployee = Record<string, string | number>;

type PayloadPreamble = {
  companyName: string;
  companyPin: string;
  companyNssf: string;
  companyNssfPassword: string;
  companyShaLogin: string;
  companyShaPassword: string;
};

type TabId = 'master' | 'paye' | 'nssf' | 'sha' | 'helb' | 'time' | 'loans' | 'reports' | 'email' | 'portal' | 'runs' | 'p10p11' | 'departments' | 'audit';

const TABS: { id: TabId; label: string; img?: string }[] = [
  { id: 'master', label: 'Payroll Data' },
  { id: 'time', label: 'Time & Attendance' },
  { id: 'loans', label: 'Loans' },
  { id: 'reports', label: 'Reports & KPIs' },
  { id: 'email', label: 'Email' },
  { id: 'paye', label: 'PAYE', img: '/logos/kra.png' },
  { id: 'nssf', label: 'NSSF', img: '/logos/nssflogo.png' },
  { id: 'sha', label: 'SHA', img: '/logos/shalogo.png' },
  { id: 'helb', label: 'HELB', img: helbLogo },
  { id: 'portal', label: 'Portal' },
  { id: 'runs', label: 'Payroll Runs' },
  { id: 'p10p11', label: 'P10/P11' },
  { id: 'departments', label: 'Departments' },
  { id: 'audit', label: 'Audit Trail' },
];

function KpiCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 flex items-start gap-2">
      <div className={`rounded-lg p-2 ${color || 'bg-slate-100'}`}>
        <Icon className={`h-4 w-4 ${color ? 'text-white' : 'text-slate-600'}`} />
      </div>
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-base font-bold text-slate-900">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        {sub && <p className="text-[9px] text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}

function createEmptyEmployee(index: number): PayrollEmployee {
  const emp: PayrollEmployee = {};
  STANDARD_HEADERS.forEach((h, i) => {
    if (i === 0) emp[h] = String(index);
    else if (i === 3) emp[h] = 'National ID';
    else if (i === 7) emp[h] = 'Resident';
    else if (i === 8) emp[h] = 'Primary Employee';
    else if (i === 9) emp[h] = 'No';
    else if (i === 10) emp[h] = '0';
    else if (i === 15) emp[h] = 'Benefit not given';
    else if (i >= 11 && i <= 17) emp[h] = '0';
    else if (i >= 21 && i <= 23) emp[h] = '0';
    else if (i === 27) emp[h] = '0';
    else emp[h] = '';
  });
  emp['Std Check-In'] = '08:00';
  emp['Std Check-Out'] = '17:00';
  return emp;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';
  return { firstName, lastName };
}

interface PayrollWebViewProps {
  client: ClientObligation;
  onBack: () => void;
  onEditClient?: () => void;
  onUploadMasterCsv?: (clientId: string, file: File) => Promise<void>;
  onRemoveMasterCsv?: (clientId: string) => Promise<void>;
  onGeneratePayrollPacks?: (client: ClientObligation) => void;
  onAutoFilePaye?: (client: ClientObligation) => void;
  onAutoFileNssf?: (client: ClientObligation) => void;
  onGenerateCompliance?: (client: ClientObligation, result: any) => void;
  clients?: ClientObligation[];
  onClientChange?: (client: ClientObligation) => void;
}

export function PayrollWebView({ client, onBack, onEditClient, onUploadMasterCsv, onRemoveMasterCsv, onGeneratePayrollPacks, onAutoFilePaye, onAutoFileNssf, onGenerateCompliance, clients, onClientChange }: PayrollWebViewProps) {
  const [preamble, setPreamble] = useState<PayloadPreamble | null>(null);
  const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);
  const [uploadingMasterCsv, setUploadingMasterCsv] = useState(false);
  const [generatingPacks, setGeneratingPacks] = useState(false);
  const [filingPaye, setFilingPaye] = useState(false);
  const [filingNssf, setFilingNssf] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('master');
  const [importingEmployees, setImportingEmployees] = useState(false);
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any>(null);
  const [employeeForm, setEmployeeForm] = useState<any>({
    payrollNumber: '', employeeName: '', idNumber: '', kraPin: '',
    nssfNo: '', shaNo: '', phone: '', email: '', bankName: '',
    bankAccount: '', bankCode: '', department: '', jobTitle: '',
    employmentType: 'Permanent', employmentStatus: 'Active',
    dateJoined: '', dateLeft: '', basicPay: 0, bonusPay: 0,
    role: 'employee', departmentId: null, standardCheckOut: '17:00',
    standardCheckIn: '08:00', portalPassword: '', workScheduleId: '',
    offDay: '',
  });

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [editingLeave, setEditingLeave] = useState<any>(null);
  const [leaveForm, setLeaveForm] = useState<any>({
    employeeId: '', employeeName: '', kraPin: '', leaveType: 'Annual',
    startDate: '', endDate: '', daysCount: 1, reason: '', status: 'Pending',
    isPaid: true,
  });
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [workSchedules, setWorkSchedules] = useState<any[]>([]);

  const [loanRecords, setLoanRecords] = useState<any[]>([]);
  const [loadingLoans, setLoadingLoans] = useState(false);
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [editingLoan, setEditingLoan] = useState<any>(null);
  const [loanForm, setLoanForm] = useState<any>({
    employeeId: '', employeeName: '', kraPin: '', loanType: 'Salary Advance',
    principal: 0, monthlyDeduction: 0, installments: 1, remainingInstallments: 1,
    interestRate: 0, totalInterest: 0, totalRepayable: 0, amountPaid: 0,
    status: 'Approved', disbursedAt: '', notes: '',
  });

  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [editingAttendance, setEditingAttendance] = useState<any>(null);
  const [attendanceForm, setAttendanceForm] = useState<any>({
    employeeId: '', employeeName: '', kraPin: '', date: '',
    checkIn: '', checkOut: '', status: 'Present', notes: '',
  });

  const [reportData, setReportData] = useState<any>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [kpiData, setKpiData] = useState<any>(null);
  const [customReportType, setCustomReportType] = useState('payroll-summary');
  const [customReportData, setCustomReportData] = useState<any>(null);
  const [emailHistory, setEmailHistory] = useState<any[]>([]);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailResult, setEmailResult] = useState<any>(null);

  // Employee Portal state
  const [portalToken, setPortalToken] = useState<string | null>(() => localStorage.getItem('portal_token'));
  const [portalEmployee, setPortalEmployee] = useState<any>(null);
  const [portalDashboard, setPortalDashboard] = useState<any>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalSubView, setPortalSubView] = useState<'dashboard' | 'leave' | 'loan'>('dashboard');
  const [portalLoginForm, setPortalLoginForm] = useState({ kraPin: '', password: '' });
  const [portalError, setPortalError] = useState<string | null>(null);
  const [portalLeaveForm, setPortalLeaveForm] = useState({ leaveType: 'Annual', startDate: '', endDate: '', daysCount: 1, reason: '' });
  const [portalEditingLeave, setPortalEditingLeave] = useState<any | null>(null);
  const [portalLoanForm, setPortalLoanForm] = useState({ loanType: 'Salary Advance', principal: 0, installments: 1, interestRate: 0, notes: '' });
  const [portalSubmitting, setPortalSubmitting] = useState(false);
  const [showPortalPasswordModal, setShowPortalPasswordModal] = useState(false);
  const [portalPasswordTarget, _setPortalPasswordTarget] = useState<{ id: number; name: string; kraPin: string } | null>(null);
  const [portalPasswordValue, setPortalPasswordValue] = useState('');
  const [portalDocuments, setPortalDocuments] = useState<any[]>([]);

  // Payroll Runs state
  const [payrollRuns, setPayrollRuns] = useState<any[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [runEntries, setRunEntries] = useState<any[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [newRunPeriod, setNewRunPeriod] = useState(getCurrentFilingPeriod().period);
  const [newRunNotes, setNewRunNotes] = useState('');
  const [generatingRun, setGeneratingRun] = useState(false);
  const [runDetailView, setRunDetailView] = useState<'list' | 'detail'>('list');
  const [savingOvertime, setSavingOvertime] = useState(false);

  // Dynamic adjustments state
  const [runAdjustments, setRunAdjustments] = useState<any[]>([]);
  const [loadingAdjustments, setLoadingAdjustments] = useState(false);
  const [showAdjustmentsForm, setShowAdjustmentsForm] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState({ employeeId: '', label: '', type: 'allowance', amount: 0 });

  // Overtime tab state
  const [attendanceOvertimePeriod, setAttendanceOvertimePeriod] = useState(getCurrentFilingPeriod().period);
  const [attendanceOvertimeEmployees, setAttendanceOvertimeEmployees] = useState<any[]>([]);
  const [timeLeaveRecords, setTimeLeaveRecords] = useState<any[]>([]);
  const [dbEmployees, setDbEmployees] = useState<any[]>([]);

  // Compliance generation state
  const [generatingCompliance, setGeneratingCompliance] = useState(false);
  const [complianceResult, setComplianceResult] = useState<any>(null);

  // Employee Documents modal state
  const [showDocModal, setShowDocModal] = useState(false);
  const [docModalEmployee, setDocModalEmployee] = useState<any>(null);
  const [empDocuments, setEmpDocuments] = useState<any[]>([]);
  const [loadingEmpDocs, setLoadingEmpDocs] = useState(false);

  // P10/P11 state
  const [p10Year, setP10Year] = useState(new Date().getFullYear().toString());
  const [p10Data, setP10Data] = useState<any>(null);
  const [loadingP10, setLoadingP10] = useState(false);
  const [p11Data, setP11Data] = useState<any>(null);
  const [loadingP11, setLoadingP11] = useState(false);

  // Attendance approval workflow state
  const [showAttendanceApprovalModal, setShowAttendanceApprovalModal] = useState(false);
  const [attendanceApprovalData, setAttendanceApprovalData] = useState<any[]>([]);
  const [loadingAttendanceApproval, setLoadingAttendanceApproval] = useState(false);
  const [savingAttendanceApproval, setSavingAttendanceApproval] = useState(false);
  const [attendanceApprovalPeriod, setAttendanceApprovalPeriod] = useState(getCurrentFilingPeriod().period);

  // Reset key state when the selected company changes
  useEffect(() => {
    setSelectedRun(null);
    setRunEntries([]);
    setRunDetailView('list');
    setComplianceResult(null);
    setError(null);
  }, [client.id]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/clients/${client.id}/payroll-data?period=${attendanceOvertimePeriod}`);
      if (!res.ok) {
        setError('Failed to load payroll data.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (!data.hasData || !data.employees?.length) {
        setHasData(false);
        setEmployees([]);
        setPreamble(null);
      } else {
        setHasData(true);
        setPreamble(data.preamble);
        setEmployees(data.employees);
      }
    } catch {
      setError('Network error loading payroll data.');
    } finally {
      setLoading(false);
    }
  }, [client.id, attendanceOvertimePeriod]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (statusMessage) console.log(statusMessage); }, [statusMessage]);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await apiFetch(`/clients/${client.id}/employees`);
      if (res.ok) setDbEmployees(await res.json());
    } catch { setDbEmployees([]); }
  }, [client.id]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  // Debounced preview: call backend calculator on cell blur (300ms)
  const previewTimers = useRef<Record<number, NodeJS.Timeout>>({});

  const triggerPreview = useCallback(async (empIndex: number, rawValues: PayrollEmployee) => {
    const basicPay = parseFloat(String(rawValues['Total Cash Pay (A)'] || 0));
    const carBenefit = parseFloat(String(rawValues['Value of Car Benefit (B)'] || 0));
    const meals = parseFloat(String(rawValues['Value of Meals (C)'] || 0));
    const nonCash = parseFloat(String(rawValues['Non Cash Benefits (D)'] || 0));
    const housingBenefit = parseFloat(String(rawValues['Housing Benefit (F)'] || 0));
    const otherBenefits = parseFloat(String(rawValues['Other Benefits (G)'] || 0));
    const otherPension = parseFloat(String(rawValues['Other Pension Contribution (K)'] || 0));
    const postRetMedical = parseFloat(String(rawValues['Post Retirement Medical Fund (L)'] || 0));
    const mortgage = parseFloat(String(rawValues['Mortgage Interest (M)'] || 0));
    const insuranceRelief = parseFloat(String(rawValues['Amount of Insurance Relief (Q)'] || 0));
    const pwd = String(rawValues['Persons with Disability(PWD)'] || '').toLowerCase() === 'yes';
    const standardCheckIn = String(rawValues['Std Check-In'] || '08:00');
    const standardCheckOut = String(rawValues['Std Check-Out'] || '17:00');

    try {
      const response = await apiFetch('/api/payroll/calculate-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basicPay,
          carBenefit,
          meals,
          nonCash,
          housingBenefit,
          otherBenefits,
          otherPension,
          postRetMedical,
          mortgage,
          insuranceRelief,
          pwd,
          standardCheckIn,
          standardCheckOut,
          payStructure: 'fixed',
          period: newRunPeriod || getCurrentFilingPeriod().period,
        }),
      });
      if (!response.ok) throw new Error('Preview API failed');
      const data = await response.json();

      setEmployees(prev => prev.map((e, i) => {
        if (i !== empIndex) return e;
        return {
          ...e,
          'Total Gross Pay (Ksh) (H)': (data.grossPay ?? 0).toFixed(2),
          'Social Health Insurance Fund (I)': (data.shaDeduction ?? 0).toFixed(2),
          'NSSF Contribution (J)': (data.nssfDeduction ?? 0).toFixed(2),
          'Affordable Housing Levy (N)': (data.ahlDeduction ?? 0).toFixed(2),
          'Taxable Pay(Ksh) (O)': (data.taxablePay ?? 0).toFixed(2),
          'Monthly Personal Relief (Ksh) (P)': '2400.00',
          'PAYE Tax (Ksh) (R)': (data.payeTax ?? 0).toFixed(2),
          'Self Assessed PAYE Tax (Ksh) (S)': (data.payeTax ?? 0).toFixed(2),
        };
      }));
    } catch (err) {
      console.error('Preview failed:', err);
    }
  }, [newRunPeriod]);

  const updateField = (empIndex: number, header: string, value: string) => {
    setEmployees(prev => {
      const updated = prev.map((emp, i) => {
        if (i !== empIndex) return emp;
        return { ...emp, [header]: value };
      });

      if (!COMPUTED_COLUMNS.has(header)) {
        if (previewTimers.current[empIndex]) {
          clearTimeout(previewTimers.current[empIndex]);
        }
        previewTimers.current[empIndex] = setTimeout(() => {
          triggerPreview(empIndex, updated[empIndex]);
        }, 300);
      }

      return updated;
    });
  };

  const addRow = () => {
    setEmployees(prev => [...prev, createEmptyEmployee(prev.length + 1)]);
  };

  const removeRow = (index: number) => {
    setEmployees(prev => {
      const filtered = prev.filter((_, i) => i !== index);
      return filtered.map((emp, i) => ({ ...emp, [STANDARD_HEADERS[0]]: String(i + 1) }));
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage(null);
    setError(null);
    try {
      const res = await apiFetch(`/clients/${client.id}/payroll-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employees }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Save failed.');
      }

      // Sync to employees DB table
      let synced = 0;
      for (const emp of employees) {
        const kraPin = String(emp[STANDARD_HEADERS[1]] || '').trim();
        if (!kraPin) continue;
        const body = {
          payrollNumber: String(emp[STANDARD_HEADERS[0]] || ''),
          employeeName: String(emp[STANDARD_HEADERS[4]] || ''),
          kraPin,
          idNumber: String(emp[STANDARD_HEADERS[2]] || ''),
          identityType: String(emp[STANDARD_HEADERS[3]] || 'National ID'),
          shaNo: String(emp[STANDARD_HEADERS[5]] || ''),
          nssfNo: String(emp[STANDARD_HEADERS[6]] || ''),
          residentialStatus: String(emp[STANDARD_HEADERS[7]] || 'Resident'),
          typeOfEmployee: String(emp[STANDARD_HEADERS[8]] || 'Primary Employee'),
          pwd: String(emp[STANDARD_HEADERS[9]] || 'No'),
          exemptionCert: String(emp[STANDARD_HEADERS[10]] || ''),
          basicPay: parseFloat(String(emp[STANDARD_HEADERS[11]] || '0')) || 0,
          carBenefit: parseFloat(String(emp[STANDARD_HEADERS[12]] || '0')) || 0,
          mealsBenefit: parseFloat(String(emp[STANDARD_HEADERS[13]] || '0')) || 0,
          nonCashBenefits: parseFloat(String(emp[STANDARD_HEADERS[14]] || '0')) || 0,
          typeOfHousing: String(emp[STANDARD_HEADERS[15]] || 'Benefit not given'),
          housingBenefit: parseFloat(String(emp[STANDARD_HEADERS[16]] || '0')) || 0,
          otherBenefits: parseFloat(String(emp[STANDARD_HEADERS[17]] || '0')) || 0,
          otherPension: parseFloat(String(emp[STANDARD_HEADERS[21]] || '0')) || 0,
          postRetMedical: parseFloat(String(emp[STANDARD_HEADERS[22]] || '0')) || 0,
          mortgageInterest: parseFloat(String(emp[STANDARD_HEADERS[23]] || '0')) || 0,
          insuranceRelief: parseFloat(String(emp[STANDARD_HEADERS[27]] || '0')) || 0,
          bonusPay: 0,
          standardCheckIn: String(emp['Std Check-In'] || '08:00'),
          standardCheckOut: String(emp['Std Check-Out'] || '17:00'),
          employmentStatus: 'Active',
          dateJoined: '',
        };
        try {
          await apiFetch(`/clients/${client.id}/employees/sync-by-pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          synced++;
        } catch { /* skip failed sync */ }
      }
      setStatusMessage(`Payroll data saved. ${synced} employees synced to DB.`);
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to save payroll data.');
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePacks = async () => {
    if (!onGeneratePayrollPacks) return;
    setGeneratingPacks(true);
    setError(null);
    try {
      await onGeneratePayrollPacks(client);
    } catch (err: any) {
      setError(err.message || 'Failed to generate payroll packs.');
    } finally {
      setGeneratingPacks(false);
    }
  };

  const handleDownloadCsv = () => {
    const lines: string[] = [];
    if (preamble) {
      lines.push(`COMPANY NAME:,${preamble.companyName}`);
      lines.push(`COMPANY KRA PIN:,${preamble.companyPin}`);
      lines.push(`COMPANY NSSF NO:,${preamble.companyNssf}`);
      lines.push(`COMPANY NSSF PASSWORD:,${preamble.companyNssfPassword}`);
      lines.push(`COMPANY SHA LOGIN:,${preamble.companyShaLogin}`);
      lines.push(`COMPANY SHA PASSWORD:,${preamble.companyShaPassword}`);
    }
    lines.push('');
    lines.push(STANDARD_HEADERS.join(','));

    employees.forEach(emp => {
      const row = STANDARD_HEADERS.map(h => String(emp[h] ?? ''));
      lines.push(row.join(','));
    });

    const bom = '\ufeff';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${client.name}_Payroll_Data.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const payeRows = useMemo(() => {
    return employees.map(emp => {
      const typeOfEmp = String(emp[STANDARD_HEADERS[8]] || '');
      const resStatus = String(emp[STANDARD_HEADERS[7]] || '');
      const typeEmpCode = typeOfEmp.toLowerCase().includes('primary') ? 'PRMEMP' : 'SECEMP';
      const resStatCode = resStatus.toLowerCase().includes('resident') && !resStatus.toLowerCase().includes('non') ? 'RES' : 'NRES';
      return [
        String(emp[STANDARD_HEADERS[1]] ?? ''),
        String(emp[STANDARD_HEADERS[4]] ?? ''),
        resStatus,
        typeOfEmp,
        String(emp[STANDARD_HEADERS[9]] ?? ''),
        String(emp[STANDARD_HEADERS[10]] ?? ''),
        String(emp[STANDARD_HEADERS[11]] ?? ''),
        String(emp[STANDARD_HEADERS[12]] ?? ''),
        String(emp[STANDARD_HEADERS[13]] ?? ''),
        String(emp[STANDARD_HEADERS[14]] ?? ''),
        String(emp[STANDARD_HEADERS[15]] ?? ''),
        String(emp[STANDARD_HEADERS[16]] ?? ''),
        String(emp[STANDARD_HEADERS[18]] ?? ''),
        String(emp[STANDARD_HEADERS[19]] ?? ''),
        String(emp[STANDARD_HEADERS[20]] ?? ''),
        String(emp[STANDARD_HEADERS[21]] ?? ''),
        String(emp[STANDARD_HEADERS[22]] ?? ''),
        String(emp[STANDARD_HEADERS[23]] ?? ''),
        String(emp[STANDARD_HEADERS[24]] ?? ''),
        String(emp[STANDARD_HEADERS[25]] ?? ''),
        String(emp[STANDARD_HEADERS[26]] ?? ''),
        String(emp[STANDARD_HEADERS[27]] ?? ''),
        String(emp[STANDARD_HEADERS[28]] ?? ''),
        String(emp[STANDARD_HEADERS[29]] ?? ''),
        typeEmpCode,
        resStatCode,
      ];
    });
  }, [employees]);

  const nssfRows = useMemo(() => {
    const rows: { cols: string[]; tier2: boolean }[] = [];
    employees.forEach(emp => {
      const payrollNo = String(emp[STANDARD_HEADERS[0]] ?? '');
      const fullName = String(emp[STANDARD_HEADERS[4]] ?? '');
      const { firstName, lastName } = splitName(fullName);
      const idNo = String(emp[STANDARD_HEADERS[2]] ?? '');
      const kraPin = String(emp[STANDARD_HEADERS[1]] ?? '');
      const nssfNo = String(emp[STANDARD_HEADERS[6]] ?? '');
      const gross = parseFloat(String(emp[STANDARD_HEADERS[18]])) || 0;

      const tier1Member = Math.min(gross * 0.06, 540);
      const tier1Employer = tier1Member;
      const tier2Member = Math.max(0, Math.min((gross - 9000) * 0.06, 5940));
      const tier2Employer = tier2Member;

      rows.push({
        cols: [payrollNo, lastName, firstName, idNo, kraPin, nssfNo, '101', gross.toFixed(2), '1', tier1Member.toFixed(2), tier1Employer.toFixed(2), (tier1Member + tier1Employer).toFixed(2)],
        tier2: false,
      });

      if (tier2Member > 0) {
        rows.push({
          cols: [payrollNo, lastName, firstName, idNo, kraPin, nssfNo, '102', gross.toFixed(2), '1', tier2Member.toFixed(2), tier2Employer.toFixed(2), (tier2Member + tier2Employer).toFixed(2)],
          tier2: true,
        });
      }
    });
    return rows;
  }, [employees]);

  const nssfTotals = useMemo(() => {
    let totalIncome = 0;
    let totalMemberNssf = 0;
    let totalEmployerNssf = 0;
    let totalRecords = 0;
    employees.forEach(emp => {
      const gross = parseFloat(String(emp[STANDARD_HEADERS[18]])) || 0;
      totalIncome += gross;
      const tier1Member = Math.min(gross * 0.06, 540);
      const tier1Employer = tier1Member;
      const tier2Member = Math.max(0, Math.min((gross - 9000) * 0.06, 5940));
      const tier2Employer = tier2Member;
      totalMemberNssf += (tier1Member + tier2Member);
      totalEmployerNssf += (tier1Employer + tier2Employer);
      totalRecords++;
      if (tier2Member > 0) totalRecords++;
    });
    return { totalIncome, totalMemberNssf, totalEmployerNssf, totalContributions: totalMemberNssf + totalEmployerNssf, totalRecords };
  }, [employees]);

  const shaRows = useMemo(() => {
    return employees.map(emp => {
      const fullName = String(emp[STANDARD_HEADERS[4]] ?? '');
      const { firstName, lastName } = splitName(fullName);
      return [
        String(emp[STANDARD_HEADERS[0]] ?? ''),
        firstName,
        lastName,
        String(emp[STANDARD_HEADERS[3]] ?? 'National ID'),
        String(emp[STANDARD_HEADERS[2]] ?? ''),
        String(emp[STANDARD_HEADERS[1]] ?? ''),
        String(emp[STANDARD_HEADERS[5]] ?? ''),
        String(emp[STANDARD_HEADERS[19]] ?? ''),
        String(emp[STANDARD_HEADERS[5]] ?? ''),
      ];
    });
  }, [employees]);

  const handleDownloadPaye = () => {
    const bom = '\ufeff';
    const lines = payeRows.map(row => row.join(','));
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${client.name}_PAYE_B_Employees_Dtls_Simp.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadNssf = () => {
    const bom = '\ufeff';
    const header = NSSF_COLUMNS.join(',');
    const lines = nssfRows.map(r => r.cols.join(','));
    const blob = new Blob([bom + header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${client.name}_NSSF_Schedule.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSha = () => {
    const bom = '\ufeff';
    const header = SHA_COLUMNS.join(',');
    const lines = shaRows.map(row => row.join(','));
    const blob = new Blob([bom + header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${client.name}_SHA_Schedule.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleOpenGeneratedFile = (url?: string) => {
    if (url) window.open(url, '_blank');
  };

  const handleDownloadPayslip = async (kraPin: string) => {
    try {
      const res = await apiFetch(`/clients/${client.id}/payslip/${kraPin}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `Payslip_${kraPin}.pdf`;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      } else setError('Failed to generate payslip');
    } catch { setError('Network error'); }
  };

  const handleDownloadP9 = async (kraPin: string) => {
    try {
      const [pYear, pMonth] = attendanceOvertimePeriod.split('-');
      const period = `${pMonth}${pYear!.slice(2)}`; // MMYY format
      const res = await apiFetch(`/clients/${client.id}/p9/${kraPin}?period=${period}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `P9_${kraPin}.pdf`;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      } else setError('Failed to generate P9');
    } catch { setError('Network error'); }
  };

  const fetchLoans = useCallback(async () => {
    setLoadingLoans(true);
    try {
      const res = await apiFetch(`/clients/${client.id}/loans`);
      if (res.ok) {
        const data = await res.json();
        setLoanRecords(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingLoans(false);
    }
  }, [client.id]);

  useEffect(() => { fetchLoans(); }, [fetchLoans]);

  const fetchLeaveTypes = useCallback(async () => {
    try {
      const res = await apiFetch(`/clients/${client.id}/leave-types`);
      if (res.ok) setLeaveTypes(await res.json());
    } catch { /* ignore */ }
  }, [client.id]);

  useEffect(() => { fetchLeaveTypes(); }, [fetchLeaveTypes]);

  const fetchWorkSchedules = useCallback(async () => {
    try {
      const res = await apiFetch(`/clients/${client.id}/work-schedules`);
      if (res.ok) setWorkSchedules(await res.json());
    } catch { /* ignore */ }
  }, [client.id]);

  useEffect(() => { fetchWorkSchedules(); }, [fetchWorkSchedules]);

  const fetchOvertimeForAttendance = useCallback(async (period: string) => {
    try {
      const [y, m] = period.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const mm = String(m).padStart(2, '0');
      const yyyy = String(y);
      const [empRes, otRes, attRes, lvRes, holRes, wsRes] = await Promise.all([
        apiFetch(`/clients/${client.id}/employees`),
        apiFetch(`/clients/${client.id}/overtime-by-period?period=${period}`),
        apiFetch(`/clients/${client.id}/attendance?dateFrom=${yyyy}-${mm}-01&dateTo=${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`),
        apiFetch(`/clients/${client.id}/leave`),
        apiFetch(`/clients/${client.id}/holidays`),
        apiFetch(`/clients/${client.id}/work-schedules`),
      ]);
      let employees: any[] = [];
      let otRecords: any[] = [];
      let attRecords: any[] = [];
      let lvRecords: any[] = [];
      let holidayRecords: any[] = [];
      let scheduleRecords: any[] = [];
      if (empRes.ok) employees = await empRes.json();
      if (otRes.ok) otRecords = await otRes.json();
      if (attRes.ok) attRecords = await attRes.json();
      if (lvRes.ok) lvRecords = await lvRes.json();
      if (holRes.ok) holidayRecords = await holRes.json();
      if (wsRes.ok) scheduleRecords = await wsRes.json();

      const otMap = new Map<number, { hours: number; rate: number; multiplier: number }>();
      for (const ot of otRecords) otMap.set(ot.employeeId, { hours: ot.hours || 0, rate: ot.rate || 0, multiplier: ot.multiplier || 1 });

      // Sort by id desc so most recent record per day wins
      const sortedAtt = [...attRecords].sort((a: any, b: any) => (b.id || 0) - (a.id || 0));
      const attMap = new Map<number, Map<string, { status: string; id: number }>>();
      for (const a of sortedAtt) {
        if (!attMap.has(a.employeeId)) attMap.set(a.employeeId, new Map());
        if (!attMap.get(a.employeeId)!.has(a.date)) {
          attMap.get(a.employeeId)!.set(a.date, { status: a.status || 'Present', id: a.id });
        }
      }

      // Build holidays set: date strings for the month
      const holidayDates = new Set<string>();
      const holidayNames = new Map<string, string>();
      for (const h of holidayRecords) {
        if (h.date) {
          const hDate = h.date.substring(0, 10);
          // Include if in this month
          if (hDate.startsWith(period)) {
            holidayDates.add(hDate);
            holidayNames.set(hDate, h.name || '');
          } else if (h.isRecurring) {
            // For recurring holidays, match only if month AND day align
            const holidayMonth = h.date.substring(5, 7);
            const holidayDay = h.date.substring(8, 10);
            const currentMonth = period.split('-')[1];
            if (holidayMonth === currentMonth) {
              const d = `${period}-${holidayDay}`;
              holidayDates.add(d);
              holidayNames.set(d, h.name || '');
            }
          }
        }
      }

      // Build schedule lookup
      const scheduleMap = new Map<number, any>();
      for (const ws of scheduleRecords) {
        scheduleMap.set(ws.id, ws);
      }

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      setTimeLeaveRecords(lvRecords);

      const merged = employees.filter((e: any) => e.employmentStatus === 'Active').map((e: any) => {
        const offDayName = e.offDay || '';
        const schedule = e.workScheduleId ? scheduleMap.get(e.workScheduleId) : null;
        const scheduleConfig = schedule ? (typeof schedule.config === 'string' ? JSON.parse(schedule.config) : schedule.config) : null;

        // Compute off-days and holidays for this employee
        const offDaySet = new Set<string>();
        const holidaySet = new Set<string>();
        for (let d = 1; d <= lastDay; d++) {
          const dateStr = `${period}-${String(d).padStart(2, '0')}`;
          const dt = new Date(y, m - 1, d);
          const dayName = dayNames[dt.getDay()];

          // Check if holiday
          if (holidayDates.has(dateStr)) {
            holidaySet.add(dateStr);
            continue;
          }

          // Check if off-day (offDay field or schedule says 0 hours)
          if (offDayName && dayName === offDayName) {
            offDaySet.add(dateStr);
          } else if (scheduleConfig) {
            const shortName = dayName.substring(0, 3);
            if (!scheduleConfig[shortName] || scheduleConfig[shortName] === 0) {
              offDaySet.add(dateStr);
            }
          }
        }

        return {
          ...e,
          ot: otMap.get(e.id) || { hours: 0, rate: Math.round((e.basicPay || 0) / 240), multiplier: 1.5 },
          _att: attMap.get(e.id) || new Map(),
          _offDaySet: offDaySet,
          _holidaySet: holidaySet,
          _holidayNames: holidayNames,
        };
      });
      setAttendanceOvertimeEmployees(merged);
    } catch { /* ignore */ }
  }, [client.id]);

  const fetchReport = useCallback(async () => {
    setLoadingReport(true);
    setReportError(null);
    try {
      const res = await apiFetch(`/clients/${client.id}/reports/summary`);
      if (res.ok) setReportData(await res.json());
      else setReportError('Failed to load report');
    } catch {
      setReportError('Network error loading report');
    } finally {
      setLoadingReport(false);
    }
  }, [client.id]);

  const fetchKpiData = useCallback(async () => {
    try {
      const r = await apiFetch(`/clients/${client.id}/kpi`);
      if (r.ok) setKpiData(await r.json());
    } catch { /* ignore */ }
  }, [client.id]);

  useEffect(() => { if (activeTab === 'reports') { fetchReport(); fetchKpiData(); } }, [fetchReport, fetchKpiData, activeTab]);

  // Auto-load Time & Attendance on tab entry or period change
  useEffect(() => { if (activeTab === 'time') fetchOvertimeForAttendance(attendanceOvertimePeriod); }, [activeTab, attendanceOvertimePeriod, fetchOvertimeForAttendance]);

  const handleDownloadReport = () => {
    if (!reportData) return;
    const lines: string[] = ['Report,Value'];
    const { employeeSummary, loanSummary } = reportData;
    lines.push(`Total Employees,${employeeSummary.totalEmployees}`);
    lines.push(`Active Employees,${employeeSummary.activeEmployees}`);
    lines.push(`Total Basic Pay,${employeeSummary.totalBasicPay}`);
    lines.push(`Average Basic Pay,${employeeSummary.avgBasicPay.toFixed(2)}`);
    lines.push('');
    lines.push('Department,Count,Total Pay');
    (reportData.departmentBreakdown || []).forEach((d: any) => lines.push(`${d.department},${d.count},${d.totalPay}`));
    lines.push('');
    lines.push('Leave Requests,Count');
    Object.entries(reportData.leaveSummary?.byStatus || {}).forEach(([k, v]) => lines.push(`${k},${v}`));
    lines.push('');
    lines.push('Loans Summary,Value');
    lines.push(`Total Loans,${loanSummary.totalLoans}`);
    lines.push(`Active Loans,${loanSummary.activeLoans}`);
    lines.push(`Paid Loans,${loanSummary.paidLoans}`);
    lines.push(`Total Principal,${loanSummary.totalPrincipal}`);
    lines.push(`Outstanding,${loanSummary.outstandingBalance}`);

    const bom = '\ufeff';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${client.name}_Report.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const fetchEmailHistory = useCallback(async () => {
    setLoadingEmail(true);
    try {
      const res = await apiFetch(`/clients/${client.id}/email/history`);
      if (res.ok) setEmailHistory(await res.json());
    } catch {
      // ignore
    } finally {
      setLoadingEmail(false);
    }
  }, [client.id]);

  useEffect(() => { if (activeTab === 'email') fetchEmailHistory(); }, [fetchEmailHistory, activeTab]);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await apiFetch(`/clients/${client.id}/payroll-runs`);
      if (res.ok) setPayrollRuns(await res.json());
    } catch { /* ignore */ } finally { setLoadingRuns(false); }
  }, [client.id]);

  useEffect(() => { if (activeTab === 'runs') fetchRuns(); }, [fetchRuns, activeTab]);

  const fetchEmpDocuments = async (employeeId: number) => {
    setLoadingEmpDocs(true);
    try {
      const res = await apiFetch(`/clients/${client.id}/employees/${employeeId}/documents`);
      if (res.ok) setEmpDocuments(await res.json());
    } catch { /* ignore */ } finally { setLoadingEmpDocs(false); }
  };

  const handleEmpDocUpload = async (employeeId: number, file: File, documentType: string, notes: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentType);
    formData.append('notes', notes);
    try {
      const res = await apiFetch(`/clients/${client.id}/employees/${employeeId}/documents/upload`, { method: 'POST', body: formData });
      if (res.ok) { fetchEmpDocuments(employeeId); return true; }
    } catch { /* ignore */ }
    return false;
  };

  const handleEmpDocDelete = async (docId: number) => {
    if (!window.confirm('Delete this document?')) return;
    try {
      const res = await apiFetch(`/clients/${client.id}/documents/${docId}`, { method: 'DELETE' });
      if (res.ok && docModalEmployee) fetchEmpDocuments(docModalEmployee.id);
    } catch { /* ignore */ }
  };

  const fetchRunEntries = useCallback(async (runId: number) => {
    setLoadingEntries(true);
    try {
      const entriesRes = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}/entries`);
      if (entriesRes.ok) setRunEntries(await entriesRes.json());
    } catch { /* ignore */ } finally { setLoadingEntries(false); }
  }, [client.id]);

  const fetchRunAdjustments = useCallback(async (runId: number) => {
    setLoadingAdjustments(true);
    try {
      const res = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}/adjustments`);
      if (res.ok) setRunAdjustments(await res.json());
    } catch { setRunAdjustments([]); } finally { setLoadingAdjustments(false); }
  }, [client.id]);

  // Auto-load portal dashboard when token exists and tab is portal
  useEffect(() => {
    if (activeTab === 'portal' && portalToken && !portalDashboard && !portalLoading) {
      setPortalLoading(true);
      (async () => {
        try {
          const [dashRes, docRes] = await Promise.all([
            fetch('/api/portal/dashboard', { headers: { 'Authorization': `Bearer ${portalToken}` } }),
            fetch('/api/portal/documents', { headers: { 'Authorization': `Bearer ${portalToken}` } }),
          ]);
          if (dashRes.ok) { const d = await dashRes.json(); setPortalDashboard(d); }
          if (docRes.ok) { const d = await docRes.json(); setPortalDocuments(d); }
        } catch { /* ignore */ } finally { setPortalLoading(false); }
      })();
    }
  }, [activeTab, portalToken, portalDashboard, portalLoading]);

  const handleSendPayslips = async () => {
    setSendingEmail(true);
    setEmailResult(null);
    try {
      const res = await apiFetch(`/clients/${client.id}/email/send-payslips`, { method: 'POST' });
      const data = await res.json();
      setEmailResult(data);
      setStatusMessage(`Sent ${data.sent} payslips, ${data.failed} failed`);
      await fetchEmailHistory();
    } catch {
      setError('Failed to send payslips');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendP9s = async () => {
    setSendingEmail(true);
    setEmailResult(null);
    try {
      const res = await apiFetch(`/clients/${client.id}/email/send-p9s`, { method: 'POST' });
      const data = await res.json();
      setEmailResult(data);
      setStatusMessage(`Sent ${data.sent} P9s, ${data.failed} failed`);
      await fetchEmailHistory();
    } catch {
      setError('Failed to send P9s');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleImportFromMasterCsv = async () => {
    setImportingEmployees(true);
    try {
      const res = await apiFetch(`/clients/${client.id}/employees/import`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setStatusMessage(`Imported ${data.imported} employees (total: ${data.total})`);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.message || 'Import failed');
      }
    } catch {
      setError('Network error importing employees');
    } finally {
      setImportingEmployees(false);
    }
  };

  const handleSaveEmployee = async () => {
    try {
      const url = editingEmployee
        ? `/clients/${client.id}/employees/${editingEmployee.id}`
        : `/clients/${client.id}/employees`;
      const method = editingEmployee ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employeeForm),
      });
      if (res.ok) {
        if (employeeForm.portalPassword && employeeForm.portalPassword.length >= 6) {
          await fetch('/api/auth/employee/set-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kraPin: employeeForm.kraPin, password: employeeForm.portalPassword }),
          });
        }
        setStatusMessage(editingEmployee ? 'Employee updated' : 'Employee created');
        setShowEmployeeModal(false);
        setEditingEmployee(null);
        fetchEmployees();
      } else {
        const err = await res.json().catch(() => ({}));
        console.error('Save employee failed:', res.status, err);
        setError(err.message || `Save failed (${res.status})`);
      }
    } catch (err) {
      console.error('Save employee network error:', err);
      setError('Network error saving employee');
    }
  };

  const openEmployeeModal = (emp?: any) => {
    if (emp) {
      setEditingEmployee(emp);
      setEmployeeForm({
        payrollNumber: emp.payrollNumber || '',
        employeeName: emp.employeeName || '',
        idNumber: emp.idNumber || '',
        kraPin: emp.kraPin || '',
        nssfNo: emp.nssfNo || '',
        shaNo: emp.shaNo || '',
        phone: emp.phone || '',
        email: emp.email || '',
        bankName: emp.bankName || '',
        bankAccount: emp.bankAccount || '',
        bankCode: emp.bankCode || '',
        department: emp.department || '',
        jobTitle: emp.jobTitle || '',
        employmentType: emp.employmentType || 'Permanent',
        employmentStatus: emp.employmentStatus || 'Active',
        dateJoined: emp.dateJoined || '',
        dateLeft: emp.dateLeft || '',
        basicPay: emp.basicPay || 0,
        bonusPay: emp.bonusPay || 0,
        role: emp.role || 'employee',
        departmentId: emp.departmentId || null,
        standardCheckIn: emp.standardCheckIn || '08:00',
        standardCheckOut: emp.standardCheckOut || '17:00',
        workScheduleId: emp.workScheduleId || '',
        offDay: emp.offDay || '',
      });
    } else {
      setEditingEmployee(null);
      setEmployeeForm({
        payrollNumber: '', employeeName: '', idNumber: '', kraPin: '',
        nssfNo: '', shaNo: '', phone: '', email: '', bankName: '',
        bankAccount: '', bankCode: '', department: '', jobTitle: '',
        employmentType: 'Permanent', employmentStatus: 'Active',
        dateJoined: '', dateLeft: '', basicPay: 0, bonusPay: 0,
        role: 'employee', departmentId: null,
        standardCheckIn: '08:00', standardCheckOut: '17:00',
        workScheduleId: '', offDay: '',
      });
    }
    setShowEmployeeModal(true);
  };

  const handleSaveLeave = async () => {
    try {
      const url = editingLeave
        ? `/clients/${client.id}/leave/${editingLeave.id}`
        : `/clients/${client.id}/leave`;
      const method = editingLeave ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leaveForm),
      });
      if (res.ok) {
        setStatusMessage(editingLeave ? 'Leave request updated' : 'Leave request created');
        setShowLeaveModal(false);
        setEditingLeave(null);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.message || 'Save failed');
      }
    } catch {
      setError('Network error saving leave request');
    }
  };

  const openLeaveModal = (rec?: any) => {
    if (rec) {
      setEditingLeave(rec);
      setLeaveForm({
        employeeId: rec.employeeId || '',
        employeeName: rec.employeeName || '',
        kraPin: rec.kraPin || '',
        leaveType: rec.leaveType || 'Annual',
        startDate: rec.startDate || '',
        endDate: rec.endDate || '',
        daysCount: rec.daysCount || 1,
        reason: rec.reason || '',
        status: rec.status || 'Pending',
        isPaid: rec.isPaid !== 0,
      });
    } else {
      setEditingLeave(null);
      setLeaveForm({
        employeeId: '', employeeName: '', kraPin: '', leaveType: 'Annual',
        startDate: '', endDate: '', daysCount: 1, reason: '', status: 'Pending',
        isPaid: true,
      });
    }
    setShowLeaveModal(true);
  };

  const handleSaveLoan = async () => {
    try {
      const payload = {
        ...loanForm,
        totalRepayable: (parseFloat(loanForm.principal) || 0) + (parseFloat(loanForm.totalInterest) || 0),
      };
      const url = editingLoan
        ? `/clients/${client.id}/loans/${editingLoan.id}`
        : `/clients/${client.id}/loans`;
      const method = editingLoan ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setStatusMessage(editingLoan ? 'Loan updated' : 'Loan created');
        setShowLoanModal(false);
        setEditingLoan(null);
        await fetchLoans();
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.message || 'Save failed');
      }
    } catch {
      setError('Network error saving loan');
    }
  };

  const handleDeleteLoan = async (id: number) => {
    if (!window.confirm('Delete this loan record?')) return;
    try {
      const res = await apiFetch(`/clients/${client.id}/loans/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setStatusMessage('Loan deleted');
        await fetchLoans();
      } else {
        setError('Failed to delete loan');
      }
    } catch {
      setError('Network error deleting loan');
    }
  };

  const openLoanModal = (rec?: any) => {
    if (rec) {
      setEditingLoan(rec);
      setLoanForm({
        employeeId: rec.employeeId || '',
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
      setEditingLoan(null);
      setLoanForm({
        employeeId: '', employeeName: '', kraPin: '', loanType: 'Salary Advance',
        principal: 0, monthlyDeduction: 0, installments: 1, remainingInstallments: 1,
        interestRate: 0, totalInterest: 0, totalRepayable: 0, amountPaid: 0,
        status: 'Approved', disbursedAt: '', notes: '',
      });
    }
    setShowLoanModal(true);
  };

  const handleSaveAttendance = async () => {
    try {
      const url = editingAttendance
        ? `/clients/${client.id}/attendance/${editingAttendance.id}`
        : `/clients/${client.id}/attendance`;
      const method = editingAttendance ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attendanceForm),
      });
      if (res.ok) {
        setStatusMessage(editingAttendance ? 'Attendance record updated' : 'Attendance record created');
        setShowAttendanceModal(false);
        setEditingAttendance(null);
        // Refresh calendar + review data so changes appear immediately
        await fetchOvertimeForAttendance(attendanceOvertimePeriod);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.message || 'Save failed');
      }
    } catch {
      setError('Network error saving attendance record');
    }
  };

  const openAttendanceModal = (rec?: any) => {
    if (rec) {
      setEditingAttendance(rec);
      setAttendanceForm({
        employeeId: rec.employeeId || '',
        employeeName: rec.employeeName || '',
        kraPin: rec.kraPin || '',
        date: rec.date || '',
        checkIn: rec.checkIn || '',
        checkOut: rec.checkOut || '',
        status: rec.status || 'Present',
        notes: rec.notes || '',
      });
    } else {
      setEditingAttendance(null);
      setAttendanceForm({
        employeeId: '', employeeName: '', kraPin: '', date: '',
        checkIn: '', checkOut: '', status: 'Present', notes: '',
      });
    }
    setShowAttendanceModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
        <span className="ml-3 text-sm text-slate-500">Loading payroll data...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">{client.name}</h2>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-500">{client.pin}</span>
            </div>
            {clients && clients.length > 0 && onClientChange && (
              <select
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 w-64"
                value={client.id}
                onChange={(e) => {
                  const selected = clients.find(c => String(c.id) === e.target.value);
                  if (selected && onClientChange) onClientChange(selected);
                }}
              >
                {clients.filter(c => {
                  const has = (val?: string | null) => !!val && val !== 'na';
                  return has(c.paye) || has(c.nssf) || has(c.sha);
                }).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.pin}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onEditClient && (
            <button
              onClick={onEditClient}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Company Details
            </button>
          )}
        </div>
      </div>

      {/* Inline error banner */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-3 rounded p-1 hover:bg-white/60 transition">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Tab Bar + Master CSV (same row) */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map(({ id, label, img }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition border-b-2 ${activeTab === id
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
            >
              {img ? (
                <img src={img} alt={label} className="h-10 w-10 object-contain" />
              ) : id === 'time' ? (
                <CalendarCheck className="h-5 w-5" />
              ) : id === 'loans' ? (
                <Banknote className="h-5 w-5" />
              ) : id === 'reports' ? (
                <BarChart3 className="h-5 w-5" />
              ) : id === 'email' ? (
                <Mail className="h-5 w-5" />
              ) : id === 'portal' ? (
                <Globe className="h-5 w-5" />
              ) : id === 'runs' ? (
                <RefreshCw className="h-5 w-5" />
              ) : id === 'p10p11' ? (
                <FileText className="h-5 w-5" />
              ) : (
                <FileSpreadsheet className="h-5 w-5" />
              )}
              <span className="text-[10px] leading-none">{label}</span>
            </button>
          ))}
        </div>

        <div className="shrink-0">
          {client.masterFileUrl ? (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <a
                href={client.masterFileUrl}
                download
                rel="noreferrer"
                className="flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-[#ff0613] transition max-w-[180px]"
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-500" />
                <span className="truncate">{client.masterFileLabel || 'Master CSV'}</span>
              </a>
              <span className="h-4 w-px bg-slate-200" />
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-200 transition">
                {uploadingMasterCsv ? (
                  <><RefreshCw className="h-3 w-3 animate-spin" /></>
                ) : (
                  <><Cloud className="h-3 w-3" /> Replace</>
                )}
                <input type="file" className="hidden" accept=".csv,.xlsx" disabled={uploadingMasterCsv}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!window.confirm('Replace the existing Master CSV?')) return;
                    setUploadingMasterCsv(true);
                    try {
                      if (onUploadMasterCsv) await onUploadMasterCsv(client.id, file);
                      else { const d = new FormData(); d.append('masterCsv', file); await fetch(`/api/clients/${client.id}/master-csv`, { method: 'POST', body: d }); }
                      setStatusMessage('Master CSV replaced.');
                      await fetchData();
                    } catch (err: any) { setError(err.message || 'Upload failed.'); }
                    finally { setUploadingMasterCsv(false); }
                  }}
                />
              </label>
              <button
                onClick={async () => {
                  if (!window.confirm('Remove the Master CSV?')) return;
                  try {
                    if (onRemoveMasterCsv) await onRemoveMasterCsv(client.id);
                    else await fetch(`/api/clients/${client.id}/master-csv`, { method: 'DELETE' });
                    setStatusMessage('Master CSV removed.');
                    await fetchData();
                  } catch (err: any) { setError(err.message || 'Remove failed.'); }
                }}
                className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100 transition"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-500 hover:border-slate-400 hover:text-slate-700 transition shadow-sm">
              <Cloud className="h-4 w-4" />
              Upload Master CSV
              <input type="file" className="hidden" accept=".csv,.xlsx" disabled={uploadingMasterCsv}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploadingMasterCsv(true);
                  try {
                    if (onUploadMasterCsv) await onUploadMasterCsv(client.id, file);
                    else { const d = new FormData(); d.append('masterCsv', file); await fetch(`/api/clients/${client.id}/master-csv`, { method: 'POST', body: d }); }
                    setStatusMessage('Master CSV uploaded.');
                    await fetchData();
                  } catch (err: any) { setError(err.message || 'Upload failed.'); }
                  finally { setUploadingMasterCsv(false); }
                }}
              />
            </label>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ───── Master Payroll Tab ───── */}
      {activeTab === 'master' && (
        <>
          {(!hasData && employees.length === 0) ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <p className="text-sm font-semibold text-slate-500">No payroll data yet</p>
              <p className="mt-2 text-xs text-slate-400">
                Click "Add Employee" to start adding payroll data manually, or upload a Master CSV from the Payroll Pipeline desk.
              </p>
              <button
                onClick={addRow}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900 transition"
              >
                <Plus className="h-4 w-4" />
                Add Employee
              </button>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee Payroll Data</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={attendanceOvertimePeriod}
                    onChange={e => setAttendanceOvertimePeriod(e.target.value)}
                    placeholder="YYYY-MM"
                    className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <button
                    onClick={() => fetchData()}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                  ><RefreshCw className="h-3.5 w-3.5" /></button>
                </div>
                <div className="flex items-center gap-2">
                  {onGeneratePayrollPacks && (
                    <button
                      onClick={handleGeneratePacks}
                      disabled={!hasData || generatingPacks}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {generatingPacks ? (
                        <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Generating...</>
                      ) : (
                        <><Cloud className="h-3.5 w-3.5" /> Generate Payroll Packs</>
                      )}
                    </button>
                  )}
                  <button
                    onClick={handleDownloadCsv}
                    disabled={employees.length === 0}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download CSV
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? (
                      <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Saving...</>
                    ) : (
                      <><Save className="h-3.5 w-3.5" /> Save Changes</>
                    )}
                  </button>
                </div>
              </div>

              <div className="mb-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 border-r border-slate-200 min-w-[3rem]">
                        #
                      </th>
                      <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Std Check-In</th>
                      <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Std Check-Out</th>
                      {STANDARD_HEADERS.map((header, i) => {
                        const numeric = i >= 11 && i !== 15;
                        return (
                          <th
                            key={header}
                            className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${COMPUTED_COLUMNS.has(header) ? 'text-slate-400' : 'text-slate-500'
                              } ${numeric ? 'text-right' : ''}`}
                          >
                            {header}
                          </th>
                        );
                      })}
                      {employees[0]?.['OT Pay (read-only)'] !== undefined && (
                        <>
                          <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400 text-right whitespace-nowrap">OT Pay</th>
                          <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400 text-right whitespace-nowrap">Absent</th>
                          <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400 text-right whitespace-nowrap">Late</th>
                          <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400 text-right whitespace-nowrap">U.Leave</th>
                          <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400 text-right whitespace-nowrap">Bonus</th>
                        </>
                      )}
                      <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 w-12">
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {employees.map((emp, rowIdx) => (
                      <tr key={rowIdx} className="hover:bg-slate-50/50 transition">
                        <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-xs text-slate-400 font-mono border-r border-slate-100">
                          {rowIdx + 1}
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="time"
                            value={String(emp['Std Check-In'] || '08:00')}
                            onChange={e => updateField(rowIdx, 'Std Check-In', e.target.value)}
                            className="w-24 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="time"
                            value={String(emp['Std Check-Out'] || '17:00')}
                            onChange={e => updateField(rowIdx, 'Std Check-Out', e.target.value)}
                            className="w-24 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>
                        {STANDARD_HEADERS.map((header, colIdx) => {
                          const isComputed = COMPUTED_COLUMNS.has(header);
                          const isNumeric = colIdx >= 11 && colIdx !== 15;
                          const rawVal = emp[header];
                          const strVal = rawVal !== undefined && rawVal !== null ? String(rawVal) : '';

                          return (
                            <td key={header} className={`px-3 py-1.5 ${isNumeric ? 'text-right' : ''}`}>
                              {isComputed ? (
                                <span className="block w-full px-1.5 py-1 text-xs text-slate-500 bg-slate-50 rounded">
                                  {strVal}
                                </span>
                              ) : colIdx === 9 ? (
                                <select
                                  value={strVal}
                                  onChange={e => updateField(rowIdx, header, e.target.value)}
                                  className="w-full min-w-[4rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                >
                                  <option value="No">No</option>
                                  <option value="Yes">Yes</option>
                                </select>
                              ) : colIdx === 3 ? (
                                <select
                                  value={strVal}
                                  onChange={e => updateField(rowIdx, header, e.target.value)}
                                  className="w-full min-w-[6rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                >
                                  <option value="National ID">National ID</option>
                                  <option value="Passport Number">Passport Number</option>
                                  <option value="Alien ID">Alien ID</option>
                                  <option value="Refugee ID">Refugee ID</option>
                                </select>
                              ) : colIdx === 7 ? (
                                <select
                                  value={strVal}
                                  onChange={e => updateField(rowIdx, header, e.target.value)}
                                  className="w-full min-w-[5rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                >
                                  <option value="Resident">Resident</option>
                                  <option value="Non-Resident">Non-Resident</option>
                                </select>
                              ) : colIdx === 8 ? (
                                <select
                                  value={strVal}
                                  onChange={e => updateField(rowIdx, header, e.target.value)}
                                  className="w-full min-w-[7rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                >
                                  <option value="Primary Employee">Primary Employee</option>
                                  <option value="Secondary Employee">Secondary Employee</option>
                                </select>
                              ) : colIdx === 15 ? (
                                <select
                                  value={strVal}
                                  onChange={e => updateField(rowIdx, header, e.target.value)}
                                  className="w-full min-w-[8rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                >
                                  <option value="Benefit not given">Benefit not given</option>
                                  <option value="Employer owns">Employer owns</option>
                                  <option value="Employer rented">Employer rented</option>
                                  <option value="Employer leased">Employer leased</option>
                                </select>
                              ) : isNumeric ? (
                                <input
                                  type="number"
                                  step="any"
                                  value={strVal}
                                  onChange={e => updateField(rowIdx, header, e.target.value)}
                                  className="w-full min-w-[5rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 text-right focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={strVal}
                                  onChange={e => updateField(rowIdx, header, e.target.value)}
                                  className="w-full min-w-[5rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                />
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-1.5">
                          {employees[0]?.['OT Pay (read-only)'] !== undefined && (
                            <>
                              <span className="block w-full px-1.5 py-1 text-xs text-amber-600 bg-amber-50 rounded text-right">{Number(emp['OT Pay (read-only)'] || 0).toLocaleString()}</span>
                            </>
                          )}
                        </td>
                        {employees[0]?.['OT Pay (read-only)'] !== undefined && (
                          <>
                            <td className="px-3 py-1.5 text-right"><span className="text-xs text-rose-500 bg-rose-50 rounded px-1.5 py-1">{emp['Absent Days (read-only)'] || 0}</span></td>
                            <td className="px-3 py-1.5 text-right"><span className="text-xs text-amber-500 bg-amber-50 rounded px-1.5 py-1">{emp['Late Days (read-only)'] || 0}</span></td>
                            <td className="px-3 py-1.5 text-right"><span className="text-xs text-blue-500 bg-blue-50 rounded px-1.5 py-1">{emp['Unpaid Leave Days (read-only)'] || 0}</span></td>
                            <td className="px-3 py-1.5 text-right"><span className="text-xs text-emerald-600 bg-emerald-50 rounded px-1.5 py-1 font-mono">{Number(emp['Bonus Pay (read-only)'] || 0).toLocaleString()}</span></td>
                          </>
                        )}
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                const kraPin = String(emp[STANDARD_HEADERS[1]] || '');
                                if (kraPin) handleDownloadPayslip(kraPin);
                              }}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                              title="Download Payslip"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                const kraPin = String(emp[STANDARD_HEADERS[1]] || '');
                                if (kraPin) handleDownloadP9(kraPin);
                              }}
                              className="rounded-lg px-1.5 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                              title="Download P9"
                            >
                              P9
                            </button>
                            <button
                              onClick={() => {
                                const kraPin = String(emp[STANDARD_HEADERS[1]] || '');
                                const e = dbEmployees.find((x: any) => x.kraPin === kraPin);
                                if (e) { setDocModalEmployee(e); fetchEmpDocuments(e.id); setShowDocModal(true); }
                              }}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                              title="Documents"
                            >
                              <FolderOpen className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                const kraPin = String(emp[STANDARD_HEADERS[1]] || '');
                                const e = dbEmployees.find((x: any) => x.kraPin === kraPin);
                                if (e) openEmployeeModal(e);
                              }}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                              title="Edit Profile"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => removeRow(rowIdx)}
                              className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                              title="Remove employee"
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

              <div className="flex items-center gap-3">
                <button
                  onClick={addRow}
                  className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900 transition"
                >
                  <Plus className="h-4 w-4" />
                  Add Employee
                </button>
                <span className="text-xs text-slate-400">
                  {employees.length} employee{employees.length !== 1 ? 's' : ''}
                </span>
              </div>
            </>
          )}
        </>
      )}

      {/* ───── Time & Attendance Tab ───── */}
      {activeTab === 'time' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Time & Attendance
            </span>
            <div className="flex items-center gap-2">
              <select
                value={attendanceOvertimePeriod.split('-')[0] || ''}
                onChange={e => {
                  const mm = attendanceOvertimePeriod.split('-')[1] || '01';
                  setAttendanceOvertimePeriod(`${e.target.value}-${mm}`);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                {Array.from({ length: 5 }, (_, i) => {
                  const y = new Date().getFullYear() - 2 + i;
                  return <option key={y} value={y}>{y}</option>;
                })}
              </select>
              <select
                value={attendanceOvertimePeriod.split('-')[1] || ''}
                onChange={e => {
                  const mm = e.target.value;
                  const yyyy = attendanceOvertimePeriod.split('-')[0] || String(new Date().getFullYear());
                  setAttendanceOvertimePeriod(`${yyyy}-${mm}`);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map(m => (
                  <option key={m} value={m}>{new Date(2020, parseInt(m) - 1, 1).toLocaleString('en-US', { month: 'short' })}</option>
                ))}
              </select>
              {isPastDeadline(attendanceOvertimePeriod) && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 whitespace-nowrap">
                  <AlertCircle className="h-3 w-3" /> Past deadline
                </span>
              )}
            </div>
          </div>

          {attendanceOvertimeEmployees.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <CalendarCheck className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">Loading data for {attendanceOvertimePeriod}...</p>
              <p className="mt-2 text-xs text-slate-400">View attendance, overtime, and leave in a unified calendar. Data loads automatically when changing the period.</p>
            </div>
          ) : (
            <>
              {/* Calendar Grid */}
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm mb-4">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap border-r border-slate-200">Employee</th>
                      {Array.from({ length: 31 }, (_, i) => (
                        <th key={i} className="w-8 px-1 py-2 text-center font-semibold uppercase tracking-wider text-slate-500">{i + 1}</th>
                      ))}
                      <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right whitespace-nowrap">OT (hrs)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {attendanceOvertimeEmployees.map((emp: any) => (
                      <tr key={emp.id} className="hover:bg-slate-50/50 transition">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-900 whitespace-nowrap border-r border-slate-200">
                          {emp.employeeName}
                        </td>
                        {Array.from({ length: 31 }, (_, i) => {
                          const day = i + 1;
                          const dateKey = `${attendanceOvertimePeriod}-${String(day).padStart(2, '0')}`;
                          // Check for valid date in month
                          const [y, m] = attendanceOvertimePeriod.split('-').map(Number);
                          const lastDay = new Date(y, m, 0).getDate();
                          if (day > lastDay) return <td key={i} className="w-8" />;

                          const isHoliday = emp._holidaySet?.has(dateKey);
                          const isOffDay = emp._offDaySet?.has(dateKey);

                          if (isHoliday) {
                            const holidayName = emp._holidayNames?.get(dateKey) || '';
                            return (
                              <td key={i} className="w-8 px-0 py-1.5 text-center">
                                <button
                                  onClick={() => {
                                    const existing = emp._att?.get(dateKey);
                                    const existingStatus = existing?.status || 'Present';
                                    setAttendanceForm({
                                      employeeId: emp.id, employeeName: emp.employeeName, kraPin: emp.kraPin,
                                      date: dateKey, checkIn: '', checkOut: '', status: existingStatus, notes: '',
                                    });
                                    setEditingAttendance(existing?.id ? { id: existing.id } : null);
                                    setShowAttendanceModal(true);
                                  }}
                                  className="inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 transition hover:ring-1 hover:ring-purple-300"
                                  title={`${emp.employeeName} — ${dateKey}: Holiday${holidayName ? ': ' + holidayName : ''}`}
                                >H</button>
                              </td>
                            );
                          }
                          if (isOffDay) {
                            return (
                              <td key={i} className="w-8 px-0 py-1.5 text-center">
                                <button
                                  onClick={() => {
                                    const existing = emp._att?.get(dateKey);
                                    const existingStatus = existing?.status || 'Present';
                                    setAttendanceForm({
                                      employeeId: emp.id, employeeName: emp.employeeName, kraPin: emp.kraPin,
                                      date: dateKey, checkIn: '', checkOut: '', status: existingStatus, notes: '',
                                    });
                                    setEditingAttendance(existing?.id ? { id: existing.id } : null);
                                    setShowAttendanceModal(true);
                                  }}
                                  className="inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-semibold bg-slate-100 text-slate-400 transition hover:ring-1 hover:ring-slate-300"
                                  title={`${emp.employeeName} — ${dateKey}: Off Day${emp.offDay ? ' (' + emp.offDay + ')' : ''}`}
                                >OFF</button>
                              </td>
                            );
                          }

                          const attRecord = emp._att?.get(dateKey);
                          const status = attRecord?.status || 'Present';
                          const color = status === 'Present' ? 'bg-emerald-50 text-emerald-700' :
                            status === 'Absent' ? 'bg-red-50 text-red-700' :
                              status === 'Late' ? 'bg-amber-50 text-amber-700' :
                                status === 'Half-Day' ? 'bg-orange-50 text-orange-700' :
                                  status === 'Leave' ? 'bg-blue-50 text-blue-700' : 'text-slate-300';
                          const label = status === 'Present' ? 'P' :
                            status === 'Absent' ? 'A' :
                              status === 'Late' ? 'L' :
                                status === 'Half-Day' ? 'H' :
                                  status === 'Leave' ? 'Lv' : '·';
                          return (
                            <td key={i} className="w-8 px-0 py-1.5 text-center">
                              <button
                                onClick={() => {
                                  setAttendanceForm({
                                    employeeId: emp.id, employeeName: emp.employeeName, kraPin: emp.kraPin,
                                    date: dateKey, checkIn: '', checkOut: '', status: status || 'Present', notes: '',
                                  });
                                  setEditingAttendance(attRecord?.id ? { id: attRecord.id } : null);
                                  setShowAttendanceModal(true);
                                }}
                                className={`inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-semibold transition ${color} hover:ring-1 hover:ring-slate-400`}
                                title={`${emp.employeeName} — ${dateKey}${status ? ': ' + status : ''}`}
                              >
                                {label}
                              </button>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700 whitespace-nowrap">
                          {emp.ot.hours > 0 ? `${emp.ot.hours}h` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Quick Actions Row */}
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => openAttendanceModal()} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition">
                  <Plus className="h-3.5 w-3.5" /> Add Attendance Record
                </button>
                <button onClick={() => openLeaveModal()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
                  <Calendar className="h-3.5 w-3.5" /> Request Leave
                </button>
                <button
                  disabled={savingOvertime}
                  onClick={async () => {
                    setSavingOvertime(true);
                    try {
                      for (const emp of attendanceOvertimeEmployees) {
                        const ot = emp.ot;
                        const amount = ot.hours * (ot.rate || 0) * (ot.multiplier || 1);
                        await apiFetch(`/clients/${client.id}/employees/${emp.id}/overtime`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ period: attendanceOvertimePeriod, hours: ot.hours, rate: ot.rate || 0, multiplier: ot.multiplier || 1, amount }),
                        });
                      }
                      setStatusMessage('Overtime saved. Regenerate payroll entries to apply.');
                    } catch { setError('Failed to save overtime'); }
                    finally { setSavingOvertime(false); }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  {savingOvertime ? 'Saving...' : 'Save Overtime'}
                </button>
                <button
                  onClick={async () => {
                    setAttendanceApprovalPeriod(attendanceOvertimePeriod);
                    setLoadingAttendanceApproval(true);
                    setShowAttendanceApprovalModal(true);
                    try {
                      const r = await apiFetch(`/clients/${client.id}/attendance-payroll-preview?period=${attendanceOvertimePeriod}`, { method: 'POST' });
                      if (r.ok) {
                        const data = await r.json();
                        setAttendanceApprovalData(data.employees || []);
                      } else { setError('Failed to load attendance preview'); }
                    } catch { setError('Network error'); }
                    finally { setLoadingAttendanceApproval(false); }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition"
                  title="Review and approve attendance data that will feed into payroll"
                >
                  <CalendarCheck className="h-3.5 w-3.5" /> Review Attendance
                </button>
              </div>

              {/* Overtime Summary Table */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Overtime Details</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Hours</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Rate (KES/hr)</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Multiplier</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Amount (KES)</th>
                        <th className="px-3 py-2 w-12" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {attendanceOvertimeEmployees
                        .filter((e: any) => (e.ot?.hours || 0) > 0 || (e.ot?.amount || 0) > 0)
                        .map((emp: any) => (
                          <tr key={emp.id} className="hover:bg-slate-50/50 transition">
                            <td className="px-3 py-2 font-medium text-slate-900">{emp.employeeName}</td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" value={emp.ot.hours} onChange={e => { const val = parseFloat(e.target.value) || 0; setAttendanceOvertimeEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, ot: { ...e.ot, hours: val } } : e)); }} className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900" />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" value={emp.ot.rate} onChange={e => { const val = parseFloat(e.target.value) || 0; setAttendanceOvertimeEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, ot: { ...e.ot, rate: val } } : e)); }} className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900" />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input type="number" value={emp.ot.multiplier} step="0.5" onChange={e => { const val = parseFloat(e.target.value) || 1; setAttendanceOvertimeEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, ot: { ...e.ot, multiplier: val } } : e)); }} className="w-14 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900" />
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">
                              {(emp.ot.hours * emp.ot.rate * emp.ot.multiplier).toFixed(2)}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                onClick={async () => {
                                  if (!window.confirm(`Delete overtime for ${emp.employeeName}?`)) return;
                                  try {
                                    await apiFetch(`/clients/${client.id}/employees/${emp.id}/overtime?period=${attendanceOvertimePeriod}`, { method: 'DELETE' });
                                    setAttendanceOvertimeEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, ot: { hours: 0, rate: Math.round((e.basicPay || 0) / 240), multiplier: 1.5 } } : e));
                                    setStatusMessage('Overtime record deleted.');
                                  } catch { setError('Failed to delete overtime.'); }
                                }}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {attendanceOvertimeEmployees.filter((e: any) => (e.ot?.hours || 0) > 0 || (e.ot?.amount || 0) > 0).length === 0 && (
                    <p className="text-xs text-slate-400 py-3 text-center">No employees with overtime records for this period.</p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-2">
                    Showing {attendanceOvertimeEmployees.filter((e: any) => (e.ot?.hours || 0) > 0 || (e.ot?.amount || 0) > 0).length} of {attendanceOvertimeEmployees.length} employees with overtime
                  </p>
                </div>
              </div>

              {/* Leave Requests Section */}
              {timeLeaveRecords.length > 0 && (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Leave Requests</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                          <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Leave Type</th>
                          <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Start Date</th>
                          <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">End Date</th>
                          <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Days</th>
                          <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Status</th>
                          <th className="px-3 py-2 w-24" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {timeLeaveRecords.map((rec: any) => (
                          <tr key={rec.id} className="hover:bg-slate-50/50 transition">
                            <td className="px-3 py-2 font-medium text-slate-900">{rec.employeeName}</td>
                            <td className="px-3 py-2 text-slate-700">{rec.leaveType}</td>
                            <td className="px-3 py-2 font-mono text-slate-700">{rec.startDate}</td>
                            <td className="px-3 py-2 font-mono text-slate-700">{rec.endDate}</td>
                            <td className="px-3 py-2 text-right font-mono text-slate-900">{rec.daysCount}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${rec.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' :
                                  rec.status === 'Pending' ? 'bg-amber-50 text-amber-700' :
                                    rec.status === 'Rejected' ? 'bg-red-50 text-red-700' :
                                      'bg-slate-100 text-slate-500'
                                }`}>{rec.status}</span>
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={() => openLeaveModal(rec)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition" title="Edit">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ───── Loans Tab ───── */}
      {activeTab === 'loans' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Loans & Advances
            </span>
            <button
              onClick={() => openLoanModal()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Loan
            </button>
          </div>

          {loadingLoans ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : loanRecords.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <Banknote className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">No loan records</p>
              <p className="mt-2 text-xs text-slate-400">
                Add loans and advances for your employees.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Employee Name</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">KRA PIN</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Loan Type</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Principal</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Monthly Deduction</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Installments</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Remaining</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Status</th>
                    <th className="px-3 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loanRecords.map((rec: any) => (
                    <tr key={rec.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-3 py-2 font-medium text-slate-900">{rec.employeeName}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{rec.kraPin}</td>
                      <td className="px-3 py-2 text-slate-700">{rec.loanType}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(rec.principal).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(rec.monthlyDeduction).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900">{rec.installments}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900">{rec.remainingInstallments}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${rec.status === 'Active' ? 'bg-blue-50 text-blue-700' :
                            rec.status === 'Paid' ? 'bg-emerald-50 text-emerald-700' :
                              rec.status === 'Defaulted' ? 'bg-red-50 text-red-700' :
                                rec.status === 'Approved' ? 'bg-amber-50 text-amber-700' :
                                  'bg-slate-100 text-slate-500'
                          }`}>
                          {rec.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openLoanModal(rec)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteLoan(rec.id)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                {loanRecords.length} loan record{loanRecords.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───── Reports & KPIs Tab ───── */}
      {activeTab === 'reports' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Reports & KPIs
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { fetchReport(); fetchKpiData(); }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
              <button
                onClick={handleDownloadReport}
                disabled={!reportData}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" />
                Download CSV
              </button>
              <button
                onClick={async () => {
                  try {
                    const r = await apiFetch(`/clients/${client.id}/reports/summary/pdf`);
                    if (r.ok) { const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Report_${client.name || 'Client'}.pdf`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
                    else setError('Failed to download PDF');
                  } catch { setError('Network error'); }
                }}
                disabled={!reportData}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
              >
                <FileText className="h-3.5 w-3.5" />
                Download PDF
              </button>
            </div>
          </div>

          {loadingReport && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}

          {reportError && (
            <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {reportError}
            </div>
          )}

          {!loadingReport && !reportError && reportData && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-slate-100 p-2"><Users className="h-4 w-4 text-slate-600" /></div>
                    <div>
                      <p className="text-xs text-slate-500">Total Employees</p>
                      <p className="text-lg font-bold text-slate-900">{reportData.employeeSummary.totalEmployees.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-slate-100 p-2"><Briefcase className="h-4 w-4 text-slate-600" /></div>
                    <div>
                      <p className="text-xs text-slate-500">Active Employees</p>
                      <p className="text-lg font-bold text-slate-900">{reportData.employeeSummary.activeEmployees.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-slate-100 p-2"><DollarSign className="h-4 w-4 text-slate-600" /></div>
                    <div>
                      <p className="text-xs text-slate-500">Total Basic Pay</p>
                      <p className="text-lg font-bold text-slate-900">{reportData.employeeSummary.totalBasicPay.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-slate-100 p-2"><TrendingUp className="h-4 w-4 text-slate-600" /></div>
                    <div>
                      <p className="text-xs text-slate-500">Average Basic Pay</p>
                      <p className="text-lg font-bold text-slate-900">{Number(reportData.employeeSummary.avgBasicPay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* KPI Dashboard */}
              {kpiData && (
                <div className="mb-6 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <KpiCard icon={Users} label="Total Employees" value={kpiData.employeeCount} sub={`${kpiData.activeEmployees} active`} color="bg-blue-600" />
                    <KpiCard icon={Briefcase} label="Departments" value={kpiData.departmentCount} color="bg-purple-600" />
                    <KpiCard icon={Banknote} label="Loan Deductions" value={`KES ${(kpiData.totalMonthlyLoanDeductions || 0).toLocaleString()}`} sub="monthly total" color="bg-amber-600" />
                    <KpiCard icon={CalendarCheck} label="Pending Leave" value={kpiData.pendingLeaveRequests} sub={`${kpiData.approvedLeaveThisMonth || 0} approved`} color="bg-emerald-600" />
                    <KpiCard icon={FileText} label="Documents" value={kpiData.documentCount || 0} color="bg-slate-600" />
                    <KpiCard icon={TrendingUp} label="Payroll Runs" value={kpiData.payrollRunCount || 0} sub={kpiData.latestRunPeriod ? `Latest: ${kpiData.latestRunPeriod}` : 'No runs'} color="bg-red-600" />
                  </div>
                  {kpiData.recentRunData?.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <h4 className="text-xs font-bold text-slate-700 mb-3">Payroll Trend (Gross Pay per Period)</h4>
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={kpiData.recentRunData}>
                            <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip contentStyle={{ fontSize: 12 }} />
                            <Bar dataKey="totalGross" fill="#ff0613" radius={[4, 4, 0, 0]} name="Gross Pay" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <h4 className="text-xs font-bold text-slate-700 mb-3">Employee Status</h4>
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie data={[{ name: 'Active', value: kpiData.activeEmployees || 0 }, { name: 'Inactive', value: (kpiData.employeeCount || 0) - (kpiData.activeEmployees || 0) }].filter(d => d.value > 0)} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                              {[{ name: 'Active', value: kpiData.activeEmployees || 0 }, { name: 'Inactive', value: (kpiData.employeeCount || 0) - (kpiData.activeEmployees || 0) }].filter(d => d.value > 0).map((_, idx) => <Cell key={idx} fill={['#10b981', '#94a3b8'][idx % 2]} />)}
                            </Pie>
                            <Tooltip />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Report Filter */}
              <div className="mb-4 flex items-center gap-3 flex-wrap">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Filter:</span>
                <input
                  type="text"
                  value={attendanceOvertimePeriod}
                  onChange={e => { setAttendanceOvertimePeriod(e.target.value); }}
                  placeholder="Period (YYYY-MM)"
                  className="w-36 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <button
                  onClick={() => { fetchReport(); fetchKpiData(); }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Apply
                </button>
              </div>

              {/* Custom Report Builder */}
              <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Custom Report Builder</h4>
                  <div className="flex items-center gap-2">
                    <select
                      value={customReportType}
                      onChange={e => setCustomReportType(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    >
                      <option value="payroll-summary">Payroll Summary</option>
                      <option value="gross-to-net">Gross-to-Net</option>
                      <option value="overtime">Overtime Report</option>
                      <option value="loans">Loan Report</option>
                      <option value="leave">Leave Report</option>
                      <option value="attendance">Attendance Report</option>
                      <option value="lateness">Lateness Report</option>
                      <option value="statutory">Statutory Deductions</option>
                    </select>
                    <button
                      onClick={async () => {
                        try {
                          const params = new URLSearchParams({ reportType: customReportType });
                          if (attendanceOvertimePeriod) { params.set('periodFrom', attendanceOvertimePeriod); params.set('periodTo', attendanceOvertimePeriod); }
                          const r = await apiFetch(`/clients/${client.id}/reports/custom?${params}`);
                          if (r.ok) setCustomReportData(await r.json());
                          else setError('Failed to load report');
                        } catch { setError('Network error'); }
                      }}
                      className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition"
                    >
                      Generate
                    </button>
                    {customReportData && (
                      <>
                        <button
                          onClick={() => {
                            if (!customReportData?.rows?.length) return;
                            const keys = Object.keys(customReportData.rows[0]);
                            const csv = [keys.join(','), ...customReportData.rows.map((r: any) => keys.map((k: string) => String(r[k] ?? '')).join(','))].join('\n');
                            const blob = new Blob([csv], { type: 'text/csv' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a'); a.href = url; a.download = `Report_${customReportType}_${client.name || 'Client'}.csv`;
                            document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                          }}
                          disabled={!customReportData?.rows?.length}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
                        >
                          <Download className="h-3.5 w-3.5 inline mr-1" />CSV
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {customReportData && (
                  <div className="overflow-x-auto max-h-64">
                    {customReportData.totals && (
                      <div className="mb-2 flex flex-wrap gap-2 text-[10px]">
                        {Object.entries(customReportData.totals).map(([k, v]) => (
                          <span key={k} className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{k}: {typeof v === 'number' ? (v as number).toLocaleString() : String(v)}</span>
                        ))}
                      </div>
                    )}
                    {customReportData.rows?.length > 0 ? (
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50">
                            {Object.keys(customReportData.rows[0]).map(k => (
                              <th key={k} className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {customReportData.rows.slice(0, 50).map((row: any, i: number) => (
                            <tr key={i} className="hover:bg-slate-50/50">
                              {(Object.values(row) as any[]).map((v: any, j: number) => (
                                <td key={j} className="px-3 py-2 text-slate-700 text-right font-mono">{typeof v === 'number' ? v.toLocaleString() : String(v)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <p className="text-xs text-slate-400 py-2">No data for this report type and period.</p>}
                    {customReportData.rows?.length > 50 && <p className="text-[10px] text-slate-400 mt-1">Showing 50 of {customReportData.rows.length} rows</p>}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 mb-6">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Department Breakdown</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Department</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Count</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Total Pay</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(reportData.departmentBreakdown || []).map((d: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="px-3 py-2 font-medium text-slate-900">{d.department}</td>
                          <td className="px-3 py-2 text-right text-slate-700">{d.count}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{d.totalPay.toLocaleString()}</td>
                        </tr>
                      ))}
                      {(reportData.departmentBreakdown || []).length === 0 && (
                        <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-400">No department data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Leave Summary</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Total Requests</span>
                      <span className="font-semibold text-slate-900">{reportData.leaveSummary.total}</span>
                    </div>
                    {Object.entries(reportData.leaveSummary.byStatus || {}).map(([status, count]) => (
                      <div key={status} className="flex justify-between text-xs">
                        <span className="text-slate-500">By Status - {status}</span>
                        <span className="font-semibold text-slate-900">{count as number}</span>
                      </div>
                    ))}
                    {Object.entries(reportData.leaveSummary.byType || {}).map(([type, count]) => (
                      <div key={type} className="flex justify-between text-xs">
                        <span className="text-slate-500">By Type - {type}</span>
                        <span className="font-semibold text-slate-900">{count as number}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Loan Summary</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Total Loans</span>
                      <span className="font-semibold text-slate-900">{reportData.loanSummary.totalLoans}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Active Loans</span>
                      <span className="font-semibold text-slate-900">{reportData.loanSummary.activeLoans}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Paid Loans</span>
                      <span className="font-semibold text-slate-900">{reportData.loanSummary.paidLoans}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Total Principal</span>
                      <span className="font-semibold text-slate-900">{reportData.loanSummary.totalPrincipal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Outstanding Balance</span>
                      <span className="font-semibold text-slate-900">{reportData.loanSummary.outstandingBalance.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Attendance Summary (Last 30 Days)</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Total Records</span>
                    <span className="font-semibold text-slate-900">{reportData.attendanceSummary.total}</span>
                  </div>
                  {Object.entries(reportData.attendanceSummary || {}).filter(([k]) => k !== 'total').map(([status, count]) => (
                    <div key={status} className="flex justify-between text-xs">
                      <span className="text-slate-500">{status}</span>
                      <span className="font-semibold text-slate-900">{count as number}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {!loadingReport && !reportError && !reportData && (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <BarChart3 className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">No report data available</p>
              <p className="mt-2 text-xs text-slate-400">
                Ensure employees, leave, loans, and attendance data exists for this client.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ───── PAYE Tab ───── */}
      {activeTab === 'paye' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">B_Employees_Dtls_Simp.csv</span>
              <span className="ml-2 text-[10px] text-slate-400">— Generated PAYE CSV for iTax upload</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenGeneratedFile(client.payeZipUrl)}
                disabled={!client.payeZipUrl}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" />
                Download PAYE ZIP
              </button>
              <button
                onClick={handleDownloadPaye}
                disabled={payeRows.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" />
                Download CSV
              </button>
              {onAutoFilePaye && (
                <button
                  onClick={() => onAutoFilePaye(client)}
                  disabled={!client.payeZipUrl}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#ff0613] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#d80000] transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Cloud className="h-3.5 w-3.5" />
                  Auto File PAYE
                </button>
              )}
            </div>
          </div>
          {payeRows.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <p className="text-sm font-semibold text-slate-500">No PAYE data</p>
              <p className="mt-2 text-xs text-slate-400">
                Enter employee payroll data in the Master Payroll tab first.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {PAYE_COLUMNS.map(col => (
                      <th key={col} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payeRows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      {row.map((val, ci) => (
                        <td key={ci} className={`px-3 py-1.5 whitespace-nowrap ${ci >= 6 ? 'text-right' : ''}`}>
                          <span className={`${ci >= 6 ? 'font-mono' : ''} text-xs text-slate-900`}>{val}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                {payeRows.length} employee{payeRows.length !== 1 ? 's' : ''} · No header row in actual file
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───── NSSF Tab ───── */}
      {activeTab === 'nssf' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">NSSF Schedule</span>
              <span className="ml-2 text-[10px] text-slate-400">— Tier I (101) &amp; Tier II (102) contributions</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenGeneratedFile(client.nssfFileUrl)}
                disabled={!client.nssfFileUrl}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" />
                Download NSSF (.xlsx)
              </button>
              <button
                onClick={handleDownloadNssf}
                disabled={nssfRows.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" />
                Download CSV
              </button>
              {onAutoFileNssf && (
                <button
                  onClick={() => onAutoFileNssf(client)}
                  disabled={!client.nssfFileUrl}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#ff0613] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#d80000] transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Cloud className="h-3.5 w-3.5" />
                  Auto File NSSF
                </button>
              )}
            </div>
          </div>
          {nssfRows.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <p className="text-sm font-semibold text-slate-500">No NSSF data</p>
              <p className="mt-2 text-xs text-slate-400">
                Enter employee payroll data in the Master Payroll tab first.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-xs">
                <tbody>
                  <tr className="border-b border-slate-200">
                    <td className="px-4 py-3 font-bold text-sm text-slate-900" colSpan={12}>NSSF</td>
                  </tr>
                  <tr className="border-b border-slate-100"><td className="px-4 py-2 font-semibold text-slate-600 w-48">Employer PIN</td><td className="px-4 py-2 text-slate-900 font-mono">{preamble?.companyPin || '-'}</td><td colSpan={10} /></tr>
                  <tr className="border-b border-slate-100"><td className="px-4 py-2 font-semibold text-slate-600">NSSF No</td><td className="px-4 py-2 text-slate-900 font-mono">{preamble?.companyNssf || '-'}</td><td colSpan={10} /></tr>
                  <tr className="border-b border-slate-100"><td className="px-4 py-2 font-semibold text-slate-600">Employer Name</td><td className="px-4 py-2 text-slate-900 font-mono">{preamble?.companyName || '-'}</td><td colSpan={10} /></tr>
                  <tr className="border-b border-slate-100"><td className="px-4 py-2 font-semibold text-slate-600">Period</td><td className="px-4 py-2 text-slate-900 font-mono">--</td><td colSpan={10} /></tr>
                  <tr className="border-b border-slate-100 bg-slate-50"><td className="px-4 py-2 font-semibold text-slate-600">Total Income</td><td className="px-4 py-2 text-slate-900 font-mono font-bold">{nssfTotals.totalIncome.toFixed(2)}</td><td colSpan={10} /></tr>
                  <tr className="border-b border-slate-100"><td className="px-4 py-2 font-semibold text-slate-600">Total Member NSSF</td><td className="px-4 py-2 text-slate-900 font-mono">{nssfTotals.totalMemberNssf.toFixed(2)}</td><td colSpan={10} /></tr>
                  <tr className="border-b border-slate-100"><td className="px-4 py-2 font-semibold text-slate-600">Total Employer NSSF</td><td className="px-4 py-2 text-slate-900 font-mono">{nssfTotals.totalEmployerNssf.toFixed(2)}</td><td colSpan={10} /></tr>
                  <tr className="border-b border-slate-100 bg-slate-50"><td className="px-4 py-2 font-semibold text-slate-600">Total Contributions</td><td className="px-4 py-2 text-slate-900 font-mono font-bold">{nssfTotals.totalContributions.toFixed(2)}</td><td colSpan={10} /></tr>
                  <tr className="border-b border-slate-100"><td className="px-4 py-2 font-semibold text-slate-600">Total Record Count</td><td className="px-4 py-2 text-slate-900 font-mono">{nssfTotals.totalRecords}</td><td colSpan={10} /></tr>
                  <tr className="border-b border-slate-200"><td className="px-4 py-1" colSpan={12} /></tr>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {NSSF_COLUMNS.map(col => (
                      <th key={col} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                  {nssfRows.map(({ cols }, i) => (
                    <tr key={i} className={`hover:bg-slate-50/50 ${cols[6] === '101' ? '' : 'bg-amber-50/30'}`}>
                      {cols.map((val, ci) => (
                        <td key={ci} className={`px-3 py-1.5 whitespace-nowrap ${ci >= 7 ? 'text-right font-mono' : ''}`}>
                          <span className="text-xs text-slate-900">{val}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                {nssfRows.length} row{nssfRows.length !== 1 ? 's' : ''} · Tier I (101) shown normally, Tier II (102) highlighted
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───── SHA Tab ───── */}
      {activeTab === 'sha' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">SHA Schedule</span>
              <span className="ml-2 text-[10px] text-slate-400">— 2.75% contribution per employee</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenGeneratedFile(client.shaFileUrl)}
                disabled={!client.shaFileUrl}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" />
                Download SHA (.xlsx)
              </button>
              <button
                onClick={handleDownloadSha}
                disabled={shaRows.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" />
                Download CSV
              </button>
            </div>
          </div>
          {shaRows.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <p className="text-sm font-semibold text-slate-500">No SHA data</p>
              <p className="mt-2 text-xs text-slate-400">
                Enter employee payroll data in the Master Payroll tab first.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {SHA_COLUMNS.map(col => (
                      <th key={col} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shaRows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      {row.map((val, ci) => (
                        <td key={ci} className={`px-3 py-1.5 whitespace-nowrap ${ci === 7 ? 'text-right font-mono' : ''}`}>
                          <span className="text-xs text-slate-900">{val}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                {shaRows.length} employee{shaRows.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───── Email Tab ───── */}
      {activeTab === 'email' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Mass Emailing
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSendPayslips}
                disabled={sendingEmail}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
              >
                {sendingEmail ? (
                  <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Sending...</>
                ) : (
                  <><Mail className="h-3.5 w-3.5" /> Send Payslips</>
                )}
              </button>
              <button
                onClick={handleSendP9s}
                disabled={sendingEmail}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
              >
                {sendingEmail ? (
                  <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Sending...</>
                ) : (
                  <><FileText className="h-3.5 w-3.5" /> Send P9s</>
                )}
              </button>
            </div>
          </div>

          {emailResult && (
            <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              Sent: {emailResult.sent} | Failed: {emailResult.failed} | Total: {emailResult.total}
            </div>
          )}

          {loadingEmail ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : emailHistory.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <Mail className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">No email history</p>
              <p className="mt-2 text-xs text-slate-400">
                Send payslips or P9s to employees with email addresses.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Email</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Document</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Status</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Sent At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {emailHistory.map((h: any) => (
                    <tr key={h.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-3 py-2 font-medium text-slate-900">{h.employeeName}</td>
                      <td className="px-3 py-2 text-slate-700">{h.emailAddress}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 uppercase">
                          {h.documentType}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${h.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                          }`}>
                          {h.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{h.sentAt ? new Date(h.sentAt).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                {emailHistory.length} email{emailHistory.length !== 1 ? 's' : ''} sent
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───── HELB Tab ───── */}
      {activeTab === 'helb' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center">
          <img src={helbLogo} alt="HELB" className="mx-auto mb-4 h-12 w-12 object-contain opacity-40" />
          <h3 className="text-lg font-bold text-slate-900 mb-2">HELB Filing — Coming Soon</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            HELB (Higher Education Loans Board) filing functionality is under development.
            Check back soon for automated HELB return generation and submission.
          </p>
        </div>
      )}

      {/* ───── Employee Portal Tab ───── */}
      {activeTab === 'portal' && (
        <div>
          {!portalToken ? (
            <div className="mx-auto max-w-md mt-8">
              <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <div className="text-center mb-6">
                  <Globe className="mx-auto h-10 w-10 text-slate-400" />
                  <h3 className="mt-3 text-lg font-bold text-slate-900">Employee Portal</h3>
                  <p className="mt-1 text-xs text-slate-500">Sign in with your KRA PIN and password</p>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">KRA PIN</label>
                    <input
                      type="text"
                      value={portalLoginForm.kraPin}
                      onChange={e => setPortalLoginForm(f => ({ ...f, kraPin: e.target.value }))}
                      placeholder="P000000000X"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Password</label>
                    <input
                      type="password"
                      value={portalLoginForm.password}
                      onChange={e => setPortalLoginForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="Enter your password"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                      onKeyDown={async e => { if (e.key === 'Enter') { setPortalLoading(true); setPortalError(null); try { const r = await fetch('/api/auth/employee/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(portalLoginForm) }); if (r.ok) { const d = await r.json(); setPortalToken(d.token); localStorage.setItem('portal_token', d.token); setPortalEmployee(d.employee); } else { const e2 = await r.json(); setPortalError(e2.message || 'Login failed'); } } catch { setPortalError('Network error'); } finally { setPortalLoading(false); } } }}
                    />
                  </div>
                  {portalError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 flex items-center gap-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {portalError}
                    </div>
                  )}
                  <button
                    disabled={portalLoading}
                    onClick={async () => {
                      setPortalLoading(true);
                      setPortalError(null);
                      try {
                        const r = await fetch('/api/auth/employee/login', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(portalLoginForm),
                        });
                        if (r.ok) {
                          const d = await r.json();
                          setPortalToken(d.token);
                          localStorage.setItem('portal_token', d.token);
                          setPortalEmployee(d.employee);
                        } else {
                          const e2 = await r.json();
                          setPortalError(e2.message || 'Login failed');
                        }
                      } catch {
                        setPortalError('Network error');
                      } finally {
                        setPortalLoading(false);
                      }
                    }}
                    className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                  >
                    {portalLoading ? (
                      <><RefreshCw className="mr-1.5 inline h-3 w-3 animate-spin" /> Signing in...</>
                    ) : (
                      <><LogIn className="mr-1.5 inline h-3 w-3" /> Sign In</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPortalSubView('dashboard')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${portalSubView === 'dashboard' ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    Dashboard
                  </button>
                  <button
                    onClick={() => setPortalSubView('leave')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${portalSubView === 'leave' ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    Request Leave
                  </button>
                  <button
                    onClick={() => setPortalSubView('loan')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${portalSubView === 'loan' ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    Apply Loan
                  </button>
                </div>
                <button
                  onClick={() => { setPortalToken(null); setPortalEmployee(null); setPortalDashboard(null); setPortalDocuments([]); localStorage.removeItem('portal_token'); }}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition"
                >
                  Sign Out
                </button>
              </div>

              {portalSubView === 'dashboard' && (
                <>
                  {!portalDashboard && (
                    <div className="flex items-center justify-center py-12">
                      <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
                    </div>
                  )}
                  {portalEmployee && !portalDashboard && (
                    <button
                      onClick={async () => {
                        setPortalLoading(true);
                        try {
                          const [dashRes, docRes] = await Promise.all([
                            fetch('/api/portal/dashboard', { headers: { 'Authorization': `Bearer ${portalToken}` } }),
                            fetch('/api/portal/documents', { headers: { 'Authorization': `Bearer ${portalToken}` } }),
                          ]);
                          if (dashRes.ok) setPortalDashboard(await dashRes.json());
                          if (docRes.ok) setPortalDocuments(await docRes.json());
                        } catch { /* ignore */ } finally { setPortalLoading(false); }
                      }}
                      className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition"
                    >
                      Load Dashboard
                    </button>
                  )}
                  {portalDashboard && (
                    <div className="space-y-4">
                      {/* Employee Info Card */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="rounded-full bg-slate-100 p-2"><User className="h-5 w-5 text-slate-600" /></div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">{portalDashboard.employee.employeeName}</h3>
                            <p className="text-xs text-slate-500">{portalDashboard.employee.jobTitle} · {portalDashboard.employee.department}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                          <div><span className="text-slate-400">KRA PIN</span><p className="font-mono font-semibold text-slate-900">{portalDashboard.employee.kraPin}</p></div>
                          <div><span className="text-slate-400">ID Number</span><p className="font-semibold text-slate-900">{portalDashboard.employee.idNumber}</p></div>
                          <div><span className="text-slate-400">Email</span><p className="font-semibold text-slate-900">{portalDashboard.employee.email}</p></div>
                          <div><span className="text-slate-400">Phone</span><p className="font-semibold text-slate-900">{portalDashboard.employee.phone}</p></div>
                          <div><span className="text-slate-400">Status</span><p className="font-semibold text-slate-900">{portalDashboard.employee.employmentStatus}</p></div>
                          <div><span className="text-slate-400">Basic Pay</span><p className="font-mono font-semibold text-slate-900">KES {Number(portalDashboard.employee.basicPay).toLocaleString()}</p></div>
                          <div><span className="text-slate-400">NSSF No</span><p className="font-mono font-semibold text-slate-900">{portalDashboard.employee.nssfNo || '-'}</p></div>
                          <div><span className="text-slate-400">SHA No</span><p className="font-mono font-semibold text-slate-900">{portalDashboard.employee.shaNo || '-'}</p></div>
                          <div><span className="text-slate-400">Unpaid Leave Days</span><p className="font-mono font-semibold text-amber-700">{portalDashboard.totalUnpaidLeaveDays || 0}</p></div>
                          <div><span className="text-slate-400">Loan Deductions</span><p className="font-mono font-semibold text-rose-700">KES {Number(portalDashboard.totalLoanDeduction || 0).toLocaleString()}</p></div>
                          <div><span className="text-slate-400">Active Loans</span><p className="font-mono font-semibold text-slate-900">{portalDashboard.loanSummary.active}</p></div>
                          <div><span className="text-slate-400">Outstanding Balance</span><p className="font-mono font-semibold text-slate-900">KES {Number(portalDashboard.loanSummary.outstandingBalance || 0).toLocaleString()}</p></div>
                        </div>
                      </div>

                      {/* Summary Cards */}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex items-center gap-2 mb-2"><Calendar className="h-4 w-4 text-blue-500" /><span className="text-xs font-semibold text-slate-500 uppercase">Leave</span></div>
                          <p className="text-lg font-bold text-slate-900">{portalDashboard.leaveSummary.total}</p>
                          <div className="mt-1 flex gap-2 text-[10px]">
                            <span className="text-amber-600">{portalDashboard.leaveSummary.pending} pending</span>
                            <span className="text-emerald-600">{portalDashboard.leaveSummary.approved} approved</span>
                            <span className="text-red-600">{portalDashboard.leaveSummary.rejected} rejected</span>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex items-center gap-2 mb-2"><Banknote className="h-4 w-4 text-emerald-500" /><span className="text-xs font-semibold text-slate-500 uppercase">Loans</span></div>
                          <p className="text-lg font-bold text-slate-900">{portalDashboard.loanSummary.total}</p>
                          <div className="mt-1 flex gap-2 text-[10px]">
                            <span className="text-amber-600">{portalDashboard.loanSummary.active} active</span>
                            <span className="text-emerald-600">{portalDashboard.loanSummary.paid} paid</span>
                            <span className="text-slate-600">KES {Number(portalDashboard.loanSummary.outstandingBalance).toLocaleString()} outstanding</span>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex items-center gap-2 mb-2"><CalendarCheck className="h-4 w-4 text-purple-500" /><span className="text-xs font-semibold text-slate-500 uppercase">Attendance</span></div>
                          <p className="text-lg font-bold text-slate-900">{portalDashboard.attendanceSummary.total}</p>
                          <div className="mt-1 flex gap-2 text-[10px]">
                            <span className="text-emerald-600">{portalDashboard.attendanceSummary.present} present</span>
                            <span className="text-red-600">{portalDashboard.attendanceSummary.absent} absent</span>
                            <span className="text-amber-600">{portalDashboard.attendanceSummary.late} late</span>
                          </div>
                        </div>
                      </div>

                      {/* Recent Activity + Documents */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Recent Leave Requests</h4>
                          {portalDashboard.recentLeave.length === 0 ? (
                            <p className="text-xs text-slate-400">No leave requests</p>
                          ) : (
                            <div className="space-y-1.5">
                              {portalDashboard.recentLeave.map((l: any) => (
                                <div key={l.id} className="flex items-center justify-between text-xs">
                                  <span className="text-slate-700">{l.leaveType} · {l.startDate} to {l.endDate}</span>
                                  <div className="flex items-center gap-1.5">
                                    {l.status === 'Pending' && (
                                      <>
                                        <button
                                          onClick={() => {
                                            setPortalEditingLeave(l);
                                            setPortalLeaveForm({
                                              leaveType: l.leaveType || 'Annual',
                                              startDate: l.startDate || '',
                                              endDate: l.endDate || '',
                                              daysCount: l.daysCount || 1,
                                              reason: l.reason || '',
                                            });
                                            setPortalSubView('leave');
                                          }}
                                          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200 transition"
                                          title="Edit"
                                        >
                                          <Pencil className="h-3 w-3" />
                                        </button>
                                        <button
                                          onClick={async () => {
                                            if (!confirm('Delete this leave request?')) return;
                                            try {
                                              const r = await fetch(`/api/portal/leave/${l.id}`, {
                                                method: 'DELETE',
                                                headers: { 'Authorization': `Bearer ${portalToken}` },
                                              });
                                              if (r.ok) {
                                                setPortalDashboard(null);
                                              }
                                            } catch { /* ignore */ }
                                          }}
                                          className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-100 transition"
                                          title="Delete"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </button>
                                      </>
                                    )}
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${l.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' :
                                        l.status === 'Rejected' ? 'bg-red-50 text-red-700' :
                                          'bg-amber-50 text-amber-700'
                                      }`}>{l.status}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Recent Loans</h4>
                          {portalDashboard.recentLoans.length === 0 ? (
                            <p className="text-xs text-slate-400">No loan records</p>
                          ) : (
                            <div className="space-y-1.5">
                              {portalDashboard.recentLoans.map((l: any) => (
                                <div key={l.id} className="flex items-center justify-between text-xs">
                                  <span className="text-slate-700">{l.loanType} · KES {Number(l.principal).toLocaleString()}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${l.status === 'Paid' ? 'bg-emerald-50 text-emerald-700' :
                                      l.status === 'Active' ? 'bg-blue-50 text-blue-700' :
                                        'bg-amber-50 text-amber-700'
                                    }`}>{l.status}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Document Downloads */}
                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Documents</h4>
                        <div className="flex flex-wrap gap-2 mb-3">
                          <button
                            onClick={async () => {
                              try {
                                const r = await fetch(`/api/portal/payslip`, { headers: { 'Authorization': `Bearer ${portalToken}` } });
                                if (r.ok) { const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Payslip_${portalDashboard.employee.kraPin}.pdf`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
                              } catch { /* ignore */ }
                            }}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                          >
                            <FileText className="h-3.5 w-3.5" /> Download Payslip
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                const r = await fetch(`/api/portal/p9`, { headers: { 'Authorization': `Bearer ${portalToken}` } });
                                if (r.ok) { const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `P9_${portalDashboard.employee.kraPin}.pdf`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
                              } catch { /* ignore */ }
                            }}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                          >
                            <FileText className="h-3.5 w-3.5" /> Download P9
                          </button>
                        </div>
                        {portalDocuments.length > 0 && (
                          <div className="border-t border-slate-100 pt-2">
                            <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1.5">Uploaded Documents</p>
                            <div className="space-y-1">
                              {portalDocuments.map((d: any) => (
                                <div key={d.id} className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-1.5 text-slate-700 truncate">
                                    <FileText className="h-3 w-3 shrink-0 text-slate-400" />
                                    <span className="truncate">{d.originalName}</span>
                                    <span className="text-slate-400">({(d.fileSize / 1024).toFixed(0)} KB)</span>
                                  </div>
                                  <button
                                    onClick={async () => {
                                      try {
                                        const r = await fetch(`/api/portal/documents/${d.id}/download`, { headers: { 'Authorization': `Bearer ${portalToken}` } });
                                        if (r.ok) { const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = d.originalName; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
                                      } catch { /* ignore */ }
                                    }}
                                    className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200 transition"
                                  >
                                    Download
                                  </button>
                                  <button
                                    onClick={handleImportFromMasterCsv}
                                    disabled={importingEmployees}
                                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
                                  >
                                    {importingEmployees ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Importing...</> : <><Cloud className="h-3.5 w-3.5" /> Import to DB</>}
                                  </button>
                                  <button
                                    onClick={() => openEmployeeModal()}
                                    className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900 transition"
                                  >
                                    <Plus className="h-3.5 w-3.5" /> Add Employee
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {portalSubView === 'leave' && (
                <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-900 mb-4">{portalEditingLeave ? 'Edit Leave Request' : 'Request Leave'}</h3>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Leave Type</label>
                        <select
                          value={portalLeaveForm.leaveType}
                          onChange={e => setPortalLeaveForm(f => ({ ...f, leaveType: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                        >
                          <option>Annual</option>
                          <option>Sick</option>
                          <option>Compassionate</option>
                          <option>Study</option>
                          <option>Maternity</option>
                          <option>Paternity</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Days</label>
                        <input
                          type="number"
                          value={portalLeaveForm.daysCount}
                          onChange={e => setPortalLeaveForm(f => ({ ...f, daysCount: parseInt(e.target.value) || 1 }))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Start Date</label>
                        <input
                          type="text"
                          value={portalLeaveForm.startDate}
                          onChange={e => setPortalLeaveForm(f => ({ ...f, startDate: e.target.value }))}
                          placeholder="YYYY-MM-DD"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">End Date</label>
                        <input
                          type="text"
                          value={portalLeaveForm.endDate}
                          onChange={e => setPortalLeaveForm(f => ({ ...f, endDate: e.target.value }))}
                          placeholder="YYYY-MM-DD"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Reason</label>
                      <textarea
                        value={portalLeaveForm.reason}
                        onChange={e => setPortalLeaveForm(f => ({ ...f, reason: e.target.value }))}
                        rows={3}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={portalSubmitting}
                        onClick={async () => {
                          setPortalSubmitting(true);
                          try {
                            const url = portalEditingLeave ? `/api/portal/leave/${portalEditingLeave.id}` : '/api/portal/leave';
                            const r = await fetch(url, {
                              method: portalEditingLeave ? 'PUT' : 'POST',
                              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${portalToken}` },
                              body: JSON.stringify(portalLeaveForm),
                            });
                            if (r.ok) {
                              setPortalSubView('dashboard');
                              setPortalDashboard(null);
                              setPortalDocuments([]);
                              setPortalLeaveForm({ leaveType: 'Annual', startDate: '', endDate: '', daysCount: 1, reason: '' });
                              setPortalEditingLeave(null);
                            }
                          } catch { /* ignore */ } finally { setPortalSubmitting(false); }
                        }}
                        className="flex-1 rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                      >
                        {portalSubmitting ? <><RefreshCw className="mr-1.5 inline h-3 w-3 animate-spin" /> Submitting...</> : (portalEditingLeave ? 'Save Changes' : 'Submit Leave Request')}
                      </button>
                      {portalEditingLeave && (
                        <button
                          onClick={() => {
                            setPortalEditingLeave(null);
                            setPortalLeaveForm({ leaveType: 'Annual', startDate: '', endDate: '', daysCount: 1, reason: '' });
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {portalSubView === 'loan' && (
                <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-900 mb-4">Apply for Loan</h3>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Loan Type</label>
                        <select
                          value={portalLoanForm.loanType}
                          onChange={e => setPortalLoanForm(f => ({ ...f, loanType: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                        >
                          <option>Salary Advance</option>
                          <option>Emergency Loan</option>
                          <option>Normal Loan</option>
                          <option>Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Principal (KES)</label>
                        <input
                          type="number"
                          value={portalLoanForm.principal}
                          onChange={e => setPortalLoanForm(f => ({ ...f, principal: parseFloat(e.target.value) || 0 }))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Installments</label>
                        <input
                          type="number"
                          value={portalLoanForm.installments}
                          onChange={e => setPortalLoanForm(f => ({ ...f, installments: parseInt(e.target.value) || 1 }))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Interest Rate (%)</label>
                        <input
                          type="number"
                          value={portalLoanForm.interestRate}
                          onChange={e => setPortalLoanForm(f => ({ ...f, interestRate: parseFloat(e.target.value) || 0 }))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Notes</label>
                      <textarea
                        value={portalLoanForm.notes}
                        onChange={e => setPortalLoanForm(f => ({ ...f, notes: e.target.value }))}
                        rows={3}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                      />
                    </div>
                    <button
                      disabled={portalSubmitting}
                      onClick={async () => {
                        setPortalSubmitting(true);
                        try {
                          const r = await fetch('/api/portal/loans', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${portalToken}` },
                            body: JSON.stringify(portalLoanForm),
                          });
                          if (r.ok) {
                            setPortalSubView('dashboard');
                            setPortalDashboard(null);
                            setPortalDocuments([]);
                            setPortalLoanForm({ loanType: 'Salary Advance', principal: 0, installments: 1, interestRate: 0, notes: '' });
                          }
                        } catch { /* ignore */ } finally { setPortalSubmitting(false); }
                      }}
                      className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                    >
                      {portalSubmitting ? <><RefreshCw className="mr-1.5 inline h-3 w-3 animate-spin" /> Submitting...</> : 'Submit Loan Application'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ───── Attendance Modal ───── */}
      {showAttendanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-sm font-bold text-slate-900">
                {editingAttendance ? 'Edit Attendance Record' : 'Add Attendance Record'}
              </h3>
              <button
                onClick={() => setShowAttendanceModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Employee ID</label>
                  <input
                    type="number"
                    value={attendanceForm.employeeId}
                    onChange={e => setAttendanceForm((f: any) => ({ ...f, employeeId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Employee Name</label>
                  <input
                    type="text"
                    value={attendanceForm.employeeName}
                    onChange={e => setAttendanceForm((f: any) => ({ ...f, employeeName: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">KRA PIN</label>
                  <input
                    type="text"
                    value={attendanceForm.kraPin}
                    onChange={e => setAttendanceForm((f: any) => ({ ...f, kraPin: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Date</label>
                  <input
                    type="date"
                    value={attendanceForm.date}
                    onChange={e => setAttendanceForm((f: any) => ({ ...f, date: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Check In</label>
                  <input
                    type="time"
                    value={attendanceForm.checkIn}
                    onChange={e => setAttendanceForm((f: any) => ({ ...f, checkIn: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Check Out</label>
                  <input
                    type="time"
                    value={attendanceForm.checkOut}
                    onChange={e => setAttendanceForm((f: any) => ({ ...f, checkOut: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</label>
                  <select
                    value={attendanceForm.status}
                    onChange={e => setAttendanceForm((f: any) => ({ ...f, status: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option>Present</option>
                    <option>Absent</option>
                    <option>Late</option>
                    <option>Half-Day</option>
                    <option>Leave</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Notes</label>
                <textarea
                  value={attendanceForm.notes}
                  onChange={e => setAttendanceForm((f: any) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button
                onClick={() => setShowAttendanceModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAttendance}
                className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition"
              >
                {editingAttendance ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Loans Modal ───── */}
      {showLoanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-sm font-bold text-slate-900">
                {editingLoan ? 'Edit Loan' : 'Add Loan'}
              </h3>
              <button
                onClick={() => setShowLoanModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Employee ID</label>
                  <input
                    type="number"
                    value={loanForm.employeeId}
                    onChange={e => setLoanForm((f: any) => ({ ...f, employeeId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Employee Name</label>
                  <input
                    type="text"
                    value={loanForm.employeeName}
                    onChange={e => setLoanForm((f: any) => ({ ...f, employeeName: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">KRA PIN</label>
                  <input
                    type="text"
                    value={loanForm.kraPin}
                    onChange={e => setLoanForm((f: any) => ({ ...f, kraPin: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Loan Type</label>
                  <select
                    value={loanForm.loanType}
                    onChange={e => setLoanForm((f: any) => ({ ...f, loanType: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option>Salary Advance</option>
                    <option>Emergency Loan</option>
                    <option>Normal Loan</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Principal</label>
                  <input
                    type="number"
                    value={loanForm.principal}
                    onChange={e => setLoanForm((f: any) => ({ ...f, principal: parseFloat(e.target.value) || 0 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Monthly Deduction</label>
                  <input
                    type="number"
                    value={loanForm.monthlyDeduction}
                    onChange={e => setLoanForm((f: any) => ({ ...f, monthlyDeduction: parseFloat(e.target.value) || 0 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Installments</label>
                  <input
                    type="number"
                    value={loanForm.installments}
                    onChange={e => setLoanForm((f: any) => ({ ...f, installments: parseInt(e.target.value) || 0 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Remaining Installments</label>
                  <input
                    type="number"
                    value={loanForm.remainingInstallments}
                    onChange={e => setLoanForm((f: any) => ({ ...f, remainingInstallments: parseInt(e.target.value) || 0 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Interest Rate (%)</label>
                  <input
                    type="number"
                    value={loanForm.interestRate}
                    onChange={e => setLoanForm((f: any) => ({ ...f, interestRate: parseFloat(e.target.value) || 0 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Total Interest</label>
                  <input
                    type="number"
                    value={loanForm.totalInterest}
                    onChange={e => setLoanForm((f: any) => ({ ...f, totalInterest: parseFloat(e.target.value) || 0 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Amount Paid</label>
                  <input
                    type="number"
                    value={loanForm.amountPaid}
                    onChange={e => setLoanForm((f: any) => ({ ...f, amountPaid: parseFloat(e.target.value) || 0 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</label>
                  <select
                    value={loanForm.status}
                    onChange={e => setLoanForm((f: any) => ({ ...f, status: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option>Approved</option>
                    <option>Active</option>
                    <option>Paid</option>
                    <option>Defaulted</option>
                    <option>Rejected</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Disbursed Date</label>
                <input
                  type="text"
                  value={loanForm.disbursedAt}
                  onChange={e => setLoanForm((f: any) => ({ ...f, disbursedAt: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Notes</label>
                <textarea
                  value={loanForm.notes}
                  onChange={e => setLoanForm((f: any) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button
                onClick={() => setShowLoanModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLoan}
                className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition"
              >
                {editingLoan ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Leave Modal ───── */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-sm font-bold text-slate-900">
                {editingLeave ? 'Edit Leave Request' : 'Add Leave Request'}
              </h3>
              <button
                onClick={() => setShowLeaveModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Employee ID</label>
                  <input
                    type="number"
                    value={leaveForm.employeeId}
                    onChange={e => setLeaveForm((f: any) => ({ ...f, employeeId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Employee Name</label>
                  <input
                    type="text"
                    value={leaveForm.employeeName}
                    onChange={e => setLeaveForm((f: any) => ({ ...f, employeeName: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">KRA PIN</label>
                  <input
                    type="text"
                    value={leaveForm.kraPin}
                    onChange={e => setLeaveForm((f: any) => ({ ...f, kraPin: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Leave Type</label>
                  <select
                    value={leaveForm.leaveType}
                    onChange={e => setLeaveForm((f: any) => ({ ...f, leaveType: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    {leaveTypes.map((lt: any) => (
                      <option key={lt.id} value={lt.name}>{lt.name} {lt.isPaid ? '(Paid)' : '(Unpaid)'}</option>
                    ))}
                    <option disabled>──────────</option>
                    <option>Annual</option>
                    <option>Sick</option>
                    <option>Compassionate</option>
                    <option>Study</option>
                    <option>Maternity</option>
                    <option>Paternity</option>
                  </select>
                </div>
                <div className="col-span-2 flex items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    id="leave-isPaid"
                    checked={leaveForm.isPaid !== false}
                    onChange={e => setLeaveForm((f: any) => ({ ...f, isPaid: e.target.checked }))}
                    className="rounded border-slate-300 text-slate-950 focus:ring-slate-500"
                  />
                  <label htmlFor="leave-isPaid" className="text-xs text-slate-700">Paid Leave</label>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Start Date</label>
                  <input
                    type="date"
                    value={leaveForm.startDate}
                    onChange={e => setLeaveForm((f: any) => ({ ...f, startDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">End Date</label>
                  <input
                    type="date"
                    value={leaveForm.endDate}
                    onChange={e => setLeaveForm((f: any) => ({ ...f, endDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Days Count</label>
                  <input
                    type="number"
                    value={leaveForm.daysCount}
                    onChange={e => setLeaveForm((f: any) => ({ ...f, daysCount: parseInt(e.target.value) || 0 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</label>
                  <select
                    value={leaveForm.status}
                    onChange={e => setLeaveForm((f: any) => ({ ...f, status: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option>Pending</option>
                    <option>Approved</option>
                    <option>Rejected</option>
                    <option>Cancelled</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Reason</label>
                <textarea
                  value={leaveForm.reason}
                  onChange={e => setLeaveForm((f: any) => ({ ...f, reason: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button
                onClick={() => setShowLeaveModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLeave}
                className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition"
              >
                {editingLeave ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Payroll Runs Tab ───── */}
      {activeTab === 'runs' && (
        <div>
          {runDetailView === 'list' ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Payroll Runs</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newRunPeriod}
                    onChange={e => setNewRunPeriod(e.target.value)}
                    placeholder="YYYY-MM"
                    className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  {isPastDeadline(newRunPeriod) && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 whitespace-nowrap">
                      <AlertCircle className="h-3 w-3" /> Past deadline — penalty may apply
                    </span>
                  )}
                  <input
                    type="text"
                    value={newRunNotes}
                    onChange={e => setNewRunNotes(e.target.value)}
                    placeholder="Notes (optional)"
                    className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <button
                    disabled={!newRunPeriod || loadingRuns}
                    onClick={async () => {
                      setLoadingRuns(true);
                      try {
                        const r = await apiFetch(`/clients/${client.id}/payroll-runs`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ period: newRunPeriod, notes: newRunNotes }),
                        });
                        if (r.ok) { setNewRunPeriod(''); setNewRunNotes(''); setStatusMessage('Payroll run created'); }
                        else { const e = await r.json(); setError(e.message || 'Failed'); }
                        fetchRuns();
                      } catch { setError('Network error'); } finally { setLoadingRuns(false); }
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" /> New Run
                  </button>
                  <button
                    onClick={async () => {
                      setAttendanceApprovalPeriod(newRunPeriod || getCurrentFilingPeriod().period);
                      setLoadingAttendanceApproval(true);
                      setShowAttendanceApprovalModal(true);
                      try {
                        const r = await apiFetch(`/clients/${client.id}/attendance-payroll-preview?period=${newRunPeriod || getCurrentFilingPeriod().period}`, { method: 'POST' });
                        if (r.ok) {
                          const data = await r.json();
                          setAttendanceApprovalData(data.employees || []);
                        } else { setError('Failed to load attendance preview'); }
                      } catch { setError('Network error'); }
                      finally { setLoadingAttendanceApproval(false); }
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                    title="Review and approve attendance data before generating payroll"
                  >
                    <CalendarCheck className="h-3.5 w-3.5" /> Review Attendance
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const r = await apiFetch(`/clients/${client.id}/payroll-runs/debug`);
                        const d = await r.json();
                        setStatusMessage(`Debug: ${d.activeEmployees} active employees. Sample: ${JSON.stringify(d.sample)}`);
                      } catch { setError('Debug fetch failed'); }
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition"
                    title="Debug: check employee data"
                  >
                    Debug
                  </button>
                </div>
              </div>

              {loadingRuns ? (
                <div className="flex items-center justify-center py-12"><RefreshCw className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : payrollRuns.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
                  <RefreshCw className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-500">No payroll runs</p>
                  <p className="mt-2 text-xs text-slate-400">Enter a period (YYYY-MM) and click New Run to start.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Period</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Status</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Employees</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Gross Pay</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Net Pay</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Notes</th>
                        <th className="px-3 py-2.5 w-32" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payrollRuns.map((run: any) => (
                        <tr key={run.id} className="hover:bg-slate-50/50 transition">
                          <td className="px-3 py-2 font-semibold text-slate-900">{run.periodLabel} <span className="text-slate-400 font-mono">({run.period})</span></td>
                          <td className="px-3 py-2">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${run.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                                run.status === 'processing' ? 'bg-blue-50 text-blue-700' :
                                  'bg-slate-100 text-slate-500'
                              }`}>{run.status}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{run.totalEmployees}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(run.totalGross).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(run.totalNet).toLocaleString()}</td>
                          <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">{run.notes || '-'}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => { setSelectedRun(run); fetchRunEntries(run.id); fetchRunAdjustments(run.id); setRunDetailView('detail'); if (client.payeZipUrl) { setComplianceResult({ payeZipUrl: client.payeZipUrl, payeZipLabel: client.payeZipLabel, nssfFileUrl: client.nssfFileUrl, nssfFileLabel: client.nssfFileLabel, shaFileUrl: client.shaFileUrl, shaFileLabel: client.shaFileLabel, summaryAmounts: { payeAmount: client.payeAmount || 0, nitaAmount: client.nitaAmount || 0, housingLevyAmount: client.housingLevyAmount || 0, nssfAmount: client.nssfAmount || 0, shaAmount: client.shaAmount || 0 } }); } }}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                                title="View"
                              ><FileText className="h-3.5 w-3.5" /></button>
                              <button
                                onClick={async () => {
                                  setGeneratingRun(true);
                                  try {
                                    const r = await apiFetch(`/clients/${client.id}/payroll-runs/${run.id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prorate: true }) });
                                    if (r.ok) {
                                      const data = await r.json();
                                      const diag = data.diagnostic;
                                      if (diag?.employeesWithZeroBasicPay > 0) {
                                        setError(`Warning: ${diag.employeesWithZeroBasicPay} employee(s) have basicPay=0. Check their profiles.`);
                                      }
                                      setStatusMessage(`Generated ${data.entriesGenerated} entries for ${run.periodLabel}`);
                                      setPayrollRuns((prev: any[]) => prev.map((p: any) => p.id === run.id ? data.run : p));
                                    } else {
                                      const e = await r.json();
                                      setError(e.hint || e.message || 'Failed');
                                    }
                                  } catch { setError('Network error'); } finally {
                                    setGeneratingRun(false);
                                  }
                                }}
                                disabled={generatingRun}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700 transition"
                                title={run.status === 'draft' ? 'Generate Entries' : 'Regenerate Entries'}
                              ><RefreshCw className={`h-3.5 w-3.5 ${generatingRun ? 'animate-spin' : ''}`} /></button>
                              {run.status === 'completed' && (
                                <a
                                  href={`/api/clients/${client.id}/payroll-runs/${run.id}/payslips`}
                                  className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-700 transition"
                                  title="Download All Payslips (ZIP)"
                                ><Download className="h-3.5 w-3.5" /></a>
                              )}
                              <button
                                onClick={async () => {
                                  if (!window.confirm('Delete this payroll run?')) return;
                                  try { await apiFetch(`/clients/${client.id}/payroll-runs/${run.id}`, { method: 'DELETE' }); fetchRuns(); }
                                  catch { setError('Delete failed'); }
                                }}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                                title="Delete"
                              ><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={() => { setRunDetailView('list'); setSelectedRun(null); setRunEntries([]); }}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {selectedRun?.periodLabel} — {selectedRun?.status}
                </span>
                {selectedRun?.lockedAt && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Finalized
                  </span>
                )}
              </div>

              {/* Run Action Bar */}
              {runEntries.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button
                    disabled={selectedRun?.lockedAt}
                    onClick={async () => {
                      if (!selectedRun) return;
                      try {
                        const r = await apiFetch(`/clients/${client.id}/payroll-runs/${selectedRun.id}/finalize`, { method: 'POST' });
                        const d = await r.json();
                        if (r.ok) {
                          setSelectedRun((prev: any) => ({ ...prev, lockedAt: d.finalizedAt, status: 'closed' }));
                          setStatusMessage(d.warnings?.length ? `Finalized with ${d.warnings.length} warning(s)` : 'Run finalized');
                          if (d.warnings?.length) console.warn('1/3 rule warnings:', d.warnings);
                        } else setError(d.message || 'Finalize failed');
                      } catch { setError('Network error'); }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition disabled:opacity-40"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Finalize Run
                  </button>
                  <button
                    disabled={!selectedRun?.lockedAt}
                    onClick={async () => {
                      if (!selectedRun) return;
                      try {
                        const r = await apiFetch(`/clients/${client.id}/payroll-runs/${selectedRun.id}/rollback`, { method: 'POST' });
                        const d = await r.json();
                        if (r.ok) {
                          setSelectedRun((prev: any) => ({ ...prev, lockedAt: null, status: 'completed' }));
                          setStatusMessage('Run rolled back');
                        } else setError(d.message || 'Rollback failed');
                      } catch { setError('Network error'); }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 transition disabled:opacity-40"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Rollback
                  </button>
                  <button
                    disabled={selectedRun?.lockedAt}
                    onClick={async () => {
                      if (!selectedRun) return;
                      setGeneratingRun(true);
                      try {
                        const r = await apiFetch(`/clients/${client.id}/payroll-runs/${selectedRun.id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prorate: true }) });
                        if (r.ok) { await fetchRunEntries(selectedRun.id); setStatusMessage('Regenerated'); }
                        else { const d = await r.json(); setError(d.message || 'Failed'); }
                      } catch { setError('Network error'); }
                      finally { setGeneratingRun(false); }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
                  >
                    {generatingRun ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Regenerate
                  </button>
                  <button
                    onClick={() => setShowAdjustmentsForm(v => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                  >
                    <DollarSign className="h-3.5 w-3.5" /> {showAdjustmentsForm ? 'Hide' : 'Show'} Adjustments
                  </button>
                </div>
              )}

              {/* Dynamic Adjustments Panel */}
              {showAdjustmentsForm && (
                <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Dynamic Adjustments</h4>
                  {loadingAdjustments ? (
                    <div className="flex items-center justify-center py-6"><RefreshCw className="h-4 w-4 animate-spin text-slate-400" /></div>
                  ) : (
                    <>
                      {runAdjustments.length > 0 && (
                        <table className="mb-3 w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 bg-slate-50">
                              <th className="px-2 py-1.5 font-semibold text-slate-500">Label</th>
                              <th className="px-2 py-1.5 font-semibold text-slate-500">Type</th>
                              <th className="px-2 py-1.5 font-semibold text-slate-500 text-right">Amount</th>
                              <th className="px-2 py-1.5 font-semibold text-slate-500">Statutory</th>
                              <th className="px-2 py-1.5" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {runAdjustments.map((adj: any) => (
                              <tr key={adj.id}>
                                <td className="px-2 py-1.5 text-slate-900">{adj.label}</td>
                                <td className="px-2 py-1.5 capitalize text-slate-700">{adj.type}</td>
                                <td className="px-2 py-1.5 text-right font-mono text-slate-900">{Number(adj.amount).toLocaleString()}</td>
                                <td className="px-2 py-1.5 text-slate-500">{adj.isStatutory ? 'Yes' : 'No'}</td>
                                <td className="px-2 py-1.5 text-right">
                                  <button
                                    disabled={selectedRun?.lockedAt}
                                    onClick={async () => {
                                      if (!selectedRun) return;
                                      try {
                                        const r = await apiFetch(`/clients/${client.id}/payroll-runs/${selectedRun.id}/adjustments/${adj.id}`, { method: 'DELETE' });
                                        if (r.ok) { setRunAdjustments(prev => prev.filter(a => a.id !== adj.id)); }
                                      } catch { /* ignore */ }
                                    }}
                                    className="rounded p-1 text-rose-400 hover:bg-rose-50 hover:text-rose-700 transition disabled:opacity-40"
                                  ><Trash2 className="h-3 w-3" /></button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div className="flex flex-wrap items-end gap-2">
                        <select
                          value={adjustmentForm.employeeId}
                          onChange={e => setAdjustmentForm(f => ({ ...f, employeeId: e.target.value }))}
                          className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900"
                        >
                          <option value="">Select employee</option>
                          {runEntries.map((e: any) => (
                            <option key={e.employeeId} value={e.employeeId}>{e.employeeName}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          placeholder="Label e.g. Transport Allowance"
                          value={adjustmentForm.label}
                          onChange={e => setAdjustmentForm(f => ({ ...f, label: e.target.value }))}
                          className="w-40 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900"
                        />
                        <select
                          value={adjustmentForm.type}
                          onChange={e => setAdjustmentForm(f => ({ ...f, type: e.target.value }))}
                          className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900"
                        >
                          <option value="allowance">Allowance</option>
                          <option value="deduction">Deduction</option>
                        </select>
                        <input
                          type="number"
                          placeholder="Amount"
                          value={adjustmentForm.amount || ''}
                          onChange={e => setAdjustmentForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                          className="w-24 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-right text-slate-900"
                        />
                        <button
                          disabled={!adjustmentForm.employeeId || !adjustmentForm.label || selectedRun?.lockedAt}
                          onClick={async () => {
                            if (!selectedRun || !adjustmentForm.employeeId) return;
                            try {
                              const r = await apiFetch(`/clients/${client.id}/payroll-runs/${selectedRun.id}/adjustments`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  employeeId: Number(adjustmentForm.employeeId),
                                  label: adjustmentForm.label,
                                  type: adjustmentForm.type,
                                  amount: adjustmentForm.amount,
                                }),
                              });
                              if (r.ok) {
                                setAdjustmentForm({ employeeId: '', label: '', type: 'allowance', amount: 0 });
                                await fetchRunAdjustments(selectedRun.id);
                              } else { const d = await r.json(); setError(d.message || 'Failed'); }
                            } catch { setError('Network error'); }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {loadingEntries ? (
                <div className="flex items-center justify-center py-12"><RefreshCw className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : runEntries.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
                  <p className="text-sm font-semibold text-slate-500">No entries yet</p>
                  <p className="mt-2 text-xs text-slate-400">Click the Generate button to auto-compute entries.</p>
                </div>
              ) : null}

              {/* Compliance File Generation */}
              {runEntries.length > 0 && (
                <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Compliance Files</h4>
                    <button
                      disabled={generatingCompliance}
                      onClick={async () => {
                        if (!selectedRun) return;
                        setGeneratingCompliance(true);
                        setError(null);
                        try {
                          const r = await apiFetch(`/clients/${client.id}/payroll-runs/${selectedRun.id}/generate-compliance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ generatePaye: true, generateNssf: true, generateSha: true }) });
                          const data = await r.json();
                          if (r.ok) { setComplianceResult(data); setStatusMessage('Compliance files generated'); onGenerateCompliance?.(client, data); }
                          else setError(data.message || 'Failed');
                        } catch { setError('Network error'); }
                        finally { setGeneratingCompliance(false); }
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                    >
                      {generatingCompliance ? (
                        <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Generating...</>
                      ) : (
                        'Generate Compliance Files'
                      )}
                    </button>
                  </div>
                  {complianceResult && (
                    <div className="space-y-2">
                      {complianceResult.payeZipUrl && (
                        <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                          <div className="flex items-center gap-2 text-xs">
                            <FileText className="h-3.5 w-3.5 text-slate-400" />
                            <span className="font-medium text-slate-900">PAYE ZIP</span>
                            <span className="text-slate-400">{complianceResult.payeZipLabel}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <a href={complianceResult.payeZipUrl} download className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 transition"><Download className="h-3 w-3" /> Download</a>
                            <button disabled={filingPaye} onClick={async () => {
                              setFilingPaye(true);
                              setError(null);
                              try {
                                const parts = selectedRun?.period?.split('-') || [];
                                const y = parseInt(parts[0], 10); const m = parseInt(parts[1], 10);
                                const mm = String(isNaN(m) ? new Date().getMonth() + 1 : m).padStart(2, '0');
                                const yyyy = String(isNaN(y) ? new Date().getFullYear() : y);
                                const lastDay = new Date(isNaN(y) ? new Date().getFullYear() : y, isNaN(m) ? new Date().getMonth() + 1 : m, 0).getDate();
                                const payload = { kraPin: client.pin, kraPassword: client.password || client.iTaxPassword || '1234', periodFrom: `${yyyy}-${mm}-01`, periodTo: `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`, taxObligationType: 'paye', payeZipUrl: complianceResult.payeZipUrl, ownsRentalProperty: false };
                                const r = await apiFetch('/tax/file-return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                                const d = await r.json();
                                if (!r.ok) setError(d.message || 'Failed');
                              } catch { setError('Network error'); } finally { setFilingPaye(false); }
                            }} className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
                              {filingPaye ? (
                                <><RefreshCw className="h-3 w-3 animate-spin" /> Filing...</>
                              ) : (
                                <><Globe className="h-3 w-3" /> File PAYE</>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                      {complianceResult.nssfFileUrl && (
                        <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                          <div className="flex items-center gap-2 text-xs"><FileSpreadsheet className="h-3.5 w-3.5 text-slate-400" /><span className="font-medium text-slate-900">NSSF XLSX</span><span className="text-slate-400">{complianceResult.nssfFileLabel}</span></div>
                          <div className="flex items-center gap-2">
                            <a href={complianceResult.nssfFileUrl} download className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 transition"><Download className="h-3 w-3" /> Download</a>
                            <button disabled={filingNssf} onClick={async () => {
                              setFilingNssf(true);
                              setError(null);
                              try {
                                const parts = selectedRun?.period?.split('-') || [];
                                const mVal = parseInt(parts[1], 10) || (new Date().getMonth() + 1);
                                const yVal = parseInt(parts[0], 10) || new Date().getFullYear();
                                const period = `${String(mVal).padStart(2, '0')}/${yVal}`;
                                const r = await apiFetch('/tax/file-nssf-return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nssfFileUrl: complianceResult.nssfFileUrl, masterFileUrl: client.masterFileUrl, period }) });
                                const d = await r.json();
                                if (!r.ok) setError(d.message || 'Failed');
                              } catch { setError('Network error'); } finally { setFilingNssf(false); }
                            }} className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
                              {filingNssf ? (
                                <><RefreshCw className="h-3 w-3 animate-spin" /> Filing...</>
                              ) : (
                                <><Globe className="h-3 w-3" /> File NSSF</>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                      {complianceResult.shaFileUrl && (
                        <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                          <div className="flex items-center gap-2 text-xs"><FileSpreadsheet className="h-3.5 w-3.5 text-slate-400" /><span className="font-medium text-slate-900">SHA XLSX</span><span className="text-slate-400">{complianceResult.shaFileLabel}</span></div>
                          <div className="flex items-center gap-2">
                            <a href={complianceResult.shaFileUrl} download className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 transition"><Download className="h-3 w-3" /> Download</a>
                            <button onClick={() => setStatusMessage('SHA auto-filing will be available in a future update.')} className="inline-flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-purple-700 transition"><Globe className="h-3 w-3" /> File SHA</button>
                          </div>
                        </div>
                      )}
                      {complianceResult.summaryAmounts && (
                        <div className="mt-2 rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] text-slate-600">
                          Summary: PAYE {Number(complianceResult.summaryAmounts.payeAmount).toLocaleString()} | NITA {Number(complianceResult.summaryAmounts.nitaAmount).toLocaleString()} | AHL {Number(complianceResult.summaryAmounts.housingLevyAmount).toLocaleString()} | NSSF {Number(complianceResult.summaryAmounts.nssfAmount).toLocaleString()} | SHA {Number(complianceResult.summaryAmounts.shaAmount).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {runEntries.length > 0 && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">KRA PIN</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Days</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Basic</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">OT</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Gross</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">PAYE</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">SHA</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">NSSF</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">AHL</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Absent</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Late</th>
                        <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {runEntries.map((entry: any) => (
                        <tr key={entry.id} className="hover:bg-slate-50/50 transition">
                          <td className="px-3 py-2 font-medium text-slate-900">{entry.employeeName}</td>
                          <td className="px-3 py-2 font-mono text-slate-700">{entry.kraPin}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{entry.daysWorked}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(entry.basicPay).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono text-amber-700">{Number(entry.overtimePay || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(entry.grossPay).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(entry.payeTax).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(entry.shaDeduction).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(entry.nssfDeduction).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(entry.ahlDeduction).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono text-rose-600">{entry.absentDays || 0}</td>
                          <td className="px-3 py-2 text-right font-mono text-amber-600">{entry.lateDays || 0}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{Number(entry.netPay).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                    {runEntries.length} entries
                    <span className="ml-3">
                      Total Gross: KES {runEntries.reduce((s: number, e: any) => s + Number(e.grossPay), 0).toLocaleString()} |
                      Total Net: KES {runEntries.reduce((s: number, e: any) => s + Number(e.netPay), 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ───── P10/P11 Tab ───── */}
      {activeTab === 'p10p11' && (
        <div className="space-y-6">
          {/* P10 Section */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900">P10 — Annual PAYE Reconciliation</h3>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={p10Year}
                  onChange={e => setP10Year(e.target.value)}
                  placeholder="YYYY"
                  className="w-20 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <button
                  disabled={loadingP10}
                  onClick={async () => {
                    setLoadingP10(true);
                    try { const r = await apiFetch(`/clients/${client.id}/p10?year=${p10Year}`); if (r.ok) setP10Data(await r.json()); else setError('Failed to load P10'); }
                    catch { setError('Network error'); } finally { setLoadingP10(false); }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                >
                  {loadingP10 ? <><RefreshCw className="h-3 w-3 animate-spin" /> Loading</> : 'Load P10'}
                </button>
                {p10Data && (
                  <a
                    href={`/api/clients/${client.id}/p10/pdf?year=${p10Year}`}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                  >
                    <Download className="h-3.5 w-3.5" /> PDF
                  </a>
                )}
              </div>
            </div>
            {p10Data ? (
              <div>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">Employees</span><p className="text-lg font-bold text-slate-900">{p10Data.totalEmployees}</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">Total Gross</span><p className="text-lg font-bold text-slate-900">KES {Number(p10Data.totalGross).toLocaleString()}</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">Total PAYE</span><p className="text-lg font-bold text-slate-900">KES {Number(p10Data.totalPaye).toLocaleString()}</p></div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">KRA PIN</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Months</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Gross Pay</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">PAYE</th>
                        <th className="px-3 py-2 w-20" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {p10Data.employeeDetails?.map((emp: any) => (
                        <tr key={emp.kraPin} className="hover:bg-slate-50/50">
                          <td className="px-3 py-2 font-medium text-slate-900">{emp.employeeName}</td>
                          <td className="px-3 py-2 font-mono text-slate-700">{emp.kraPin}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{emp.monthsWorked}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(emp.totalGross).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(emp.totalPaye).toFixed(2)}</td>
                          <td className="px-3 py-2">
                            <button
                              onClick={async () => {
                                setLoadingP11(true);
                                try { const r = await apiFetch(`/clients/${client.id}/p11/${emp.kraPin}?year=${p10Year}`); if (r.ok) setP11Data(await r.json()); else setError('Failed to load P11'); }
                                catch { setError('Network error'); } finally { setLoadingP11(false); }
                              }}
                              className="rounded-lg px-1.5 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                            >P11</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Click Load P10 to generate annual reconciliation.</p>
            )}
          </div>

          {/* P11 Section */}
          {p11Data && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-900">
                  P11 — {p11Data.employeeName} ({p11Data.kraPin})
                </h3>
                <a
                  href={`/api/clients/${client.id}/p11/${p11Data.kraPin}/pdf?year=${p10Year}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  <Download className="h-3.5 w-3.5" /> PDF
                </a>
              </div>
              {loadingP11 ? (
                <div className="flex items-center justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Month</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Gross</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">PAYE</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">SHA</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">NSSF</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">AHL</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {p11Data.monthly?.map((m: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="px-3 py-2 font-medium text-slate-900">{m.periodLabel || m.period}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(m.grossPay).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(m.payeTax).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(m.shaDeduction).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(m.nssfDeduction).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(m.ahlDeduction).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{Number(m.netPay).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50">
                        <td className="px-3 py-2 font-bold text-slate-900">TOTAL</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalGross || 0).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalPaye || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalSha || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalNssf || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalAhl || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalNet || 0).toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ───── Departments Tab ───── */}
      {activeTab === 'departments' && (
        <DepartmentsView client={client} />
      )}

      {/* ───── Audit Trail Tab ───── */}
      {activeTab === 'audit' && (
        <AuditView client={client} />
      )}

      {/* ───── Employee Documents Modal ───── */}
      {showDocModal && docModalEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-sm font-bold text-slate-900">Documents — {docModalEmployee.employeeName}</h3>
              <button onClick={() => { setShowDocModal(false); setDocModalEmployee(null); setEmpDocuments([]); }} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Upload Section */}
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4">
                <p className="text-xs font-semibold text-slate-500 mb-2">Upload Document</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="file"
                    id="docUploadInput"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const docType = (document.getElementById('docTypeSelect') as HTMLSelectElement)?.value || 'other';
                      const notes = (document.getElementById('docNotesInput') as HTMLInputElement)?.value || '';
                      await handleEmpDocUpload(docModalEmployee.id, file, docType, notes);
                      e.target.value = '';
                    }}
                  />
                  <select id="docTypeSelect" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900">
                    <option value="contract">Contract</option>
                    <option value="id">ID Document</option>
                    <option value="certificate">Certificate</option>
                    <option value="other">Other</option>
                  </select>
                  <input id="docNotesInput" type="text" placeholder="Notes" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 w-32" />
                  <label htmlFor="docUploadInput" className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition">
                    <Upload className="h-3 w-3" /> Upload
                  </label>
                </div>
              </div>

              {/* Documents List */}
              {loadingEmpDocs ? (
                <div className="flex items-center justify-center py-6"><RefreshCw className="h-4 w-4 animate-spin text-slate-400" /></div>
              ) : empDocuments.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No documents uploaded for this employee.</p>
              ) : (
                <div className="space-y-2">
                  {empDocuments.map((doc: any) => (
                    <div key={doc.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate text-slate-900">{doc.originalName}</span>
                        <span className="shrink-0 text-slate-400">({(doc.fileSize / 1024).toFixed(0)} KB)</span>
                        {doc.documentType && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{doc.documentType}</span>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <a
                          href={`/api/clients/${client.id}/documents/${doc.id}/download`}
                          className="rounded px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 transition"
                          title="Download"
                        >
                          <Download className="h-3 w-3" />
                        </a>
                        <button
                          onClick={() => handleEmpDocDelete(doc.id)}
                          className="rounded px-2 py-1 text-[10px] font-semibold text-red-500 hover:bg-red-50 transition"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ───── Portal Password Modal ───── */}
      {showPortalPasswordModal && portalPasswordTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-sm font-bold text-slate-900">Set Portal Password</h3>
              <button
                onClick={() => setShowPortalPasswordModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <p className="text-xs text-slate-600">
                Set password for <strong>{portalPasswordTarget.name}</strong> ({portalPasswordTarget.kraPin})
              </p>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">New Password</label>
                <input
                  type="password"
                  value={portalPasswordValue}
                  onChange={e => setPortalPasswordValue(e.target.value)}
                  placeholder="Min 6 characters"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button
                onClick={() => setShowPortalPasswordModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (portalPasswordValue.length < 6) return;
                  try {
                    const r = await fetch('/api/auth/employee/set-password', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ kraPin: portalPasswordTarget.kraPin, password: portalPasswordValue }),
                    });
                    if (r.ok) {
                      setStatusMessage(`Portal password set for ${portalPasswordTarget.name}`);
                      setShowPortalPasswordModal(false);
                    } else {
                      const e = await r.json();
                      setError(e.message || 'Failed to set password');
                    }
                  } catch {
                    setError('Network error');
                  }
                }}
                className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
              >
                Set Password
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Employee Modal ───── */}
      {showEmployeeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-sm font-bold text-slate-900">
                {editingEmployee ? 'Edit Employee' : 'Add Employee'}
              </h3>
              <button
                onClick={() => setShowEmployeeModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
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
                  { key: 'department', label: 'Department' },
                  { key: 'jobTitle', label: 'Job Title' },
                  { key: 'dateJoined', label: 'Date Joined' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
                    <input
                      type="text"
                      value={employeeForm[key]}
                      onChange={e => setEmployeeForm((f: any) => ({ ...f, [key]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                ))}
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Date Left</label>
                  <input
                    type="text"
                    value={employeeForm.dateLeft || ''}
                    onChange={e => setEmployeeForm((f: any) => ({ ...f, dateLeft: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="Leave blank if active"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Employment Type</label>
                  <select
                    value={employeeForm.employmentType}
                    onChange={e => setEmployeeForm((f: any) => ({ ...f, employmentType: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option>Permanent</option>
                    <option>Contract</option>
                    <option>Casual</option>
                    <option>Intern</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</label>
                  <select
                    value={employeeForm.employmentStatus}
                    onChange={e => setEmployeeForm((f: any) => ({ ...f, employmentStatus: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option>Active</option>
                    <option>Terminated</option>
                    <option>Resigned</option>
                    <option>Suspended</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Basic Pay (KES)</label>
                  <input
                    type="number"
                    value={employeeForm.basicPay}
                    onChange={e => setEmployeeForm((f: any) => ({ ...f, basicPay: parseFloat(e.target.value) || 0 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Bonus Pay (KES)</label>
                  <input
                    type="number"
                    value={employeeForm.bonusPay}
                    onChange={e => setEmployeeForm((f: any) => ({ ...f, bonusPay: parseFloat(e.target.value) || 0 }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Std Check-In</label>
                  <input
                    type="time"
                    value={employeeForm.standardCheckIn || '08:00'}
                    onChange={e => setEmployeeForm((f: any) => ({ ...f, standardCheckIn: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Std Check-Out</label>
                  <input
                    type="time"
                    value={employeeForm.standardCheckOut || '17:00'}
                    onChange={e => setEmployeeForm((f: any) => ({ ...f, standardCheckOut: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Role</label>
                  <select
                    value={employeeForm.role || 'employee'}
                    onChange={e => setEmployeeForm((f: any) => ({ ...f, role: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="employee">Employee</option>
                    <option value="hr">HR</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Work Schedule</label>
                  <select
                    value={employeeForm.workScheduleId || ''}
                    onChange={e => setEmployeeForm((f: any) => ({ ...f, workScheduleId: e.target.value ? Number(e.target.value) : '' }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="">Default (no schedule)</option>
                    {workSchedules.map((ws: any) => (
                      <option key={ws.id} value={ws.id}>{ws.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Off Day (if rotating)</label>
                  <select
                    value={employeeForm.offDay || ''}
                    onChange={e => setEmployeeForm((f: any) => ({ ...f, offDay: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="">None</option>
                    <option value="Monday">Monday</option>
                    <option value="Tuesday">Tuesday</option>
                    <option value="Wednesday">Wednesday</option>
                    <option value="Thursday">Thursday</option>
                    <option value="Friday">Friday</option>
                    <option value="Saturday">Saturday</option>
                    <option value="Sunday">Sunday</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Portal Password</label>
                  <input
                    type="password"
                    value={employeeForm.portalPassword || ''}
                    onChange={e => setEmployeeForm((f: any) => ({ ...f, portalPassword: e.target.value }))}
                    placeholder="Set to update portal login"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button
                onClick={() => setShowEmployeeModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEmployee}
                className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition"
              >
                {editingEmployee ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Approval Modal */}
      {showAttendanceApprovalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-sm font-bold text-slate-900">Review Attendance Data — {attendanceApprovalPeriod}</h3>
              <button onClick={() => setShowAttendanceApprovalModal(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-6">
              {loadingAttendanceApproval ? (
                <div className="flex items-center justify-center py-12"><RefreshCw className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : attendanceApprovalData.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">No attendance data found for this period.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Absent Days</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Late Hours</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">OT Hours</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">OT Rate</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">OT Multiplier</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">OT Amount</th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {attendanceApprovalData.map((emp: any) => (
                        <tr key={emp.employeeId} className="hover:bg-slate-50/50 transition">
                          <td className="px-3 py-2 font-medium text-slate-900">{emp.employeeName}</td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" step="0.5" value={emp.absentDays} onChange={e => { const val = parseFloat(e.target.value) || 0; setAttendanceApprovalData(prev => prev.map(e => e.employeeId === emp.employeeId ? { ...e, absentDays: val } : e)); }} className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900" />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" step="0.5" value={emp.lateHours} onChange={e => { const val = parseFloat(e.target.value) || 0; setAttendanceApprovalData(prev => prev.map(e => e.employeeId === emp.employeeId ? { ...e, lateHours: val } : e)); }} className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900" />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" step="0.5" value={emp.overtimeHours} onChange={e => { const val = parseFloat(e.target.value) || 0; setAttendanceApprovalData(prev => prev.map(e => e.employeeId === emp.employeeId ? { ...e, overtimeHours: val } : e)); }} className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900" />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" value={emp.overtimeRate} onChange={e => { const val = parseFloat(e.target.value) || 0; setAttendanceApprovalData(prev => prev.map(e => e.employeeId === emp.employeeId ? { ...e, overtimeRate: val } : e)); }} className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900" />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" step="0.5" value={emp.overtimeMultiplier} onChange={e => { const val = parseFloat(e.target.value) || 1; setAttendanceApprovalData(prev => prev.map(e => e.employeeId === emp.employeeId ? { ...e, overtimeMultiplier: val } : e)); }} className="w-14 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900" />
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">
                            {(emp.overtimeHours * emp.overtimeRate * emp.overtimeMultiplier).toFixed(2)}
                          </td>
                          <td className="px-3 py-2">
                            {emp.approved ? (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Approved</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Draft</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
              <p className="text-[10px] text-slate-400">{attendanceApprovalData.length} employees</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowAttendanceApprovalModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">Cancel</button>
                <button
                  disabled={savingAttendanceApproval || attendanceApprovalData.length === 0}
                  onClick={async () => {
                    setSavingAttendanceApproval(true);
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);
                    try {
                      const r = await apiFetch(`/clients/${client.id}/attendance-payroll-approve`, {
                        method: 'POST',
                        signal: controller.signal,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          period: attendanceApprovalPeriod,
                          employees: attendanceApprovalData.map(e => ({
                            employeeId: e.employeeId,
                            employeeName: e.employeeName,
                            absentDays: e.absentDays,
                            lateHours: e.lateHours,
                            overtimeHours: e.overtimeHours,
                            overtimeRate: e.overtimeRate,
                            overtimeMultiplier: e.overtimeMultiplier,
                            overtimeAmount: e.overtimeHours * e.overtimeRate * e.overtimeMultiplier,
                          })),
                          approvedBy: 'admin',
                        }),
                      });
                      clearTimeout(timeoutId);
                      if (r.ok) {
                        setStatusMessage('Attendance data approved and saved.');
                        setShowAttendanceApprovalModal(false);
                        fetchOvertimeForAttendance(attendanceApprovalPeriod);
                      } else { setError('Failed to save approval'); }
                    } catch (err: any) {
                      if (err?.name === 'AbortError') setError('Request timed out. Please try again.');
                      else setError('Network error');
                    } finally { setSavingAttendanceApproval(false); }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                >
                  {savingAttendanceApproval ? 'Saving...' : 'Approve & Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
