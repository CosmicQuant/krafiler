import { useEffect } from 'react';
import { apiFetch } from '../services/api';
import { ActiveDashboardJob, ClientObligation, FilingJobState, FilingStepLog, VatPreparationSummary } from '../types';
import { buildStoredArtifactUrl, isTerminalFilingJob } from '../utils/dashboardUtils';

export function useJobPolling(
  activeJobs: Record<string, ActiveDashboardJob>,
  setActiveJobs: React.Dispatch<React.SetStateAction<Record<string, ActiveDashboardJob>>>,
  setClients: React.Dispatch<React.SetStateAction<ClientObligation[]>>,
) {
  useEffect(() => {
    const checkJobs = async () => {
      const currentJobs = { ...activeJobs };
      let hasChanges = false;
      const vatClientUpdates: Record<string, Partial<ClientObligation>> = {};

      for (const [clientId, job] of Object.entries(currentJobs)) {
        if (isTerminalFilingJob(job) || !job.id) continue;

        try {
          const res = await apiFetch(`/tax/filing-status/${job.id}`);
          if (!res.ok) continue;
          const data = await res.json();

          const newMessage = data.lastStep?.message ?? currentJobs[clientId].message ?? 'Processing...';
          const nextProgress = typeof data.progress === 'number' ? data.progress : currentJobs[clientId].progress;
          const resultReceiptUrl = buildStoredArtifactUrl(data.result?.receiptPath);
          const resultPrnUrl = buildStoredArtifactUrl(data.result?.prnPath);
          const resultGeneratedZipUrl = buildStoredArtifactUrl(data.result?.generatedZipUrl);
          const resultSourcePackageUrl = buildStoredArtifactUrl(data.result?.sourcePackageUrl);
          const resultVatSummary =
            data.result?.vatSummary && typeof data.result.vatSummary === 'object'
              ? (data.result.vatSummary as VatPreparationSummary)
              : undefined;
          const nextStepLogs: FilingStepLog[] | undefined = Array.isArray(data.stepLogs) && data.stepLogs.length > 0
            ? data.stepLogs
            : currentJobs[clientId].stepLogs;

          if (
            currentJobs[clientId].state !== data.state ||
            currentJobs[clientId].progress !== data.progress ||
            currentJobs[clientId].message !== newMessage ||
            currentJobs[clientId].receiptUrl !== resultReceiptUrl ||
            currentJobs[clientId].prnUrl !== resultPrnUrl ||
            currentJobs[clientId].generatedZipUrl !== resultGeneratedZipUrl ||
            currentJobs[clientId].sourcePackageUrl !== resultSourcePackageUrl ||
            currentJobs[clientId].generatedZipLabel !== data.result?.generatedZipLabel ||
            currentJobs[clientId].sourcePackageLabel !== data.result?.sourcePackageLabel ||
            JSON.stringify(currentJobs[clientId].vatSummary ?? null) !== JSON.stringify(resultVatSummary ?? null) ||
            JSON.stringify(currentJobs[clientId].stepLogs ?? null) !== JSON.stringify(nextStepLogs ?? null)
          ) {
            currentJobs[clientId] = {
              ...currentJobs[clientId],
              id: data.jobId,
              state: data.state as FilingJobState,
              progress: nextProgress,
              message: newMessage,
              failedReason: data.failedReason || '',
              receiptUrl: resultReceiptUrl,
              prnUrl: resultPrnUrl,
              generatedZipUrl: resultGeneratedZipUrl,
              generatedZipLabel: data.result?.generatedZipLabel,
              sourcePackageUrl: resultSourcePackageUrl,
              sourcePackageLabel: data.result?.sourcePackageLabel,
              vatSummary: resultVatSummary,
              stepLogs: nextStepLogs,
            };
            hasChanges = true;
          }

          if (currentJobs[clientId].obligationType === 'vat') {
            const vatUpdate: Partial<ClientObligation> = {};
            const finishedAt = typeof data.finishedOn === 'string' ? data.finishedOn : new Date().toISOString();

            if (resultGeneratedZipUrl) {
              vatUpdate.vatZipUrl = resultGeneratedZipUrl;
              vatUpdate.vatZipLabel = data.result?.generatedZipLabel;
              vatUpdate.vatSourcePackageUrl = resultSourcePackageUrl;
              vatUpdate.vatSourcePackageLabel = data.result?.sourcePackageLabel;
              vatUpdate.vatPreparedAt = finishedAt;
              vatUpdate.vat = 'generated';
            }

            if (resultVatSummary) {
              vatUpdate.vatInputVat = resultVatSummary.inputVat;
              vatUpdate.vatOutputVat = resultVatSummary.outputVat;
              vatUpdate.vatPreviousCredit = resultVatSummary.previousCredit;
              vatUpdate.vatPayableVat = resultVatSummary.payableVat;
              vatUpdate.vatNetVatBalance = resultVatSummary.netVatBalance;
            }

            if (data.state === 'completed' && resultReceiptUrl) {
              vatUpdate.vat = 'filed';
              vatUpdate.vatReceiptUrl = resultReceiptUrl;
              vatUpdate.vatLastFiledDate = finishedAt;
            }

            if (Object.keys(vatUpdate).length > 0) {
              vatClientUpdates[clientId] = {
                ...(vatClientUpdates[clientId] ?? {}),
                ...vatUpdate,
              };
            }
          }
        } catch (e) {
          // suppress network errors so UI doesn't crash
        }
      }

      if (hasChanges) {
        setActiveJobs((prev) => ({ ...prev, ...currentJobs }));
      }

      if (Object.keys(vatClientUpdates).length > 0) {
        setClients((current) =>
          current.map((client) => {
            const update = vatClientUpdates[client.id];
            if (!update) {
              return client;
            }
            return {
              ...client,
              ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)),
            };
          }),
        );
      }
    };

    const interval = setInterval(checkJobs, 2000);
    return () => clearInterval(interval);
  }, [activeJobs, setActiveJobs, setClients]);
}
