import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Calendar, Download, Save, Plus, Trash2, RefreshCw, AlertCircle, FileSpreadsheet, Cloud, X, Users, Pencil, FileText, Banknote, CalendarCheck, BarChart3, DollarSign, Briefcase, TrendingUp, Mail, Globe, LogIn, User } from 'lucide-react';
import { ClientObligation } from '../../../types';
import { apiFetch } from '../../../services/api';
import helbLogo from '../../../../assests/HELB.png';

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

type TabId = 'master' | 'paye' | 'nssf' | 'sha' | 'helb' | 'employees' | 'leave' | 'loans' | 'attendance' | 'reports' | 'email' | 'portal';

const TABS: { id: TabId; label: string; img?: string }[] = [
  { id: 'master', label: 'Master Payroll' },
  { id: 'employees', label: 'Employees' },
  { id: 'leave', label: 'Leave' },
  { id: 'loans', label: 'Loans' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'reports', label: 'Reports' },
  { id: 'email', label: 'Email' },
  { id: 'paye', label: 'PAYE', img: '/logos/kra.png' },
  { id: 'nssf', label: 'NSSF', img: '/logos/nssflogo.png' },
  { id: 'sha', label: 'SHA', img: '/logos/shalogo.png' },
  { id: 'helb', label: 'HELB', img: helbLogo },
  { id: 'portal', label: 'Portal' },
];

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function calculateFields(emp: PayrollEmployee): void {
  const totalCashPay = parseFloat(String(emp[STANDARD_HEADERS[11]])) || 0;
  const carBenefit = parseFloat(String(emp[STANDARD_HEADERS[12]])) || 0;
  const meals = parseFloat(String(emp[STANDARD_HEADERS[13]])) || 0;
  const nonCash = parseFloat(String(emp[STANDARD_HEADERS[14]])) || 0;
  const housingBenefit = parseFloat(String(emp[STANDARD_HEADERS[16]])) || 0;
  const otherBenefits = parseFloat(String(emp[STANDARD_HEADERS[17]])) || 0;
  const otherPension = parseFloat(String(emp[STANDARD_HEADERS[21]])) || 0;
  const postRetMedical = parseFloat(String(emp[STANDARD_HEADERS[22]])) || 0;
  const mortgage = parseFloat(String(emp[STANDARD_HEADERS[23]])) || 0;
  const insuranceRelief = parseFloat(String(emp[STANDARD_HEADERS[27]])) || 0;
  const pwd = String(emp[STANDARD_HEADERS[9]] || '').toLowerCase() === 'yes';

  const grossSalary = roundMoney(totalCashPay + carBenefit + meals + nonCash + housingBenefit + otherBenefits);
  const shaContribution = grossSalary > 0 ? roundMoney(grossSalary * 0.0275) : 0;
  const nssfContribution = grossSalary > 0 ? roundMoney(Math.min(grossSalary * 0.06, 6480)) : 0;
  const ahl = grossSalary > 0 ? roundMoney(grossSalary * 0.015) : 0;
  const pwdExemption = pwd ? 150000 : 0;
  const taxablePay = roundMoney(Math.max(0, grossSalary - shaContribution - nssfContribution - otherPension - postRetMedical - mortgage - ahl - pwdExemption));
  const personalRelief = totalCashPay > 0 ? 2400 : 0;

  const paye = roundMoney(Math.max(0,
    Math.max(0, taxablePay * 0.1)
    + Math.max(0, (taxablePay - 24000) * 0.15)
    + Math.max(0, (taxablePay - 32333) * 0.05)
    + Math.max(0, (taxablePay - 500000) * 0.025)
    + Math.max(0, (taxablePay - 800000) * 0.025)
    - personalRelief
    - insuranceRelief,
  ));

  emp[STANDARD_HEADERS[18]] = grossSalary.toFixed(2);
  emp[STANDARD_HEADERS[19]] = shaContribution.toFixed(2);
  emp[STANDARD_HEADERS[20]] = nssfContribution.toFixed(2);
  emp[STANDARD_HEADERS[24]] = ahl.toFixed(2);
  emp[STANDARD_HEADERS[25]] = taxablePay.toFixed(2);
  emp[STANDARD_HEADERS[26]] = personalRelief.toFixed(2);
  emp[STANDARD_HEADERS[28]] = paye.toFixed(2);
  emp[STANDARD_HEADERS[29]] = paye.toFixed(2);
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
  calculateFields(emp);
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
}

