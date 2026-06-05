import { useState, useEffect, useCallback } from 'react';
import {
    FileArchive, FileSpreadsheet, FileText, Download, Send, Play,
    AlertCircle, CheckCircle2, Info, RefreshCw, Clock
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';
import type { ClientObligation } from '../../../types';

type RunStatus = 'draft' | 'approved' | 'finalized' | 'filed';
type ObligationStatus = 'na' | 'not_ready' | 'ready' | 'generated' | 'filed';

interface ComplianceSidebarProps {
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

const obligations = [
    { key: 'paye' as const, label: 'PAYE', icon: FileArchive, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
    { key: 'nssf' as const, label: 'NSSF', icon: FileSpreadsheet, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    { key: 'sha' as const, label: 'SHA', icon: FileText, color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-200' },
    { key: 'nita' as const, label: 'NITA', icon: FileText, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
    { key: 'housingLevy' as const, label: 'Housing Levy', icon: FileText, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200' },
];

function deriveObligationStatus(
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

export function ComplianceSidebar({ client, runId, period, runStatus, onRefresh }: ComplianceSidebarProps) {
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
                const data = await res.json();
                setState(data);
            }
        } catch {
            // ignore
        }
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
                setSuccess('Compliance files generated.');
                onRefresh();
            } else {
                setError(data.message || 'Generation failed');
            }
        } catch {
            setError('Network error during generation');
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
                    setError('NSSF file or Master CSV not available. Generate compliance files first.');
                    setFilingType(null);
                    return;
                }
                const res = await apiFetch(`/tax/file-nssf-return`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId: client.id, nssfFileUrl: nssfUrl, masterFileUrl: masterUrl, period: '' }),
                });
                const data = await res.json();
                if (res.ok) {
                    setSuccess(`NSSF filing queued. Job: ${data.jobId || 'N/A'}`);
                } else {
                    setError(data.message || 'NSSF filing failed');
                }
            } else if (type === 'paye') {
                const payeUrl = state?.payeZipUrl;
                const [yearStr, monthStr] = period.split('-');
                const lastDay = new Date(parseInt(yearStr), parseInt(monthStr), 0).getDate();
                const periodFrom = `${yearStr}-${monthStr}-01`;
                const periodTo = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
                const res = await apiFetch(`/tax/file-return`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        clientId: client.id,
                        kraPin: client.pin,
                        kraPassword: client.password || client.iTaxPassword || '',
                        taxObligationType: 'paye',
                        periodFrom,
                        periodTo,
                        payeZipUrl: payeUrl,
                        printPrnOnly: false,
                    }),
                });
                const data = await res.json();
                if (res.ok) {
                    setSuccess(`PAYE filing queued. Job: ${data.jobId || 'N/A'}`);
                } else {
                    setError(data.message || 'PAYE filing failed');
                }
            }
        } catch {
            setError(`Network error during ${type.toUpperCase()} filing. Ensure backend is deployed.`);
        } finally {
            setFilingType(null);
        }
    };

    const getObligationUrl = (key: string): string | null => {
        if (!state) return null;
        if (key === 'paye') return state.payeZipUrl;
        if (key === 'nssf') return state.nssfFileUrl;
        if (key === 'sha') return state.shaFileUrl;
        return null;
    };

    const getObligationLabel = (key: string): string | null => {
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

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900">Compliance</h3>
                {runId && (
                    <button
                        onClick={fetchStatus}
                        className="rounded p-1 text-slate-400 hover:bg-slate-50 transition"
                    >
                        <RefreshCw className="h-3 w-3" />
                    </button>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 mb-3">
                    <AlertCircle className="h-3.5 w-3.5" /> {error}
                </div>
            )}
            {success && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 mb-3">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {success}
                </div>
            )}

            {!isFinalized && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-3">
                    <p className="text-xs text-amber-700 flex items-center gap-1.5">
                        <Info className="h-3.5 w-3.5" />
                        Finalize the run to generate compliance files.
                    </p>
                </div>
            )}

            <div className="space-y-2">
                {obligations.map((obl) => {
                    const url = getObligationUrl(obl.key);
                    const label = getObligationLabel(obl.key);
                    const storedStatus = getStoredStatus(obl.key);
                    const hasUrl = !!url;
                    const status = deriveObligationStatus(obl.key, runStatus, storedStatus, hasUrl);
                    const Icon = obl.icon;
                    const isFiling = filingType === obl.key;

                    return (
                        <div key={obl.key} className={cn('rounded-lg border p-3', obl.bg, obl.border)}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Icon className={cn('h-4 w-4', obl.color)} />
                                    <span className="text-xs font-bold text-slate-800">{obl.label}</span>
                                </div>
                                <span className={cn(
                                    'text-[10px] font-bold uppercase tracking-wider',
                                    status === 'filed' ? 'text-blue-600' :
                                    status === 'generated' ? 'text-emerald-600' :
                                    status === 'ready' ? 'text-amber-600' :
                                    'text-slate-400'
                                )}>
                                    {status === 'filed' ? 'Filed' : status === 'generated' ? 'Generated' : status === 'ready' ? 'Ready' : 'Not Ready'}
                                </span>
                            </div>

                            {url && label && (
                                <div className="mt-2">
                                    <a
                                        href={url}
                                        download={label}
                                        className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-blue-600 hover:text-blue-800 transition"
                                    >
                                        <Download className="h-3 w-3" /> {label}
                                    </a>
                                </div>
                            )}

                            <div className="flex items-center gap-2 mt-2">
                                {isFinalized && !url && (
                                    <button
                                        onClick={handleGenerate}
                                        disabled={generating}
                                        className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 transition disabled:opacity-40"
                                    >
                                        {generating ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                        Generate
                                    </button>
                                )}
                                {isFinalized && url && (
                                    <button
                                        onClick={() => handleFile(obl.key)}
                                        disabled={isFiling}
                                        className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 transition disabled:opacity-40"
                                    >
                                        {isFiling ? <Clock className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                        File
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
