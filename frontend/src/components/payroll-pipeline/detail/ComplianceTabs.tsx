import { useState, useEffect, useCallback } from 'react';
import {
  FileArchive, FileSpreadsheet, Send, Play, AlertCircle, CheckCircle2,
  RefreshCw, Clock, Building2, ShieldCheck, GraduationCap,
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';
import type { ClientObligation } from '../../../types';

type RunStatus = 'draft' | 'approved' | 'finalized' | 'filed';
type ObligationStatus = 'na' | 'not_ready' | 'ready' | 'generated' | 'filed';

interface ComplianceTabsProps {
  client: ClientObligation;
  runId?: number;
  period: string;
  runStatus: RunStatus;
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
  filePreview: { name: string; desc: string }[];
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
    filePreview: [
      { name: 'PAYE Return CSV', desc: 'Monthly PAYE remittance per employee' },
      { name: 'NITA Levy CSV', desc: 'National Industrial Training Levy (0.5%)' },
      { name: 'AHL CSV', desc: 'Affordable Housing Levy (1.5%)' },
    ],
  },
  {
    key: 'nssf',
    label: 'NSSF',
    logo: '/logos/nssflogo.png',
    altIcon: <ShieldCheck className="h-6 w-6 text-emerald-600" />,
    colorClass: 'text-emerald-700',
    bgClass: 'bg-emerald-50',
    borderClass: 'border-emerald-200',
    filePreview: [
      { name: 'NSSF Return CSV', desc: 'Tier I & II contributions per employee' },
      { name: 'NSSF Receipt', desc: 'Auto-generated after e-filing' },
    ],
  },
  {
    key: 'sha',
    label: 'SHA',
    logo: '/logos/shalogo.png',
    altIcon: <ShieldCheck className="h-6 w-6 text-violet-600" />,
    colorClass: 'text-violet-700',
    bgClass: 'bg-violet-50',
    borderClass: 'border-violet-200',
    filePreview: [
      { name: 'SHA Return CSV', desc: 'Social Health Authority contributions' },
      { name: 'SHA Receipt', desc: 'Auto-generated after e-filing' },
    ],
  },
  {
    key: 'helb',
    label: 'HELB',
    logo: null,
    altIcon: <GraduationCap className="h-6 w-6 text-amber-600" />,
    colorClass: 'text-amber-700',
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-200',
    filePreview: [
      { name: 'HELB Deductions', desc: 'Student loan deductions per employee' },
    ],
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

export function ComplianceTabs({ client, runId, period, runStatus, onRefresh }: ComplianceTabsProps) {
  const [activeTab, setActiveTab] = useState('paye');
  const [state, setState] = useState<ComplianceState | null>(null);
  const [generating, setGenerating] = useState(false);
  const [filingType, setFilingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}/compliance-status`);
      if (res.ok) {
        setState(await res.json());
      }
    } catch { /* ignore */ }
  }, [client.id, runId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

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

  const getLabel = (key: string): string | null => {
    if (!state) return null;
    if (key === 'paye') return state.payeZipLabel;
    if (key === 'nssf') return state.nssfFileLabel;
    if (key === 'sha') return state.shaFileLabel;
    return null;
  };

  const getStoredStatus = (key: string): string => {
    if (!state) return 'na';
    return state.statuses[key as keyof typeof state.statuses] || 'na';
  };

  const isFinalized = runStatus === 'finalized' || runStatus === 'filed';
  const activeConfig = tabs.find((t) => t.key === activeTab);

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
      <div className="flex border-b border-slate-100">
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
                'flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition border-b-2',
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
          <div className="flex items-start gap-4">
            {/* Left: Logo + Status + Amounts */}
            <div className="flex flex-col items-center gap-2 w-32 shrink-0">
              <div className={cn('h-16 w-16 rounded-xl border flex items-center justify-center', activeConfig.bgClass, activeConfig.borderClass)}>
                {activeConfig.logo ? (
                  <img src={activeConfig.logo} alt={activeConfig.label} className="max-h-12 max-w-12 object-contain" />
                ) : (
                  activeConfig.altIcon
                )}
              </div>
              <p className={cn('text-xs font-bold', activeConfig.colorClass)}>{activeConfig.label}</p>
              {isFinalized && (
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40 w-full justify-center"
                >
                  {generating ? <Clock className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Generate
                </button>
              )}
            </div>

            {/* Middle: File Preview */}
            <div className="flex-1 min-w-0">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">File Contents</h4>
              <div className="space-y-2">
                {activeConfig.filePreview.map((file) => (
                  <div key={file.name} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <FileSpreadsheet className="h-4 w-4 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">{file.name}</p>
                      <p className="text-[10px] text-slate-500 truncate">{file.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex flex-col items-end gap-2 w-36 shrink-0">
              {(() => {
                const url = getUrl(activeConfig.key);
                const label = getLabel(activeConfig.key);
                const isFiling = filingType === activeConfig.key;
                if (!url) {
                  return (
                    <div className="text-center w-full">
                      <p className="text-[10px] text-slate-400 mb-2">No file generated yet</p>
                      {!isFinalized && (
                        <p className="text-[10px] text-amber-600 font-medium">Finalize payroll first</p>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="flex flex-col gap-2 w-full">
                    <a
                      href={url}
                      download={label || `${activeConfig.label}.zip`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 transition w-full"
                    >
                      {url.endsWith('.zip') ? <FileArchive className="h-3.5 w-3.5" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                      Download
                    </a>
                    {isFinalized && activeConfig.key !== 'helb' && (
                      <button
                        onClick={() => handleFile(activeConfig.key)}
                        disabled={isFiling}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40 w-full"
                      >
                        {isFiling ? <Clock className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        File / Send
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
