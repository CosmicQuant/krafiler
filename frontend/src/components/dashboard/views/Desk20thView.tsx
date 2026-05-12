
import {
  TerminalSquare,
  Upload,
  Download,
  RefreshCw,
} from 'lucide-react';
import { ClientObligation, TaxStatus, VatPreparationSummary } from '../../../types';
import { VatSummaryCard } from '../VatSummaryCard';
import {
  StatusBadge,
} from '../StatusBadges';
import {
  formatTaxAmount,
  getReceiptUrlForObligation,
  isPendingFilingJob,
  isTerminalFilingJob,
  isSameMoney,
} from '../../../utils/dashboardUtils';

interface Desk20thViewProps {
  clients: ClientObligation[];
  activeJobs: Record<string, { state: string; progress: number; message: string; failedReason?: string; receiptUrl?: string; prnUrl?: string; generatedZipUrl?: string; generatedZipLabel?: string; sourcePackageUrl?: string; sourcePackageLabel?: string; vatSummary?: VatPreparationSummary }>;
  monthlyReturnFilter: 'ALL' | 'VAT' | 'TOT' | 'MRI' | 'DST';
  setMonthlyReturnFilter: (filter: 'ALL' | 'VAT' | 'TOT' | 'MRI' | 'DST') => void;
  mriInputVals: Record<string, string>;
  setMriInputVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  totInputVals: Record<string, string>;
  setTotInputVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  vatPreviousCreditVals: Record<string, string>;
  setVatPreviousCreditVals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onPrepareVat: (client: ClientObligation) => Promise<void>;
  onConfirmVatFiling: (client: ClientObligation) => Promise<void>;
  onGeneratePrn: (client: ClientObligation, type: string) => Promise<void>;
  onFileMri: (client: ClientObligation) => Promise<void>;
  onFileTot: (client: ClientObligation) => Promise<void>;
  onAutoFile: (client: ClientObligation) => Promise<void>;
  onAutoFileNssf: (client: ClientObligation) => void;
  onGenerateTotZip: (client: ClientObligation) => Promise<void>;
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
  onPrepareVat,
  onConfirmVatFiling,
  onGeneratePrn,
  onFileMri,
  onFileTot,
  onAutoFile,
  onAutoFileNssf,
  onGenerateTotZip,
}: Desk20thViewProps) {

  let obligations: { client: ClientObligation; type: string; status: TaxStatus }[] = [];
  clients.forEach((c) => {
    if (c.vat !== 'na') obligations.push({ client: c, type: 'VAT', status: c.vat });
    if (c.tot !== 'na') obligations.push({ client: c, type: 'TOT', status: c.tot });
    if (c.dst !== 'na') obligations.push({ client: c, type: 'DST', status: c.dst });
    if (c.mri !== 'na') obligations.push({ client: c, type: 'MRI', status: c.mri });
  });

  if (monthlyReturnFilter !== 'ALL') {
    obligations = obligations.filter((ob) => ob.type === monthlyReturnFilter);
  }

  return (
    <div className="mt-8">
      {/* 1. The Toggle UI */}
      <div className="mb-6 flex flex-wrap gap-3 items-center">
        {(['VAT', 'TOT', 'MRI', 'DST', 'ALL'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMonthlyReturnFilter(t)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              monthlyReturnFilter === t
                ? 'bg-blue-500 text-white shadow-md shadow-blue-500/20'
                : 'border border-slate-700 bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            {t === 'ALL' ? 'All Returns' : `${t} Returns`}
          </button>
        ))}
      </div>

      {/* 2. The Matrix Table Wrapper */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
        <div className="pb-16 sm:pb-32 overflow-x-auto lg:overflow-visible">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="border-b border-slate-800 bg-slate-900 rounded-t-2xl text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Client Info</th>
                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Return Data / Source</th>
                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Tax Calculation details</th>
                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Status</th>
                <th className="px-4 py-4 font-semibold text-right uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {obligations.map((ob, idx) => {
                const jobArtifacts = activeJobs[ob.client.id];
                const latestReceiptUrl = jobArtifacts?.receiptUrl ?? getReceiptUrlForObligation(ob.client, ob.type);
                const latestPrnUrl = jobArtifacts?.prnUrl;
                const unifiedPrnUrl = latestPrnUrl && latestPrnUrl === latestReceiptUrl ? latestPrnUrl : undefined;
                const vatGeneratedZipUrl = ob.client.vatZipUrl ?? jobArtifacts?.generatedZipUrl;
                const vatSourcePackageUrl = ob.client.vatSourcePackageUrl ?? jobArtifacts?.sourcePackageUrl;
                const vatSummary: VatPreparationSummary = {
                  inputVat: ob.client.vatInputVat ?? jobArtifacts?.vatSummary?.inputVat ?? 0,
                  outputVat: ob.client.vatOutputVat ?? jobArtifacts?.vatSummary?.outputVat ?? 0,
                  previousCredit: ob.client.vatPreviousCredit ?? jobArtifacts?.vatSummary?.previousCredit ?? 0,
                  payableVat: ob.client.vatPayableVat ?? jobArtifacts?.vatSummary?.payableVat ?? 0,
                  netVatBalance: ob.client.vatNetVatBalance ?? jobArtifacts?.vatSummary?.netVatBalance ?? 0,
                };
                const vatInputValue =
                  vatPreviousCreditVals[ob.client.id] ??
                  (typeof ob.client.vatPreviousCredit === 'number'
                    ? String(ob.client.vatPreviousCredit)
                    : '');
                const parsedVatInputValue = vatInputValue.trim().length > 0 ? Number.parseFloat(vatInputValue) : 0;
                const vatCurrentCredit = Number.isFinite(parsedVatInputValue) ? parsedVatInputValue : 0;
                const vatHasPreparedArtifacts = Boolean(vatGeneratedZipUrl);
                const vatCreditMatchesPrepared = isSameMoney(vatSummary.previousCredit, vatCurrentCredit);
                const vatGenerateActionLabel = vatHasPreparedArtifacts ? 'Regenerate VAT ZIP' : 'Generate VAT ZIP';
                const vatBalanceLabel = vatSummary.netVatBalance >= 0 ? 'VAT Payable' : 'Credit Balance';
                const vatBalanceValue = Math.abs(vatSummary.netVatBalance);

                return (
                  <tr key={`${ob.client.id}-${ob.type}-${idx}`} className="transition hover:bg-slate-800/50 group">
                    <td className="px-4 py-4">
                      <div className="font-semibold text-white">{ob.client.name}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-slate-500">PIN: {ob.client.pin}</span>
                        <span className="inline-flex rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
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
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition"
                                    title={ob.client.vatZipLabel}
                                  >
                                    <Download className="h-3 w-3" /> Generated VAT ZIP (KRA Upload)
                                  </a>
                                  <span className="text-[10px] text-slate-500 text-center">
                                    Generated: {new Date(ob.client.vatPreparedAt || Date.now()).toLocaleString()}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[11px] text-slate-500">No VAT ZIP generated yet.</span>
                              )}

                              {vatSourcePackageUrl && (
                                <a
                                  href={vatSourcePackageUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800/70 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700/80 transition"
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
                        <button className="text-xs flex items-center justify-center gap-1.5 rounded-xl mt-1 bg-fuchsia-500/10 px-4 py-2.5 font-bold text-fuchsia-400 hover:bg-fuchsia-500/20 transition w-full max-w-[200px] border border-fuchsia-500/20">
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
                              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-rose-500 transition shadow-inner"
                            />
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 min-w-[280px]">
                      {ob.type === 'VAT' && (
                        <div className="flex flex-col gap-3 rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 shadow-sm group-hover:border-slate-600 transition">
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
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-blue-500 transition shadow-inner"
                              />
                            </div>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-400 font-medium">
                              Input VAT <span className="font-normal text-[10px] ml-1 text-slate-500">(Purchases)</span>
                            </span>
                            <span className="text-slate-200 font-bold border-b border-transparent">
                              KES {formatTaxAmount(vatSummary.inputVat)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-400 font-medium">
                              Output VAT <span className="font-normal text-[10px] ml-1 text-slate-500">(Sales)</span>
                            </span>
                            <span className="text-slate-200 font-bold border-b border-transparent">
                              KES {formatTaxAmount(vatSummary.outputVat)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-400 font-medium">
                              Previous Credit <span className="font-normal text-[10px] ml-1 text-slate-500">(Applied)</span>
                            </span>
                            <span className="text-slate-200 font-bold border-b border-transparent">
                              KES {formatTaxAmount(vatSummary.previousCredit)}
                            </span>
                          </div>
                          <div className="border-t border-slate-700/80 my-1 pt-2.5 flex justify-between items-center text-xs">
                            <span
                              className={`font-bold ${
                                vatSummary.netVatBalance >= 0 ? 'text-blue-400' : 'text-emerald-400'
                              }`}
                            >
                              {vatBalanceLabel}{' '}
                              <span className="font-normal text-[10px] ml-1 opacity-70">(After credit)</span>
                            </span>
                            <span
                              className={`font-black text-[13px] drop-shadow-sm ${
                                vatSummary.netVatBalance >= 0 ? 'text-blue-400' : 'text-emerald-400'
                              }`}
                            >
                              KES {formatTaxAmount(vatBalanceValue)}
                            </span>
                          </div>
                          {vatHasPreparedArtifacts ? (
                            <div className="flex flex-col gap-2 rounded-lg border border-slate-700/70 bg-slate-950/40 p-3 text-[11px] text-slate-300">
                              <span
                                className={`font-semibold ${
                                  vatCreditMatchesPrepared ? 'text-emerald-400' : 'text-amber-400'
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
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 font-semibold text-slate-300 hover:bg-slate-800/80 transition"
                                    title={ob.client.vatSourcePackageLabel}
                                  >
                                    <Download className="h-3 w-3" /> Source Package
                                  </a>
                                )}
                                {vatGeneratedZipUrl && (
                                  <a
                                    href={vatGeneratedZipUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 font-semibold text-emerald-400 hover:bg-emerald-500/20 transition"
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
                        <div className="flex flex-col gap-3 rounded-xl bg-blue-900/5 border border-blue-500/20 p-4 shadow-sm group-hover:border-blue-500/30 transition">
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
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-blue-500 transition shadow-inner"
                              />
                            </div>
                          </div>
                          <div className="border-t border-slate-700/80 pt-2 flex justify-between items-center text-xs">
                            <span className="font-bold text-blue-400">1.5% Computed TOT</span>
                            <span className="font-black text-[13px] text-blue-400 drop-shadow-sm">
                              KES{' '}
                              {totInputVals[ob.client.id] &&
                              !isNaN(parseFloat(totInputVals[ob.client.id]))
                                ? (
                                    parseFloat(totInputVals[ob.client.id]) * 0.015
                                  ).toLocaleString(undefined, { minimumFractionDigits: 2 })
                                : '0.00'}
                            </span>
                          </div>
                          <div className="flex flex-col gap-2 mt-2 border-t border-slate-700/80 pt-3">
                            {ob.client.totZipUrl && (
                              <div className="flex flex-col gap-1">
                                <a
                                  href={ob.client.totZipUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition"
                                >
                                  <Download className="h-3 w-3" /> Download Generated ZIP
                                </a>
                                <span className="text-[10px] text-center text-slate-500">
                                  Generated: {new Date(ob.client.lastGeneratedAt || Date.now()).toLocaleString()}
                                </span>
                              </div>
                            )}
                            <button
                              onClick={() => void onGenerateTotZip(ob.client)}
                              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 text-[11px] font-bold text-blue-400 hover:bg-blue-500/20 transition hover:scale-[1.02]"
                            >
                              <RefreshCw className="h-3 w-3" />{' '}
                              {ob.client.totZipUrl ? 'Regenerate TOT ZIP' : 'Generate TOT ZIP'}
                            </button>
                          </div>
                        </div>
                      )}
                      {ob.type === 'MRI' && (
                        <div className="flex flex-col rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 shadow-sm group-hover:border-rose-900/30 transition">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-rose-400">7.5% Computed Tax</span>
                            <span className="font-black text-[13px] text-rose-400 drop-shadow-sm">
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
                              disabled={isPendingFilingJob(activeJobs[ob.client.id] as any)}
                              className={`flex w-full justify-center items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition shadow-sm drop-shadow ${
                                isPendingFilingJob(activeJobs[ob.client.id] as any)
                                  ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                                  : 'bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300'
                              }`}
                            >
                              {vatGenerateActionLabel}
                            </button>
                            <button
                              onClick={() => void onConfirmVatFiling(ob.client)}
                              disabled={
                                isPendingFilingJob(activeJobs[ob.client.id] as any) ||
                                !vatHasPreparedArtifacts ||
                                !vatCreditMatchesPrepared
                              }
                              className={`flex w-full justify-center items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition shadow-sm drop-shadow ${
                                isPendingFilingJob(activeJobs[ob.client.id] as any) ||
                                !vatHasPreparedArtifacts ||
                                !vatCreditMatchesPrepared
                                  ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300'
                              }`}
                            >
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
                              isPendingFilingJob(activeJobs[ob.client.id] as any) ||
                              (ob.type === 'TOT' && !ob.client.totZipUrl)
                            }
                            className={`flex w-full justify-center items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition shadow-sm drop-shadow ${
                              isPendingFilingJob(activeJobs[ob.client.id] as any) ||
                              (ob.type === 'TOT' && !ob.client.totZipUrl)
                                ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300'
                            }`}
                          >
                            Process Return
                          </button>
                        )}

                        <button
                          onClick={() => void onGeneratePrn(ob.client, ob.type)}
                          disabled={isPendingFilingJob(activeJobs[ob.client.id] as any)}
                          className="flex w-full justify-center items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/20 hover:text-amber-300 transition shadow-sm drop-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Generate Payment Slip directly without filing"
                        >
                          Print PRN
                        </button>
                        {isTerminalFilingJob(activeJobs[ob.client.id] as any) &&
                          (latestReceiptUrl || latestPrnUrl) && (
                            <>
                              {latestReceiptUrl && !unifiedPrnUrl && latestReceiptUrl !== latestPrnUrl && (
                                <a
                                  href={latestReceiptUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex w-full justify-center items-center gap-2 rounded-xl bg-blue-500/10 border border-blue-500/20 px-4 py-2 text-xs font-bold text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition shadow-sm"
                                >
                                  Download Receipt
                                </a>
                              )}
                              {(latestPrnUrl || unifiedPrnUrl) && (
                                <a
                                  href={unifiedPrnUrl ?? latestPrnUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex w-full justify-center items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/20 hover:text-amber-300 transition shadow-sm"
                                >
                                  Download PRN
                                </a>
                              )}
                            </>
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
