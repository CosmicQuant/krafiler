import {
  RefreshCw,
  UploadCloud,
  FileArchive,
  Rocket,
  PlayCircle,
  FileSpreadsheet,
  X,
  Cloud,
  Download,
} from 'lucide-react';
import { ClientObligation, ActiveDashboardJob, TaxStatus } from '../../../types';
import {
  getAutoFileLabel,
  getFilingStatusLabel,
  getFilingProgressTone,
  isPendingFilingJob,
  isTerminalFilingJob,
} from '../../../utils/dashboardUtils';
import { ExcelIcon, ZipIcon } from '../Icons';
import { StatusBadge, InteractiveStatusBadge } from '../StatusBadges';

interface Desk9thViewProps {
  clients: ClientObligation[];
  activeJobs: Record<string, ActiveDashboardJob>;
  generatingClientIds: Record<string, boolean>;
  uploadingClientIds: Record<string, boolean>;
  cancellingClientIds: Record<string, boolean>;
  isGeneratingZips: boolean;
  isGlobalUploading: boolean;
  onGenerateClientZip: (client: ClientObligation) => Promise<void>;
  onAutoFile: (client: ClientObligation) => Promise<void>;
  onAutoFileNssf: (client: ClientObligation) => void;
  onCancelJob: (client: ClientObligation) => Promise<void>;
  onGenerateAllZips: () => Promise<void>;
  onGeneratePrn: (client: ClientObligation, type: string) => Promise<void>;
  onUploadMasterCsv: (clientId: string, file: File) => Promise<void>;
  onRemoveMasterCsv: (clientId: string) => Promise<void>;
  onUpdateStatus: (clientId: string, field: 'paye' | 'nssf' | 'sha', newStatus: TaxStatus) => void;
  onOpenNewClientModal: (client?: ClientObligation) => void;
  onGlobalMasterCsvUpload: (file: File) => Promise<void>;
}

