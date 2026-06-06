
import {
  TerminalSquare,
  Upload,
  Download,
  RefreshCw,
} from 'lucide-react';
import { downloadAuthFile } from '../../../utils/downloadAuthFile';
import { ClientObligation, TaxStatus, VatPreparationSummary } from '../../../types';
import { VatSummaryCard } from '../VatSummaryCard';
import {
  StatusBadge,
} from '../StatusBadges';
import {
  formatTaxAmount,
  getReceiptUrlForObligation,
  getFilingStatusLabel,
  getFilingProgressTone,
  isPendingFilingJob,
  isTerminalFilingJob,
  isSameMoney,
  formatGeneratedDate,
} from '../../../utils/dashboardUtils';

interface Desk20thViewProps {
  clients: ClientObligation[];
  activeJobs: Record<string, { state: string; progress: number; message: string; failedReason?: string; receiptUrl?: string; prnUrl?: string; generatedZipUrl?: string; generatedZipLabel?: string; sourcePackageUrl?: string; sourcePackageLabel?: string; vatSummary?: VatPreparationSummary; obligationType?: string }>;
  monthlyReturnFilter: 'ALL' | 'VAT' | 'TOT' | 'MRI' | 'DST';
  setMonthlyReturnFilter: (filter: 'ALL' | 'VAT' | 'TOT' | 'MRI' | 'DST') => void;
  mriInputVals: Record<string, string>;
  setMriInputVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  totInputVals: Record<string, string>;
  setTotInputVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  vatPreviousCreditVals: Record<string, string>;
  setVatPreviousCreditVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  vatSectionBWithoutPinVals: Record<string, string>;
  setVatSectionBWithoutPinVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onPrepareVat: (client: ClientObligation) => Promise<void>;
  onConfirmVatFiling: (client: ClientObligation) => Promise<void>;
  onGeneratePrn: (client: ClientObligation, type: string) => Promise<void>;
  onFileMri: (client: ClientObligation) => Promise<void>;
  onFileTot: (client: ClientObligation) => Promise<void>;
  onAutoFile: (client: ClientObligation) => Promise<void>;
  onAutoFileNssf: (client: ClientObligation) => void;
    onGenerateTotZip: (client: ClientObligation) => Promise<void>;
  fixedType?: 'vat' | 'tot' | 'mri' | 'dst';
  onSelectClient?: (client: ClientObligation) => void;
}

