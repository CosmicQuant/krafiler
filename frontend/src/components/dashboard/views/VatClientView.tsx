/**
 * VatClientView.tsx
 *
 * Single-client VAT view with Section M (Output / Sales) and Section N (Input / Purchases)
 * side by side, plus credit brought forward and Section B input fields.
 */

import { useState, useMemo } from 'react';
import { Download, RefreshCw, FileText } from 'lucide-react';
import { ClientObligation, VatPreparationSummary } from '../../../types';
import { ClientSelectorDropdown } from '../ClientSelectorDropdown';
import { VatSummaryCard } from '../VatSummaryCard';
import {
    formatTaxAmount,
    getReceiptUrlForObligation,
    getFilingStatusLabel,
    getFilingProgressTone,
    isPendingFilingJob,
    isTerminalFilingJob,
    isSameMoney,
} from '../../../utils/dashboardUtils';
import { StatusBadge } from '../StatusBadges';
import { ActiveDashboardJob } from '../../../types';

interface VatClientViewProps {
    clients: ClientObligation[];
    activeJobs: Record<string, ActiveDashboardJob>;
    vatPreviousCreditVals: Record<string, string>;
    setVatPreviousCreditVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    vatSectionBWithoutPinVals: Record<string, string>;
    setVatSectionBWithoutPinVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onPrepareVat: (client: ClientObligation) => Promise<void>;
    onConfirmVatFiling: (client: ClientObligation) => Promise<void>;
    onGeneratePrn: (client: ClientObligation, type: string) => Promise<void>;
}

