import { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet, Send, Play, AlertCircle, CheckCircle2,
  RefreshCw, Clock, Building2, ShieldCheck, GraduationCap,
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';
import type { ClientObligation } from '../../../types';

type RunStatus = 'draft' | 'approved' | 'finalized' | 'filed';
type ObligationStatus = 'na' | 'not_ready' | 'ready' | 'generated' | 'filed';

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
}

interface Employee {
  id: number;
  employeeName: string;
  kraPin: string;
  idNumber: string;
  nssfNo: string;
  shaNo: string;
  phone: string;
  payrollNumber: string;
}

interface ComplianceTabsProps {
  client: ClientObligation;
  runId?: number;
  period: string;
  runStatus: RunStatus;
  entries: PayrollEntry[];
  onRefresh: () => void;
}

interface ComplianceState {
  payeZipUrl: string | null;
  payeZipLabel: string | null;
  nssfFileUrl: string | null;
  nssfFileLabel: string | null;
  shaFileUrl: string | null;
  shaFileLabel: string | null;
  statuses: {
    paye: string;
    nssf: string;
    sha: string;
  };
  amounts: {
    payeAmount: number;
    nitaAmount: number;
    housingLevyAmount: number;
    nssfAmount: number;
    shaAmount: number;
  };
}

interface TabConfig {
  key: string;
  label: string;
  subLabel?: string;
  logo: string | null;
  altIcon: React.ReactNode;
  colorClass: string;
  bgClass: string;
  borderClass: string;
}

const tabs: TabConfig[] = [
  {
    key: 'paye',
    label: 'PAYE',
    subLabel: 'Incl. NITA + AHL',
    logo: '/logos/kra.png',
    altIcon: <Building2 className="h-6 w-6 text-blue-600" />,
    colorClass: 'text-blue-700',
    bgClass: 'bg-blue-50',
    borderClass: 'border-blue-200',
  },
  {
    key: 'nssf',
    label: 'NSSF',
    logo: '/logos/nssflogo.png',
    altIcon: <ShieldCheck className="h-6 w-6 text-emerald-600" />,
    colorClass: 'text-emerald-700',
    bgClass: 'bg-emerald-50',
    borderClass: 'border-emerald-200',
  },
  {
    key: 'sha',
    label: 'SHA',
    logo: '/logos/shalogo.png',
    altIcon: <ShieldCheck className="h-6 w-6 text-violet-600" />,
    colorClass: 'text-violet-700',
    bgClass: 'bg-violet-50',
    borderClass: 'border-violet-200',
  },
  {
    key: 'helb',
    label: 'HELB',
    logo: null,
    altIcon: <GraduationCap className="h-6 w-6 text-amber-600" />,
    colorClass: 'text-amber-700',
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-200',
  },
];

function deriveStatus(
  _key: string,
  runStatus: RunStatus,
  storedStatus: string,
  hasUrl: boolean
): ObligationStatus {
  if (storedStatus === 'filed') return 'filed';
  if (hasUrl) return 'generated';
  if (runStatus === 'finalized' || runStatus === 'filed') return 'ready';
  return 'not_ready';
}

