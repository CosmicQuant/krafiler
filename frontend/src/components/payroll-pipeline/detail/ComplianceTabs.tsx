import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileSpreadsheet, Send, Play, AlertCircle, CheckCircle2,
  RefreshCw, Clock, Download,
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { ClientObligation } from '../../../types';

type RunStatus = 'draft' | 'approved' | 'finalized' | 'filed';
type ObligationStatus = 'na' | 'not_ready' | 'ready' | 'generated' | 'filed';

interface PayrollEntry {
  id: number; employeeId: number; employeeName: string; kraPin: string;
  basicPay: number; carBenefit: number; mealsBenefit: number; nonCashBenefits: number;
  housingBenefit: number; otherBenefits: number; bonusPay: number; overtimePay: number;
  grossPay: number; shaDeduction: number; nssfDeduction: number; ahlDeduction: number;
  taxablePay: number; payeTax: number; loanDeduction: number; otherDeductions: number;
  totalDeductions: number; netPay: number; daysWorked: number;
  absentDays?: number; lateDays?: number; unpaidLeaveDays?: number;
}

interface Employee {
  id: number; employeeName: string; kraPin: string; idNumber: string;
  nssfNo: string; shaNo: string; phone: string; payrollNumber: string;
  residentialStatus?: string; typeOfEmployee?: string; pwd?: string;
  exemptionCert?: string; carBenefit?: number; mealsBenefit?: number;
  nonCashBenefits?: number; typeOfHousing?: string; housingBenefit?: number;
  otherBenefits?: number; otherPension?: number; postRetMedical?: number;
  mortgageInterest?: number; insuranceRelief?: number;
}

interface ComplianceTabsProps {
  client: ClientObligation; runId?: number; period: string;
  runStatus: RunStatus; entries: PayrollEntry[]; onRefresh: () => void;
}

interface ComplianceState {
  payeZipUrl: string | null; payeZipLabel: string | null;
  nssfFileUrl: string | null; nssfFileLabel: string | null;
  shaFileUrl: string | null; shaFileLabel: string | null;
  statuses: { paye: string; nssf: string; sha: string };
  amounts: { payeAmount: number; nitaAmount: number; housingLevyAmount: number; nssfAmount: number; shaAmount: number };
  payeReceiptUrl?: string | null;
  nssfReceiptUrl?: string | null;
  shaReceiptUrl?: string | null;
}

interface TabConfig {
  key: string; label: string; subLabel?: string;
  logo: string | null; altIcon: React.ReactNode;
  colorClass: string; bgClass: string; borderClass: string;
}

const tabs: TabConfig[] = [
  { key: 'paye', label: 'PAYE', subLabel: 'Incl. NITA + AHL', logo: '/logos/kra.png', altIcon: null, colorClass: 'text-blue-700', bgClass: 'bg-blue-50', borderClass: 'border-blue-200' },
  { key: 'nssf', label: 'NSSF', logo: '/logos/nssflogo.png', altIcon: null, colorClass: 'text-emerald-700', bgClass: 'bg-emerald-50', borderClass: 'border-emerald-200' },
  { key: 'sha', label: 'SHA', logo: '/logos/shalogo.png', altIcon: null, colorClass: 'text-violet-700', bgClass: 'bg-violet-50', borderClass: 'border-violet-200' },
  { key: 'helb', label: 'HELB', logo: null, altIcon: null, colorClass: 'text-amber-700', bgClass: 'bg-amber-50', borderClass: 'border-amber-200' },
];