export function PayrollWebView({ client, onBack, onEditClient, onUploadMasterCsv, onRemoveMasterCsv, onGeneratePayrollPacks, onAutoFilePaye, onAutoFileNssf }: PayrollWebViewProps) {
  const [preamble, setPreamble] = useState<PayloadPreamble | null>(null);
  const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);
  const [uploadingMasterCsv, setUploadingMasterCsv] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('master');
  const [employeeRecords, setEmployeeRecords] = useState<any[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [importingEmployees, setImportingEmployees] = useState(false);
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any>(null);
  const [employeeForm, setEmployeeForm] = useState<any>({
    payrollNumber: '', employeeName: '', idNumber: '', kraPin: '',
    nssfNo: '', shaNo: '', phone: '', email: '', bankName: '',
    bankAccount: '', bankCode: '', department: '', jobTitle: '',
    employmentType: 'Permanent', employmentStatus: 'Active',
    dateJoined: '', dateLeft: '', basicPay: 0,
  });

  const [leaveRecords, setLeaveRecords] = useState<any[]>([]);
  const [loadingLeave, setLoadingLeave] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [editingLeave, setEditingLeave] = useState<any>(null);
  const [leaveForm, setLeaveForm] = useState<any>({
    employeeId: '', employeeName: '', kraPin: '', leaveType: 'Annual',
    startDate: '', endDate: '', daysCount: 1, reason: '', status: 'Pending',
  });

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

  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [editingAttendance, setEditingAttendance] = useState<any>(null);
  const [attendanceForm, setAttendanceForm] = useState<any>({
    employeeId: '', employeeName: '', kraPin: '', date: '',
    checkIn: '', checkOut: '', status: 'Present', notes: '',
  });
  const [attendanceDateFilter, setAttendanceDateFilter] = useState('');

  const [reportData, setReportData] = useState<any>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
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
  const [portalLoanForm, setPortalLoanForm] = useState({ loanType: 'Salary Advance', principal: 0, installments: 1, interestRate: 0, notes: '' });
  const [portalSubmitting, setPortalSubmitting] = useState(false);
  const [showPortalPasswordModal, setShowPortalPasswordModal] = useState(false);
  const [portalPasswordTarget, setPortalPasswordTarget] = useState<{ id: number; name: string; kraPin: string } | null>(null);
  const [portalPasswordValue, setPortalPasswordValue] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/clients/${client.id}/payroll-data`);
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
  }, [client.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateField = (empIndex: number, header: string, value: string) => {
    setEmployees(prev => {
      const updated = prev.map((emp, i) => {
        if (i !== empIndex) return emp;
        const next = { ...emp, [header]: value };
        if (!COMPUTED_COLUMNS.has(header)) {
          calculateFields(next);
        }
        return next;
      });
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
      setStatusMessage('Payroll data saved and recalculated successfully.');
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to save payroll data.');
    } finally {
      setSaving(false);
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

  const fetchEmployees = useCallback(async () => {
    setLoadingEmployees(true);
    try {
      const res = await apiFetch(`/clients/${client.id}/employees`);
      if (res.ok) {
        const data = await res.json();
        setEmployeeRecords(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingEmployees(false);
    }
  }, [client.id]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const fetchLeave = useCallback(async () => {
    setLoadingLeave(true);
    try {
      const res = await apiFetch(`/clients/${client.id}/leave`);
      if (res.ok) {
        const data = await res.json();
        setLeaveRecords(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingLeave(false);
    }
  }, [client.id]);

  useEffect(() => { fetchLeave(); }, [fetchLeave]);

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

  const fetchAttendance = useCallback(async () => {
    setLoadingAttendance(true);
    try {
      const params = new URLSearchParams();
      if (attendanceDateFilter) params.set('dateFrom', attendanceDateFilter);
      const qs = params.toString();
      const res = await apiFetch(`/clients/${client.id}/attendance${qs ? '?' + qs : ''}`);
      if (res.ok) {
        const data = await res.json();
        setAttendanceRecords(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingAttendance(false);
    }
  }, [client.id, attendanceDateFilter]);

  useEffect(() => { fetchAttendance(); }, [fetchAttendance]);

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

  useEffect(() => { if (activeTab === 'reports') fetchReport(); }, [fetchReport, activeTab]);

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

  // Auto-load portal dashboard when token exists and tab is portal
  useEffect(() => {
    if (activeTab === 'portal' && portalToken && !portalDashboard && !portalLoading) {
      setPortalLoading(true);
      (async () => {
        try {
          const r = await fetch('/api/portal/dashboard', { headers: { 'Authorization': `Bearer ${portalToken}` } });
          if (r.ok) { const d = await r.json(); setPortalDashboard(d); }
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
        await fetchEmployees();
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

  const handleDeleteEmployee = async (id: number) => {
    if (!window.confirm('Delete this employee record?')) return;
    try {
      const res = await apiFetch(`/clients/${client.id}/employees/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setStatusMessage('Employee deleted');
        await fetchEmployees();
      } else {
        setError('Failed to delete employee');
      }
    } catch {
      setError('Network error deleting employee');
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
        setStatusMessage(editingEmployee ? 'Employee updated' : 'Employee created');
        setShowEmployeeModal(false);
        setEditingEmployee(null);
        await fetchEmployees();
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.message || 'Save failed');
      }
    } catch {
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
      });
    } else {
      setEditingEmployee(null);
      setEmployeeForm({
        payrollNumber: '', employeeName: '', idNumber: '', kraPin: '',
        nssfNo: '', shaNo: '', phone: '', email: '', bankName: '',
        bankAccount: '', bankCode: '', department: '', jobTitle: '',
        employmentType: 'Permanent', employmentStatus: 'Active',
        dateJoined: '', dateLeft: '', basicPay: 0,
      });
    }
    setShowEmployeeModal(true);
  };

  const handleDownloadPayslip = async (kraPin: string) => {
    try {
      const res = await apiFetch(`/clients/${client.id}/payslip/${kraPin}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Payslip_${kraPin}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else {
        setError('Failed to generate payslip');
      }
    } catch {
      setError('Network error generating payslip');
    }
  };

  const handleDownloadP9 = async (kraPin: string) => {
    try {
      const res = await apiFetch(`/clients/${client.id}/p9/${kraPin}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `P9_${kraPin}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else {
        setError('Failed to generate P9');
      }
    } catch {
      setError('Network error generating P9');
    }
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
        await fetchLeave();
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.message || 'Save failed');
      }
    } catch {
      setError('Network error saving leave request');
    }
  };

  const handleDeleteLeave = async (id: number) => {
    if (!window.confirm('Delete this leave request?')) return;
    try {
      const res = await apiFetch(`/clients/${client.id}/leave/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setStatusMessage('Leave request deleted');
        await fetchLeave();
      } else {
        setError('Failed to delete leave request');
      }
    } catch {
      setError('Network error deleting leave request');
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
      });
    } else {
      setEditingLeave(null);
      setLeaveForm({
        employeeId: '', employeeName: '', kraPin: '', leaveType: 'Annual',
        startDate: '', endDate: '', daysCount: 1, reason: '', status: 'Pending',
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
        await fetchAttendance();
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.message || 'Save failed');
      }
    } catch {
      setError('Network error saving attendance record');
    }
  };

  const handleDeleteAttendance = async (id: number) => {
    if (!window.confirm('Delete this attendance record?')) return;
    try {
      const res = await apiFetch(`/clients/${client.id}/attendance/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setStatusMessage('Attendance record deleted');
        await fetchAttendance();
      } else {
        setError('Failed to delete attendance record');
      }
    } catch {
      setError('Network error deleting attendance record');
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
          <h2 className="text-xl font-bold text-slate-900">{client.name}</h2>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-500">{client.pin}</span>
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

      {/* Tab Bar + Master CSV (same row) */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map(({ id, label, img }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition border-b-2 ${
                activeTab === id
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {img ? (
                <img src={img} alt={label} className="h-10 w-10 object-contain" />
              ) : id === 'employees' ? (
                <Users className="h-5 w-5" />
              ) : id === 'leave' ? (
                <Calendar className="h-5 w-5" />
              ) : id === 'loans' ? (
                <Banknote className="h-5 w-5" />
              ) : id === 'attendance' ? (
                <CalendarCheck className="h-5 w-5" />
              ) : id === 'reports' ? (
                <BarChart3 className="h-5 w-5" />
              ) : id === 'email' ? (
                <Mail className="h-5 w-5" />
              ) : id === 'portal' ? (
                <Globe className="h-5 w-5" />
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
                target="_blank"
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
                      window.location.reload();
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
                    window.location.reload();
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
                    window.location.reload();
                  } catch (err: any) { setError(err.message || 'Upload failed.'); }
                  finally { setUploadingMasterCsv(false); }
                }}
              />
            </label>
          )}
        </div>
      </div>

      {statusMessage && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {statusMessage}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ───── Master Payroll Tab ───── */}
      {activeTab === 'master' && (
        <>
          {!hasData ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <p className="text-sm font-semibold text-slate-500">No payroll data found</p>
              <p className="mt-2 text-xs text-slate-400">
                Upload a master CSV for this client from the Payroll Pipeline desk to enable the payroll editor.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee Payroll Data</span>
                <div className="flex items-center gap-2">
                  {onGeneratePayrollPacks && (
                    <button
                      onClick={() => onGeneratePayrollPacks(client)}
                      disabled={!hasData}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Cloud className="h-3.5 w-3.5" />
                      Generate Payroll Packs
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
                      {STANDARD_HEADERS.map((header, i) => {
                        const numeric = i >= 11 && i !== 15;
                        return (
                          <th
                            key={header}
                            className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${
                              COMPUTED_COLUMNS.has(header) ? 'text-slate-400' : 'text-slate-500'
                            } ${numeric ? 'text-right' : ''}`}
                          >
                            {header}
                          </th>
                        );
                      })}
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
                          <button
                            onClick={() => removeRow(rowIdx)}
                            className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                            title="Remove employee"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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

      {/* ───── Employees Tab ───── */}
      {activeTab === 'employees' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Employee Profiles
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleImportFromMasterCsv}
                disabled={importingEmployees}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
              >
                {importingEmployees ? (
                  <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Importing...</>
                ) : (
                  <><Cloud className="h-3.5 w-3.5" /> Import from Master CSV</>
                )}
              </button>
              <button
                onClick={() => openEmployeeModal()}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Employee
              </button>
            </div>
          </div>

          {loadingEmployees ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : employeeRecords.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <Users className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">No employee profiles</p>
              <p className="mt-2 text-xs text-slate-400">
                Import from Master CSV or add employees manually.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Name</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">KRA PIN</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">ID No.</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">NSSF</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">SHA</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Status</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Basic Pay</th>
                    <th className="px-3 py-2.5 w-24" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {employeeRecords.map((emp: any) => (
                    <tr key={emp.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-3 py-2 font-medium text-slate-900">{emp.employeeName}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{emp.kraPin}</td>
                      <td className="px-3 py-2 text-slate-700">{emp.idNumber}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{emp.nssfNo}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{emp.shaNo}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          emp.employmentStatus === 'Active'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {emp.employmentStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900">
                        {Number(emp.basicPay).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleDownloadPayslip(emp.kraPin)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                            title="Download Payslip"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDownloadP9(emp.kraPin)}
                            className="rounded-lg px-1.5 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                            title="Download P9 Annual Tax Card"
                          >
                            P9
                          </button>
                          <button
                            onClick={() => { setPortalPasswordTarget({ id: emp.id, name: emp.employeeName, kraPin: emp.kraPin }); setPortalPasswordValue(''); setShowPortalPasswordModal(true); }}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                            title="Set Portal Password"
                          >
                            <Globe className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => openEmployeeModal(emp)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteEmployee(emp.id)}
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
                {employeeRecords.length} employee{employeeRecords.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───── Leave Tab ───── */}
      {activeTab === 'leave' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Leave Requests
            </span>
            <button
              onClick={() => openLeaveModal()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Leave Request
            </button>
          </div>

          {loadingLeave ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : leaveRecords.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <Calendar className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">No leave requests</p>
              <p className="mt-2 text-xs text-slate-400">
                Add leave requests for your employees.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Employee Name</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">KRA PIN</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Leave Type</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Start Date</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">End Date</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">Days</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Status</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Reason</th>
                    <th className="px-3 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leaveRecords.map((rec: any) => (
                    <tr key={rec.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-3 py-2 font-medium text-slate-900">{rec.employeeName}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{rec.kraPin}</td>
                      <td className="px-3 py-2 text-slate-700">{rec.leaveType}</td>
                      <td className="px-3 py-2 text-slate-700">{rec.startDate}</td>
                      <td className="px-3 py-2 text-slate-700">{rec.endDate}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900">{rec.daysCount}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          rec.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' :
                          rec.status === 'Rejected' ? 'bg-red-50 text-red-700' :
                          rec.status === 'Cancelled' ? 'bg-slate-100 text-slate-500' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {rec.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 max-w-[150px] truncate">{rec.reason}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openLeaveModal(rec)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteLeave(rec.id)}
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
                {leaveRecords.length} leave request{leaveRecords.length !== 1 ? 's' : ''}
              </div>
            </div>
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
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          rec.status === 'Active' ? 'bg-blue-50 text-blue-700' :
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

      {/* ───── Attendance Tab ───── */}
      {activeTab === 'attendance' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Attendance Records
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={attendanceDateFilter}
                onChange={e => setAttendanceDateFilter(e.target.value)}
                placeholder="Filter by date (YYYY-MM-DD)"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
              <button
                onClick={() => openAttendanceModal()}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Record
              </button>
            </div>
          </div>

          {loadingAttendance ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : attendanceRecords.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <CalendarCheck className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">No attendance records</p>
              <p className="mt-2 text-xs text-slate-400">
                Add attendance records for your employees.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Employee Name</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">KRA PIN</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Date</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Check In</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Check Out</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Status</th>
                    <th className="px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500">Notes</th>
                    <th className="px-3 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attendanceRecords.map((rec: any) => (
                    <tr key={rec.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-3 py-2 font-medium text-slate-900">{rec.employeeName}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{rec.kraPin}</td>
                      <td className="px-3 py-2 text-slate-700">{rec.date}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{rec.checkIn}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{rec.checkOut}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          rec.status === 'Present' ? 'bg-emerald-50 text-emerald-700' :
                          rec.status === 'Absent' ? 'bg-red-50 text-red-700' :
                          rec.status === 'Late' ? 'bg-amber-50 text-amber-700' :
                          rec.status === 'Half-Day' ? 'bg-orange-50 text-orange-700' :
                          rec.status === 'Leave' ? 'bg-blue-50 text-blue-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {rec.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 max-w-[150px] truncate">{rec.notes}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openAttendanceModal(rec)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteAttendance(rec.id)}
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
                {attendanceRecords.length} record{attendanceRecords.length !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───── Reports Tab ───── */}
      {activeTab === 'reports' && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Payroll Reports
            </span>
            <button
              onClick={handleDownloadReport}
              disabled={!reportData}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </button>
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
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          h.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
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
                  onClick={() => { setPortalToken(null); setPortalEmployee(null); setPortalDashboard(null); localStorage.removeItem('portal_token'); }}
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
                          const r = await fetch('/api/portal/dashboard', { headers: { 'Authorization': `Bearer ${portalToken}` } });
                          if (r.ok) setPortalDashboard(await r.json());
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
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                    l.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' :
                                    l.status === 'Rejected' ? 'bg-red-50 text-red-700' :
                                    'bg-amber-50 text-amber-700'
                                  }`}>{l.status}</span>
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
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                    l.status === 'Paid' ? 'bg-emerald-50 text-emerald-700' :
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
                        <div className="flex gap-2">
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
                      </div>
                    </div>
                  )}
                </>
              )}

              {portalSubView === 'leave' && (
                <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-900 mb-4">Request Leave</h3>
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
                    <button
                      disabled={portalSubmitting}
                      onClick={async () => {
                        setPortalSubmitting(true);
                        try {
                          const r = await fetch('/api/portal/leave', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${portalToken}` },
                            body: JSON.stringify(portalLeaveForm),
                          });
                          if (r.ok) {
                            setPortalSubView('dashboard');
                            setPortalDashboard(null);
                            setPortalLeaveForm({ leaveType: 'Annual', startDate: '', endDate: '', daysCount: 1, reason: '' });
                          }
                        } catch { /* ignore */ } finally { setPortalSubmitting(false); }
                      }}
                      className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                    >
                      {portalSubmitting ? <><RefreshCw className="mr-1.5 inline h-3 w-3 animate-spin" /> Submitting...</> : 'Submit Leave Request'}
                    </button>
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
                    type="text"
                    value={attendanceForm.date}
                    onChange={e => setAttendanceForm((f: any) => ({ ...f, date: e.target.value }))}
                    placeholder="YYYY-MM-DD"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Check In</label>
                  <input
                    type="text"
                    value={attendanceForm.checkIn}
                    onChange={e => setAttendanceForm((f: any) => ({ ...f, checkIn: e.target.value }))}
                    placeholder="HH:MM"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Check Out</label>
                  <input
                    type="text"
                    value={attendanceForm.checkOut}
                    onChange={e => setAttendanceForm((f: any) => ({ ...f, checkOut: e.target.value }))}
                    placeholder="HH:MM"
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
                    <option>Annual</option>
                    <option>Sick</option>
                    <option>Compassionate</option>
                    <option>Study</option>
                    <option>Maternity</option>
                    <option>Paternity</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Start Date</label>
                  <input
                    type="text"
                    value={leaveForm.startDate}
                    onChange={e => setLeaveForm((f: any) => ({ ...f, startDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">End Date</label>
                  <input
                    type="text"
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
    </div>
  );
}