export function ComplianceTabs({ client, runId, period, runStatus, entries, onRefresh }: ComplianceTabsProps) {
  const [activeTab, setActiveTab] = useState('paye');
  const [state, setState] = useState<ComplianceState | null>(null);
  const [generating, setGenerating] = useState(false);
  const [filingType, setFilingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const fetchStatus = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}/compliance-status`);
      if (res.ok) {
        setState(await res.json());
      }
    } catch { /* ignore */ }
  }, [client.id, runId]);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await apiFetch(`/clients/${client.id}/employees`);
      if (res.ok) setEmployees(await res.json());
    } catch { /* ignore */ }
  }, [client.id]);

  useEffect(() => {
    fetchStatus();
    fetchEmployees();
  }, [fetchStatus, fetchEmployees]);

  const handleGenerate = async () => {
    if (!runId) return;
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}/generate-compliance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generatePaye: true, generateNssf: true, generateSha: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setState({
          payeZipUrl: data.payeZipUrl || null,
          payeZipLabel: data.payeZipLabel || null,
          nssfFileUrl: data.nssfFileUrl || null,
          nssfFileLabel: data.nssfFileLabel || null,
          shaFileUrl: data.shaFileUrl || null,
          shaFileLabel: data.shaFileLabel || null,
          statuses: { paye: data.payeZipUrl ? 'generated' : 'na', nssf: data.nssfFileUrl ? 'generated' : 'na', sha: data.shaFileUrl ? 'generated' : 'na' },
          amounts: data.summaryAmounts || {},
        });
        setSuccess('Files generated successfully');
        onRefresh();
      } else {
        setError(data.message || 'Generation failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setGenerating(false);
    }
  };

  const handleFile = async (type: string) => {
    setFilingType(type);
    setError(null);
    setSuccess(null);
    try {
      if (type === 'nssf') {
        const nssfUrl = state?.nssfFileUrl;
        const masterUrl = client.masterFileUrl;
        if (!nssfUrl || !masterUrl) {
          setError('NSSF file or Master CSV not available');
          setFilingType(null);
          return;
        }
        const res = await apiFetch(`/api/tax/file-nssf-return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: client.id, nssfFileUrl: nssfUrl, masterFileUrl: masterUrl, period: '' }),
        });
        const data = await res.json();
        if (res.ok) setSuccess(`NSSF queued. Job: ${data.jobId || 'N/A'}`);
        else setError(data.message || 'NSSF filing failed');
      } else if (type === 'paye') {
        const payeUrl = state?.payeZipUrl;
        const [yearStr, monthStr] = period.split('-');
        const lastDay = new Date(parseInt(yearStr), parseInt(monthStr), 0).getDate();
        const periodFrom = `${yearStr}-${monthStr}-01`;
        const periodTo = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
        const res = await apiFetch(`/api/tax/file-return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: client.id,
            kraPin: client.pin,
            taxObligationType: 'paye',
            periodFrom,
            periodTo,
            payeZipUrl: payeUrl,
            printPrnOnly: false,
          }),
        });
        const data = await res.json();
        if (res.ok) setSuccess(`PAYE queued. Job: ${data.jobId || 'N/A'}`);
        else setError(data.message || 'PAYE filing failed');
      }
    } catch {
      setError('Network error. Ensure backend is deployed.');
    } finally {
      setFilingType(null);
    }
  };

  const getUrl = (key: string): string | null => {
    if (!state) return null;
    if (key === 'paye') return state.payeZipUrl;
    if (key === 'nssf') return state.nssfFileUrl;
    if (key === 'sha') return state.shaFileUrl;
    return null;
  };

  const getStoredStatus = (key: string): string => {
    if (!state) return 'na';
    return state.statuses[key as keyof typeof state.statuses] || 'na';
  };

  const isFinalized = runStatus === 'finalized' || runStatus === 'filed';
  const activeConfig = tabs.find((t) => t.key === activeTab);

  // ─── File Preview Builders ─────────────────────────────────────

  const getEmp = (employeeId: number) => employees.find((e) => e.id === employeeId);

  const splitName = (fullName: string) => {
    const parts = (fullName || '').trim().split(/\s+/);
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
  };

  const totalGross = entries.reduce((s, e) => s + (e.grossPay || 0), 0);
  const totalNssf = entries.reduce((s, e) => s + (e.nssfDeduction || 0), 0);
  const totalSha = entries.reduce((s, e) => s + (e.shaDeduction || 0), 0);
  const totalAhl = entries.reduce((s, e) => s + (e.ahlDeduction || 0), 0);
  const totalPaye = entries.reduce((s, e) => s + (e.payeTax || 0), 0);

  // NSSF: split each employee into 2 rows (Type 101 and 102)
  const nssfRows = entries.flatMap((e) => {
    const emp = getEmp(e.employeeId);
    const base = 1080; // fixed type 101
    const remainder = Math.max(0, (e.nssfDeduction || 0) - base);
    const nameParts = splitName(e.employeeName);
    const rows = [];
    // Type 101
    const type101Amount = Math.min(e.nssfDeduction || 0, base);
    rows.push({
      payrollNo: emp?.payrollNumber || '1',
      surname: nameParts.lastName || e.employeeName,
      otherNames: nameParts.firstName || '',
      idNo: emp?.idNumber || '',
      kraPin: e.kraPin || '',
      nssfNo: emp?.nssfNo || '',
      contribType: '101',
      income: e.grossPay || 0,
      incomeType: '1',
      member: +(type101Amount / 2).toFixed(0),
      employer: +(type101Amount / 2).toFixed(0),
      total: type101Amount,
    });
    if (remainder > 0) {
      rows.push({
        payrollNo: emp?.payrollNumber || '1',
        surname: nameParts.lastName || e.employeeName,
        otherNames: nameParts.firstName || '',
        idNo: emp?.idNumber || '',
        kraPin: e.kraPin || '',
        nssfNo: emp?.nssfNo || '',
        contribType: '102',
        income: e.grossPay || 0,
        incomeType: '1',
        member: +(remainder / 2).toFixed(0),
        employer: +(remainder / 2).toFixed(0),
        total: remainder,
      });
    }
    return rows;
  });

  // PAYE: B_Employees_Dtls_Simp structure
  const payeRows = entries.map((e) => {
    return {
      kraPin: e.kraPin || '',
      employeeName: e.employeeName || '',
      resident: 'Resident',
      employmentType: 'Primary En',
      pinType: 'No',
      basicSalary: e.basicPay || 0,
      benefitsCash: e.carBenefit + e.mealsBenefit + e.housingBenefit + e.otherBenefits,
      benefitsNonCash: e.nonCashBenefits || 0,
      bonus: e.bonusPay || 0,
      grossPay: e.grossPay || 0,
      paye: e.payeTax || 0,
      sha: e.shaDeduction || 0,
      ahl: e.ahlDeduction || 0,
      nssf: e.nssfDeduction || 0,
      netPay: e.netPay || 0,
    };
  });

  // SHA: Payroll Template structure
  const shaRows = entries.map((e) => {
    const emp = getEmp(e.employeeId);
    const nameParts = splitName(e.employeeName);
    return {
      payrollNo: emp?.payrollNumber || '1',
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      idNo: emp?.idNumber || '',
      kraPin: e.kraPin || '',
      shaNo: emp?.shaNo || '',
      contribution: e.shaDeduction || 0,
      phone: emp?.phone || '',
    };
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">Compliance Filing</h3>
        {runId && (
          <button onClick={fetchStatus} className="rounded p-1 text-slate-400 hover:bg-slate-50 transition">
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </div>
      )}
      {success && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> {success}
        </div>
      )}

      {/* Tab headers */}
      <div className="flex border-b border-slate-100 overflow-x-auto">
        {tabs.map((tab) => {
          const url = getUrl(tab.key);
          const stored = getStoredStatus(tab.key);
          const status = deriveStatus(tab.key, runStatus, stored, !!url);
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition border-b-2 shrink-0',
                isActive ? `text-slate-900 border-[#ff0613]` : 'text-slate-500 border-transparent hover:text-slate-700'
              )}
            >
              <div className="h-5 w-5 flex items-center justify-center">
                {tab.logo ? (
                  <img src={tab.logo} alt={tab.label} className="max-h-full max-w-full object-contain" />
                ) : (
                  tab.altIcon
                )}
              </div>
              <div className="flex flex-col items-start">
                <span>{tab.label}</span>
                {tab.subLabel && <span className="text-[9px] font-medium text-slate-400">{tab.subLabel}</span>}
              </div>
              {status === 'generated' && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
              {status === 'filed' && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-blue-500" />}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeConfig && (
        <div className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Left: Logo + Status + Amounts + Actions */}
            <div className="flex flex-col items-start gap-3 w-full lg:w-48 shrink-0">
              <div className={cn('h-14 w-14 rounded-xl border flex items-center justify-center', activeConfig.bgClass, activeConfig.borderClass)}>
                {activeConfig.logo ? (
                  <img src={activeConfig.logo} alt={activeConfig.label} className="max-h-10 max-w-10 object-contain" />
                ) : (
                  activeConfig.altIcon
                )}
              </div>
              <p className={cn('text-xs font-bold', activeConfig.colorClass)}>{activeConfig.label}</p>

              {activeTab === 'nssf' && (
                <div className="space-y-1 text-[10px] text-slate-600">
                  <p>Total Income: <span className="font-mono font-semibold">{totalGross.toLocaleString()}</span></p>
                  <p>Total Member: <span className="font-mono font-semibold">{Math.round(totalNssf / 2).toLocaleString()}</span></p>
                  <p>Total Employer: <span className="font-mono font-semibold">{Math.round(totalNssf / 2).toLocaleString()}</span></p>
                  <p>Total Contributions: <span className="font-mono font-semibold">{totalNssf.toLocaleString()}</span></p>
                  <p>Total Records: <span className="font-mono font-semibold">{nssfRows.length}</span></p>
                </div>
              )}
              {activeTab === 'paye' && (
                <div className="space-y-1 text-[10px] text-slate-600">
                  <p>Total Gross: <span className="font-mono font-semibold">{totalGross.toLocaleString()}</span></p>
                  <p>Total PAYE: <span className="font-mono font-semibold">{totalPaye.toLocaleString()}</span></p>
                  <p>Total SHA: <span className="font-mono font-semibold">{totalSha.toLocaleString()}</span></p>
                  <p>Total AHL: <span className="font-mono font-semibold">{totalAhl.toLocaleString()}</span></p>
                  <p>Total NSSF: <span className="font-mono font-semibold">{totalNssf.toLocaleString()}</span></p>
                  <p>Employees: <span className="font-mono font-semibold">{entries.length}</span></p>
                </div>
              )}
              {activeTab === 'sha' && (
                <div className="space-y-1 text-[10px] text-slate-600">
                  <p>Total Contribution: <span className="font-mono font-semibold">{totalSha.toLocaleString()}</span></p>
                  <p>Employees: <span className="font-mono font-semibold">{entries.length}</span></p>
                </div>
              )}

              <div className="flex flex-col gap-2 w-full mt-2">
                {isFinalized && (
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40 w-full"
                  >
                    {generating ? <Clock className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Generate
                  </button>
                )}
                {(() => {
                  const url = getUrl(activeConfig.key);
                  if (!url) return null;
                  return (
                    <>
                      <a
                        href={url}
                        download
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 transition w-full"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" /> Download
                      </a>
                      {isFinalized && activeConfig.key !== 'helb' && (
                        <button
                          onClick={() => handleFile(activeConfig.key)}
                          disabled={filingType === activeConfig.key}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40 w-full"
                        >
                          {filingType === activeConfig.key ? <Clock className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                          File / Send
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Right: File Preview Table */}
            <div className="flex-1 min-w-0 overflow-x-auto">
              {activeTab === 'nssf' && (
                <div className="space-y-3">
                  <div className="space-y-0.5 text-[10px] text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <p><span className="font-semibold">NSSF CONTRIBUTIONS</span></p>
                    <p>EMPLOYER KRA PIN: <span className="font-mono">{client.pin || 'N/A'}</span></p>
                    <p>EMPLOYER NSSF NUMBER: <span className="font-mono">{(client as any).nssfNumber || 'N/A'}</span></p>
                    <p>EMPLOYER NAME: <span className="font-mono">{client.name || 'Company'}</span></p>
                    <p>CONTRIBUTIONS PERIOD: <span className="font-mono">{period ? period.replace('-', '').substring(2) + period.substring(0, 4) : 'N/A'}</span></p>
                  </div>
                  <table className="w-full text-[10px]">
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200 text-left font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="px-2 py-1.5">Payroll No</th>
                        <th className="px-2 py-1.5">Surname</th>
                        <th className="px-2 py-1.5">Other Names</th>
                        <th className="px-2 py-1.5">N/ID No</th>
                        <th className="px-2 py-1.5">KRA PIN</th>
                        <th className="px-2 py-1.5">NSSF No</th>
                        <th className="px-2 py-1.5">Contrib</th>
                        <th className="px-2 py-1.5 text-right">Income</th>
                        <th className="px-2 py-1.5 text-center">Type</th>
                        <th className="px-2 py-1.5 text-right">Member</th>
                        <th className="px-2 py-1.5 text-right">Employer</th>
                        <th className="px-2 py-1.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {nssfRows.length === 0 ? (
                        <tr><td colSpan={12} className="py-4 text-center text-slate-400">No payroll entries</td></tr>
                      ) : nssfRows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.payrollNo}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.surname}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.otherNames}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-600">{r.idNo}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-600">{r.kraPin}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-600">{r.nssfNo}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.contribType}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.income.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-center font-mono">{r.incomeType}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.member}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.employer}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-semibold">{r.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'paye' && (
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">B_Employees_Dtls_Simp.csv Preview</p>
                  <table className="w-full text-[10px]">
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200 text-left font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="px-2 py-1.5">KRA PIN</th>
                        <th className="px-2 py-1.5">Employee Name</th>
                        <th className="px-2 py-1.5">Resident</th>
                        <th className="px-2 py-1.5">Employment</th>
                        <th className="px-2 py-1.5">Pin Type</th>
                        <th className="px-2 py-1.5 text-right">Basic Salary</th>
                        <th className="px-2 py-1.5 text-right">Benefits</th>
                        <th className="px-2 py-1.5 text-right">Bonus</th>
                        <th className="px-2 py-1.5 text-right">Gross Pay</th>
                        <th className="px-2 py-1.5 text-right">PAYE</th>
                        <th className="px-2 py-1.5 text-right">SHA</th>
                        <th className="px-2 py-1.5 text-right">AHL</th>
                        <th className="px-2 py-1.5 text-right">NSSF</th>
                        <th className="px-2 py-1.5 text-right">Net Pay</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {payeRows.length === 0 ? (
                        <tr><td colSpan={14} className="py-4 text-center text-slate-400">No payroll entries</td></tr>
                      ) : payeRows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-mono text-slate-600">{r.kraPin}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.employeeName}</td>
                          <td className="px-2 py-1.5 text-slate-600">{r.resident}</td>
                          <td className="px-2 py-1.5 text-slate-600">{r.employmentType}</td>
                          <td className="px-2 py-1.5 text-slate-600">{r.pinType}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.basicSalary.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.benefitsCash.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.bonus.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-semibold">{r.grossPay.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.paye.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.sha.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.ahl.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{r.nssf.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-semibold text-emerald-700">{r.netPay.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'sha' && (
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Payroll Template / SHA Contributions Preview</p>
                  <table className="w-full text-[10px]">
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200 text-left font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="px-2 py-1.5">Payroll No</th>
                        <th className="px-2 py-1.5">First Name</th>
                        <th className="px-2 py-1.5">Last Name</th>
                        <th className="px-2 py-1.5">Identity ID No</th>
                        <th className="px-2 py-1.5">KRA PIN</th>
                        <th className="px-2 py-1.5">SHA No</th>
                        <th className="px-2 py-1.5 text-right">Contribution</th>
                        <th className="px-2 py-1.5">Phone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {shaRows.length === 0 ? (
                        <tr><td colSpan={8} className="py-4 text-center text-slate-400">No payroll entries</td></tr>
                      ) : shaRows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.payrollNo}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.firstName}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.lastName}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-600">{r.idNo}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-600">{r.kraPin}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-600">{r.shaNo}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-semibold">{r.contribution.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-slate-600">{r.phone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'helb' && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <GraduationCap className="h-8 w-8 text-amber-300 mb-2" />
                  <p className="text-xs font-semibold text-slate-600">HELB Deductions</p>
                  <p className="text-[10px] text-slate-400 mt-1">Coming soon — HELB integration is under development.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
