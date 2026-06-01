/**
 * useFilingActions.ts
 *
 * Consolidates all KRA filing async operations into a single hook.
 * Reads live state via a ref to avoid stale closures in async handlers.
 */

import { useRef, useCallback } from 'react';
import { apiFetch } from '../services/api';
import { ClientObligation, FilingJobState, ActiveDashboardJob, TaxStatus } from '../types';
import { getCurrentFilingPeriod } from '../utils/taxPeriods';
import { isPendingFilingJob, isTerminalFilingJob, markPayrollStatusesGenerated } from '../utils/dashboardUtils';

export type DashboardNotice = { tone: 'success' | 'error' | 'info'; message: string } | null;

export type FilingActionsDeps = {
    setDashboardNotice: (notice: DashboardNotice) => void;
    setClients: React.Dispatch<React.SetStateAction<ClientObligation[]>>;
    setSelectedClient?: React.Dispatch<React.SetStateAction<ClientObligation | null>>;
    setActiveJobs: React.Dispatch<React.SetStateAction<Record<string, ActiveDashboardJob>>>;
    setGeneratingClientIds?: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    setCancellingClientIds?: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    setUploadingClientIds?: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    setIsGeneratingZips?: React.Dispatch<React.SetStateAction<boolean>>;
    setIsGlobalUploading?: React.Dispatch<React.SetStateAction<boolean>>;
    getActiveJobs: () => Record<string, ActiveDashboardJob>;
    getNilSelections: () => Record<string, { type: string; periodFrom: string; periodTo: string; ownsRentalProperty?: boolean }>;
    getVatPreviousCreditVals: () => Record<string, string>;
    getVatSectionBWithoutPinVals: () => Record<string, string>;
    getMriInputVals: () => Record<string, string>;
    getTotInputVals: () => Record<string, string>;
};

