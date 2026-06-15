/**
 * VatClientView.tsx
 *
 * Single-client VAT view with Section M (Output / Sales) and Section N (Input / Purchases)
 * side by side, plus credit brought forward and Section B input fields.
 */

import { useState, useMemo } from 'react';
import { Download, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { downloadAuthFile } from '../../../utils/downloadAuthFile';
import { ClientObligation, VatPreparationSummary } from '../../../types';
import { ClientSelectorDropdown } from '../ClientSelectorDropdown';
import { VatSummaryCard } from '../VatSummaryCard';
import {
    formatTaxAmount,
    getReceiptUrlForObligation,
    getPrnUrlForObligation,
    isPendingFilingJob,
    isTerminalFilingJob,
    getClientFilingPeriod,
} from '../../../utils/dashboardUtils';
import JobStatusInline from '../JobStatusInline';
import { InteractiveStatusBadge } from '../StatusBadges';
import { ActiveDashboardJob } from '../../../types';

interface VatClientViewProps {
    clients: ClientObligation[];
    activeJobs: Record<string, ActiveDashboardJob>;
    vatSectionBWithoutPinVals: Record<string, string>;
    setVatSectionBWithoutPinVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onPrepareVat: (client: ClientObligation) => Promise<void>;
    onConfirmVatFiling: (client: ClientObligation) => Promise<void>;
    onGeneratePrn: (client: ClientObligation, type: string) => Promise<void>;
    onCancelJob?: (client: ClientObligation) => Promise<void>;
    cancellingClientIds?: Record<string, boolean>;
    setClients?: React.Dispatch<React.SetStateAction<ClientObligation[]>>;
}

export function VatClientView({
    clients,
    activeJobs,
    vatSectionBWithoutPinVals,
    setVatSectionBWithoutPinVals,
    onPrepareVat,
    onConfirmVatFiling,
    onGeneratePrn,
    onCancelJob,
    cancellingClientIds,
    setClients,
}: VatClientViewProps) {
    const vatClients = useMemo(() => clients.filter((c) => c.vat !== 'na'), [clients]);

    const [selectedClient, setSelectedClient] = useState<ClientObligation | null>(
        vatClients[0] || null
    );

    const client = selectedClient || vatClients[0];
    if (!client) {
        return (
            <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center">
                <p className="text-sm font-semibold text-slate-900">No VAT Clients</p>
                <p className="mt-1 text-xs text-slate-500">
                    Add a client with a VAT obligation to see them here.
                </p>
            </div>
        );
    }

    const job = activeJobs[client.id];
    const relevantJob = !job?.obligationType || job.obligationType === 'vat' ? job : undefined;

    const latestReceiptUrl = relevantJob?.receiptUrl ?? getReceiptUrlForObligation(client, 'VAT');
    const latestPrnUrl = relevantJob?.prnUrl ?? getPrnUrlForObligation(client, 'VAT');
    const unifiedPrnUrl = latestPrnUrl && latestPrnUrl === latestReceiptUrl ? latestPrnUrl : undefined;

    const vatGeneratedZipUrl = client.vatZipUrl ?? relevantJob?.generatedZipUrl;
    const vatSourcePackageUrl = client.vatSourcePackageUrl ?? relevantJob?.sourcePackageUrl;

    // Extract credit and withholding from job results or client data
    const vatSummary: VatPreparationSummary = {
        inputVat: client.vatInputVat ?? relevantJob?.vatSummary?.inputVat ?? 0,
        outputVat: client.vatOutputVat ?? relevantJob?.vatSummary?.outputVat ?? 0,
        previousCredit: client.vatPreviousCredit ?? relevantJob?.vatSummary?.previousCredit ?? 0,
        withholdingAmount: client.vatWithholdingAmount ?? relevantJob?.vatSummary?.withholdingAmount ?? 0,
        payableVat: client.vatPayableVat ?? relevantJob?.vatSummary?.payableVat ?? 0,
        netVatBalance: client.vatNetVatBalance ?? relevantJob?.vatSummary?.netVatBalance ?? 0,
        sales: relevantJob?.vatSummary?.sales,
        purchases: relevantJob?.vatSummary?.purchases,
    };

    const vatSectionBWithoutPinInputValue =
        vatSectionBWithoutPinVals[client.id] ??
        (typeof client.vatSectionBWithoutPinSales === 'number'
            ? String(client.vatSectionBWithoutPinSales)
            : '');

    const vatHasPreparedArtifacts = Boolean(vatGeneratedZipUrl);
    const vatGenerateActionLabel = vatHasPreparedArtifacts ? 'Regenerate VAT ZIP' : 'Generate VAT ZIP';

    // Determine the VAT period from client settings (or fallback to current filing period)
    const vatPeriod = getClientFilingPeriod(client, 'vat');
    const vatPeriodKey = vatPeriod.period;
    const vatPeriodAlreadyFiled = client.filedPeriods?.vat?.includes(vatPeriodKey);

    const [periodLoading, setPeriodLoading] = useState(false);

    const changeVatPeriod = async (direction: 'prev' | 'next') => {
        if (!client || periodLoading) return;
        setPeriodLoading(true);
        try {
            const currentYear = client.vatPeriodYear ?? vatPeriod.year;
            const currentMonth = client.vatPeriodMonth ?? vatPeriod.month;
            let newMonth = direction === 'next' ? currentMonth + 1 : currentMonth - 1;
            let newYear = currentYear;
            if (newMonth > 12) { newMonth = 1; newYear += 1; }
            if (newMonth < 1) { newMonth = 12; newYear -= 1; }

            const res = await apiFetch(`/clients/${client.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vatPeriodMonth: newMonth, vatPeriodYear: newYear }),
            });
            if (!res.ok) throw new Error('Failed to update VAT period');
            const updated = await res.json();
            const updatedClient = { ...client, ...updated } as ClientObligation;
            setSelectedClient(updatedClient);
            setClients?.((current) => current.map((c) => (c.id === client.id ? updatedClient : c)));
        } catch (e: any) {
            alert(e.message || 'Failed to change VAT period');
        } finally {
            setPeriodLoading(false);
        }
    };

    return (
        <div className="mt-6 space-y-6">
            {/* Client Selector */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="w-full sm:w-80">
                    <ClientSelectorDropdown
                        clients={vatClients}
                        selectedClient={client}
                        onSelectClient={setSelectedClient}
                        label="VAT Client"
                    />
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => void changeVatPeriod('prev')}
                        disabled={periodLoading}
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition disabled:opacity-50"
                        title="Previous period"
                    >
                        <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-xs font-medium text-slate-500 min-w-[110px] text-center">
                        Period: <span className="font-bold text-slate-700">{vatPeriodKey}</span>
                        {vatPeriodAlreadyFiled && (
                            <span className="ml-2 text-emerald-600">(filed)</span>
                        )}
                    </span>
                    <button
                        onClick={() => void changeVatPeriod('next')}
                        disabled={periodLoading}
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition disabled:opacity-50"
                        title="Next period"
                    >
                        <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    <InteractiveStatusBadge
                        status={client.vat}
                        generatedAt={client.vatPreparedAt}
                        lastFiledDate={client.vatLastFiledDate}
                        receiptUrl={latestReceiptUrl}
                        onUpdateStatus={async (newStatus) => {
                            try {
                                const res = await apiFetch(`/clients/${client.id}/status`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        field: 'vat',
                                        status: newStatus,
                                        period: vatPeriodKey,
                                    }),
                                });
                                if (!res.ok) throw new Error('Failed to update status');
                                const updated = await res.json();
                                const updatedClient = { ...client, ...updated } as ClientObligation;
                                setSelectedClient(updatedClient);
                                setClients?.((current) => current.map((c) => (c.id === client.id ? updatedClient : c)));
                            } catch (e: any) {
                                alert(e.message || 'Failed to update VAT status');
                            }
                        }}
                    />
                </div>
            </div>

            {/* Downloads row */}
            <div className="flex flex-wrap items-center gap-3">
                {vatGeneratedZipUrl && (
                    <a
                        href={vatGeneratedZipUrl}
                        download
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-600 hover:bg-emerald-100 transition"
                    >
                        <Download className="h-3.5 w-3.5" />
                        Generated VAT ZIP
                    </a>
                )}
                {vatSourcePackageUrl && (
                    <a
                        href={vatSourcePackageUrl}
                        download
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg bg-slate-100 border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 transition"
                    >
                        <Download className="h-3.5 w-3.5" />
                        Source Package
                    </a>
                )}
            </div>

            {/* Main VAT Card */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-6">
                {/* Inputs: Section B Without VAT PIN + Credit/Withholding Display */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {/* Section B Without VAT PIN */}
                    <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-4">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Section B — Sales Without VAT PIN
                        </label>
                        <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-500">KES</span>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Sales to non-VAT buyers"
                                value={vatSectionBWithoutPinInputValue}
                                onChange={(e) =>
                                    setVatSectionBWithoutPinVals((prev) => ({
                                        ...prev,
                                        [client.id]: e.target.value,
                                    }))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition shadow-inner"
                            />
                        </div>
                    </div>

                    {/* Credit Brought Forward — Auto-extracted */}
                    <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-4">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Credit Brought Forward
                        </label>
                        <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-500">KES</span>
                            <div className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                                {formatTaxAmount(vatSummary.previousCredit)}
                            </div>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-400">Auto-extracted from KRA portal</p>
                    </div>

                    {/* VAT Withholding — Auto-extracted */}
                    <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-4">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            VAT Withholding
                        </label>
                        <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-500">KES</span>
                            <div className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                                {formatTaxAmount(vatSummary.withholdingAmount)}
                            </div>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-400">Auto-extracted from KRA portal</p>
                    </div>
                </div>

                {/* VAT Breakdown Card */}
                {(vatSummary.sales?.length || vatSummary.purchases?.length) ? (
                    <VatSummaryCard
                        sales={vatSummary.sales}
                        purchases={vatSummary.purchases}
                        previousCredit={vatSummary.previousCredit}
                        withholdingAmount={vatSummary.withholdingAmount}
                        netVatBalance={vatSummary.netVatBalance}
                    />
                ) : null}

                {/* Prepared artifacts warning */}
                {vatHasPreparedArtifacts && (
                    <div className="flex flex-col gap-2 rounded-lg border border-slate-200/70 bg-slate-100 p-3 text-[11px] text-slate-600">
                        <span className="font-semibold text-emerald-600">
                            VAT summary is ready. File VAT when you are satisfied with the figures.
                        </span>
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                        onClick={() => void onPrepareVat(client)}
                        disabled={isPendingFilingJob(relevantJob as any) || vatPeriodAlreadyFiled}
                        title={vatPeriodAlreadyFiled ? `VAT for ${vatPeriodKey} has already been filed` : undefined}
                        className={`inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-xs font-bold transition shadow-sm ${
                            isPendingFilingJob(relevantJob as any) || vatPeriodAlreadyFiled
                                ? 'bg-slate-100 border-slate-100 text-slate-500 cursor-not-allowed'
                                : 'bg-blue-50 border-blue-500/20 text-blue-600 hover:bg-blue-100 hover:text-blue-500'
                        }`}
                    >
                        {isPendingFilingJob(relevantJob as any) && (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                        )}
                        {vatGenerateActionLabel}
                    </button>
                    <button
                        onClick={() => void onConfirmVatFiling(client)}
                        disabled={
                            isPendingFilingJob(relevantJob as any) ||
                            !vatHasPreparedArtifacts ||
                            vatPeriodAlreadyFiled
                        }
                        title={vatPeriodAlreadyFiled ? `VAT for ${vatPeriodKey} has already been filed` : undefined}
                        className={`inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-xs font-bold transition shadow-sm ${
                            isPendingFilingJob(relevantJob as any) ||
                            !vatHasPreparedArtifacts ||
                            vatPeriodAlreadyFiled
                                ? 'bg-slate-100 border-slate-100 text-slate-500 cursor-not-allowed'
                                : 'bg-emerald-50 border-emerald-500/20 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-500'
                        }`}
                    >
                        {isPendingFilingJob(relevantJob as any) && (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                        )}
                        File VAT (Auto)
                    </button>
                    <button
                        onClick={() => void onGeneratePrn(client, 'vat')}
                        disabled={isPendingFilingJob(relevantJob as any)}
                        className="inline-flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-5 py-2.5 text-xs font-bold text-[#ff0613] hover:bg-red-100 hover:text-[#d80000] transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPendingFilingJob(relevantJob as any) && (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                        )}
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

                {/* Terminal job receipts */}
                {isTerminalFilingJob(relevantJob as any) && (latestReceiptUrl || latestPrnUrl) && (
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                        {latestReceiptUrl && !unifiedPrnUrl && latestReceiptUrl !== latestPrnUrl && (
                            <button
                                onClick={() => downloadAuthFile(latestReceiptUrl)}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-500/20 px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-100 transition"
                            >
                                <Download className="h-3.5 w-3.5" />
                                Download Receipt
                            </button>
                        )}
                        {(latestPrnUrl || unifiedPrnUrl) && (
                                <button
                                onClick={() => downloadAuthFile((unifiedPrnUrl ?? latestPrnUrl)!)}
                                className="inline-flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-xs font-bold text-[#ff0613] hover:bg-red-100 transition"
                            >
                                <Download className="h-3.5 w-3.5" />
                                Download PRN
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
