/**
 * TotClientView.tsx
 *
 * Single-client Turnover Tax (ToT) view with a client selector dropdown.
 */

import { useState, useMemo } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { downloadAuthFile } from '../../../utils/downloadAuthFile';
import { ClientObligation } from '../../../types';
import { ClientSelectorDropdown } from '../ClientSelectorDropdown';
import { StatusBadge } from '../StatusBadges';
import {
    getReceiptUrlForObligation,
    isPendingFilingJob,
    isTerminalFilingJob,
} from '../../../utils/dashboardUtils';
import JobStatusInline from '../JobStatusInline';
import { ActiveDashboardJob } from '../../../types';

interface TotClientViewProps {
    clients: ClientObligation[];
    activeJobs: Record<string, ActiveDashboardJob>;
    totInputVals: Record<string, string>;
    setTotInputVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onFileTot: (client: ClientObligation) => Promise<void>;
    onGenerateTotZip: (client: ClientObligation) => Promise<void>;
    onGeneratePrn: (client: ClientObligation, type: string) => Promise<void>;
    onCancelJob?: (client: ClientObligation) => Promise<void>;
    cancellingClientIds?: Record<string, boolean>;
}

export function TotClientView({
    clients,
    activeJobs,
    totInputVals,
    setTotInputVals,
    onFileTot,
    onGenerateTotZip,
    onGeneratePrn,
    onCancelJob,
    cancellingClientIds,
}: TotClientViewProps) {
    const totClients = useMemo(() => clients.filter((c) => c.tot !== 'na'), [clients]);
    const [selectedClient, setSelectedClient] = useState<ClientObligation | null>(totClients[0] || null);

    const client = selectedClient || totClients[0];
    if (!client) {
        return (
            <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center">
                <p className="text-sm font-semibold text-slate-900">No ToT Clients</p>
                <p className="mt-1 text-xs text-slate-500">Add a client with a ToT obligation to see them here.</p>
            </div>
        );
    }

    const job = activeJobs[client.id];
    const relevantJob = !job?.obligationType || job.obligationType === 'turnover_tax' ? job : undefined;
    const latestReceiptUrl = relevantJob?.receiptUrl ?? getReceiptUrlForObligation(client, 'TOT');
    const latestPrnUrl = relevantJob?.prnUrl;
    const unifiedPrnUrl = latestPrnUrl && latestPrnUrl === latestReceiptUrl ? latestPrnUrl : undefined;

    return (
        <div className="mt-6 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="w-full sm:w-80">
                    <ClientSelectorDropdown clients={totClients} selectedClient={client} onSelectClient={setSelectedClient} label="ToT Client" />
                </div>
                <StatusBadge status={client.tot} />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-5">
                {/* Sales Input */}
                <div className="rounded-xl bg-blue-50/50 border border-blue-500/20 p-5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Gross Sales / Turnover
                    </label>
                    <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs font-medium text-slate-500">KES</span>
                        <input
                            type="number"
                            placeholder="Sales Amount"
                            value={totInputVals[client.id] || ''}
                            onChange={(e) => setTotInputVals((prev) => ({ ...prev, [client.id]: e.target.value }))}
                            className="w-full rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition shadow-inner"
                        />
                    </div>
                    <div className="border-t border-slate-200/80 pt-2 mt-3 flex justify-between items-center text-xs">
                        <span className="font-bold text-blue-600">1.5% Computed TOT</span>
                        <span className="font-black text-[13px] text-blue-600 drop-shadow-sm">
                            KES {totInputVals[client.id] && !isNaN(parseFloat(totInputVals[client.id]))
                                ? (parseFloat(totInputVals[client.id]) * 0.015).toLocaleString(undefined, { minimumFractionDigits: 2 })
                                : '0.00'}
                        </span>
                    </div>
                </div>

                {/* Downloads */}
                {client.totZipUrl && (
                    <a href={client.totZipUrl} download rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-600 hover:bg-emerald-100 transition">
                        <Download className="h-3.5 w-3.5" /> Download Generated ZIP
                    </a>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button onClick={() => void onGenerateTotZip(client)} className="inline-flex items-center gap-2 rounded-xl border bg-blue-50 border-blue-500/20 px-5 py-2.5 text-xs font-bold text-blue-600 hover:bg-blue-100 transition shadow-sm">
                        <RefreshCw className="h-3 w-3" /> {client.totZipUrl ? 'Regenerate TOT ZIP' : 'Generate TOT ZIP'}
                    </button>
                    <button onClick={() => void onFileTot(client)} disabled={isPendingFilingJob(relevantJob as any) || !client.totZipUrl} className={`inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-xs font-bold transition shadow-sm ${isPendingFilingJob(relevantJob as any) || !client.totZipUrl ? 'bg-slate-100 border-slate-100 text-slate-500 cursor-not-allowed' : 'bg-emerald-50 border-emerald-500/20 text-emerald-600 hover:bg-emerald-100'}`}>
                        {isPendingFilingJob(relevantJob as any) && <RefreshCw className="h-3 w-3 animate-spin" />}
                        File ToT
                    </button>
                    <button onClick={() => void onGeneratePrn(client, 'tot')} disabled={isPendingFilingJob(relevantJob as any)} className="inline-flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-5 py-2.5 text-xs font-bold text-[#ff0613] hover:bg-red-100 transition shadow-sm disabled:opacity-50">
                        {isPendingFilingJob(relevantJob as any) && <RefreshCw className="h-3 w-3 animate-spin" />}
                        Print PRN
                    </button>
                </div>

                {/* Job status */}
                {relevantJob && (
                    <JobStatusInline
                        job={relevantJob}
                        clientName={client.name}
                        onCancel={onCancelJob ? () => void onCancelJob(client) : undefined}
                        cancelling={Boolean(cancellingClientIds?.[client.id])}
                    />
                )}

                {isTerminalFilingJob(relevantJob as any) && (latestReceiptUrl || latestPrnUrl) && (
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                        {latestReceiptUrl && !unifiedPrnUrl && latestReceiptUrl !== latestPrnUrl && (
                            <button onClick={() => downloadAuthFile(latestReceiptUrl)} className="inline-flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-500/20 px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-100 transition"><Download className="h-3.5 w-3.5" /> Receipt</button>
                        )}
                        {(latestPrnUrl || unifiedPrnUrl) && (
                            <button onClick={() => downloadAuthFile((unifiedPrnUrl ?? latestPrnUrl)!)} className="inline-flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-xs font-bold text-[#ff0613] hover:bg-red-100 transition"><Download className="h-3.5 w-3.5" /> PRN</button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
