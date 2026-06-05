/**
 * useJobListener.ts
 *
 * Replaces 2-second REST polling with Firestore onSnapshot real-time listeners.
 * Listens to the user's active jobs in Firestore and keeps dashboard state in sync.
 */

import { useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import {
    collection,
    query,
    where,
    onSnapshot,
    QuerySnapshot,
    DocumentData,
    Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ActiveDashboardJob, ClientObligation, FilingJobState, VatPreparationSummary } from '../types';
import { buildStoredArtifactUrl } from '../utils/dashboardUtils';

interface FirestoreJobDoc extends DocumentData {
    ownerUid: string;
    clientId?: string;
    status: string;
    progress: number;
    message: string;
    payload?: {
        taxObligationType?: string;
        clientId?: string;
    };
    result?: {
        receiptPath?: string;
        prnPath?: string;
        generatedZipUrl?: string;
        generatedZipLabel?: string;
        sourcePackageUrl?: string;
        sourcePackageLabel?: string;
        vatSummary?: VatPreparationSummary;
    };
    error?: { message?: string };
    createdAt?: Timestamp;
    startedAt?: Timestamp;
    completedAt?: Timestamp;
}

function mapStatusToState(status: string): FilingJobState {
    switch (status) {
        case 'waiting':
            return 'waiting';
        case 'active':
        case 'processing':
            return 'active';
        case 'completed':
            return 'completed';
        case 'failed':
            return 'failed';
        case 'cancelled':
            return 'cancelled';
        default:
            return 'unknown';
    }
}

export function useJobListener(
    user: User | null,
    activeJobs: Record<string, ActiveDashboardJob>,
    setActiveJobs: React.Dispatch<React.SetStateAction<Record<string, ActiveDashboardJob>>>,
    setClients?: React.Dispatch<React.SetStateAction<ClientObligation[]>>,
) {
    const activeJobsRef = useRef(activeJobs);
    activeJobsRef.current = activeJobs;

    useEffect(() => {
        if (!user) return;

        const q = query(
            collection(db, 'jobs'),
            where('ownerUid', '==', user.uid),
            where('status', 'in', ['waiting', 'active', 'processing'])
        );

        const handleSnapshot = (snapshot: QuerySnapshot<DocumentData>) => {
            const nextJobs: Record<string, ActiveDashboardJob> = {};
            const vatClientUpdates: Record<string, Partial<ClientObligation>> = {};
            const now = new Date().toISOString();

            snapshot.docs.forEach((docSnap) => {
                const data = docSnap.data() as FirestoreJobDoc;
                const jobId = docSnap.id;
                const clientId = data.clientId || data.payload?.clientId;
                if (!clientId) return; // Skip legacy jobs without client mapping

                const state = mapStatusToState(data.status);
                const result = data.result || {};
                const resultReceiptUrl = buildStoredArtifactUrl(result.receiptPath);
                const resultPrnUrl = buildStoredArtifactUrl(result.prnPath);
                const resultGeneratedZipUrl = buildStoredArtifactUrl(result.generatedZipUrl);
                const resultSourcePackageUrl = buildStoredArtifactUrl(result.sourcePackageUrl);
                const resultVatSummary = result.vatSummary;

                nextJobs[clientId] = {
                    id: jobId,
                    state,
                    progress: typeof data.progress === 'number' ? data.progress : 0,
                    message: data.message || 'Processing...',
                    failedReason: data.error?.message || '',
                    obligationType: data.payload?.taxObligationType || '',
                    receiptUrl: resultReceiptUrl,
                    prnUrl: resultPrnUrl,
                    generatedZipUrl: resultGeneratedZipUrl,
                    generatedZipLabel: result.generatedZipLabel,
                    sourcePackageUrl: resultSourcePackageUrl,
                    sourcePackageLabel: result.sourcePackageLabel,
                    vatSummary: resultVatSummary,
                };

                // VAT side-effect updates (mirror old polling behaviour)
                if (data.payload?.taxObligationType === 'vat' && setClients) {
                    const vatUpdate: Partial<ClientObligation> = {};
                    const finishedAt = data.completedAt
                        ? data.completedAt.toDate().toISOString()
                        : now;

                    if (resultGeneratedZipUrl) {
                        vatUpdate.vatZipUrl = resultGeneratedZipUrl;
                        vatUpdate.vatZipLabel = result.generatedZipLabel;
                        vatUpdate.vatSourcePackageUrl = resultSourcePackageUrl;
                        vatUpdate.vatSourcePackageLabel = result.sourcePackageLabel;
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

                    if (data.status === 'completed' && resultReceiptUrl) {
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
            });

            // Merge with existing activeJobs so we don't drop fields like stepLogs or isNil
            // that were set during job creation but aren't present in the Firestore document.
            const merged: Record<string, ActiveDashboardJob> = { ...activeJobsRef.current };
            Object.entries(nextJobs).forEach(([clientId, job]) => {
                merged[clientId] = { ...merged[clientId], ...job };
            });

            // Remove any jobs that were in the previous snapshot but are no longer
            // active AND have reached a terminal state. Keep terminal ones that
            // are still in activeJobsRef so they remain visible.
            const currentSnapshotClientIds = new Set(Object.keys(nextJobs));
            Object.keys(merged).forEach((clientId) => {
                const job = merged[clientId];
                if (!currentSnapshotClientIds.has(clientId) && job.state !== 'completed' && job.state !== 'failed' && job.state !== 'cancelled') {
                    delete merged[clientId];
                }
            });

            setActiveJobs(merged);

            if (setClients && Object.keys(vatClientUpdates).length > 0) {
                setClients((current) =>
                    current.map((client) => {
                        const update = vatClientUpdates[client.id];
                        if (!update) return client;
                        return {
                            ...client,
                            ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)),
                        };
                    })
                );
            }
        };

        const unsubscribe = onSnapshot(q, handleSnapshot, (err) => {
            console.error('[useJobListener] Firestore listener error:', err);
        });

        return () => unsubscribe();
    }, [user, setActiveJobs, setClients]);
}
