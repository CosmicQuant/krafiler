/**
 * NilClientView.tsx
 *
 * Single-client Nil / Income Tax Return view with a client selector dropdown.
 */

import { useState, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { ClientObligation } from '../../../types';
import { ClientSelectorDropdown } from '../ClientSelectorDropdown';
import { getPreviousYearIsoRange } from '../../../utils/taxPeriods';
import { isTerminalFilingJob } from '../../../utils/dashboardUtils';
import { ActiveDashboardJob } from '../../../types';
import JobStatusInline from '../JobStatusInline';

const TAX_OPTIONS = [
    { value: 'income_tax_resident_individual', label: 'Income Tax - Resident Individual (Nil)' },
    { value: 'income_tax_non_resident_individual', label: 'Income Tax - Non-Resident Individual (Nil)' },
    { value: 'income_tax_company', label: 'Income Tax - Company (Nil)' },
    { value: 'vat', label: 'Value Added Tax (Nil)' },
    { value: 'paye', label: 'PAYE (Nil)' },
    { value: 'turnover_tax', label: 'Turnover Tax (Nil)' },
    { value: 'monthly_rental_income', label: 'Monthly Rental Income (Nil)' },
    { value: 'excise_duty', label: 'Excise Duty (Nil)' },
];

interface NilClientViewProps {
    clients: ClientObligation[];
    activeJobs: Record<string, ActiveDashboardJob>;
    nilSelections: Record<string, { type: string; periodFrom: string; periodTo: string; ownsRentalProperty?: boolean }>;
    setNilSelections: React.Dispatch<
        React.SetStateAction<
            Record<string, { type: string; periodFrom: string; periodTo: string; ownsRentalProperty?: boolean }>
        >
    >;
    onFileNil: (client: ClientObligation) => Promise<void>;
    onCancelJob?: (client: ClientObligation) => Promise<void>;
    cancellingClientIds?: Record<string, boolean>;
    filterType?: 'income-tax-individual' | 'income-tax-company' | null;
}

export function NilClientView({
    clients,
    activeJobs,
    nilSelections,
    setNilSelections,
    onFileNil,
    onCancelJob,
    cancellingClientIds,
    filterType,
}: NilClientViewProps) {
    const [selectedClient, setSelectedClient] = useState<ClientObligation | null>(clients[0] || null);

    const availableOptions = useMemo(() => {
        let opts = TAX_OPTIONS;
        if (filterType === 'income-tax-individual') {
            opts = opts.filter((o) => o.value === 'income_tax_resident_individual' || o.value === 'income_tax_non_resident_individual');
        } else if (filterType === 'income-tax-company') {
            opts = opts.filter((o) => o.value === 'income_tax_company');
        }
        return opts;
    }, [filterType]);

    const client = selectedClient || clients[0];
    if (!client) {
        return (
            <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center">
                <p className="text-sm font-semibold text-slate-900">No Clients</p>
                <p className="mt-1 text-xs text-slate-500">Add clients to file nil returns.</p>
            </div>
        );
    }

    const sel = nilSelections[client.id] || {
        type: filterType ? availableOptions[0]?.value : '',
        periodFrom: getPreviousYearIsoRange().periodFrom,
        periodTo: getPreviousYearIsoRange().periodTo,
    };

    const job = activeJobs[client.id];
    const displayJob = job?.isNil ? job : undefined;
    const isProcessing = displayJob && !isTerminalFilingJob(displayJob);
    const isCompleted = displayJob?.state === 'completed';

    return (
        <div className="mt-6 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="w-full sm:w-80">
                    <ClientSelectorDropdown
                        clients={clients}
                        selectedClient={client}
                        onSelectClient={setSelectedClient}
                        label="Client"
                    />
                </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-5">
                {/* Obligation selector */}
                {!filterType && (
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Tax Obligation
                        </label>
                        <select
                            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#ff0613]"
                            value={sel.type}
                            onChange={(e) =>
                                setNilSelections((prev) => ({
                                    ...prev,
                                    [client.id]: { ...sel, type: e.target.value },
                                }))
                            }
                        >
                            <option value="" disabled>Choose Obligation</option>
                            {availableOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </div>
                )}

                {filterType && (
                    <div className="text-sm text-slate-700 font-medium">
                        {availableOptions.find((o) => o.value === sel.type)?.label || availableOptions[0]?.label}
                    </div>
                )}

                {/* Period */}
                <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Return Period
                    </label>
                    <div className="flex gap-2 mt-2">
                        <input
                            type="date"
                            value={sel.periodFrom}
                            onChange={(e) =>
                                setNilSelections((prev) => ({
                                    ...prev,
                                    [client.id]: { ...sel, periodFrom: e.target.value },
                                }))
                            }
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#ff0613]"
                        />
                        <span className="flex items-center text-slate-500">-</span>
                        <input
                            type="date"
                            value={sel.periodTo}
                            onChange={(e) =>
                                setNilSelections((prev) => ({
                                    ...prev,
                                    [client.id]: { ...sel, periodTo: e.target.value },
                                }))
                            }
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#ff0613]"
                        />
                    </div>
                </div>

                {/* Rental property checkbox for individual income tax */}
                {(sel.type === 'income_tax_resident_individual' || sel.type === 'income_tax_non_resident_individual') && (
                    <label className="flex items-center gap-2 cursor-pointer w-max">
                        <input
                            type="checkbox"
                            checked={sel.ownsRentalProperty || false}
                            onChange={(e) =>
                                setNilSelections((prev) => ({
                                    ...prev,
                                    [client.id]: { ...sel, ownsRentalProperty: e.target.checked },
                                }))
                            }
                            className="rounded bg-white border-slate-200 focus:ring-[#ff0613] accent-[#ff0613] h-4 w-4"
                        />
                        <span className="text-sm text-slate-600">Owns Rental Property?</span>
                    </label>
                )}

                {/* Action */}
                <div className="pt-2">
                    <button
                        onClick={() => void onFileNil(client)}
                        disabled={isProcessing || (!filterType && !sel.type)}
                        className={`inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-xs font-bold transition shadow-sm ${
                            isProcessing || (!filterType && !sel.type)
                                ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                                : 'bg-[#ff0613] hover:bg-[#d80000] text-white'
                        }`}
                    >
                        {isProcessing ? (
                            <>
                                <RefreshCw className="h-3 w-3 animate-spin" />
                                <span>Processing ({displayJob.progress}%)</span>
                            </>
                        ) : isCompleted ? (
                            'File Again'
                        ) : (
                            'File Nil Return'
                        )}
                    </button>
                </div>

                {/* Job status */}
                {displayJob && (
                    <JobStatusInline
                        job={displayJob}
                        clientName={client.name}
                        onCancel={onCancelJob ? () => void onCancelJob(client) : undefined}
                        cancelling={Boolean(cancellingClientIds?.[client.id])}
                    />
                )}
            </div>
        </div>
    );
}