export function Desk20thView({
  clients,
  activeJobs,
  monthlyReturnFilter,
  setMonthlyReturnFilter,
  mriInputVals,
  setMriInputVals,
  totInputVals,
  setTotInputVals,
  vatPreviousCreditVals,
  setVatPreviousCreditVals,
  vatSectionBWithoutPinVals,
  setVatSectionBWithoutPinVals,
  onPrepareVat,
  onConfirmVatFiling,
  onGeneratePrn,
  onFileMri,
  onFileTot,
  onAutoFile,
  onAutoFileNssf,
  onGenerateTotZip,
  fixedType,
  onSelectClient,
}: Desk20thViewProps) {

  let obligations: { client: ClientObligation; type: string; status: TaxStatus }[] = [];

  if (fixedType) {
    const statusMap: Record<string, keyof ClientObligation> = {
      vat: 'vat',
      tot: 'tot',
      mri: 'mri',
      dst: 'dst',
    };
    const typeLabelMap: Record<string, string> = {
      vat: 'VAT',
      tot: 'TOT',
      mri: 'MRI',
      dst: 'DST',
    };
    const field = statusMap[fixedType];
    const typeLabel = typeLabelMap[fixedType];
    obligations = clients
      .filter((c) => c[field] !== 'na')
      .map((c) => ({ client: c, type: typeLabel, status: c[field] as TaxStatus }));
  } else {
    clients.forEach((c) => {
      if (c.vat !== 'na') obligations.push({ client: c, type: 'VAT', status: c.vat });
      if (c.tot !== 'na') obligations.push({ client: c, type: 'TOT', status: c.tot });
      if (c.dst !== 'na') obligations.push({ client: c, type: 'DST', status: c.dst });
      if (c.mri !== 'na') obligations.push({ client: c, type: 'MRI', status: c.mri });
    });
  }

  if (!fixedType && monthlyReturnFilter !== 'ALL') {
    obligations = obligations.filter((ob) => ob.type === monthlyReturnFilter);
  }

  return (
    <div className="mt-8">
      {/* 1. The Toggle UI */}
      {!fixedType && (
        <div className="mb-6 flex flex-wrap gap-3 items-center">
          {(['VAT', 'TOT', 'MRI', 'DST', 'ALL'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setMonthlyReturnFilter(t)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                monthlyReturnFilter === t
                  ? 'bg-blue-500 text-slate-900 shadow-md'
                  : 'border border-slate-100 bg-slate-100/50 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
              }`}
            >
              {t === 'ALL' ? 'All Returns' : `${t} Returns`}
            </button>
          ))}
        </div>
      )}

      {/* 2. The Matrix Table Wrapper */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 shadow-xl">
        <div className="pb-16 sm:pb-32 overflow-x-auto lg:overflow-visible">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="border-b border-slate-200 bg-white rounded-t-2xl text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Client Info</th>
                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Return Data / Source</th>
                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Tax Calculation details</th>
                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Status</th>
                <th className="px-4 py-4 font-semibold text-right uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/50">
              {obligations.map((ob, idx) => {
                const jobArtifacts = activeJobs[ob.client.id];
                const typeMap: Record<string, string> = { VAT: 'vat', TOT: 'turnover_tax', MRI: 'monthly_rental_income', PAYE: 'paye', NSSF: 'nssf' };
                const relevantJob = !jobArtifacts?.obligationType || jobArtifacts.obligationType === typeMap[ob.type] ? jobArtifacts : undefined;
                const latestReceiptUrl = relevantJob?.receiptUrl ?? getReceiptUrlForObligation(ob.client, ob.type);
                const latestPrnUrl = relevantJob?.prnUrl;
                const unifiedPrnUrl = latestPrnUrl && latestPrnUrl === latestReceiptUrl ? latestPrnUrl : undefined;
                const vatGeneratedZipUrl = ob.client.vatZipUrl ?? relevantJob?.generatedZipUrl;
                const vatSourcePackageUrl = ob.client.vatSourcePackageUrl ?? relevantJob?.sourcePackageUrl;
                const vatSummary: VatPreparationSummary = {
                  inputVat: ob.client.vatInputVat ?? relevantJob?.vatSummary?.inputVat ?? 0,
                  outputVat: ob.client.vatOutputVat ?? relevantJob?.vatSummary?.outputVat ?? 0,
                  previousCredit: ob.client.vatPreviousCredit ?? relevantJob?.vatSummary?.previousCredit ?? 0,
                  payableVat: ob.client.vatPayableVat ?? relevantJob?.vatSummary?.payableVat ?? 0,
                  netVatBalance: ob.client.vatNetVatBalance ?? relevantJob?.vatSummary?.netVatBalance ?? 0,
                  sales: relevantJob?.vatSummary?.sales,
                  purchases: relevantJob?.vatSummary?.purchases,
                };
                const vatInputValue =
                  vatPreviousCreditVals[ob.client.id] ??
                  (typeof ob.client.vatPreviousCredit === 'number'
                    ? String(ob.client.vatPreviousCredit)
                    : '');
                const parsedVatInputValue = vatInputValue.trim().length > 0 ? Number.parseFloat(vatInputValue) : 0;
                const vatCurrentCredit = Number.isFinite(parsedVatInputValue) ? parsedVatInputValue : 0;
                const vatSectionBWithoutPinInputValue =
                  vatSectionBWithoutPinVals[ob.client.id] ??
                  (typeof ob.client.vatSectionBWithoutPinSales === 'number'
                    ? String(ob.client.vatSectionBWithoutPinSales)
                    : '');
                const vatHasPreparedArtifacts = Boolean(vatGeneratedZipUrl);
                const vatCreditMatchesPrepared = isSameMoney(vatSummary.previousCredit, vatCurrentCredit);
                const vatGenerateActionLabel = vatHasPreparedArtifacts ? 'Regenerate VAT ZIP' : 'Generate VAT ZIP';
                const vatBalanceLabel = vatSummary.netVatBalance >= 0 ? 'VAT Payable' : 'Credit Balance';
                const vatBalanceValue = Math.abs(vatSummary.netVatBalance);

                return (
                  <tr key={`${ob.client.id}-${ob.type}-${idx}`} className="transition hover:bg-slate-100/50 group">
                    <td className="px-4 py-4">
                      <div 
                        className="font-semibold text-slate-900 cursor-pointer hover:text-[#ff0613]"
                        onClick={() => onSelectClient?.(ob.client)}
                      >{ob.client.name}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-slate-500 cursor-pointer hover:text-[#ff0613]" onClick={() => onSelectClient?.(ob.client)}>PIN: {ob.client.pin}</span>
                        <span className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                          {ob.type}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top pt-5">
                      {(ob.type === 'VAT' || ob.type === 'TOT') && (
                        <div>
                          {ob.type === 'VAT' && (
                            <div className="mt-2 flex flex-col gap-2 max-w-[260px]">
                              {vatGeneratedZipUrl ? (
                                <>
                                  <a
                                    href={vatGeneratedZipUrl}
                                    download
                                    rel="noreferrer"
                                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-100 transition"
                                    title={ob.client.vatZipLabel}
                                  >
                                    <Download className="h-3 w-3" /> Generated VAT ZIP (KRA Upload)
                                  </a>
                                  <span className="text-[10px] text-slate-500 text-center">
                                  Generated: {formatGeneratedDate(ob.client.vatPreparedAt)}
                                </span>
                              </>
                            ) : (
                              <span className="text-[11px] text-slate-500">No VAT ZIP generated yet.</span>
                            )}

                              {vatSourcePackageUrl && (
                                <a
                                  href={vatSourcePackageUrl}
                                  download
                                  rel="noreferrer"
                                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-100/70 border border-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200/80 transition"
                                  title={ob.client.vatSourcePackageLabel}
                                >
                                  <Download className="h-3 w-3" /> Download VAT Source Package
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {ob.type === 'DST' && (
                        <button className="text-xs flex items-center justify-center gap-1.5 rounded-xl mt-1 bg-fuchsia-50 px-4 py-2.5 font-bold text-fuchsia-600 hover:bg-fuchsia-100 transition w-full max-w-[200px] border border-fuchsia-500/20">
                          <Upload className="h-4 w-4" /> Upload Sales CSV
                        </button>
                      )}
                      {ob.type === 'MRI' && (
                        <div className="flex flex-col gap-1.5 max-w-[240px]">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            Total Monthly Rental Income
                          </label>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-500">KES</span>
                            <input
                              type="number"
                              placeholder="Rent Amount"
                              value={mriInputVals[ob.client.id] || ''}
                              onChange={(e) =>
                                setMriInputVals((prev) => ({ ...prev, [ob.client.id]: e.target.value }))
                              }
                              className="w-full rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] transition shadow-inner"
                            />
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 min-w-[280px]">
                      {ob.type === 'VAT' && (
                        <div className="flex flex-col gap-3 rounded-xl bg-slate-50 border border-slate-200/50 p-4 shadow-sm group-hover:border-slate-300 transition">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Section B Without VAT PIN Sales
                            </label>
                            <div className="mt-1 flex items-center gap-2">
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
                                    [ob.client.id]: e.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition shadow-inner"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Previous Month VAT Credit
                            </label>
                            <div className="mt-1 flex items-center gap-2">
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
                                    [ob.client.id]: e.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition shadow-inner"
                              />
                            </div>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-500 font-medium">
                              Input VAT <span className="font-normal text-[10px] ml-1 text-slate-500">(Purchases)</span>
                            </span>
                            <span className="text-slate-700 font-bold border-b border-transparent">
                              KES {formatTaxAmount(vatSummary.inputVat)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-500 font-medium">
                              Output VAT <span className="font-normal text-[10px] ml-1 text-slate-500">(Sales)</span>
                            </span>
                            <span className="text-slate-700 font-bold border-b border-transparent">
                              KES {formatTaxAmount(vatSummary.outputVat)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-500 font-medium">
                              Previous Credit <span className="font-normal text-[10px] ml-1 text-slate-500">(Applied)</span>
                            </span>
                            <span className="text-slate-700 font-bold border-b border-transparent">
                              KES {formatTaxAmount(vatSummary.previousCredit)}
                            </span>
                          </div>
                          <div className="border-t border-slate-200/80 my-1 pt-2.5 flex justify-between items-center text-xs">
                            <span
                              className={`font-bold ${
                                vatSummary.netVatBalance >= 0 ? 'text-blue-600' : 'text-emerald-600'
                              }`}
                            >
                              {vatBalanceLabel}{' '}
                              <span className="font-normal text-[10px] ml-1 opacity-70">(After credit)</span>
                            </span>
                            <span
                              className={`font-black text-[13px] drop-shadow-sm ${
                                vatSummary.netVatBalance >= 0 ? 'text-blue-600' : 'text-emerald-600'
                              }`}
                            >
                              KES {formatTaxAmount(vatBalanceValue)}
                            </span>
                          </div>
                          {vatHasPreparedArtifacts ? (
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
                              <div className="flex flex-wrap gap-2">
                                {vatSourcePackageUrl && (
                                  <a
                                    href={vatSourcePackageUrl}
                                    download
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-100 px-2.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-100/80 transition"
                                    title={ob.client.vatSourcePackageLabel}
                                  >
                                    <Download className="h-3 w-3" /> Source Package
                                  </a>
                                )}
                                {vatGeneratedZipUrl && (
                                  <a
                                    href={vatGeneratedZipUrl}
                                    download
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-600 hover:bg-emerald-100 transition"
                                    title={ob.client.vatZipLabel}
                                  >
                                    <Download className="h-3 w-3" /> Generated VAT ZIP
                                  </a>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-500">
                              Generate VAT ZIP to download the KRA package, build the upload ZIP, and review the summary before filing VAT.
                            </span>
                          )}

                          {/* Detailed VAT Breakdown — shown when breakdown data is available */}
                          {(vatSummary.sales?.length || vatSummary.purchases?.length) ? (
                            <div className="mt-2">
                              <VatSummaryCard
                                sales={vatSummary.sales}
                                purchases={vatSummary.purchases}
                                previousCredit={vatSummary.previousCredit}
                                netVatBalance={vatSummary.netVatBalance}
                              />
                            </div>
                          ) : null}
                        </div>
                      )}
                      {ob.type === 'TOT' && (
                        <div className="flex flex-col gap-3 rounded-xl bg-blue-50/50 border border-blue-500/20 p-4 shadow-sm group-hover:border-blue-500/30 transition">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Gross Sales / Turnover
                            </label>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs font-medium text-slate-500">KES</span>
                              <input
                                type="number"
                                placeholder="Sales Amount"
                                value={totInputVals[ob.client.id] || ''}
                                onChange={(e) =>
                                  setTotInputVals((prev) => ({
                                    ...prev,
                                    [ob.client.id]: e.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 transition shadow-inner"
                              />
                            </div>
                          </div>
                          <div className="border-t border-slate-200/80 pt-2 flex justify-between items-center text-xs">
                            <span className="font-bold text-blue-600">1.5% Computed TOT</span>
                            <span className="font-black text-[13px] text-blue-600 drop-shadow-sm">
                              KES{' '}
                              {totInputVals[ob.client.id] &&
                              !isNaN(parseFloat(totInputVals[ob.client.id]))
                                ? (
                                    parseFloat(totInputVals[ob.client.id]) * 0.015
                                  ).toLocaleString(undefined, { minimumFractionDigits: 2 })
                                : '0.00'}
                            </span>
                          </div>
                          <div className="flex flex-col gap-2 mt-2 border-t border-slate-200/80 pt-3">
                            {ob.client.totZipUrl && (
                              <div className="flex flex-col gap-1">
                                <a
                                  href={ob.client.totZipUrl}
                                  download
                                  rel="noreferrer"
                                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-100 transition"
                                >
                                  <Download className="h-3 w-3" /> Download Generated ZIP
                                </a>
                                <span className="text-[10px] text-center text-slate-500">
                                  Generated: {formatGeneratedDate(ob.client.lastGeneratedAt)}
                                </span>
                              </div>
                            )}
                            <button
                              onClick={() => void onGenerateTotZip(ob.client)}
                              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-50 border border-blue-500/20 px-3 py-1.5 text-[11px] font-bold text-blue-600 hover:bg-blue-100 transition hover:scale-[1.02]"
                            >
                              <RefreshCw className="h-3 w-3" />{' '}
                              {ob.client.totZipUrl ? 'Regenerate TOT ZIP' : 'Generate TOT ZIP'}
                            </button>
                          </div>
                        </div>
                      )}
                      {ob.type === 'MRI' && (
                        <div className="flex flex-col rounded-xl bg-slate-50 border border-slate-200/50 p-4 shadow-sm group-hover:border-rose-200/30 transition">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-rose-600">7.5% Computed Tax</span>
                            <span className="font-black text-[13px] text-rose-600 drop-shadow-sm">
                              KES{' '}
                              {mriInputVals[ob.client.id] &&
                              !isNaN(parseFloat(mriInputVals[ob.client.id]))
                                ? (
                                    parseFloat(mriInputVals[ob.client.id]) * 0.075
                                  ).toLocaleString(undefined, { minimumFractionDigits: 2 })
                                : '0.00'}
                            </span>
                          </div>
                        </div>
                      )}
                      {ob.type === 'DST' && (
                        <span className="text-slate-500 text-xs italic">Pending CSV Data</span>
                      )}
                    </td>
                    <td className="px-4 py-4 pt-5 align-top">
                      <StatusBadge status={ob.status} />
                    </td>
                    <td className="px-4 py-4 pt-5 align-top text-right">
                      <div className="flex flex-col gap-2 w-full max-w-[140px] ml-auto">
                        {ob.type === 'VAT' ? (
                          <>
                            <button
                              onClick={() => void onPrepareVat(ob.client)}
                              disabled={isPendingFilingJob(relevantJob as any)}
                              className={`flex w-full justify-center items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition shadow-sm drop-shadow ${
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
                              onClick={() => void onConfirmVatFiling(ob.client)}
                              disabled={
                                isPendingFilingJob(relevantJob as any) ||
                                !vatHasPreparedArtifacts ||
                                !vatCreditMatchesPrepared
                              }
                              className={`flex w-full justify-center items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition shadow-sm drop-shadow ${
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
                              File VAT (Auto File)
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => {
                              if (ob.type === 'MRI') void onFileMri(ob.client);
                              else if (ob.type === 'TOT') void onFileTot(ob.client);
                              else if (ob.type === 'PAYE') void onAutoFile(ob.client);
                              else if (ob.type === 'NSSF') void onAutoFileNssf(ob.client);
                            }}
                            disabled={
                              isPendingFilingJob(relevantJob as any) ||
                              (ob.type === 'TOT' && !ob.client.totZipUrl)
                            }
                            className={`flex w-full justify-center items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition shadow-sm drop-shadow ${
                              isPendingFilingJob(relevantJob as any) ||
                              (ob.type === 'TOT' && !ob.client.totZipUrl)
                                ? 'bg-slate-100 border-slate-100 text-slate-500 cursor-not-allowed'
                                : 'bg-emerald-50 border-emerald-500/20 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-500'
                            }`}
                          >
                            {isPendingFilingJob(relevantJob as any) && (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            )}
                            Process Return
                          </button>
                        )}

                        <button
                          onClick={() => void onGeneratePrn(ob.client, ob.type)}
                          disabled={isPendingFilingJob(relevantJob as any)}
                          className="flex w-full justify-center items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-2 text-xs font-bold text-[#ff0613] hover:bg-red-100 hover:text-[#d80000] transition shadow-sm drop-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Generate Payment Slip directly without filing"
                        >
                          {isPendingFilingJob(relevantJob as any) && (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          )}
                          Print PRN
                        </button>
                        {isTerminalFilingJob(relevantJob as any) &&
                          (latestReceiptUrl || latestPrnUrl) && (
                            <>
                              {latestReceiptUrl && !unifiedPrnUrl && latestReceiptUrl !== latestPrnUrl && (
                                <button
                                  onClick={() => downloadAuthFile(latestReceiptUrl)}
                                  className="flex w-full justify-center items-center gap-2 rounded-xl bg-blue-50 border border-blue-500/20 px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-100 hover:text-blue-500 transition shadow-sm"
                                >
                                  Download Receipt
                                </button>
                              )}
                              {(latestPrnUrl || unifiedPrnUrl) && (
                                <button
                                  onClick={() => downloadAuthFile((unifiedPrnUrl ?? latestPrnUrl)!)}
                                  className="flex w-full justify-center items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-2 text-xs font-bold text-[#ff0613] hover:bg-red-100 hover:text-[#d80000] transition shadow-sm"
                                >
                                  Download PRN
                                </button>
                              )}
                            </>
                          )}

                        {relevantJob && (
                          <div className="w-full mt-2 bg-white border border-slate-100 rounded-lg p-2">
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
                                className={`h-1.5 rounded-full transition-all duration-500 ${getFilingProgressTone(relevantJob as any)}`}
                                style={{ width: `${Math.max(relevantJob.progress, 5)}%` }}
                              ></div>
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
                      </div>
                    </td>
                  </tr>
                );
              })}
              {obligations.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-500">
                      <TerminalSquare className="h-8 w-8 mb-3 opacity-20" />
                      <p>No returns found for this filter.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
