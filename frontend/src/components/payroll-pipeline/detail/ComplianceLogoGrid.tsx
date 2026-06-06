import { useState, useEffect, useCallback } from 'react';
import {
    FileArchive, FileSpreadsheet, Send, Play, AlertCircle, CheckCircle2,
    RefreshCw, Clock, Home
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';
import type { ClientObligation } from '../../../types';

type RunStatus = 'draft' | 'approved' | 'finalized' | 'filed';
type ObligationStatus = 'na' | 'not_ready' | 'ready' | 'generated' | 'filed';

interface ComplianceLogoGridProps {
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

interface ObligationConfig {
    key: 'paye' | 'nssf' | 'sha' | 'nita' | 'housingLevy';
    label: string;
    logo: string | null;
    altLogo: React.ReactNode;
    colorClass: string;
    bgClass: string;
    borderClass: string;
}

const obligations: ObligationConfig[] = [
    {
        key: 'paye',
        label: 'PAYE',
        logo: '/logos/kra.png',
        altLogo: null,
        colorClass: 'text-blue-700',
        bgClass: 'bg-blue-50',
        borderClass: 'border-blue-200',
    },
    {
        key: 'nssf',
        label: 'NSSF',
        logo: '/logos/nssflogo.png',
        altLogo: null,
        colorClass: 'text-emerald-700',
        bgClass: 'bg-emerald-50',
        borderClass: 'border-emerald-200',
    },
    {
        key: 'sha',
        label: 'SHA',
        logo: '/logos/shalogo.png',
        altLogo: null,
        colorClass: 'text-violet-700',
        bgClass: 'bg-violet-50',
        borderClass: 'border-violet-200',
    },
    {
        key: 'nita',
        label: 'NITA',
        logo: '/logos/tourismfundlogo.png',
        altLogo: null,
        colorClass: 'text-amber-700',
        bgClass: 'bg-amber-50',
        borderClass: 'border-amber-200',
    },
    {
        key: 'housingLevy',
        label: 'Housing Levy',
        logo: null,
        altLogo: <Home className="h-6 w-6 text-rose-500" />,
        colorClass: 'text-rose-700',
        bgClass: 'bg-rose-50',
        borderClass: 'border-rose-200',
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

export function ComplianceLogoGrid({ client, runId, period, runStatus, onRefresh }: ComplianceLogoGridProps) {
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
                setSuccess('Files generated');
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
                if (!nssfUrl) {
                    setError('NSSF file not available. Generate compliance files first.');
                    setFilingType(null);
                    return;
                }
                const res = await apiFetch(`/tax/file-nssf-return`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId: client.id, nssfFileUrl: nssfUrl, period: '' }),
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
                if (res.ok) setSuccess(`PAYE queued. Job: ${data.jobId || 'N/A'}`);
                else setError(data.message || 'PAYE filing failed');
            }
        } catch {
            setError(`Network error. Ensure backend is deployed.`);
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

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900">Compliance</h3>
                {runId && (
                    <button onClick={fetchStatus} className="rounded p-1 text-slate-400 hover:bg-slate-50 transition">
                        <RefreshCw className="h-3 w-3" />
                    </button>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 mb-2">
                    <AlertCircle className="h-3.5 w-3.5" /> {error}
                </div>
            )}
            {success && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 mb-2">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {success}
                </div>
            )}

            {/* Logo grid */}
            <div className="grid grid-cols-2 gap-2">
                {obligations.map((obl) => {
                    const url = getUrl(obl.key);
                    const label = getLabel(obl.key);
                    const stored = getStoredStatus(obl.key);
                    const hasUrl = !!url;
                    const status = deriveStatus(obl.key, runStatus, stored, hasUrl);
                    const isFiling = filingType === obl.key;

                    const statusBadge = (
                        <span className={cn(
                            'text-[9px] font-bold uppercase tracking-wider',
                            status === 'filed' ? 'text-blue-600' :
                            status === 'generated' ? 'text-emerald-600' :
                            status === 'ready' ? 'text-amber-600' :
                            'text-slate-400'
                        )}>
                            {status === 'filed' ? 'Filed' : status === 'generated' ? 'Generated' : status === 'ready' ? 'Ready' : 'Pending'}
                        </span>
                    );

                    return (
                        <div key={obl.key} className={cn('rounded-lg border p-2.5 flex flex-col items-center text-center', obl.bgClass, obl.borderClass)}>
                            {/* Logo */}
                            <div className="h-10 w-10 flex items-center justify-center mb-1.5">
                                {obl.logo ? (
                                    <img src={obl.logo} alt={obl.label} className="max-h-full max-w-full object-contain" />
                                ) : (
                                    obl.altLogo
                                )}
                            </div>

                            {/* Label + Status */}
                            <div className="mb-1.5">
                                <p className="text-[10px] font-bold text-slate-800">{obl.label}</p>
                                {statusBadge}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 mt-auto">
                                {isFinalized && !url && (
                                    <button
                                        onClick={handleGenerate}
                                        disabled={generating}
                                        className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[9px] font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 transition disabled:opacity-40"
                                    >
                                        {generating ? <Clock className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />}
                                        Gen
                                    </button>
                                )}
                                {url && (
                                    <>
                                        <a
                                            href={url}
                                            download={label || `${obl.label}.zip`}
                                            className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[9px] font-bold text-blue-600 border border-slate-200 hover:bg-blue-50 transition"
                                            title={label || obl.label}
                                        >
                                            {url.endsWith('.zip') ? (
                                                <FileArchive className="h-3.5 w-3.5" />
                                            ) : (
                                                <FileSpreadsheet className="h-3.5 w-3.5" />
                                            )}
                                        </a>
                                        {isFinalized && (
                                            <button
                                                onClick={() => handleFile(obl.key)}
                                                disabled={isFiling}
                                                className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[9px] font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 transition disabled:opacity-40"
                                            >
                                                {isFiling ? <Clock className="h-2.5 w-2.5 animate-spin" /> : <Send className="h-2.5 w-2.5" />}
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