export function Desk9thView({
  clients,
  activeJobs,
  generatingClientIds,
  uploadingClientIds,
  cancellingClientIds,
  isGeneratingZips,
  isGlobalUploading,
  onGenerateClientZip,
  onAutoFile,
  onAutoFileNssf,
  onCancelJob,
  onGenerateAllZips,
  onGeneratePrn,
  onUploadMasterCsv,
  onRemoveMasterCsv,
  onUpdateStatus,
  onOpenNewClientModal,
  onGlobalMasterCsvUpload,
}: Desk9thViewProps) {
  const payrollClients = clients.filter(
    (c) => c.paye !== 'na' || c.nssf !== 'na' || c.sha !== 'na',
  );

  return (
    <div className="mt-10">
      {/* Global Payroll Upload */}
      <div className="my-4 overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-br from-slate-800/80 to-slate-900/40 shadow-sm backdrop-blur relative">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"></div>

        <div className="px-5 py-5 sm:px-6">
          <div className="max-w-3xl">
            <h2 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent mb-1">
              Automate Your Payroll Processing
            </h2>
            <p className="text-sm text-slate-400 mb-4 leading-relaxed">
              Say goodbye to manual client entry. Upload any client&apos;s Master CSV here. We&apos;ll automatically extract the company details, create the client profile if they don&apos;t exist, and instantly generate the final PAYE, NSSF, and SHA files ready for portals.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-stretch">
              <label className="relative group cursor-pointer w-full sm:w-auto">
                <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-400 opacity-20 blur transition group-hover:opacity-40"></div>
                <div className="relative flex flex-1 items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 shadow-md backdrop-blur transition-all group-hover:bg-emerald-500/20">
                  {isGlobalUploading ? (
                    <>
                      <RefreshCw className="h-4 w-4 text-emerald-400 animate-spin" />
                      <span className="text-sm font-bold text-emerald-100/90 tracking-wide">Processing...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="h-4 w-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                      <span className="text-sm font-bold text-emerald-100/90 tracking-wide">Upload Master CSV & Auto-Generate</span>
                    </>
                  )}
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept=".csv,.xlsx"
                  disabled={isGlobalUploading}
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      void onGlobalMasterCsvUpload(e.target.files[0]);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <div className="h-4 w-1 rounded-full bg-slate-700"></div>
              <p className="text-xs text-slate-500 font-medium tracking-wide">
                Need the required format?{' '}
                <a
                  href="/Axon_Unified_Payroll_Template_v4.xlsx"
                  download
                  className="text-emerald-400 hover:text-emerald-300 hover:underline transition-colors focus:outline-none ml-1"
                >
                  Download our complete Unified Template
                </a>{' '}
                (Ensure Employer Details are in Rows 1-3).
              </p>
            </div>
          </div>
        </div>

        {/* Visual flair graphic right side */}
        <div className="absolute right-0 bottom-0 pointer-events-none hidden lg:block opacity-10">
          <svg width="200" height="200" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" stroke="url(#paint0_linear)" strokeWidth="2" strokeDasharray="4 4" />
            <defs>
              <linearGradient id="paint0_linear" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
                <stop stopColor="#10B981" />
                <stop offset="1" stopColor="#10B981" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

      {/* 9th Desk Grid */}
      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 rounded-t-2xl bg-slate-900/80 px-4 py-4 gap-3 sm:gap-0">
          <h3 className="font-bold text-white">Payroll Clients</h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void onGenerateAllZips()}
              disabled={isGeneratingZips}
              className={`inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 sm:px-4 sm:py-2 text-xs sm:text-sm font-bold text-white transition hover:bg-slate-700 ${
                isGeneratingZips ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {isGeneratingZips ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <FileArchive className="h-4 w-4 shrink-0" />
              )}
              <span className="hidden sm:inline">
                {isGeneratingZips ? 'Generating...' : 'Generate All ZIPs'}
              </span>
              <span className="sm:hidden">{isGeneratingZips ? '...' : 'Gen All'}</span>
            </button>
            <button className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 sm:px-4 sm:py-2 text-xs sm:text-sm font-bold text-slate-950 transition hover:bg-emerald-400">
              <Rocket className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Auto-File All</span>
              <span className="sm:hidden">Auto-File</span>
            </button>
          </div>
        </div>
        <div className="pb-16 sm:pb-32 overflow-x-auto lg:overflow-visible">
          <div className="grid grid-cols-1 gap-4 p-4 lg:hidden">
            {payrollClients.map((client) => (
              <div
                key={client.id}
                className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 shadow-lg backdrop-blur flex flex-col gap-4 overflow-visible"
              >
                <div className="flex flex-col border-b border-slate-700/50 pb-3">
                  <h4
                    className="text-sm font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer"
                    onClick={() => onOpenNewClientModal(client)}
                    title="Edit client details"
                  >
                    {client.name}
                  </h4>
                  <span className="text-xs text-slate-500">{client.pin}</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs overflow-visible">
                  <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 overflow-visible">
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-semibold">PAYE</span>
                      {client.payeAmount !== undefined && client.payeAmount !== null ? (
                        <span className="text-[10px] text-slate-400">KES {client.payeAmount.toLocaleString()}</span>
                      ) : (
                        <span className="text-[10px] text-slate-500">KES 0</span>
                      )}
                    </div>
                    <InteractiveStatusBadge
                      status={client.paye}
                      generatedAt={client.lastGeneratedAt}
                      lastFiledDate={client.payeLastFiledDate}
                      receiptUrl={client.payeReceiptUrl}
                      onUpdateStatus={(s) => onUpdateStatus(client.id, 'paye', s)}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 overflow-visible">
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-semibold">NITA</span>
                      {client.nitaAmount !== undefined && client.nitaAmount !== null ? (
                        <span className="text-[10px] text-slate-400">KES {client.nitaAmount.toLocaleString()}</span>
                      ) : (
                        <span className="text-[10px] text-slate-500">KES 0</span>
                      )}
                    </div>
                    <StatusBadge status="due" />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 overflow-visible">
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-semibold">H. Levy</span>
                      {client.housingLevyAmount !== undefined && client.housingLevyAmount !== null ? (
                        <span className="text-[10px] text-slate-400">KES {client.housingLevyAmount.toLocaleString()}</span>
                      ) : (
                        <span className="text-[10px] text-slate-500">KES 0</span>
                      )}
                    </div>
                    <StatusBadge status="due" />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 overflow-visible">
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-semibold">NSSF</span>
                      {client.nssfAmount !== undefined && client.nssfAmount !== null ? (
                        <span className="text-[10px] text-slate-400">KES {client.nssfAmount.toLocaleString()}</span>
                      ) : (
                        <span className="text-[10px] text-slate-500">KES 0</span>
                      )}
                    </div>
                    <InteractiveStatusBadge
                      status={client.nssf}
                      generatedAt={client.lastGeneratedAt}
                      lastFiledDate={client.nssfLastFiledDate}
                      receiptUrl={client.nssfReceiptUrl}
                      onUpdateStatus={(s) => onUpdateStatus(client.id, 'nssf', s)}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 overflow-visible">
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-semibold">SHA</span>
                      {client.shaAmount !== undefined && client.shaAmount !== null ? (
                        <span className="text-[10px] text-slate-400">KES {client.shaAmount.toLocaleString()}</span>
                      ) : (
                        <span className="text-[10px] text-slate-500">KES 0</span>
                      )}
                    </div>
                    <InteractiveStatusBadge
                      status={client.sha}
                      generatedAt={client.lastGeneratedAt}
                      lastFiledDate={client.shaLastFiledDate}
                      receiptUrl={client.shaReceiptUrl}
                      onUpdateStatus={(s) => onUpdateStatus(client.id, 'sha', s)}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2">
                    <span className="text-slate-400 font-semibold">eLevy</span>
                    <StatusBadge status={client.eLevy} />
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-slate-700/50">
                  {client.masterFileUrl ? (
                    <div className="flex items-center gap-2 w-full">
                      <a
                        href={client.masterFileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 flex items-center justify-center rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-600 hover:text-white transition"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-2 shrink-0 text-slate-400" />
                        <span className="truncate">{client.masterFileLabel || 'View Master CSV'}</span>
                      </a>
                      <label
                        className="flex shrink-0 items-center justify-center cursor-pointer rounded-lg border border-slate-600 bg-slate-700/30 p-2 hover:bg-slate-600 transition"
                        title="Replace CSV"
                      >
                        <RefreshCw className="h-4 w-4 text-slate-400 hover:text-white" />
                        <input
                          type="file"
                          className="hidden"
                          accept=".csv,.xlsx"
                          onChange={(e) => {
                            if (e.target.files?.[0]) {
                              if (window.confirm('Replace the existing Master CSV?')) {
                                void onUploadMasterCsv(client.id, e.target.files[0]);
                              }
                            }
                          }}
                        />
                      </label>
                      <button
                        onClick={() => void onRemoveMasterCsv(client.id)}
                        className="flex shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 p-2 hover:bg-red-500/20 transition"
                        title="Remove Master CSV"
                      >
                        <X className="h-4 w-4 text-red-400" />
                      </button>
                    </div>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center justify-center w-full rounded-lg border border-dashed border-slate-600 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-800 hover:text-white transition">
                      {uploadingClientIds[client.id] ? (
                        <>
                          <RefreshCw className="h-3 w-3 mr-2 animate-spin" /> Uploading...
                        </>
                      ) : (
                        'Upload Master CSV'
                      )}
                      <input
                        type="file"
                        className="hidden"
                        accept=".csv,.xlsx"
                        onChange={(e) => {
                          if (e.target.files?.[0]) {
                            void onUploadMasterCsv(client.id, e.target.files[0]);
                          }
                        }}
                      />
                    </label>
                  )}

                  <div className="flex flex-col gap-2 mt-2">
                    {client.payeZipUrl && (
                      <a
                        href={client.payeZipUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center w-full rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition"
                      >
                        <ZipIcon className="h-4 w-4 mr-2 shrink-0" />
                        <span className="truncate">{client.payeZipLabel || 'Download PAYE ZIP'}</span>
                      </a>
                    )}
                    {client.nssfFileUrl && (
                      <a
                        href={client.nssfFileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center w-full rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 text-xs font-semibold text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition"
                      >
                        <ExcelIcon className="h-4 w-4 mr-2 shrink-0" />
                        <span className="truncate">{client.nssfFileLabel || 'Download NSSF CSV'}</span>
                      </a>
                    )}
                    {client.shaFileUrl && (
                      <a
                        href={client.shaFileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center w-full rounded-lg bg-violet-500/10 border border-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-400 hover:bg-violet-500/20 hover:text-violet-300 transition"
                      >
                        <ExcelIcon className="h-4 w-4 mr-2 shrink-0" />
                        <span className="truncate">{client.shaFileLabel || 'Download SHA CSV'}</span>
                      </a>
                    )}
                  </div>

                  {activeJobs[client.id] && (
                    <div className="w-full mt-3 mb-3 bg-slate-900 border border-slate-700 rounded-lg p-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] text-slate-300 font-medium font-mono uppercase tracking-wider truncate">
                          {getFilingStatusLabel(activeJobs[client.id])}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {activeJobs[client.id].progress}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5 mb-1 overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-500 ${getFilingProgressTone(activeJobs[client.id])}`}
                          style={{ width: `${Math.max(activeJobs[client.id].progress, 5)}%` }}
                        ></div>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                        {activeJobs[client.id].state === 'failed' ? (
                          <span className="text-red-400">
                            {activeJobs[client.id].failedReason || 'An error occurred during filing.'}
                          </span>
                        ) : (
                          activeJobs[client.id].message
                        )}
                      </div>
                      {isPendingFilingJob(activeJobs[client.id]) && (
                        <button
                          onClick={() => void onCancelJob(client)}
                          disabled={
                            Boolean(cancellingClientIds[client.id]) ||
                            activeJobs[client.id].state === 'cancelling'
                          }
                          className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold text-amber-300 transition hover:bg-amber-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                        >
                          {Boolean(cancellingClientIds[client.id]) ||
                          activeJobs[client.id].state === 'cancelling' ? (
                            <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
                          ) : (
                            <X className="h-3 w-3 shrink-0" />
                          )}
                          <span>
                            {activeJobs[client.id].state === 'cancelling'
                              ? 'Cancelling...'
                              : 'Cancel Job'}
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={() => void onGenerateClientZip(client)}
                      disabled={
                        !(client.masterFileUrl || client.payrollSourceUrl) ||
                        Boolean(generatingClientIds[client.id]) ||
                        isGeneratingZips
                      }
                      className="flex items-center justify-center w-full gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-2.5 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                    >
                      {generatingClientIds[client.id] ? (
                        <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                      ) : (
                        <PlayCircle className="h-4 w-4 shrink-0" />
                      )}
                      <span className="truncate">
                        {client.masterFileUrl || client.payrollSourceUrl
                          ? generatingClientIds[client.id]
                            ? 'Generating...'
                            : 'Auto Gen ZIP'
                          : 'No CSV'}
                      </span>
                    </button>
                    <div className="flex w-full gap-2">
                      <button
                        onClick={() => void onAutoFile(client)}
                        disabled={
                          (!client.masterFileUrl &&
                            !client.payrollSourceUrl &&
                            !client.payeZipUrl) ||
                          isPendingFilingJob(activeJobs[client.id])
                        }
                        className="flex items-center justify-center flex-1 gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-2.5 text-[10px] font-bold text-blue-400 transition hover:bg-blue-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                        title="Auto File PAYE"
                      >
                        <Rocket className="h-4 w-4 shrink-0" />
                        <span className="truncate">{getAutoFileLabel(activeJobs[client.id])}</span>
                      </button>
                      <button
                        onClick={() => void onAutoFileNssf(client)}
                        disabled={!client.nssfFileUrl || !client.masterFileUrl}
                        className="flex items-center justify-center flex-1 gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-2.5 text-[10px] font-bold text-blue-400 transition hover:bg-blue-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                        title="Auto File NSSF"
                      >
                        <Cloud className="h-4 w-4 shrink-0" />
                        <span className="truncate">AutoFile NSSF</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="overflow-x-auto">
            <table className="hidden lg:table w-full table-fixed text-left text-sm text-slate-300">
              <thead className="border-b border-slate-800 bg-slate-900 text-xs uppercase text-slate-400">
                <tr>
                  <th className="w-[16%] px-2 py-3 sm:px-4 sm:py-4 font-semibold uppercase tracking-wider">
                    Client Portfolio
                  </th>
                  <th className="w-[18%] px-2 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider">
                    Master CSV
                  </th>
                  <th className="px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center">
                    PAYE
                  </th>
                  <th className="px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center">
                    NITA
                  </th>
                  <th className="px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center">
                    H. Levy
                  </th>
                  <th className="px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center">
                    NSSF
                  </th>
                  <th className="px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center">
                    SHA
                  </th>
                  <th className="w-[10%] px-2 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider">
                    Latest Files
                  </th>
                  <th className="w-[16%] px-2 py-3 sm:px-4 sm:py-4 font-semibold text-right uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {payrollClients.map((client) => (
                  <tr key={client.id} className="transition hover:bg-slate-800/50">
                    <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4">
                      <div
                        className="font-semibold break-words text-emerald-400 hover:text-emerald-300 cursor-pointer"
                        onClick={() => onOpenNewClientModal(client)}
                        title="Edit client details"
                      >
                        {client.name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{client.pin}</div>
                    </td>
                    <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-2 sm:py-2">
                      {client.masterFileUrl ? (
                        <div className="flex max-w-[180px] flex-col gap-1.5 xl:max-w-[220px]">
                          <a
                            href={client.masterFileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex w-full items-center gap-2 truncate rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                          >
                            <FileSpreadsheet className="h-3 w-3 shrink-0 text-slate-500" />
                            <span className="truncate">{client.masterFileLabel || 'Open file'}</span>
                          </a>
                          <div className="flex items-center justify-end gap-1.5">
                            <label
                              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-700/30 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-300 hover:bg-slate-600 transition"
                              title="Replace CSV/XLSX"
                            >
                              <RefreshCw className="h-3 w-3 text-slate-400" />
                              <span>Replace</span>
                              <input
                                type="file"
                                className="hidden"
                                accept=".csv,.xlsx"
                                onChange={(e) => {
                                  if (e.target.files?.[0]) {
                                    if (window.confirm('Replace the existing Master CSV?')) {
                                      void onUploadMasterCsv(client.id, e.target.files[0]);
                                    }
                                  }
                                }}
                              />
                            </label>
                            <button
                              onClick={() => void onRemoveMasterCsv(client.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-300 hover:bg-red-500/20 transition"
                              title="Remove Master CSV"
                            >
                              <X className="h-3 w-3 text-red-400" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="inline-flex w-full max-w-[180px] cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-800 hover:text-white transition xl:max-w-[220px]">
                          {uploadingClientIds[client.id] ? (
                            <>
                              <RefreshCw className="h-3 w-3 mr-2 animate-spin" /> Uploading...
                            </>
                          ) : (
                            'Upload Master CSV'
                          )}
                          <input
                            type="file"
                            className="hidden"
                            accept=".csv,.xlsx"
                            onChange={(e) => {
                              if (e.target.files?.[0]) {
                                void onUploadMasterCsv(client.id, e.target.files[0]);
                              }
                            }}
                          />
                        </label>
                      )}
                    </td>
                    <td className="whitespace-normal min-w-0 px-1 py-3 sm:px-2 sm:py-2 text-center overflow-visible">
                      <div className="flex flex-col items-center gap-1">
                        {client.payeAmount !== undefined && client.payeAmount !== null ? (
                          <span className="text-[10px] font-bold text-slate-300">
                            KES {client.payeAmount.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-500">KES 0</span>
                        )}
                        <InteractiveStatusBadge
                          status={client.paye}
                          generatedAt={client.lastGeneratedAt}
                          lastFiledDate={client.payeLastFiledDate}
                          receiptUrl={client.payeReceiptUrl}
                          onUpdateStatus={(s) => onUpdateStatus(client.id, 'paye', s)}
                        />
                      </div>
                    </td>
                    <td className="whitespace-normal min-w-0 px-1 py-3 sm:px-2 sm:py-2 text-center overflow-visible">
                      <div className="flex flex-col items-center gap-1">
                        {client.nitaAmount !== undefined && client.nitaAmount !== null ? (
                          <span className="text-[10px] font-bold text-slate-300">
                            KES {client.nitaAmount.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-500">KES 0</span>
                        )}
                        <StatusBadge status="due" />
                      </div>
                    </td>
                    <td className="whitespace-normal min-w-0 px-1 py-3 sm:px-2 sm:py-2 text-center overflow-visible">
                      <div className="flex flex-col items-center gap-1">
                        {client.housingLevyAmount !== undefined && client.housingLevyAmount !== null ? (
                          <span className="text-[10px] font-bold text-slate-300">
                            KES {client.housingLevyAmount.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-500">KES 0</span>
                        )}
                        <StatusBadge status="due" />
                      </div>
                    </td>
                    <td className="whitespace-normal min-w-0 px-1 py-3 sm:px-2 sm:py-2 text-center overflow-visible">
                      <div className="flex flex-col items-center gap-1">
                        {client.nssfAmount !== undefined && client.nssfAmount !== null ? (
                          <span className="text-[10px] font-bold text-slate-300">
                            KES {client.nssfAmount.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-500">KES 0</span>
                        )}
                        <InteractiveStatusBadge
                          status={client.nssf}
                          generatedAt={client.lastGeneratedAt}
                          lastFiledDate={client.nssfLastFiledDate}
                          receiptUrl={client.nssfReceiptUrl}
                          onUpdateStatus={(s) => onUpdateStatus(client.id, 'nssf', s)}
                        />
                      </div>
                    </td>
                    <td className="whitespace-normal min-w-0 px-1 py-3 sm:px-2 sm:py-2 text-center overflow-visible">
                      <div className="flex flex-col items-center gap-1">
                        {client.shaAmount !== undefined && client.shaAmount !== null ? (
                          <span className="text-[10px] font-bold text-slate-300">
                            KES {client.shaAmount.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-500">KES 0</span>
                        )}
                        <InteractiveStatusBadge
                          status={client.sha}
                          generatedAt={client.lastGeneratedAt}
                          lastFiledDate={client.shaLastFiledDate}
                          receiptUrl={client.shaReceiptUrl}
                          onUpdateStatus={(s) => onUpdateStatus(client.id, 'sha', s)}
                        />
                      </div>
                    </td>
                    <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-2 sm:py-2">
                      <div className="flex flex-col gap-1.5">
                        {client.payeZipUrl ? (
                          <a
                            href={client.payeZipUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-[100px] md:max-w-[150px] items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
                            title={client.payeZipLabel}
                          >
                            <ZipIcon className="h-3 w-3 shrink-0" />
                            <span className="truncate font-semibold">PAYE</span>
                          </a>
                        ) : (
                          <span className="text-xs text-slate-500 italic">No PAYE</span>
                        )}
                        {client.nssfFileUrl ? (
                          <a
                            href={client.nssfFileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-[100px] md:max-w-[150px] items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 hover:underline"
                            title={client.nssfFileLabel}
                          >
                            <ExcelIcon className="h-3 w-3 shrink-0" />
                            <span className="truncate font-semibold">NSSF</span>
                          </a>
                        ) : null}
                        {client.shaFileUrl ? (
                          <a
                            href={client.shaFileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-[100px] md:max-w-[150px] items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 hover:underline"
                            title={client.shaFileLabel}
                          >
                            <ExcelIcon className="h-3 w-3 shrink-0" />
                            <span className="truncate font-semibold">SHA</span>
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4 text-right align-top">
                      <div className="mb-2 ml-auto flex w-full max-w-[150px] flex-col items-stretch gap-1.5">
                        <div className="flex flex-col items-end gap-1 w-full">
                          {client.payeZipUrl && (
                            <span className="text-[10px] text-right text-slate-500">
                              Generated: {new Date(client.lastGeneratedAt || Date.now()).toLocaleString()}
                            </span>
                          )}
                          <button
                            onClick={() => void onGenerateClientZip(client)}
                            disabled={
                              !(client.masterFileUrl || client.payrollSourceUrl) ||
                              Boolean(generatingClientIds[client.id]) ||
                              isGeneratingZips
                            }
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold leading-tight text-emerald-400 transition hover:bg-emerald-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                          >
                            {generatingClientIds[client.id] ? (
                              <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
                            ) : (
                              <PlayCircle className="h-3 w-3 shrink-0" />
                            )}
                            {generatingClientIds[client.id] ? 'Generating...' : 'Generate PAYE ZIP'}
                          </button>
                        </div>
                        <button
                          onClick={() => void onAutoFile(client)}
                          disabled={
                            !client.payeZipUrl || isPendingFilingJob(activeJobs[client.id])
                          }
                          className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold leading-tight transition ${
                            !client.payeZipUrl || isPendingFilingJob(activeJobs[client.id])
                              ? 'border-slate-700 bg-slate-800 text-slate-500 cursor-not-allowed'
                              : 'border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500 hover:text-slate-950'
                          }`}
                          title="Auto File PAYE"
                        >
                          <Rocket className="h-3 w-3 shrink-0" />
                          <span className="truncate">Auto File PAYE</span>
                        </button>
                        <button
                          onClick={() => void onGeneratePrn(client, 'PAYE')}
                          disabled={isPendingFilingJob(activeJobs[client.id])}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold leading-tight text-amber-400 transition hover:bg-amber-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
                          title="Print PAYE PRN"
                        >
                          <Download className="h-3 w-3 shrink-0" />
                          <span className="truncate">Print PAYE PRN</span>
                        </button>
                        <button
                          onClick={() => void onAutoFileNssf(client)}
                          disabled={!client.nssfFileUrl || !client.masterFileUrl}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-bold leading-tight text-blue-400 transition hover:bg-blue-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                          title="Auto File NSSF"
                        >
                          <Cloud className="h-3 w-3 shrink-0" />
                          <span className="truncate">Auto File NSSF</span>
                        </button>
                      </div>
                      {activeJobs[client.id] && (
                        <div className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-left">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] text-slate-300 font-medium font-mono uppercase tracking-wider truncate">
                              {getFilingStatusLabel(activeJobs[client.id])}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {activeJobs[client.id].progress}%
                            </span>
                          </div>
                          <div className="w-full bg-slate-800 rounded-full h-1.5 mb-1 overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-500 ${getFilingProgressTone(activeJobs[client.id])}`}
                              style={{ width: `${Math.max(activeJobs[client.id].progress, 5)}%` }}
                            ></div>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                            {activeJobs[client.id].state === 'failed' ? (
                              <span className="text-red-400">
                                {activeJobs[client.id].failedReason || 'An error occurred during filing.'}
                              </span>
                            ) : (
                              activeJobs[client.id].message
                            )}
                          </div>
                          {isPendingFilingJob(activeJobs[client.id]) && (
                            <button
                              onClick={() => void onCancelJob(client)}
                              disabled={
                                Boolean(cancellingClientIds[client.id]) ||
                                activeJobs[client.id].state === 'cancelling'
                              }
                              className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold text-amber-300 transition hover:bg-amber-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                            >
                              {Boolean(cancellingClientIds[client.id]) ||
                              activeJobs[client.id].state === 'cancelling' ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <X className="h-3 w-3" />
                              )}
                              {activeJobs[client.id].state === 'cancelling'
                                ? 'Cancelling...'
                                : 'Cancel Job'}
                            </button>
                          )}
                          {isTerminalFilingJob(activeJobs[client.id]) &&
                            (activeJobs[client.id].receiptUrl || activeJobs[client.id].prnUrl) && (
                              <div className="mt-2 flex flex-col gap-1.5">
                                {activeJobs[client.id].receiptUrl &&
                                  activeJobs[client.id].receiptUrl !== activeJobs[client.id].prnUrl && (
                                    <a
                                      href={activeJobs[client.id].receiptUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[10px] font-bold text-blue-300 transition hover:bg-blue-500 hover:text-slate-950"
                                    >
                                      <Download className="h-3 w-3" /> Download Receipt
                                    </a>
                                  )}
                                {activeJobs[client.id].prnUrl && (
                                  <a
                                    href={activeJobs[client.id].prnUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold text-amber-300 transition hover:bg-amber-500 hover:text-slate-950"
                                  >
                                    <Download className="h-3 w-3" /> Download PRN
                                  </a>
                                )}
                              </div>
                            )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