export function VatClientView({
    clients,
    activeJobs,
    vatPreviousCreditVals,
    setVatPreviousCreditVals,
    vatSectionBWithoutPinVals,
    setVatSectionBWithoutPinVals,
    onPrepareVat,
    onConfirmVatFiling,
    onGeneratePrn,
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
    const latestPrnUrl = relevantJob?.prnUrl;
    const unifiedPrnUrl = latestPrnUrl && latestPrnUrl === latestReceiptUrl ? latestPrnUrl : undefined;

    const vatGeneratedZipUrl = client.vatZipUrl ?? relevantJob?.generatedZipUrl;
    const vatSourcePackageUrl = client.vatSourcePackageUrl ?? relevantJob?.sourcePackageUrl;

    const vatSummary: VatPreparationSummary = {
        inputVat: client.vatInputVat ?? relevantJob?.vatSummary?.inputVat ?? 0,
        outputVat: client.vatOutputVat ?? relevantJob?.vatSummary?.outputVat ?? 0,
        previousCredit: client.vatPreviousCredit ?? relevantJob?.vatSummary?.previousCredit ?? 0,
        payableVat: client.vatPayableVat ?? relevantJob?.vatSummary?.payableVat ?? 0,
        netVatBalance: client.vatNetVatBalance ?? relevantJob?.vatSummary?.netVatBalance ?? 0,
        sales: relevantJob?.vatSummary?.sales,
        purchases: relevantJob?.vatSummary?.purchases,
    };

    const vatInputValue =
        vatPreviousCreditVals[client.id] ??
        (typeof client.vatPreviousCredit === 'number' ? String(client.vatPreviousCredit) : '');
    const parsedVatInputValue = vatInputValue.trim().length > 0 ? Number.parseFloat(vatInputValue) : 0;
    const vatCurrentCredit = Number.isFinite(parsedVatInputValue) ? parsedVatInputValue : 0;

    const vatSectionBWithoutPinInputValue =
        vatSectionBWithoutPinVals[client.id] ??
        (typeof client.vatSectionBWithoutPinSales === 'number'
            ? String(client.vatSectionBWithoutPinSales)
            : '');

    const vatHasPreparedArtifacts = Boolean(vatGeneratedZipUrl);
    const vatCreditMatchesPrepared = isSameMoney(vatSummary.previousCredit, vatCurrentCredit);
    const vatGenerateActionLabel = vatHasPreparedArtifacts ? 'Regenerate VAT ZIP' : 'Generate VAT ZIP';
    const vatBalanceLabel = vatSummary.netVatBalance >= 0 ? 'VAT Payable' : 'Credit Balance';
    const vatBalanceValue = Math.abs(vatSummary.netVatBalance);

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
                <StatusBadge status={client.vat} />
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
                {/* Inputs: Section B + Credit */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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

                    {/* Credit Brought Forward */}
                    <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-4">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Credit Brought Forward
                        </label>
                        <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-500">KES</span>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Carry-forward credit"
                                value={vatInputValue}
                                onChange={(e) =>
                                    setVatPreviousCreditVals((prev) => ({
                                        ...prev,
                                        [client.id]: e.target.value,
                                    }))
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition shadow-inner"
                            />
                        </div>
                    </div>
                </div>

                {/* Section M & N Side by Side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Section M — Output VAT (Sales) */}
                    <div className="rounded-xl border border-blue-500/10 bg-blue-50/40 p-5">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-blue-700 mb-4 flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5" />
                            Section M — Output VAT (Sales)
                        </h4>
                        <div className="space-y-3">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-600 font-medium">Output VAT</span>
                                <span className="text-slate-900 font-bold">
                                    KES {formatTaxAmount(vatSummary.outputVat)}
                                </span>
                            </div>
                            <div className="h-px bg-blue-200/40" />
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-600 font-medium">Sales Value</span>
                                <span className="text-slate-900 font-semibold">
                                    KES {formatTaxAmount((vatSummary.outputVat || 0) * 20)}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Section N — Input VAT (Purchases) */}
                    <div className="rounded-xl border border-emerald-500/10 bg-emerald-50/40 p-5">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-700 mb-4 flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5" />
                            Section N — Input VAT (Purchases)
                        </h4>
                        <div className="space-y-3">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-600 font-medium">Input VAT</span>
                                <span className="text-slate-900 font-bold">
                                    KES {formatTaxAmount(vatSummary.inputVat)}
                                </span>
                            </div>
                            <div className="h-px bg-emerald-200/40" />
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-600 font-medium">Purchases Value</span>
                                <span className="text-slate-900 font-semibold">
                                    KES {formatTaxAmount((vatSummary.inputVat || 0) * 20)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Summary & Balance */}
                <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4 space-y-3">
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-600 font-medium">Previous Credit Applied</span>
                        <span className="text-slate-900 font-bold">
                            KES {formatTaxAmount(vatSummary.previousCredit)}
                        </span>
                    </div>
                    <div className="border-t border-slate-200/80 pt-3 flex justify-between items-center">
                        <span
                            className={`text-sm font-bold ${
                                vatSummary.netVatBalance >= 0 ? 'text-blue-600' : 'text-emerald-600'
                            }`}
                        >
                            {vatBalanceLabel}{' '}
                            <span className="font-normal text-[10px] opacity-70">(After credit)</span>
                        </span>
                        <span
                            className={`text-lg font-black ${
                                vatSummary.netVatBalance >= 0 ? 'text-blue-600' : 'text-emerald-600'
                            }`}
                        >
                            KES {formatTaxAmount(vatBalanceValue)}
                        </span>
                    </div>
                </div>

                {/* VAT Breakdown Card */}
                {(vatSummary.sales?.length || vatSummary.purchases?.length) ? (
                    <VatSummaryCard
                        sales={vatSummary.sales}
                        purchases={vatSummary.purchases}
                        previousCredit={vatSummary.previousCredit}
                        netVatBalance={vatSummary.netVatBalance}
                    />
                ) : null}

                {/* Prepared artifacts warning */}
                {vatHasPreparedArtifacts && (
                    <div className="flex flex-col gap-2 rounded-lg border border-slate-200/70 bg-slate-100 p-3 text-[11px] text-slate-600">
                        <span
                            className={`font-semibold ${
                                vatCreditMatchesPrepared ? 'text-emerald-600' : 'text-[#ff0613]'
                            }`}
                        >
                            {vatCreditMatchesPrepared
                                ? 'VAT summary is ready. File VAT when you are satisfied with the figures.'
                                : 'The VAT credit input changed after generation. Regenerate VAT ZIP before filing VAT.'}
                        </span>
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                        onClick={() => void onPrepareVat(client)}
                        disabled={isPendingFilingJob(relevantJob as any)}
                        className={`inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-xs font-bold transition shadow-sm ${
                            isPendingFilingJob(relevantJob as any)
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
                            !vatCreditMatchesPrepared
                        }
                        className={`inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-xs font-bold transition shadow-sm ${
                            isPendingFilingJob(relevantJob as any) ||
                            !vatHasPreparedArtifacts ||
                            !vatCreditMatchesPrepared
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
                    <div className="w-full bg-white border border-slate-100 rounded-lg p-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] text-slate-600 font-medium font-mono uppercase tracking-wider truncate">
                                {getFilingStatusLabel(relevantJob as any)}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                                {relevantJob.progress}%
                            </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1 overflow-hidden">
                            <div
                                className={`h-1.5 rounded-full transition-all duration-500 ${getFilingProgressTone(
                                    relevantJob as any
                                )}`}
                                style={{ width: `${Math.max(relevantJob.progress, 5)}%` }}
                            />
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                            {relevantJob.state === 'failed' ? (
                                <span className="text-red-600">
                                    {relevantJob.failedReason || 'An error occurred during filing.'}
                                </span>
                            ) : (
                                relevantJob.message
                            )}
                        </div>
                    </div>
                )}

                {/* Terminal job receipts */}
                {isTerminalFilingJob(relevantJob as any) && (latestReceiptUrl || latestPrnUrl) && (
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                        {latestReceiptUrl && !unifiedPrnUrl && latestReceiptUrl !== latestPrnUrl && (
                            <a
                                href={latestReceiptUrl}
                                download
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-500/20 px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-100 transition"
                            >
                                <Download className="h-3.5 w-3.5" />
                                Download Receipt
                            </a>
                        )}
                        {(latestPrnUrl || unifiedPrnUrl) && (
                            <a
                                href={unifiedPrnUrl ?? latestPrnUrl}
                                download
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-xs font-bold text-[#ff0613] hover:bg-red-100 transition"
                            >
                                <Download className="h-3.5 w-3.5" />
                                Download PRN
                            </a>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
