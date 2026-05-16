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
  formatGeneratedDate,
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
  onSelectClient?: (client: ClientObligation) => void;
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
  onSelectClient,
}: Desk9thViewProps) {
  const payrollClients = clients.filter(
    (c) => c.paye !== 'na' || c.nssf !== 'na' || c.sha !== 'na',
  );

  return (
    <div className="mt-10">
      {/* 9th Desk Grid */}
      <div className="mt-0 rounded-2xl border border-slate-200 bg-slate-50 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-200 rounded-t-2xl bg-slate-50/80 px-4 py-4 gap-3 sm:gap-0">
          <h3 className="font-bold text-slate-900">Payroll Clients</h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void onGenerateAllZips()}
              disabled={isGeneratingZips}
              className={`inline-flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-100 px-3 py-2 sm:px-4 sm:py-2 text-xs sm:text-sm font-bold text-slate-900 transition hover:bg-slate-200 ${
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
            <button className="inline-flex items-center gap-2 rounded-xl bg-[#ff0613] px-3 py-2 sm:px-4 sm:py-2 text-xs sm:text-sm font-bold text-slate-950 transition hover:bg-[#d80000]">
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
                className="rounded-xl border border-slate-100 bg-slate-100/50 p-4 shadow-lg flex flex-col gap-4 overflow-visible"
              >
                <div className="flex flex-col border-b border-slate-200/50 pb-3">
                  <h4
                    className="text-sm font-bold text-emerald-600 hover:text-emerald-500 cursor-pointer"
                    onClick={() => onSelectClient ? onSelectClient(client) : onOpenNewClientModal(client)}
                    title="View client details"
                  >
                    {client.name}
                  </h4>
                  <span className="text-xs text-slate-500">{client.pin}</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs overflow-visible">
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2 overflow-visible">
                    <div className="flex flex-col">
                      <span className="text-slate-500 font-semibold">PAYE</span>
                      {client.payeAmount !== undefined && client.payeAmount !== null ? (
                        <span className="text-[10px] text-slate-500">KES {client.payeAmount.toLocaleString()}</span>
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
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2 overflow-visible">
                    <div className="flex flex-col">
                      <span className="text-slate-500 font-semibold">NITA</span>
                      {client.nitaAmount !== undefined && client.nitaAmount !== null ? (
                        <span className="text-[10px] text-slate-500">KES {client.nitaAmount.toLocaleString()}</span>
                      ) : (
                        <span className="text-[10px] text-slate-500">KES 0</span>
                      )}
                    </div>
                    <StatusBadge status="due" />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2 overflow-visible">
                    <div className="flex flex-col">
                      <span className="text-slate-500 font-semibold">H. Levy</span>
                      {client.housingLevyAmount !== undefined && client.housingLevyAmount !== null ? (
                        <span className="text-[10px] text-slate-500">KES {client.housingLevyAmount.toLocaleString()}</span>
                      ) : (
                        <span className="text-[10px] text-slate-500">KES 0</span>
                      )}
                    </div>
                    <StatusBadge status="due" />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2 overflow-visible">
                    <div className="flex flex-col">
                      <span className="text-slate-500 font-semibold">NSSF</span>
                      {client.nssfAmount !== undefined && client.nssfAmount !== null ? (
                        <span className="text-[10px] text-slate-500">KES {client.nssfAmount.toLocaleString()}</span>
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
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2 overflow-visible">
                    <div className="flex flex-col">
                      <span className="text-slate-500 font-semibold">SHA</span>
                      {client.shaAmount !== undefined && client.shaAmount !== null ? (
                        <span className="text-[10px] text-slate-500">KES {client.shaAmount.toLocaleString()}</span>
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
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2">
                    <span className="text-slate-500 font-semibold">eLevy</span>
                    <StatusBadge status={client.eLevy} />
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-slate-200/50">
                  {client.masterFileUrl ? (
                    <div className="flex items-center gap-2 w-full">
                      <a
                        href={client.masterFileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 flex items-center justify-center rounded-lg border border-slate-300 bg-slate-200/50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-300 hover:text-slate-900 transition"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-2 shrink-0 text-slate-500" />
                        <span className="truncate">{client.masterFileLabel || 'View Master CSV'}</span>
                      </a>
                      <label
                        className="flex shrink-0 items-center justify-center cursor-pointer rounded-lg border border-slate-300 bg-slate-200/30 p-2 hover:bg-slate-300 transition"
                        title="Replace CSV"
                      >
                        <RefreshCw className="h-4 w-4 text-slate-500 hover:text-slate-900" />
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
                        className="flex shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-50 p-2 hover:bg-red-100 transition"
                        title="Remove Master CSV"
                      >
                        <X className="h-4 w-4 text-red-600" />
                      </button>
                    </div>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center justify-center w-full rounded-lg border border-dashed border-slate-300 bg-slate-50/80 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition">
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
                        className="flex items-center justify-center w-full rounded-lg bg-emerald-50 border border-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-100 hover:text-emerald-500 transition"
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
                        className="flex items-center justify-center w-full rounded-lg bg-blue-50 border border-blue-500/20 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-100 hover:text-blue-500 transition"
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
                        className="flex items-center justify-center w-full rounded-lg bg-violet-50 border border-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-600 hover:bg-violet-100 hover:text-violet-500 transition"
                      >
                        <ExcelIcon className="h-4 w-4 mr-2 shrink-0" />
                        <span className="truncate">{client.shaFileLabel || 'Download SHA CSV'}</span>
                      </a>
                    )}
                  </div>

                  {(() => {
                    const job = activeJobs[client.id];
                    const isDesk9Job = !job?.obligationType || ['paye', 'nssf'].includes(job.obligationType);
                    const displayJob = isDesk9Job ? job : undefined;
                    if (!displayJob) return null;
                    return (
                    <div className="w-full mt-3 mb-3 bg-white border border-slate-100 rounded-lg p-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] text-slate-600 font-medium font-mono uppercase tracking-wider truncate">
                          {getFilingStatusLabel(displayJob)}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {displayJob.progress}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1 overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-500 ${getFilingProgressTone(displayJob)}`}
                          style={{ width: `${Math.max(displayJob.progress, 5)}%` }}
                        ></div>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                        {displayJob.state === 'failed' ? (
                          <span className="text-red-600">
                            {displayJob.failedReason || 'An error occurred during filing.'}
                          </span>
                        ) : (
                          displayJob.message
                        )}
                      </div>
                      {isPendingFilingJob(displayJob) && (
                        <button
                          onClick={() => void onCancelJob(client)}
                          disabled={
                            Boolean(cancellingClientIds[client.id]) ||
                            displayJob.state === 'cancelling'
                          }
                          className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-[#d80000] transition hover:bg-[#d80000] hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-white disabled:text-slate-500"
                        >
                          {Boolean(cancellingClientIds[client.id]) ||
                          displayJob.state === 'cancelling' ? (
                            <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
                          ) : (
                            <X className="h-3 w-3 shrink-0" />
                          )}
                          <span>
                            {displayJob.state === 'cancelling'
                              ? 'Cancelling...'
                              : 'Cancel Job'}
                          </span>
                        </button>
                      )}
                    </div>
                    );
                  })()}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={() => void onGenerateClientZip(client)}
                      disabled={
                        !(client.masterFileUrl || client.payrollSourceUrl) ||
                        Boolean(generatingClientIds[client.id]) ||
                        isGeneratingZips
                      }
                      className="flex items-center justify-center w-full gap-2 rounded-lg border border-emerald-500/30 bg-emerald-50 px-2 py-2.5 text-xs font-bold text-emerald-600 transition hover:bg-[#ff0613] hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-white disabled:text-slate-500"
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
                        className="flex items-center justify-center flex-1 gap-2 rounded-lg border border-blue-500/30 bg-blue-50 px-2 py-2.5 text-[10px] font-bold text-blue-600 transition hover:bg-blue-600 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-white disabled:text-slate-500"
                        title="Auto File PAYE"
                      >
                        <Rocket className="h-4 w-4 shrink-0" />
                        <span className="truncate">{getAutoFileLabel((() => {
                          const job = activeJobs[client.id];
                          const isDesk9Job = !job?.obligationType || ['paye', 'nssf'].includes(job.obligationType);
                          return isDesk9Job ? job : undefined;
                        })())}</span>
                      </button>
                      <button
                        onClick={() => void onAutoFileNssf(client)}
                        disabled={!client.nssfFileUrl || !client.masterFileUrl}
                        className="flex items-center justify-center flex-1 gap-2 rounded-lg border border-blue-500/30 bg-blue-50 px-2 py-2.5 text-[10px] font-bold text-blue-600 transition hover:bg-blue-600 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-white disabled:text-slate-500"
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
            <table className="hidden lg:table w-full table-fixed text-left text-sm text-slate-600">
              <thead className="border-b border-slate-200 bg-white text-xs uppercase text-slate-500">
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
              <tbody className="divide-y divide-slate-200/50">
                {payrollClients.map((client) => (
                  <tr key={client.id} className="transition hover:bg-slate-100/50">
                    <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4">
                      <div
                        className="font-semibold break-words text-emerald-600 hover:text-emerald-500 cursor-pointer"
                        onClick={() => onSelectClient ? onSelectClient(client) : onOpenNewClientModal(client)}
                        title="View client details"
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
                            className="flex w-full items-center gap-2 truncate rounded-lg border border-slate-100 bg-slate-100/50 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition"
                          >
                            <FileSpreadsheet className="h-3 w-3 shrink-0 text-slate-500" />
                            <span className="truncate">{client.masterFileLabel || 'Open file'}</span>
                          </a>
                          <div className="flex items-center justify-end gap-1.5">
                            <label
                              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-200/30 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-300 transition"
                              title="Replace CSV/XLSX"
                            >
                              <RefreshCw className="h-3 w-3 text-slate-500" />
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
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-700 hover:bg-red-100 transition"
                              title="Remove Master CSV"
                            >
                              <X className="h-3 w-3 text-red-600" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="inline-flex w-full max-w-[180px] cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-100 bg-slate-50/60 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition xl:max-w-[220px]">
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
                          <span className="text-[10px] font-bold text-slate-600">
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
                          <span className="text-[10px] font-bold text-slate-600">
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
                          <span className="text-[10px] font-bold text-slate-600">
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
                          <span className="text-[10px] font-bold text-slate-600">
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
                          <span className="text-[10px] font-bold text-slate-600">
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
                            className="inline-flex max-w-[100px] md:max-w-[150px] items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-500 hover:underline"
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
                            className="inline-flex max-w-[100px] md:max-w-[150px] items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-500 hover:underline"
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
                            className="inline-flex max-w-[100px] md:max-w-[150px] items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-500 hover:underline"
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
                          {client.payeZipUrl && formatGeneratedDate(client.lastGeneratedAt) && (
                            <span className="text-[10px] text-right text-slate-500">
                              Generated: {formatGeneratedDate(client.lastGeneratedAt)}
                            </span>
                          )}
                          <button
                            onClick={() => void onGenerateClientZip(client)}
                            disabled={
                              !(client.masterFileUrl || client.payrollSourceUrl) ||
                              Boolean(generatingClientIds[client.id]) ||
                              isGeneratingZips
                            }
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-50 px-3 py-2 text-xs font-bold leading-tight text-emerald-600 transition hover:bg-[#ff0613] hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-white disabled:text-slate-500"
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
                            !client.payeZipUrl || isPendingFilingJob((() => {
                              const job = activeJobs[client.id];
                              const isDesk9Job = !job?.obligationType || ['paye', 'nssf'].includes(job.obligationType);
                              return isDesk9Job ? job : undefined;
                            })())
                          }
                          className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold leading-tight transition ${
                            !client.payeZipUrl || isPendingFilingJob((() => {
                              const job = activeJobs[client.id];
                              const isDesk9Job = !job?.obligationType || ['paye', 'nssf'].includes(job.obligationType);
                              return isDesk9Job ? job : undefined;
                            })())
                              ? 'border-slate-100 bg-slate-100 text-slate-500 cursor-not-allowed'
                              : 'border-blue-500/30 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-slate-950'
                          }`}
                          title="Auto File PAYE"
                        >
                          <Rocket className="h-3 w-3 shrink-0" />
                          <span className="truncate">Auto File PAYE</span>
                        </button>
                        <button
                          onClick={() => void onGeneratePrn(client, 'PAYE')}
                          disabled={isPendingFilingJob((() => {
                            const job = activeJobs[client.id];
                            const isDesk9Job = !job?.obligationType || ['paye', 'nssf'].includes(job.obligationType);
                            return isDesk9Job ? job : undefined;
                          })())}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold leading-tight text-[#ff0613] transition hover:bg-[#d80000] hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-100 disabled:text-slate-500"
                          title="Print PAYE PRN"
                        >
                          <Download className="h-3 w-3 shrink-0" />
                          <span className="truncate">Print PAYE PRN</span>
                        </button>
                        <button
                          onClick={() => void onAutoFileNssf(client)}
                          disabled={!client.nssfFileUrl || !client.masterFileUrl}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-50 px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-bold leading-tight text-blue-600 transition hover:bg-blue-600 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-white disabled:text-slate-500"
                          title="Auto File NSSF"
                        >
                          <Cloud className="h-3 w-3 shrink-0" />
                          <span className="truncate">Auto File NSSF</span>
                        </button>
                      </div>
                      {(() => {
                        const job = activeJobs[client.id];
                        const isDesk9Job = !job?.obligationType || ['paye', 'nssf'].includes(job.obligationType);
                        const displayJob = isDesk9Job ? job : undefined;
                        if (!displayJob) return null;
                        return (
                        <div className="w-full bg-white border border-slate-100 rounded-lg p-2 text-left">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] text-slate-600 font-medium font-mono uppercase tracking-wider truncate">
                              {getFilingStatusLabel(displayJob)}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {displayJob.progress}%
                            </span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1 overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-500 ${getFilingProgressTone(displayJob)}`}
                              style={{ width: `${Math.max(displayJob.progress, 5)}%` }}
                            ></div>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                            {displayJob.state === 'failed' ? (
                              <span className="text-red-600">
                                {displayJob.failedReason || 'An error occurred during filing.'}
                              </span>
                            ) : (
                              displayJob.message
                            )}
                          </div>
                          {isPendingFilingJob(displayJob) && (
                            <button
                              onClick={() => void onCancelJob(client)}
                              disabled={
                                Boolean(cancellingClientIds[client.id]) ||
                                displayJob.state === 'cancelling'
                              }
                              className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-[#d80000] transition hover:bg-[#d80000] hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-white disabled:text-slate-500"
                            >
                              {Boolean(cancellingClientIds[client.id]) ||
                              displayJob.state === 'cancelling' ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <X className="h-3 w-3" />
                              )}
                              {displayJob.state === 'cancelling'
                                ? 'Cancelling...'
                                : 'Cancel Job'}
                            </button>
                          )}
                          {isTerminalFilingJob(displayJob) &&
                            (displayJob.receiptUrl || displayJob.prnUrl) && (
                              <div className="mt-2 flex flex-col gap-1.5">
                                {displayJob.receiptUrl &&
                                  displayJob.receiptUrl !== displayJob.prnUrl && (
                                    <a
                                      href={displayJob.receiptUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-50 px-3 py-1.5 text-[10px] font-bold text-blue-500 transition hover:bg-blue-600 hover:text-slate-950"
                                    >
                                      <Download className="h-3 w-3" /> Download Receipt
                                    </a>
                                  )}
                                {displayJob.prnUrl && (
                                  <a
                                    href={displayJob.prnUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-[#d80000] transition hover:bg-[#d80000] hover:text-slate-950"
                                  >
                                    <Download className="h-3 w-3" /> Download PRN
                                  </a>
                                )}
                              </div>
                            )}
                        </div>
                        );
                      })()}
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
