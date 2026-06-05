/**
 * DstClientView.tsx
 *
 * Single-client Digital Service Tax (DST) view with a client selector dropdown.
 */

import { useState, useMemo } from 'react';
import { Upload, RefreshCw, Download } from 'lucide-react';
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

interface DstClientViewProps {
    clients: ClientObligation[];
    activeJobs: Record<string, ActiveDashboardJob>;
    onAutoFile: (client: ClientObligation) => Promise<void>;
    onGeneratePrn: (client: ClientObligation, type: string) => Promise<void>;
    onCancelJob?: (client: ClientObligation) => Promise<void>;
    cancellingClientIds?: Record<string, boolean>;
}

export function DstClientView({
    clients,
    activeJobs,
    onAutoFile,
    onGeneratePrn,
    onCancelJob,
    cancellingClientIds,
}: DstClientViewProps) {
    const dstClients = useMemo(() => clients.filter((c) => c.dst !== 'na'), [clients]);
    const [selectedClient, setSelectedClient] = useState<ClientObligation | null>(dstClients[0] || null);

    const client = selectedClient || dstClients[0];
    if (!client) {
        return (
            <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center">
                <p className="text-sm font-semibold text-slate-900">No DST Clients</p>
                <p className="mt-1 text-xs text-slate-500">Add a client with a DST obligation to see them here.</p>
            </div>
        );
    }

    const job = activeJobs[client.id];
    const relevantJob = !job?.obligationType || job.obligationType === 'dst' ? job : undefined;
    const latestReceiptUrl = relevantJob?.receiptUrl ?? getReceiptUrlForObligation(client, 'DST');
    const latestPrnUrl = relevantJob?.prnUrl;
    const unifiedPrnUrl = latestPrnUrl && latestPrnUrl === latestReceiptUrl ? latestPrnUrl : undefined;

    return (
        <div className="mt-6 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="w-full sm:w-80">
                    <ClientSelectorDropdown clients={dstClients} selectedClient={client} onSelectClient={setSelectedClient} label="DST Client" />
                </div>
                <StatusBadge status={client.dst} />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-5">
                {/* Upload placeholder */}
                <div className="rounded-xl bg-fuchsia-50/40 border border-fuchsia-500/20 p-5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        DST Sales Data
                    </label>
                    <button className="mt-3 inline-flex items-center gap-2 rounded-xl bg-fuchsia-50 border border-fuchsia-500/20 px-5 py-2.5 text-xs font-bold text-fuchsia-600 hover:bg-fuchsia-100 transition">
                        <Upload className="h-3.5 w-3.5" /> Upload Sales CSV
                    </button>
                    <p className="mt-2 text-[11px] text-slate-500">Upload a CSV with digital service sales to compute DST.</p>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button onClick={() => void onAutoFile(client)} disabled={isPendingFilingJob(relevantJob as any)} className={`inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-xs font-bold transition shadow-sm ${isPendingFilingJob(relevantJob as any) ? 'bg-slate-100 border-slate-100 text-slate-500 cursor-not-allowed' : 'bg-emerald-50 border-emerald-500/20 text-emerald-600 hover:bg-emerald-100'}`}>
                        {isPendingFilingJob(relevantJob as any) && <RefreshCw className="h-3 w-3 animate-spin" />}
                        File DST
                    </button>
                    <button onClick={() => void onGeneratePrn(client, 'dst')} disabled={isPendingFilingJob(relevantJob as any)} className="inline-flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-5 py-2.5 text-xs font-bold text-[#ff0613] hover:bg-red-100 transition shadow-sm disabled:opacity-50">
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
