/**
 * MriClientView.tsx
 *
 * Single-client Monthly Rental Income (MRI) view with a client selector dropdown.
 */

import { useState, useMemo } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { ClientObligation } from '../../../types';
import { ClientSelectorDropdown } from '../ClientSelectorDropdown';
import { StatusBadge } from '../StatusBadges';
import {
    getReceiptUrlForObligation,
    getFilingStatusLabel,
    getFilingProgressTone,
    isPendingFilingJob,
    isTerminalFilingJob,
} from '../../../utils/dashboardUtils';
import { ActiveDashboardJob } from '../../../types';

interface MriClientViewProps {
    clients: ClientObligation[];
    activeJobs: Record<string, ActiveDashboardJob>;
    mriInputVals: Record<string, string>;
    setMriInputVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onFileMri: (client: ClientObligation) => Promise<void>;
    onGeneratePrn: (client: ClientObligation, type: string) => Promise<void>;
}

export function MriClientView({
    clients,
    activeJobs,
    mriInputVals,
    setMriInputVals,
    onFileMri,
    onGeneratePrn,
}: MriClientViewProps) {
    const mriClients = useMemo(() => clients.filter((c) => c.mri !== 'na'), [clients]);
    const [selectedClient, setSelectedClient] = useState<ClientObligation | null>(mriClients[0] || null);

    const client = selectedClient || mriClients[0];
    if (!client) {
        return (
            <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center">
                <p className="text-sm font-semibold text-slate-900">No MRI Clients</p>
                <p className="mt-1 text-xs text-slate-500">Add a client with an MRI obligation to see them here.</p>
            </div>
        );
    }

    const job = activeJobs[client.id];
    const relevantJob = !job?.obligationType || job.obligationType === 'monthly_rental_income' ? job : undefined;
    const latestReceiptUrl = relevantJob?.receiptUrl ?? getReceiptUrlForObligation(client, 'MRI');
    const latestPrnUrl = relevantJob?.prnUrl;
    const unifiedPrnUrl = latestPrnUrl && latestPrnUrl === latestReceiptUrl ? latestPrnUrl : undefined;

    return (
        <div className="mt-6 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="w-full sm:w-80">
                    <ClientSelectorDropdown clients={mriClients} selectedClient={client} onSelectClient={setSelectedClient} label="MRI Client" />
                </div>
                <StatusBadge status={client.mri} />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-5">
                {/* Rental Income Input */}
                <div className="rounded-xl bg-rose-50/40 border border-rose-500/20 p-5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Total Monthly Rental Income
                    </label>
                    <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs font-medium text-slate-500">KES</span>
                        <input
                            type="number"
                            placeholder="Rent Amount"
                            value={mriInputVals[client.id] || ''}
                            onChange={(e) => setMriInputVals((prev) => ({ ...prev, [client.id]: e.target.value }))}
                            className="w-full rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none focus:border-rose-500 transition shadow-inner"
                        />
                    </div>
                    <div className="border-t border-slate-200/80 pt-2 mt-3 flex justify-between items-center text-xs">
                        <span className="font-bold text-rose-600">7.5% Computed Tax</span>
                        <span className="font-black text-[13px] text-rose-600 drop-shadow-sm">
                            KES {mriInputVals[client.id] && !isNaN(parseFloat(mriInputVals[client.id]))
                                ? (parseFloat(mriInputVals[client.id]) * 0.075).toLocaleString(undefined, { minimumFractionDigits: 2 })
                                : '0.00'}
                        </span>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button onClick={() => void onFileMri(client)} disabled={isPendingFilingJob(relevantJob as any)} className={`inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-xs font-bold transition shadow-sm ${isPendingFilingJob(relevantJob as any) ? 'bg-slate-100 border-slate-100 text-slate-500 cursor-not-allowed' : 'bg-emerald-50 border-emerald-500/20 text-emerald-600 hover:bg-emerald-100'}`}>
                        {isPendingFilingJob(relevantJob as any) && <RefreshCw className="h-3 w-3 animate-spin" />}
                        File MRI
                    </button>
                    <button onClick={() => void onGeneratePrn(client, 'mri')} disabled={isPendingFilingJob(relevantJob as any)} className="inline-flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-5 py-2.5 text-xs font-bold text-[#ff0613] hover:bg-red-100 transition shadow-sm disabled:opacity-50">
                        {isPendingFilingJob(relevantJob as any) && <RefreshCw className="h-3 w-3 animate-spin" />}
                        Print PRN
                    </button>
                </div>

                {/* Job status */}
                {relevantJob && (
                    <div className="w-full bg-white border border-slate-100 rounded-lg p-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] text-slate-600 font-medium font-mono uppercase tracking-wider truncate">{getFilingStatusLabel(relevantJob as any)}</span>
                            <span className="text-[10px] text-slate-500 font-mono">{relevantJob.progress}%</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1 overflow-hidden">
                            <div className={`h-1.5 rounded-full transition-all duration-500 ${getFilingProgressTone(relevantJob as any)}`} style={{ width: `${Math.max(relevantJob.progress, 5)}%` }} />
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                            {relevantJob.state === 'failed' ? <span className="text-red-600">{relevantJob.failedReason || 'An error occurred.'}</span> : relevantJob.message}
                        </div>
                    </div>
                )}

                {isTerminalFilingJob(relevantJob as any) && (latestReceiptUrl || latestPrnUrl) && (
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                        {latestReceiptUrl && !unifiedPrnUrl && latestReceiptUrl !== latestPrnUrl && (
                            <a href={latestReceiptUrl} download rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-500/20 px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-100 transition"><Download className="h-3.5 w-3.5" /> Receipt</a>
                        )}
                        {(latestPrnUrl || unifiedPrnUrl) && (
                            <a href={unifiedPrnUrl ?? latestPrnUrl} download rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-xs font-bold text-[#ff0613] hover:bg-red-100 transition"><Download className="h-3.5 w-3.5" /> PRN</a>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