export function useFilingActions(deps: FilingActionsDeps) {
    const depsRef = useRef(deps);
    depsRef.current = deps;

    const getD = () => depsRef.current;

    const withLoading = async <T,>(
        clientId: string,
        setLoading: React.Dispatch<React.SetStateAction<Record<string, boolean>>> | undefined,
        fn: () => Promise<T>
    ): Promise<T | undefined> => {
        if (setLoading) setLoading((prev) => ({ ...prev, [clientId]: true }));
        try {
            return await fn();
        } finally {
            if (setLoading) {
                setLoading((prev) => {
                    const next = { ...prev };
                    delete next[clientId];
                    return next;
                });
            }
        }
    };

    const handleDuplicateJob = useCallback((client: ClientObligation, data: any, obligationType?: string) => {
        const d = getD();
        const duplicateState = (data.jobState || 'waiting') as FilingJobState;
        d.setActiveJobs((prev) => ({
            ...prev,
            [client.id]: {
                id: data.jobId,
                state: duplicateState,
                progress: prev[client.id]?.id === data.jobId ? prev[client.id].progress : 0,
                message: data.message || 'A filing is already queued or active.',
                failedReason: '',
                obligationType,
            },
        }));
        console.log(data.message || `A filing is already queued or active for ${client.name}.`);
    }, []);

    const generatePayrollZip = useCallback(async (client: ClientObligation): Promise<any> => {
        const d = getD();
        const sourceUrl = client.masterFileUrl || client.payrollSourceUrl;
        if (!sourceUrl) throw new Error(`${client.name} does not have a stored payroll CSV yet.`);

        const sourceResponse = await apiFetch(`/clients/${client.id}/master-csv-download`, { cache: 'no-store' });
        if (!sourceResponse.ok) throw new Error(`Could not load the stored payroll CSV for ${client.name}.`);

        const payrollFile = await sourceResponse.blob();
        const formData = new FormData();
        formData.append('payrollFile', payrollFile, `${client.name.replace(/\s+/g, '_')}_Unified_Payroll.csv`);
        formData.append('generatePaye', 'true');
        formData.append('generateNssf', 'true');
        formData.append('generateSha', 'true');
        formData.append('clientName', client.name);
        formData.append('clientId', client.id);

        const response = await apiFetch('/payroll/generate-unified', { method: 'POST', body: formData });
        if (!response.ok) {
            const errorPayload = await response.json().catch(async () => ({ error: await response.text().catch(() => 'Failed to generate payroll ZIP.') }));
            throw new Error(errorPayload.error || 'Failed to generate payroll ZIP.');
        }

        const data = await response.json();
        const updatedClient = {
            ...markPayrollStatusesGenerated(client),
            payeZipUrl: data.paye?.url,
            payeZipLabel: data.paye?.label,
            nssfFileUrl: data.nssf?.url,
            nssfFileLabel: data.nssf?.label,
            shaFileUrl: data.sha?.url,
            shaFileLabel: data.sha?.label,
        };
        d.setClients((current) => current.map((existingClient) => (
            existingClient.id === client.id ? updatedClient : existingClient
        )));
        if (d.setSelectedClient) d.setSelectedClient((prev: ClientObligation | null) => prev?.id === client.id ? updatedClient : prev);
        return data;
    }, []);

    const generateClientZip = useCallback(async (client: ClientObligation) => {
        const d = getD();
        await withLoading(client.id, d.setGeneratingClientIds, async () => {
            console.log(`Generating payroll ZIP for ${client.name}...`);
            try {
                await generatePayrollZip(client);
                d.setDashboardNotice({ tone: 'success', message: `Saved the latest payroll ZIP for ${client.name} to the workspace.` });
            } catch (e: any) {
                d.setDashboardNotice({ tone: 'error', message: e.message || `Failed to generate payroll ZIP for ${client.name}.` });
            }
        });
    }, [generatePayrollZip]);

    const generateAllZips = useCallback(async (payrollClients: ClientObligation[]) => {
        const d = getD();
        const clientsWithSources = payrollClients.filter((client) => Boolean(client.masterFileUrl || client.payrollSourceUrl));
        if (clientsWithSources.length === 0) {
            d.setDashboardNotice({ tone: 'error', message: 'Add or seed at least one payroll CSV before generating ZIPs.' });
            return;
        }
        if (d.setIsGeneratingZips) d.setIsGeneratingZips(true);
        console.log(`Generating payroll ZIPs for ${clientsWithSources.length} client${clientsWithSources.length === 1 ? '' : 's'}...`);

        try {
            const batchSize = 5;
            for (let i = 0; i < clientsWithSources.length; i += batchSize) {
                const batch = clientsWithSources.slice(i, i + batchSize);
                await Promise.all(batch.map(async (client) => {
                    if (d.setGeneratingClientIds) d.setGeneratingClientIds((prev) => ({ ...prev, [client.id]: true }));
                    try { await generatePayrollZip(client); } catch (e) { console.error('Failed for client', client.name, e); }
                    finally {
                        if (d.setGeneratingClientIds) {
                            d.setGeneratingClientIds((prev) => { const next = { ...prev }; delete next[client.id]; return next; });
                        }
                    }
                }));
            }
            d.setDashboardNotice({ tone: 'success', message: `Generated ${clientsWithSources.length} payroll ZIP${clientsWithSources.length === 1 ? '' : 's'} and saved the latest copies in the workspace.` });
        } catch (error) {
            d.setDashboardNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to generate the payroll ZIPs.' });
        } finally {
            if (d.setIsGeneratingZips) d.setIsGeneratingZips(false);
            if (d.setGeneratingClientIds) d.setGeneratingClientIds({});
        }
    }, [generatePayrollZip]);

    const autoFile = useCallback(async (client: ClientObligation) => {
        const d = getD();
        const activeJobs = d.getActiveJobs();
        try {
            if (isPendingFilingJob(activeJobs[client.id])) {
                console.log(`A filing is already ${activeJobs[client.id].state === 'active' ? 'in progress' : 'queued'} for ${client.name}.`);
                return;
            }

            let activeClient = client;
            if (activeClient.masterFileUrl || activeClient.payrollSourceUrl) {
                console.log(`Generating required ZIP files before filing for ${client.name}...`);
                const sourceUrl = activeClient.masterFileUrl || activeClient.payrollSourceUrl;
                const sourceResponse = await fetch(sourceUrl as string, { cache: 'no-store' });
                if (!sourceResponse.ok) throw new Error(`Could not load payroll CSV`);
                const payrollFile = await sourceResponse.blob();

                const formData = new FormData();
                formData.append('payrollFile', payrollFile, `${client.name.replace(/\s+/g, '_')}_Unified_Payroll.csv`);
                formData.append('generatePaye', 'true');
                formData.append('generateNssf', 'true');
                formData.append('generateSha', 'true');
                formData.append('clientName', client.name);
                formData.append('clientId', client.id);

                const response = await apiFetch('/payroll/generate-unified', { method: 'POST', body: formData });
                if (!response.ok) throw new Error('Failed to generate payroll ZIP.');
                const data = await response.json();

                activeClient = { ...activeClient, payeZipUrl: data.paye?.url };
                d.setClients((current) => current.map((c) => (c.id === client.id ? { ...c, payeZipUrl: data.paye?.url } : c)));
            }

            if (!activeClient.payeZipUrl) throw new Error("No PAYE ZIP available to upload.");

            console.log(`Dispatching KRA filing job for ${client.name}...`);
            const { periodFrom, periodTo } = getCurrentFilingPeriod('paye');
            const payload = {
                clientId: activeClient.id,
                kraPin: activeClient.pin,
                kraPassword: activeClient.password || activeClient.iTaxPassword || "1234",
                periodFrom,
                periodTo,
                taxObligationType: "paye",
                payeZipUrl: activeClient.payeZipUrl,
                ownsRentalProperty: false
            };

            const res = await apiFetch('/tax/file-return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const dataResp = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) { handleDuplicateJob(client, dataResp); return; }
                throw new Error(dataResp.message || dataResp.error || 'Failed to queue filing job.');
            }

            d.setDashboardNotice({ tone: 'success', message: `Auto-filing job queued successfully for ${client.name}.` });
            d.setActiveJobs((prev) => ({ ...prev, [client.id]: { id: dataResp.jobId, state: (dataResp.jobState || 'waiting') as FilingJobState, progress: 0, message: 'Queueing job...', failedReason: '', obligationType: 'paye' } }));
        } catch (e: any) {
            d.setDashboardNotice({ tone: 'error', message: e.message });
        }
    }, [handleDuplicateJob]);

    const prepareVat = useCallback(async (client: ClientObligation) => {
        const d = getD();
        const activeJobs = d.getActiveJobs();
        const vatPreviousCreditVal = d.getVatPreviousCreditVals()[client.id] || '';
        const vatSectionBWithoutPinVal = d.getVatSectionBWithoutPinVals()[client.id] || '';
        try {
            if (isPendingFilingJob(activeJobs[client.id])) {
                console.log(`A VAT job is already ${activeJobs[client.id].state === 'active' ? 'in progress' : 'queued'} for ${client.name}.`);
                return;
            }
            const previousCredit = !vatPreviousCreditVal.trim() ? 0 : parseFloat(vatPreviousCreditVal);
            if (!Number.isFinite(previousCredit) || previousCredit < 0) throw new Error(`Enter a valid non-negative VAT credit value for ${client.name}.`);
            const sectionBWithoutPinSales = !vatSectionBWithoutPinVal.trim() ? 0 : parseFloat(vatSectionBWithoutPinVal);
            if (!Number.isFinite(sectionBWithoutPinSales) || sectionBWithoutPinSales < 0) throw new Error(`Enter a valid non-negative Section B Without PIN sales amount for ${client.name}.`);

            const { periodFrom, periodTo } = getCurrentFilingPeriod('vat');

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: client.id,
                    clientName: client.name,
                    kraPin: client.pin,
                    kraPassword: client.password || client.iTaxPassword || client.pin,
                    periodFrom,
                    periodTo,
                    taxObligationType: 'vat',
                    ownsRentalProperty: false,
                    prepareVatOnly: true,
                    vatPreviousCredit: previousCredit,
                    sectionBWithoutPinSales: sectionBWithoutPinSales > 0 ? sectionBWithoutPinSales : undefined,
                }),
            });

            const dataResp = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) { handleDuplicateJob(client, dataResp, 'vat'); return; }
                throw new Error(dataResp.message || dataResp.error || 'Failed to queue VAT ZIP generation job.');
            }

            d.setActiveJobs((prev) => ({
                ...prev,
                [client.id]: {
                    id: dataResp.jobId,
                    state: (dataResp.jobState || 'waiting') as FilingJobState,
                    progress: 0,
                    message: 'Queueing VAT ZIP generation job...',
                    failedReason: '',
                    obligationType: 'vat',
                },
            }));
            d.setDashboardNotice({ tone: 'success', message: `VAT ZIP generation job queued for ${client.name}. Review the summary when it finishes, then file VAT.` });
        } catch (error: any) {
            d.setDashboardNotice({ tone: 'error', message: error.message || `Failed to prepare VAT for ${client.name}.` });
        }
    }, [handleDuplicateJob]);

    const confirmVatFiling = useCallback(async (client: ClientObligation) => {
        const d = getD();
        const activeJobs = d.getActiveJobs();
        const vatPreviousCreditVal = d.getVatPreviousCreditVals()[client.id] || '';
        try {
            if (isPendingFilingJob(activeJobs[client.id])) {
                console.log(`A VAT job is already ${activeJobs[client.id].state === 'active' ? 'in progress' : 'queued'} for ${client.name}.`);
                return;
            }
            const effectiveVatZipUrl = client.vatZipUrl ?? activeJobs[client.id]?.generatedZipUrl;
            if (!effectiveVatZipUrl) throw new Error(`Generate VAT ZIP for ${client.name} before filing.`);

            const previousCredit = !vatPreviousCreditVal.trim() ? 0 : parseFloat(vatPreviousCreditVal);
            if (!Number.isFinite(previousCredit) || previousCredit < 0) throw new Error(`Enter a valid non-negative VAT credit value for ${client.name}.`);

            const { periodFrom, periodTo } = getCurrentFilingPeriod('vat');
            console.log(`Filing VAT for ${client.name} with the generated ZIP.`);

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: client.id,
                    clientName: client.name,
                    kraPin: client.pin,
                    kraPassword: client.password || client.iTaxPassword || client.pin,
                    periodFrom,
                    periodTo,
                    taxObligationType: 'vat',
                    ownsRentalProperty: false,
                    vatZipUrl: effectiveVatZipUrl,
                }),
            });

            const dataResp = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) { handleDuplicateJob(client, dataResp, 'vat'); return; }
                throw new Error(dataResp.message || dataResp.error || 'Failed to queue VAT auto filing job.');
            }

            d.setActiveJobs((prev) => ({
                ...prev,
                [client.id]: {
                    id: dataResp.jobId,
                    state: (dataResp.jobState || 'waiting') as FilingJobState,
                    progress: 0,
                    message: 'Queueing VAT auto filing job...',
                    failedReason: '',
                    obligationType: 'vat',
                },
            }));
            d.setDashboardNotice({ tone: 'success', message: `VAT auto filing job queued for ${client.name}. The worker will upload the generated ZIP and generate the PRN after filing.` });
        } catch (error: any) {
            d.setDashboardNotice({ tone: 'error', message: error.message || `Failed to confirm VAT filing for ${client.name}.` });
        }
    }, [handleDuplicateJob]);

    const generatePrn = useCallback(async (client: ClientObligation, type: string) => {
        const d = getD();
        console.log(`Queuing PRN Generation for ${client.name} (${type})...`);
        try {
            const taxObligationMap: Record<string, string> = { 'PAYE': 'paye', 'TOT': 'turnover_tax', 'MRI': 'monthly_rental_income', 'VAT': 'vat' };
            const { periodFrom, periodTo } = getCurrentFilingPeriod(taxObligationMap[type]);
            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: client.id,
                    kraPin: client.pin,
                    kraPassword: client.password || client.iTaxPassword || "1234",
                    periodFrom,
                    periodTo,
                    taxObligationType: taxObligationMap[type],
                    printPrnOnly: true
                }),
            });
            if (!res.ok) { const data = await res.json(); throw new Error(data.message || `Failed to queue ${type} PRN generation.`); }
            const rData = await res.json();
            const obligationType = taxObligationMap[type] || type.toLowerCase();
            d.setActiveJobs((prev) => ({ ...prev, [client.id]: { id: rData.jobId, state: 'waiting', progress: 0, message: 'Queueing PRN job...', receiptUrl: undefined, prnUrl: undefined, obligationType } }));
            d.setDashboardNotice({ tone: 'success', message: `${type} PRN generation queued for ${client.name}.` });
        } catch (e: any) {
            d.setDashboardNotice({ tone: 'error', message: e.message });
        }
    }, []);

    const fileNssf = useCallback(async (client: ClientObligation) => {
        const d = getD();
        if (!client.nssfFileUrl || !client.masterFileUrl) {
            d.setDashboardNotice({ tone: 'error', message: `No NSSF File or Master CSV available for ${client.name}. Please generate ZIP first.` });
            return;
        }
        console.log(`Starting NSSF Auto-filing for ${client.name}...`);
        try {
            const res = await apiFetch('/tax/file-nssf-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nssfFileUrl: client.nssfFileUrl, masterFileUrl: client.masterFileUrl, period: getCurrentFilingPeriod('nssf').mmSlashYYYY }),
            });
            const dataResp = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) { handleDuplicateJob(client, dataResp); return; }
                throw new Error(dataResp.message || dataResp.error || 'Failed to file NSSF.');
            }
            d.setActiveJobs((prev) => ({ ...prev, [client.id]: { id: dataResp.jobId, state: 'waiting', progress: 0, message: 'Job queued...', failedReason: '', obligationType: 'nssf' } }));
            d.setDashboardNotice({ tone: 'success', message: `NSSF auto-filing queued successfully for ${client.name}.` });
        } catch (e: any) {
            d.setDashboardNotice({ tone: 'error', message: e.message });
        }
    }, [handleDuplicateJob]);

    const fileNil = useCallback(async (client: ClientObligation) => {
        const d = getD();
        const nilSelections = d.getNilSelections();
        const sel = nilSelections[client.id];
        if (!sel || !sel.type || !sel.periodFrom || !sel.periodTo) {
            d.setDashboardNotice({ tone: 'error', message: `Please specify the obligation type and period for ${client.name}.` });
            return;
        }
        console.log(`Starting Nil Auto-filing for ${client.name}... `);
        try {
            let totYear, totMonth;
            if (sel.type === 'turnover_tax' && sel.periodFrom) {
                const parts = sel.periodFrom.includes('-') ? sel.periodFrom.split('-') : sel.periodFrom.split('/');
                totYear = sel.periodFrom.includes('-') ? parseInt(parts[0], 10) : parseInt(parts[2], 10);
                totMonth = sel.periodFrom.includes('-') ? parseInt(parts[1], 10) : parseInt(parts[1], 10);
            }
            const payload = {
                clientId: client.id,
                kraPin: client.pin,
                kraPassword: client.password || client.iTaxPassword || client.pin,
                periodFrom: sel.periodFrom,
                periodTo: sel.periodTo,
                taxObligationType: sel.type,
                ownsRentalProperty: (sel.type === 'income_tax_resident_individual' || sel.type === 'income_tax_non_resident_individual') ? !!sel.ownsRentalProperty : false,
                isNil: true,
                ...(totYear && totMonth && { totYear, totMonth }),
            };
            const res = await apiFetch('/tax/file-return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const dataResp = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) {
                    d.setActiveJobs((prev) => ({ ...prev, [client.id]: { id: dataResp.jobId, state: dataResp.jobState || 'waiting', progress: 0, message: 'Reconnected to running job.', obligationType: sel.type, isNil: true } }));
                    console.log('Reconnected to an existing Nil job.');
                } else {
                    throw new Error(dataResp.message || 'Auto-file request failed');
                }
            } else if (dataResp.jobId) {
                d.setActiveJobs((prev) => ({ ...prev, [client.id]: { id: dataResp.jobId, state: dataResp.jobState || 'waiting', progress: 0, message: 'Starting...', obligationType: sel.type, isNil: true } }));
                d.setDashboardNotice({ tone: 'success', message: 'Nil Auto-file queued successfully.' });
            }
        } catch (err: any) {
            d.setDashboardNotice({ tone: 'error', message: err.message || 'Failed to trigger Nil return' });
        }
    }, []);

    const fileMri = useCallback(async (client: ClientObligation) => {
        const d = getD();
        const amountStr = d.getMriInputVals()[client.id];
        const amount = amountStr ? parseFloat(amountStr) : 0;
        if (isNaN(amount) || amount <= 0) {
            d.setDashboardNotice({ tone: 'error', message: `Please enter a valid rental income amount for ${client.name}.` });
            return;
        }
        console.log(`Starting MRI Auto-filing for ${client.name}... `);
        try {
            const isNilMri = amount === 0;
            const { periodFrom, periodTo } = getCurrentFilingPeriod('monthly_rental_income');
            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: client.id,
                    kraPin: client.pin,
                    kraPassword: client.password || client.iTaxPassword || client.pin,
                    periodFrom,
                    periodTo,
                    taxObligationType: "monthly_rental_income",
                    ownsRentalProperty: true,
                    rentalIncomeAmount: amount,
                    isNil: isNilMri,
                }),
            });
            const dataResp = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) {
                    d.setActiveJobs((prev) => ({ ...prev, [client.id]: { id: dataResp.jobId, state: dataResp.jobState || 'waiting', progress: 0, message: 'Reconnected to running job.', obligationType: 'monthly_rental_income' } }));
                    console.log('Reconnected to an existing MRI job.');
                } else { throw new Error(dataResp.message || 'Auto-file request failed'); }
            } else if (dataResp.jobId) {
                d.setActiveJobs((prev) => ({ ...prev, [client.id]: { id: dataResp.jobId, state: 'waiting', progress: 0, message: 'MRI Job queued...', obligationType: 'monthly_rental_income' } }));
                d.setDashboardNotice({ tone: 'success', message: 'MRI filing job started successfully.' });
            }
        } catch (error) {
            console.error('Auto-file error:', error);
            d.setDashboardNotice({ tone: 'error', message: `Failed to queue MRI filing for ${client.name}.` });
        }
    }, []);

    const fileTot = useCallback(async (client: ClientObligation) => {
        const d = getD();
        const amountStr = d.getTotInputVals()[client.id];
        const amount = amountStr ? parseFloat(amountStr) : 0;
        if (isNaN(amount) || amount <= 0) {
            d.setDashboardNotice({ tone: 'error', message: `Please enter a valid turnover amount for ${client.name}.` });
            return;
        }
        console.log(`Starting TOT Auto-filing for ${client.name}... `);
        try {
            const currentDate = new Date();
            currentDate.setMonth(currentDate.getMonth() - 1);
            const year = currentDate.getFullYear();
            const isNilTot = amount === 0;
            const { periodFrom, periodTo } = getCurrentFilingPeriod('turnover_tax');
            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: client.id,
                    kraPin: client.pin,
                    kraPassword: client.password || client.iTaxPassword || client.pin,
                    periodFrom,
                    periodTo,
                    taxObligationType: "turnover_tax",
                    totTurnover: amount,
                    totYear: year,
                    totMonth: currentDate.getMonth() + 1,
                    isNil: isNilTot
                }),
            });
            const dataResp = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) {
                    d.setActiveJobs((prev) => ({ ...prev, [client.id]: { id: dataResp.jobId, state: dataResp.jobState || 'waiting', progress: 0, message: 'Reconnected to running job.', obligationType: 'turnover_tax' } }));
                    console.log('Reconnected to an existing TOT job.');
                } else { throw new Error(dataResp.message || 'Auto-file request failed'); }
            } else if (dataResp.jobId) {
                d.setActiveJobs((prev) => ({ ...prev, [client.id]: { id: dataResp.jobId, state: 'waiting', progress: 0, message: 'TOT Job queued...', obligationType: 'turnover_tax' } }));
                d.setDashboardNotice({ tone: 'success', message: 'TOT filing job started successfully.' });
            }
        } catch (error) {
            console.error('Auto-file error:', error);
            d.setDashboardNotice({ tone: 'error', message: `Failed to queue TOT filing for ${client.name}.` });
        }
    }, []);

    const generateTotZip = useCallback(async (client: ClientObligation) => {
        const d = getD();
        const turnoverVal = d.getTotInputVals()[client.id];
        if (!turnoverVal || isNaN(parseFloat(turnoverVal))) {
            d.setDashboardNotice({ tone: 'error', message: 'Please enter a valid gross sales/turnover amount first.' });
            return;
        }
        try {
            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth() === 0 ? 12 : today.getMonth();
            const yearP = month === 12 ? year - 1 : year;
            const response = await apiFetch('/tax/generate-tot-zip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kraPin: client.pin, year: yearP, month, turnover: parseFloat(turnoverVal), clientName: client.name }),
            });
            if (!response.ok) { const errResult = await response.json().catch(() => ({})); throw new Error(errResult.error || 'Failed to generate TOT ZIP'); }
            const data = await response.json();
            d.setClients((current) => current.map((existingClient) => (
                existingClient.id === client.id
                    ? { ...existingClient, tot: 'generated' as const, lastGeneratedAt: new Date().toISOString(), totZipUrl: data.totInfo?.url, totZipLabel: data.totInfo?.label }
                    : existingClient
            )));
            d.setDashboardNotice({ tone: 'success', message: `Successfully generated TOT return ZIP for ${client.name}` });
        } catch (error) {
            console.error('TOT generation error:', error);
            d.setDashboardNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Error generating TOT.' });
        }
    }, []);

    const cancelAutoFile = useCallback(async (client: ClientObligation) => {
        const d = getD();
        const activeJobs = d.getActiveJobs();
        const activeJob = activeJobs[client.id];
        if (!activeJob || isTerminalFilingJob(activeJob)) return;
        if (d.setCancellingClientIds) d.setCancellingClientIds((current) => ({ ...current, [client.id]: true }));
        try {
            const response = await apiFetch(`/tax/filing-status/${activeJob.id}/cancel`, { method: 'POST' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || 'Failed to cancel the filing job.');
            const nextState = (data.jobState || (activeJob.state === 'active' ? 'cancelling' : 'cancelled')) as FilingJobState;
            d.setActiveJobs((current) => ({ ...current, [client.id]: { ...current[client.id], state: nextState, message: data.message || (nextState === 'cancelled' ? 'Job cancelled before processing started.' : 'Cancellation requested. Waiting for the worker to stop.') } }));
            console.log(data.message || (nextState === 'cancelled' ? `Cancelled the queued filing for ${client.name}.` : `Cancellation requested for ${client.name}.`));
        } catch (error) {
            d.setDashboardNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to cancel the filing job.' });
        } finally {
            if (d.setCancellingClientIds) { d.setCancellingClientIds((current) => { const next = { ...current }; delete next[client.id]; return next; }); }
        }
    }, []);

    const uploadMasterCsv = useCallback(async (clientId: string, file: File, options?: { propagateError?: boolean }) => {
        const d = getD();
        if (d.setUploadingClientIds) d.setUploadingClientIds((prev) => ({ ...prev, [clientId]: true }));
        try {
            const formData = new FormData();
            formData.append('masterCsv', file);
            const res = await apiFetch(`/clients/${clientId}/master-csv`, { method: 'POST', body: formData });
            const payload = await res.json().catch(async () => ({ message: await res.text().catch(() => '') }));
            if (!res.ok) {
                const message = payload.message || payload.error || 'Failed to upload CSV.';
                d.setDashboardNotice({ tone: 'error', message });
                if (options?.propagateError) throw new Error(message);
                return payload;
            }
            const message = payload.fallbackReason ? `${payload.message} ${payload.fallbackReason}` : (payload.message || 'Master CSV uploaded securely.');
            d.setDashboardNotice({ tone: 'success', message });
            return payload;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Upload error.';
            d.setDashboardNotice({ tone: 'error', message });
            if (options?.propagateError) throw err;
        } finally {
            if (d.setUploadingClientIds) { d.setUploadingClientIds((current) => { const next = { ...current }; delete next[clientId]; return next; }); }
        }
    }, []);

    const removeMasterCsv = useCallback(async (clientId: string) => {
        const res = await apiFetch(`/clients/${clientId}/master-csv`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to remove Master CSV.');
    }, []);

    const bulkCsvUpload = useCallback((fetchClients: () => void) => async (event: React.ChangeEvent<HTMLInputElement>) => {
        const d = getD();
        const file = event.target.files?.[0];
        if (!file) return;
        console.log('Uploading bulk clients CSV...');
        try {
            const formData = new FormData();
            formData.append('clientsCsv', file);
            const res = await apiFetch('/clients/bulk', { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok) {
                d.setDashboardNotice({ tone: 'success', message: data.message || 'Successfully uploaded bulk clients CSV.' });
                fetchClients();
            } else {
                d.setDashboardNotice({ tone: 'error', message: data.message || 'Failed to upload bulk clients.' });
            }
        } catch (error) {
            console.error('Bulk client upload error:', error);
            d.setDashboardNotice({ tone: 'error', message: 'Error communicating with the server during bulk import.' });
        } finally {
            if (event.target) event.target.value = '';
        }
    }, []);

    const globalMasterCsvUpload = useCallback(async (file: File) => {
        const d = getD();
        if (d.setIsGlobalUploading) d.setIsGlobalUploading(true);
        console.log('Analyzing Master CSV...');
        try {
            const formData = new FormData();
            formData.append('payrollFile', file);
            formData.append('generatePaye', 'true');
            formData.append('generateNssf', 'true');
            formData.append('generateSha', 'true');
            const response = await apiFetch('/payroll/generate-unified', { method: 'POST', body: formData });
            if (!response.ok) { const errData = await response.json().catch(() => ({})); throw new Error(errData.error || 'Failed to generate unified payroll files.'); }
            const data = await response.json();
            if (data.masterZipUrl) {
                const a = document.createElement('a');
                a.href = data.masterZipUrl;
                a.download = data.masterZipUrl.split('/').pop() || 'Payroll_Auto_Generated.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
            d.setDashboardNotice({ tone: 'success', message: 'Auto-generated payroll files successfully downloaded!' });
        } catch (error: any) {
            d.setDashboardNotice({ tone: 'error', message: error.message || 'Error processing the Master CSV.' });
        } finally {
            if (d.setIsGlobalUploading) d.setIsGlobalUploading(false);
        }
    }, []);

    const updateSingleStatus = useCallback(async (clientId: string, field: 'paye' | 'nssf' | 'sha', newStatus: TaxStatus) => {
        // Update backend first
        try {
            const res = await apiFetch(`/clients/${clientId}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ field, status: newStatus }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || data.error || 'Failed to update status');
            }
        } catch (error) {
            const d = getD();
            d.setDashboardNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to update status' });
            return;
        }
        const d = getD();
        d.setClients((current) => current.map((c) => (c.id === clientId ? { ...c, [field]: newStatus } : c)));
        d.setDashboardNotice({ tone: 'success', message: `Updated ${field.toUpperCase()} status.` });
    }, []);

    const generatePayrollCompliance = useCallback(async (client: ClientObligation, runId: number) => {
        const d = getD();
        console.log(`Generating compliance files for ${client.name}...`);
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}/generate-compliance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ generatePaye: true, generateNssf: true, generateSha: true }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to generate compliance files.');
            const updatedClient = {
                ...client,
                payeZipUrl: data.payeZipUrl,
                payeZipLabel: data.payeZipLabel,
                nssfFileUrl: data.nssfFileUrl,
                nssfFileLabel: data.nssfFileLabel,
                shaFileUrl: data.shaFileUrl,
                shaFileLabel: data.shaFileLabel,
                payeAmount: data.summaryAmounts?.payeAmount,
                nitaAmount: data.summaryAmounts?.nitaAmount,
                housingLevyAmount: data.summaryAmounts?.housingLevyAmount,
                nssfAmount: data.summaryAmounts?.nssfAmount,
                shaAmount: data.summaryAmounts?.shaAmount,
            };
            d.setClients((current) => current.map((c) => (c.id === client.id ? updatedClient : c)));
            if (d.setSelectedClient) d.setSelectedClient((prev) => prev?.id === client.id ? updatedClient : prev);
            d.setDashboardNotice({ tone: 'success', message: `Compliance files generated for ${client.name}.` });
            return data;
        } catch (err: any) {
            d.setDashboardNotice({ tone: 'error', message: err.message || 'Failed to generate compliance files.' });
        }
    }, []);

    return {
        generateClientZip,
        generateAllZips,
        autoFile,
        prepareVat,
        confirmVatFiling,
        generatePrn,
        fileNssf,
        fileNil,
        fileMri,
        fileTot,
        generateTotZip,
        cancelAutoFile,
        uploadMasterCsv,
        removeMasterCsv,
        bulkCsvUpload,
        globalMasterCsvUpload,
        updateSingleStatus,
        generatePayrollCompliance,
    };
}
