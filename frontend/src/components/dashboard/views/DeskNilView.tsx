import { Download } from 'lucide-react';
import { ClientObligation, ActiveDashboardJob } from '../../../types';
import { isTerminalFilingJob } from '../../../utils/dashboardUtils';
import { getPreviousYearIsoRange } from '../../../utils/taxPeriods';

const TAX_OBLIGATION_OPTIONS = [
  { value: 'income_tax_resident_individual', label: 'Income Tax - Resident Individual (Nil)', filingMode: 'nil' },
  { value: 'income_tax_non_resident_individual', label: 'Income Tax - Non-Resident Individual (Nil)', filingMode: 'nil' },
  { value: 'income_tax_company', label: 'Income Tax - Company (Nil)', filingMode: 'nil' },
  { value: 'vat', label: 'Value Added Tax (Nil)', filingMode: 'nil' },
  { value: 'paye', label: 'PAYE (Nil)', filingMode: 'nil' },
  { value: 'turnover_tax', label: 'Turnover Tax (Nil)', filingMode: 'nil' },
  { value: 'monthly_rental_income', label: 'Monthly Rental Income (Nil)', filingMode: 'nil' },
];

interface DeskNilViewProps {
  clients: ClientObligation[];
  activeJobs: Record<string, ActiveDashboardJob>;
  nilSelections: Record<string, { type: string; periodFrom: string; periodTo: string; ownsRentalProperty?: boolean }>;
  setNilSelections: React.Dispatch<
    React.SetStateAction<
      Record<string, { type: string; periodFrom: string; periodTo: string; ownsRentalProperty?: boolean }>
    >
  >;
  onFileNil: (client: ClientObligation) => Promise<void>;
  filterType?: 'income-tax-individual' | 'income-tax-company' | null;
}

export function DeskNilView({
  clients,
  activeJobs,
  nilSelections,
  setNilSelections,
  onFileNil,
  filterType,
}: DeskNilViewProps) {
  let availableOptions = TAX_OBLIGATION_OPTIONS.filter((o) => o.filingMode === 'nil');

  if (filterType === 'income-tax-individual') {
    availableOptions = availableOptions.filter(
      (o) =>
        o.value === 'income_tax_resident_individual' ||
        o.value === 'income_tax_non_resident_individual'
    );
  } else if (filterType === 'income-tax-company') {
    availableOptions = availableOptions.filter((o) => o.value === 'income_tax_company');
  }

  const title = filterType === 'income-tax-individual'
    ? 'Income Tax Individual'
    : filterType === 'income-tax-company'
    ? 'Income Tax Company'
    : 'Nil & ITR Filing Desk';
  const description = filterType === 'income-tax-individual'
    ? 'File Income Tax returns for individual clients.'
    : filterType === 'income-tax-company'
    ? 'File Income Tax returns for company clients.'
    : 'File Nil returns and Annual Income Tax Returns for your clients.';

  return (
    <div className="mt-10">
      <div className="mb-6 flex flex-col gap-2 border-b border-slate-200 pb-5">
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto pb-16">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-4 font-semibold tracking-wider w-1/3">Client & PIN</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Tax Obligation</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Period (From - To)</th>
                <th className="px-6 py-4 font-semibold tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((client) => {
                const sel = nilSelections[client.id] || {
                  type: '',
                  periodFrom: getPreviousYearIsoRange().periodFrom,
                  periodTo: getPreviousYearIsoRange().periodTo,
                };
                const job = activeJobs[client.id];
                const displayJob = job?.isNil ? job : undefined;
                const isProcessing = displayJob && !isTerminalFilingJob(displayJob);
                const isCompleted = displayJob?.state === 'completed';
                const isFailed = displayJob?.state === 'failed';

                return (
                  <tr key={client.id} className="group transition hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-900">{client.name}</div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">{client.pin}</div>
                    </td>
                    <td className="px-6 py-4">
                      {filterType ? (
                        <span className="text-sm text-slate-700">
                          {availableOptions.find((o) => o.value === sel.type)?.label || availableOptions[0]?.label}
                        </span>
                      ) : (
                        <select
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#ff0613]"
                          value={sel.type}
                          onChange={(e) =>
                            setNilSelections((prev) => ({
                              ...prev,
                              [client.id]: { ...sel, type: e.target.value },
                            }))
                          }
                        >
                          <option value="" disabled>
                            Choose Obligation
                          </option>
                          {availableOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <input
                            type="date"
                            value={sel.periodFrom}
                            onChange={(e) =>
                              setNilSelections((prev) => ({
                                ...prev,
                                [client.id]: { ...sel, periodFrom: e.target.value },
                              }))
                            }
                            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-[#ff0613]"
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
                            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-[#ff0613]"
                          />
                        </div>
                        {(sel.type === 'income_tax_resident_individual' ||
                          sel.type === 'income_tax_non_resident_individual') && (
                          <label className="flex items-center gap-2 mt-1 cursor-pointer w-max">
                            <input
                              type="checkbox"
                              checked={sel.ownsRentalProperty || false}
                              onChange={(e) =>
                                setNilSelections((prev) => ({
                                  ...prev,
                                  [client.id]: {
                                    ...sel,
                                    ownsRentalProperty: e.target.checked,
                                  },
                                }))
                              }
                              className="rounded bg-white border-slate-200 focus:ring-[#ff0613] accent-[#ff0613] h-3.5 w-3.5"
                            />
                            <span className="text-[11px] text-slate-500">Owns Rental Property?</span>
                          </label>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-col items-end gap-2">
                        <button
                          onClick={() => void onFileNil(client)}
                          disabled={isProcessing}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition ${
                            isProcessing
                              ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                              : 'bg-[#ff0613] hover:bg-[#d80000] text-white shadow-sm'
                          }`}
                        >
                          {isProcessing ? `Processing (${displayJob.progress}%)` : isCompleted ? 'File Again' : 'File Nil'}
                        </button>

                        {isCompleted && displayJob.receiptUrl && (
                          <a
                            href={displayJob.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-100 transition"
                          >
                            <Download className="h-3 w-3" /> Download Receipt
                          </a>
                        )}

                        {isFailed && displayJob.failedReason && (
                          <span className="text-[11px] text-red-600 max-w-[200px]">
                            {displayJob.failedReason}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