function deriveStatus(_k: string, rs: RunStatus, ss: string, hu: boolean): ObligationStatus {
  if (ss === 'filed') return 'filed'; if (hu) return 'generated';
  if (rs === 'finalized' || rs === 'filed') return 'ready'; return 'not_ready';
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function splitName(fullName: string) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length <= 1) return { firstNames: fullName || '', lastName: '' };
  return { firstNames: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

export function ComplianceTabs({ client, runId, period, runStatus, entries, onRefresh }: ComplianceTabsProps) {
  const [activeTab, setActiveTab] = useState('paye');
  const [state, setState] = useState<ComplianceState | null>(null);
  const [generating, setGenerating] = useState(false);
  const [filingType, setFilingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activeJobs, setActiveJobs] = useState<Record<string, { jobId: string; status: string; progress: number; message: string }>>({});

  const fetchStatus = useCallback(async () => {
    if (!runId) return;
    try { const res = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}/compliance-status`); if (res.ok) setState(await res.json()); } catch {}
  }, [client.id, runId]);

  const fetchEmployees = useCallback(async () => {
    try { const res = await apiFetch(`/clients/${client.id}/employees`); if (res.ok) setEmployees(await res.json()); } catch {}
  }, [client.id]);

  useEffect(() => { fetchStatus(); fetchEmployees(); }, [fetchStatus, fetchEmployees]);

  // Real-time Firestore listener for client document updates (e.g., nssf status, receiptUrl)
  const [liveClient, setLiveClient] = useState<ClientObligation>(client);
  useEffect(() => {
    setLiveClient(client);
  }, [client]);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'clients', client.id),
      (docSnap) => {
        if (docSnap.exists()) {
          setLiveClient({ ...client, ...docSnap.data() } as ClientObligation);
        }
      },
      (err) => {
        console.error('[ComplianceTabs] Firestore listener error for client:', err);
      }
    );
    return () => unsub();
  }, [client.id]);

  // Real-time Firestore listener for active filing jobs
  const activeJobsRef = useRef(activeJobs);
  activeJobsRef.current = activeJobs;

  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    for (const [type, job] of Object.entries(activeJobs)) {
      if (!job.jobId) continue;
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        // Terminal states—no need to listen
        continue;
      }

      const unsub = onSnapshot(
        doc(db, 'jobs', job.jobId),
        (docSnap) => {
          if (!docSnap.exists()) return;
          const data = docSnap.data();
          const newStatus = data.status as string;
          const newProgress = typeof data.progress === 'number' ? data.progress : job.progress;
          const newMessage = (data.message as string) || job.message;

          setActiveJobs((prev) => ({
            ...prev,
            [type]: {
              ...prev[type],
              status: newStatus || prev[type].status,
              progress: newProgress,
              message: newMessage,
            },
          }));

          if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') {
            onRefresh();
            fetchStatus();
          }
        },
        (err) => {
          console.error(`[ComplianceTabs] Firestore listener error for job ${job.jobId}:`, err);
        }
      );
      unsubscribes.push(unsub);
    }

    return () => unsubscribes.forEach((unsub) => unsub());
  }, [activeJobs, onRefresh, fetchStatus]);

  const handleGenerate = async () => {
    if (!runId) return; setGenerating(true); setError(null); setSuccess(null);
    try {
      const res = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}/generate-compliance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generatePaye: true, generateNssf: true, generateSha: true }),
      });
      const data = await res.json();
      if (res.ok) { setState({ ...data, statuses: { paye: data.payeZipUrl ? 'generated' : 'na', nssf: data.nssfFileUrl ? 'generated' : 'na', sha: data.shaFileUrl ? 'generated' : 'na' } }); setSuccess('Files generated'); onRefresh(); }
      else setError(data.message || 'Generation failed');
    } catch { setError('Network error'); } finally { setGenerating(false); }
  };

  const handleFile = async (type: string) => {
    setFilingType(type); setError(null); setSuccess(null);
    try {
      if (type === 'nssf') {
        const nssfUrl = state?.nssfFileUrl;
        if (!nssfUrl) { setError('NSSF file not available. Generate compliance files first.'); setFilingType(null); return; }
        const res = await apiFetch(`/tax/file-nssf-return`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: client.id, nssfFileUrl: nssfUrl, period: '' }) });
         const data = await res.json(); if (res.ok) { setSuccess(`NSSF queued. Job: ${data.jobId || 'N/A'}`); if (data.jobId) setActiveJobs(prev => ({ ...prev, nssf: { jobId: data.jobId, status: 'waiting', progress: 0, message: 'Queued' } })); } else setError(data.message || 'NSSF filing failed');
      } else if (type === 'paye') {
        const payeUrl = state?.payeZipUrl; const [ys, ms] = period.split('-'); const lastDay = new Date(parseInt(ys), parseInt(ms), 0).getDate();
        const res = await apiFetch(`/tax/file-return`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: client.id, kraPin: client.pin, kraPassword: client.password || client.iTaxPassword || '', taxObligationType: 'paye', periodFrom: `${ys}-${ms}-01`, periodTo: `${ys}-${ms}-${String(lastDay).padStart(2, '0')}`, payeZipUrl: payeUrl, printPrnOnly: false }) });
         const data = await res.json(); if (res.ok) { setSuccess(`PAYE queued. Job: ${data.jobId || 'N/A'}`); if (data.jobId) setActiveJobs(prev => ({ ...prev, paye: { jobId: data.jobId, status: 'waiting', progress: 0, message: 'Queued' } })); } else setError(data.message || 'PAYE filing failed');
      } else if (type === 'prn') {
        const [ys, ms] = period.split('-');
        const taxType = activeTab === 'paye' ? 'paye' : activeTab;
        const res = await apiFetch(`/tax/file-return`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: client.id, kraPin: client.pin, kraPassword: client.password || client.iTaxPassword || '', taxObligationType: taxType, periodFrom: `${ys}-${ms}-01`, periodTo: `${ys}-${ms}-${String(new Date(parseInt(ys), parseInt(ms), 0).getDate()).padStart(2, '0')}`, printPrnOnly: true }) });
        const data = await res.json(); if (res.ok) { setSuccess(`PRN queued. Job: ${data.jobId || 'N/A'}`); if (data.jobId) setActiveJobs(prev => ({ ...prev, [activeTab]: { jobId: data.jobId, status: 'waiting', progress: 0, message: 'PRN queued' } })); } else setError(data.message || 'PRN generation failed');
      }
    } catch { setError('Network error'); } finally { setFilingType(null); }
  };

  const getUrl = (key: string): string | null => { if (!state) return null; if (key === 'paye') return state.payeZipUrl; if (key === 'nssf') return state.nssfFileUrl; if (key === 'sha') return state.shaFileUrl; return null; };
  const getStoredStatus = (key: string): string => { if (!state) return 'na'; return state.statuses[key as keyof typeof state.statuses] || 'na'; };

  const isFinalized = runStatus === 'finalized' || runStatus === 'filed';
  const activeConfig = tabs.find((t) => t.key === activeTab);
  const getEmp = (employeeId: number) => employees.find((e) => e.id === employeeId);

  const nssfRows = entries.flatMap((e) => {
    const emp = getEmp(e.employeeId); const gross = e.grossPay || 0;
    const tier1Member = roundMoney(Math.min(gross * 0.06, 540)); const tier1Employer = tier1Member;
    const tier2Member = roundMoney(Math.max(0, Math.min((gross - 9000) * 0.06, 5940))); const tier2Employer = tier2Member;
    const { firstNames: otherNames, lastName: surname } = splitName(e.employeeName);
    const rows = [];
    rows.push({ payrollNo: emp?.payrollNumber || '', surname, otherNames, idNo: emp?.idNumber || '', kraPin: e.kraPin || '', nssfNo: emp?.nssfNo || '', contribType: '101', income: gross, incomeType: '1', member: tier1Member, employer: tier1Employer, total: roundMoney(tier1Member + tier1Employer) });
    if (tier2Member > 0) rows.push({ payrollNo: emp?.payrollNumber || '', surname, otherNames, idNo: emp?.idNumber || '', kraPin: e.kraPin || '', nssfNo: emp?.nssfNo || '', contribType: '102', income: gross, incomeType: '1', member: tier2Member, employer: tier2Employer, total: roundMoney(tier2Member + tier2Employer) });
    return rows;
  });

  const totalIncome = entries.reduce((s, e) => s + (e.grossPay || 0), 0);
  const totalMemberNssf = nssfRows.reduce((s, r) => s + r.member, 0);
  const totalEmployerNssf = nssfRows.reduce((s, r) => s + r.employer, 0);
  const totalContributions = roundMoney(totalMemberNssf + totalEmployerNssf);
  const totalRecordsCount = nssfRows.length;

  const payeRows = entries.map((e) => {
    const emp = getEmp(e.employeeId);
    const resStatus = emp?.residentialStatus || 'Resident';
    const empType = emp?.typeOfEmployee || 'Primary Employee';
    const pwd = emp?.pwd || 'No';
    const exemptionCert = emp?.exemptionCert || '';
    const unpaidLeaveDays = e.unpaidLeaveDays || 0;
    const unpaidLeaveDeduction = roundMoney((e.basicPay / Math.max(1, e.daysWorked || 30)) * unpaidLeaveDays);
    const attendanceDeduction = roundMoney((e.basicPay / Math.max(1, e.daysWorked || 30)) * ((e.absentDays || 0) + (e.lateDays || 0) * 0.5));
    const bonusPay = e.bonusPay || 0;
    const totalCashPay = roundMoney(e.basicPay + e.overtimePay + bonusPay - unpaidLeaveDeduction - attendanceDeduction);
    const housingOrOtherBenefits = emp?.housingBenefit || emp?.otherBenefits || e.otherBenefits || 0;
    const taxablePayCalc = roundMoney(Math.max(0, e.grossPay - e.shaDeduction - e.nssfDeduction - e.ahlDeduction));
    const typeEmpCode = empType.toLowerCase().includes('primary') ? 'PRMEMP' : 'SECEMP';
    const resStatCode = resStatus.toLowerCase().includes('non') ? 'NRES' : 'RES';
    return {
      kraPin: e.kraPin || '', employeeName: e.employeeName || '', resStatus, empType, pwd, exemptionCert,
      totalCashPay, carBenefit: emp?.carBenefit || 0, meals: emp?.mealsBenefit || 0, nonCash: emp?.nonCashBenefits || 0,
      typeOfHousing: emp?.typeOfHousing || 'Benefit not given', housingOrOtherBenefits,
      grossSalary: e.grossPay, shaContribution: e.shaDeduction, nssfContribution: e.nssfDeduction,
      otherPension: emp?.otherPension || 0, postRetMedical: emp?.postRetMedical || 0, mortgage: emp?.mortgageInterest || 0,
      ahl: e.ahlDeduction, taxablePayCalc, personalRelief: 2400, insuranceRelief: emp?.insuranceRelief || 0,
      paye: e.payeTax, selfAssessedPaye: e.payeTax, typeEmpCode, resStatCode,
    };
  });

  const shaRows = entries.map((e) => {
    const emp = getEmp(e.employeeId);
    const { firstNames, lastName } = splitName(e.employeeName);
    return { payrollNo: emp?.payrollNumber || '', firstNames, lastName, idType: 'National ID', idNo: emp?.idNumber || '', kraPin: e.kraPin || '', shaNo: emp?.shaNo || '', contribution: e.shaDeduction || 0, phone: emp?.phone || '' };
  });

  const totalGross = entries.reduce((s, e) => s + (e.grossPay || 0), 0);
  const totalNssf = entries.reduce((s, e) => s + (e.nssfDeduction || 0), 0);
  const totalSha = entries.reduce((s, e) => s + (e.shaDeduction || 0), 0);
  const totalAhl = entries.reduce((s, e) => s + (e.ahlDeduction || 0), 0);
  const totalPaye = entries.reduce((s, e) => s + (e.payeTax || 0), 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">Compliance Filing</h3>
        {runId && <button onClick={fetchStatus} className="rounded p-1 text-slate-400 hover:bg-slate-50 transition"><RefreshCw className="h-3 w-3" /></button>}
      </div>
      {error && <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><AlertCircle className="h-3.5 w-3.5" /> {error}</div>}
      {success && <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> {success}</div>}

      {/* Active filing job status */}
      {(() => {
        const job = activeJobs[activeTab];
        if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return null;
        const isError = job.status === 'failed' || job.status === 'cancelled';
        return (
          <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: isError ? '#fca5a5' : '#bfdbfe', backgroundColor: isError ? '#fef2f2' : '#eff6ff', color: isError ? '#b91c1c' : '#1d4ed8' }}>
            <Clock className="h-3.5 w-3.5 animate-spin" />
            <span className="font-semibold">{activeTab.toUpperCase()} {job.message?.toLowerCase().includes('prn') ? 'PRN generation' : 'filing'}:</span>
            <span>{job.message || 'Processing...'}</span>
            {typeof job.progress === 'number' && job.progress > 0 && (
              <span className="ml-auto font-mono">{job.progress}%</span>
            )}
          </div>
        );
      })()}

      <div className="flex border-b border-slate-100 overflow-x-auto">
        {tabs.map((tab) => {
          const url = getUrl(tab.key); const stored = getStoredStatus(tab.key);
          const status = deriveStatus(tab.key, runStatus, stored, !!url); const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={cn('flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition border-b-2 shrink-0', isActive ? 'text-slate-900 border-[#ff0613]' : 'text-slate-500 border-transparent hover:text-slate-700')}>
              <div className="h-5 w-5 flex items-center justify-center">{tab.logo ? <img src={tab.logo} alt={tab.label} className="max-h-full max-w-full object-contain" /> : <span>{tab.label[0]}</span>}</div>
              <div className="flex flex-col items-start"><span>{tab.label}</span>{tab.subLabel && <span className="text-[9px] font-medium text-slate-400">{tab.subLabel}</span>}</div>
              {status === 'generated' && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />}{status === 'filed' && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-blue-500" />}
            </button>
          );
        })}
      </div>

      {activeConfig && (
        <div className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex flex-col items-start gap-3 w-full lg:w-48 shrink-0">
              <div className={cn('h-14 w-14 rounded-xl border flex items-center justify-center', activeConfig.bgClass, activeConfig.borderClass)}>
                {activeConfig.logo ? <img src={activeConfig.logo} alt={activeConfig.label} className="max-h-10 max-w-10 object-contain" /> : <span className={cn('text-lg font-bold', activeConfig.colorClass)}>{activeConfig.label[0]}</span>}
              </div>
              <p className={cn('text-xs font-bold', activeConfig.colorClass)}>{activeConfig.label}</p>

              {activeTab === 'nssf' && (
                <div className="space-y-1 text-[10px] text-slate-700">
                  <p><span className="font-semibold text-slate-900">NSSF CONTRIBUTIONS</span></p>
                  <p>EMPLOYER KRA PIN: <span className="font-mono">{client.pin || 'N/A'}</span></p>
                  <p>EMPLOYER NSSF NUMBER: <span className="font-mono">{(client as any).nssfNo || (client as any).nssfLogin || 'N/A'}</span></p>
                  <p>EMPLOYER NAME: <span className="font-mono">{client.name || 'Company'}</span></p>
                  <p>CONTRIBUTIONS PERIOD: <span className="font-mono">{period ? period.replace('-', '').substring(2) + period.substring(0, 4) : 'N/A'}</span></p>
                  <p>TOTAL INCOME: <span className="font-mono font-semibold text-slate-900">{totalIncome.toLocaleString()}</span></p>
                  <p>TOTAL MEMBER: <span className="font-mono font-semibold text-slate-900">{totalMemberNssf.toLocaleString()}</span></p>
                  <p>TOTAL EMPLOYER: <span className="font-mono font-semibold text-slate-900">{totalEmployerNssf.toLocaleString()}</span></p>
                  <p>TOTAL CONTRIBUTIONS: <span className="font-mono font-semibold text-slate-900">{totalContributions.toLocaleString()}</span></p>
                  <p>TOTAL RECORDS: <span className="font-mono font-semibold text-slate-900">{totalRecordsCount}</span></p>
                </div>
              )}
              {activeTab === 'paye' && (
                <div className="space-y-1 text-[10px] text-slate-700">
                  <p>Total Gross: <span className="font-mono font-semibold text-slate-900">{totalGross.toLocaleString()}</span></p>
                  <p>Total PAYE: <span className="font-mono font-semibold text-slate-900">{totalPaye.toLocaleString()}</span></p>
                  <p>Total SHA: <span className="font-mono font-semibold text-slate-900">{totalSha.toLocaleString()}</span></p>
                  <p>Total AHL: <span className="font-mono font-semibold text-slate-900">{totalAhl.toLocaleString()}</span></p>
                  <p>Total NSSF: <span className="font-mono font-semibold text-slate-900">{totalNssf.toLocaleString()}</span></p>
                  <p>Employees: <span className="font-mono font-semibold text-slate-900">{entries.length}</span></p>
                </div>
              )}
              {activeTab === 'sha' && (
                <div className="space-y-1 text-[10px] text-slate-700">
                  <p>Total Contribution: <span className="font-mono font-semibold text-slate-900">{totalSha.toLocaleString()}</span></p>
                  <p>Employees: <span className="font-mono font-semibold text-slate-900">{entries.length}</span></p>
                </div>
              )}

              <div className="flex flex-col gap-2 w-full mt-2">
                {isFinalized && (
                  <button onClick={handleGenerate} disabled={generating} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40 w-full">
                    {generating ? <Clock className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Generate
                  </button>
                )}
                {(() => {
                  const url = getUrl(activeConfig.key); if (!url) return null;
                  return (
                    <>
                      <a href={url} download className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 transition w-full"><FileSpreadsheet className="h-3.5 w-3.5" /> Download</a>
                      {isFinalized && activeConfig.key !== 'helb' && <button onClick={() => handleFile(activeConfig.key)} disabled={filingType === activeConfig.key} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40 w-full">{filingType === activeConfig.key ? <Clock className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} File / Send</button>}
                      {isFinalized && activeConfig.key === 'paye' && <button onClick={() => handleFile('prn')} disabled={filingType === 'prn'} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 transition disabled:opacity-40 w-full">{filingType === 'prn' ? <Clock className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Print PRN</button>}
                    </>
                  );
                })()}
                {/* Filing error display */}
                {(() => {
                  const error = activeConfig.key === 'nssf' ? (liveClient.nssfError || liveClient.nssfErrorType)
                    : activeConfig.key === 'paye' ? (liveClient.payeError || liveClient.payeErrorType)
                    : activeConfig.key === 'sha' ? (liveClient.shaError || liveClient.shaErrorType)
                    : null;
                  if (!error) return null;
                  return (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 mt-1">
                      <p className="font-semibold">Filing Failed</p>
                      <p>{liveClient.nssfError || liveClient.payeError || liveClient.shaError}</p>
                    </div>
                  );
                })()}
                {/* Receipt download link after filing is completed */}
                {(() => {
                  // Prefer state (from compliance-status API) over liveClient (from Firestore)
                  // so the UI updates immediately after fetchStatus() is called on job completion.
                  const receiptUrl = activeConfig.key === 'paye' ? (state?.payeReceiptUrl || liveClient.payeReceiptUrl)
                    : activeConfig.key === 'nssf' ? (state?.nssfReceiptUrl || liveClient.nssfReceiptUrl)
                    : activeConfig.key === 'sha' ? (state?.shaReceiptUrl || liveClient.shaReceiptUrl)
                    : activeConfig.key === 'tot' ? liveClient.totReceiptUrl
                    : activeConfig.key === 'mri' ? liveClient.mriReceiptUrl
                    : activeConfig.key === 'vat' ? liveClient.vatReceiptUrl
                    : null;
                  const isFiled = activeConfig.key === 'paye' ? ((state?.statuses?.paye || liveClient.paye) === 'filed')
                    : activeConfig.key === 'nssf' ? ((state?.statuses?.nssf || liveClient.nssf) === 'filed')
                    : activeConfig.key === 'sha' ? ((state?.statuses?.sha || liveClient.sha) === 'filed')
                    : activeConfig.key === 'tot' ? liveClient.tot === 'filed'
                    : activeConfig.key === 'mri' ? liveClient.mri === 'filed'
                    : activeConfig.key === 'vat' ? liveClient.vat === 'filed'
                    : false;
                  if (!isFiled || !receiptUrl) return null;
                  return (
                    <button
                      onClick={async () => {
                        try {
                          const res = await apiFetch(receiptUrl.replace(/^\/api/, ''));
                          if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
                          const blob = await res.blob();
                          const objectUrl = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = objectUrl;
                          a.download = receiptUrl.split('/').pop() || 'receipt.pdf';
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          window.URL.revokeObjectURL(objectUrl);
                        } catch (e: any) {
                          alert('Failed to download receipt: ' + e.message);
                        }
                      }}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition w-full mt-1"
                    >
                      <Download className="h-3.5 w-3.5" /> Download Receipt
                    </button>
                  );
                })()}
                {/* PRN download link after filing is completed */}
                {(() => {
                  // Build a list of PRN URLs to show for this obligation
                  const prnEntries: Array<{ label: string; url: string }> = [];
                  const isFiled = activeConfig.key === 'paye' ? ((state?.statuses?.paye || liveClient.paye) === 'filed')
                    : activeConfig.key === 'nssf' ? ((state?.statuses?.nssf || liveClient.nssf) === 'filed')
                    : activeConfig.key === 'sha' ? ((state?.statuses?.sha || liveClient.sha) === 'filed')
                    : activeConfig.key === 'tot' ? liveClient.tot === 'filed'
                    : activeConfig.key === 'mri' ? liveClient.mri === 'filed'
                    : activeConfig.key === 'vat' ? liveClient.vat === 'filed'
                    : false;

                  if (!isFiled) return null;

                  // For PAYE, show all 3 PRNs (PAYE, NITA, AHL) if available
                  if (activeConfig.key === 'paye') {
                    const prnResults = (liveClient as any).payePrnResults || [];
                    if (prnResults.length > 0) {
                      prnResults.forEach((r: any) => {
                        const label = r.taxType === 'paye' ? 'PAYE PRN'
                          : r.taxType === 'nita' ? 'NITA Levy PRN'
                          : r.taxType === 'affordable_housing' ? 'Housing Levy PRN'
                          : 'PRN';
                        const url = r.prnGcsPath
                          ? `/api/clients/${client.id}/receipts/${r.taxType}_prn`
                          : r.prnPath;
                        if (url) prnEntries.push({ label, url });
                      });
                    } else if (liveClient.payePrnUrl) {
                      prnEntries.push({ label: 'PAYE PRN', url: liveClient.payePrnUrl });
                    }
                  } else {
                    // Single PRN for other obligations
                    const prnUrl = activeConfig.key === 'nssf' ? liveClient.nssfPrnUrl
                      : activeConfig.key === 'sha' ? liveClient.shaPrnUrl
                      : activeConfig.key === 'tot' ? liveClient.totPrnUrl
                      : activeConfig.key === 'mri' ? liveClient.mriPrnUrl
                      : activeConfig.key === 'vat' ? liveClient.vatPrnUrl
                      : null;
                    if (prnUrl) prnEntries.push({ label: 'PRN', url: prnUrl });
                  }

                  if (prnEntries.length === 0) return null;

                  return (
                    <div className="flex flex-col gap-1.5 mt-1">
                      {prnEntries.map((entry, idx) => (
                        <button
                          key={idx}
                          onClick={async () => {
                            try {
                              const res = await apiFetch(entry.url.replace(/^\/api/, ''));
                              if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
                              const blob = await res.blob();
                              const objectUrl = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = objectUrl;
                              a.download = entry.url.split('/').pop() || 'prn.pdf';
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              window.URL.revokeObjectURL(objectUrl);
                            } catch (e: any) {
                              alert('Failed to download PRN: ' + e.message);
                            }
                          }}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs font-bold text-green-700 hover:bg-green-100 transition w-full"
                        >
                          <Download className="h-3.5 w-3.5" /> {entry.label}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="flex-1 min-w-0 overflow-x-auto">
              {activeTab === 'nssf' && (
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">NSSF Return Preview</p>
                  <table className="w-full text-[10px] border border-slate-200 rounded-lg overflow-hidden">
                    <thead className="bg-slate-100">
                      <tr className="border-b border-slate-200 text-left font-semibold text-slate-700 uppercase tracking-wider">
                        <th className="px-2 py-1.5 whitespace-nowrap">Payroll No</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Surname</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Other Names</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">N/ID No</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">KRA PIN</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">NSSF No</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Contrib</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Income</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-center">Type</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Member</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Employer</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {nssfRows.length === 0 ? <tr><td colSpan={12} className="py-4 text-center text-slate-500">No payroll entries</td></tr> : nssfRows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-mono text-slate-800">{r.payrollNo}</td>
                          <td className="px-2 py-1.5 text-slate-800">{r.surname}</td>
                          <td className="px-2 py-1.5 text-slate-800">{r.otherNames}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.idNo}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.kraPin}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.nssfNo}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-800">{r.contribType}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.income.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-center font-mono text-slate-800">{r.incomeType}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.member.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.employer.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-900">{r.total.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'paye' && (
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">B_Employees_Dtls_Simp.csv Preview</p>
                  <table className="w-full text-[10px] border border-slate-200 rounded-lg overflow-hidden">
                    <thead className="bg-slate-100">
                      <tr className="border-b border-slate-200 text-left font-semibold text-slate-700 uppercase tracking-wider">
                        <th className="px-2 py-1.5 whitespace-nowrap">KRA PIN</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Employee Name</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Resident</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Employment</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">PWD</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Exemption</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Cash Pay</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Car</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Meals</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Non-Cash</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Housing</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Benefits</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Gross</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">SHA</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">NSSF</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Pension</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Med</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Mortgage</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">AHL</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Taxable</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Relief</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Ins Relief</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">PAYE</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Self PAYE</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Emp Code</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-center">0</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Res Code</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">DTEMP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payeRows.length === 0 ? <tr><td colSpan={28} className="py-4 text-center text-slate-500">No payroll entries</td></tr> : payeRows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.kraPin}</td>
                          <td className="px-2 py-1.5 text-slate-800 whitespace-nowrap">{r.employeeName}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.resStatus}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.empType}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.pwd}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.exemptionCert || ''}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.totalCashPay.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.carBenefit.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.meals.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.nonCash.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.typeOfHousing}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.housingOrOtherBenefits.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-900">{r.grossSalary.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.shaContribution.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.nssfContribution.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.otherPension.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.postRetMedical.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.mortgage.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.ahl.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-900">{r.taxablePayCalc.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.personalRelief.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.insuranceRelief.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.paye.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-800">{r.selfAssessedPaye.toLocaleString()}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.typeEmpCode}</td>
                          <td className="px-2 py-1.5 text-center font-mono text-slate-800">0</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.resStatCode}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">DTEMP</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'sha' && (
                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Payroll Template / SHA Contributions Preview</p>
                  <table className="w-full text-[10px] border border-slate-200 rounded-lg overflow-hidden">
                    <thead className="bg-slate-100">
                      <tr className="border-b border-slate-200 text-left font-semibold text-slate-700 uppercase tracking-wider">
                        <th className="px-2 py-1.5 whitespace-nowrap">Payroll No</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">First Names</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Last Name</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Identity Type</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Identity ID No</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">KRA PIN</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">SHA No</th>
                        <th className="px-2 py-1.5 whitespace-nowrap text-right">Contribution</th>
                        <th className="px-2 py-1.5 whitespace-nowrap">Phone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shaRows.length === 0 ? <tr><td colSpan={9} className="py-4 text-center text-slate-500">No payroll entries</td></tr> : shaRows.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-mono text-slate-800">{r.payrollNo}</td>
                          <td className="px-2 py-1.5 text-slate-800">{r.firstNames}</td>
                          <td className="px-2 py-1.5 text-slate-800">{r.lastName}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.idType}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.idNo}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.kraPin}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">{r.shaNo}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-900">{r.contribution.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-slate-700">{r.phone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'helb' && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-xs font-semibold text-slate-600">HELB Deductions</p>
                  <p className="text-[10px] text-slate-400 mt-1">Coming soon.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}