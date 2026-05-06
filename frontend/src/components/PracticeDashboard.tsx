import { useState, useEffect } from 'react';
import CompanyDetails from './CompanyDetails';
import { Sidebar } from './dashboard/Sidebar';
import { useUIStore } from '../store/uiStore';
import { 
    DashboardView, PlanKey, PracticePlan, TaxStatus, VatPreparationSummary, 
    ClientObligation, FilingJobState, ActiveDashboardJob 
} from '../types';
import { 
    normalizeClientObligation, buildStoredArtifactUrl, getPreviousMonthIsoRange, 
    formatTaxAmount, isSameMoney, getReceiptUrlForObligation, isPendingFilingJob, 
    isTerminalFilingJob, getAutoFileLabel, getFilingStatusLabel, getFilingProgressTone, 
    isPayrollDeskClient, markPayrollStatusesGenerated 
} from '../utils/formatters';
import { StatusBadge, InteractiveStatusBadge } from './ui/StatusBadge';
import { ExcelIcon, ZipIcon } from './icons';
import { NewClientModal } from './dashboard/NewClientModal';
import { ClientTable } from './dashboard/ClientTable';
import {
    Activity,
    Building2,
    CalendarClock,
    CheckCircle2,
    Clock,
    LayoutDashboard,
    LogOut,
    Menu,
    Plus,
    Search,
    ShieldAlert,
    TerminalSquare,
    UploadCloud,
    Users,
    X,
    FileSpreadsheet,
    FileArchive,
    PlayCircle,
    RefreshCw,
    Rocket,
  Upload,
  Cloud,
    Download,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const plans: Record<PlanKey, PracticePlan> = {
    starter: { label: 'Practice Starter', capacity: 10, used: 8 },
    growth: { label: 'Growing Firm', capacity: 50, used: 42 },
    enterprise: { label: 'Enterprise Desk', capacity: 'Unlimited', used: 142 },
};

const apiFetch = (path: string, init?: RequestInit) => fetch(`/api${path}`, init);

const TAX_OBLIGATION_OPTIONS = [
    { value: 'income_tax_resident_individual', label: 'Income Tax - Resident Individual (Nil)', filingMode: 'nil' },
    { value: 'income_tax_non_resident_individual', label: 'Income Tax - Non-Resident Individual (Nil)', filingMode: 'nil' },
    { value: 'income_tax_company', label: 'Income Tax - Company (Nil)', filingMode: 'nil' },
    { value: 'vat', label: 'Value Added Tax (Nil)', filingMode: 'nil' },
    { value: 'paye', label: 'PAYE (Nil)', filingMode: 'nil' },
    { value: 'turnover_tax', label: 'Turnover Tax (Nil)', filingMode: 'nil' },
    { value: 'monthly_rental_income', label: 'Monthly Rental Income (Nil)', filingMode: 'nil' }
];

export default function PracticeDashboard() {
    const { view, setView, monthlyReturnFilter, setMonthlyReturnFilter, isSidebarOpen, setIsSidebarOpen, selectedPlan, setSelectedPlan } = useUIStore();
    const [clients, setClients] = useState<ClientObligation[]>([]);
    const [selectedClient, setSelectedClient] = useState<ClientObligation | null>(null);
    const [isGeneratingZips, setIsGeneratingZips] = useState(false);
    const [isGlobalUploading, setIsGlobalUploading] = useState(false);
// @ts-ignore
const [etimsConnections, setEtimsConnections] = useState<Record<string, boolean>>({});
// @ts-ignore
const [etimsModalClient, setEtimsModalClient] = useState<any>(null);
// @ts-ignore
const [etimsPassword, setEtimsPassword] = useState('');
    const [generatingClientIds, setGeneratingClientIds] = useState<Record<string, boolean>>({});
    const [activeJobs, setActiveJobs] = useState<Record<string, ActiveDashboardJob>>({});
    const [nilSelections, setNilSelections] = useState<Record<string, { type: string, periodFrom: string, periodTo: string, ownsRentalProperty?: boolean }>>({});
    const [cancellingClientIds, setCancellingClientIds] = useState<Record<string, boolean>>({});
    const [uploadingClientIds, setUploadingClientIds] = useState<Record<string, boolean>>({});
    const [dashboardNotice, setDashboardNotice] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);

    // New Client Modal State
    const [showNewClientModal, setShowNewClientModal] = useState(false);
    const [newClientObligations, setNewClientObligations] = useState<string[]>([]);
    const [newClientName, setNewClientName] = useState('');
    const [newClientPin, setNewClientPin] = useState('');
    const [newClientPassword, setNewClientPassword] = useState('');
    const [mriInputVals, setMriInputVals] = useState<Record<string, string>>({});
    const [totInputVals, setTotInputVals] = useState<Record<string, string>>({});
    const [vatPreviousCreditVals, setVatPreviousCreditVals] = useState<Record<string, string>>({});
    const [newClientMasterCsv, setNewClientMasterCsv] = useState<File | null>(null);
    const [isSavingClient, setIsSavingClient] = useState(false);
    const [newClientModalError, setNewClientModalError] = useState<string | null>(null);
    const [editingClientId, setEditingClientId] = useState<number | null>(null);

    const resetNewClientForm = () => {
        setEditingClientId(null);
        setShowNewClientModal(false);
        setNewClientName('');
        setNewClientPin('');
        setNewClientPassword('');
        setNewClientObligations([]);
        setNewClientMasterCsv(null);
        setNewClientModalError(null);
    };

    const openNewClientModal = (clientToEdit?: any) => {
        setNewClientMasterCsv(null);

        if (clientToEdit?.id) {
            setEditingClientId(clientToEdit.id);
            setNewClientName(clientToEdit.name);
            setNewClientPin(clientToEdit.pin);
            setNewClientPassword(clientToEdit.password);
            setNewClientObligations(clientToEdit.obligations ? clientToEdit.obligations.split(',').map((s: string) => normalizeClientObligation(s)).filter(Boolean) : []);
        } else {
            setEditingClientId(null);
            setNewClientName('');
            setNewClientPin('');
            setNewClientPassword('');
            setNewClientObligations([]);
        }
        setNewClientModalError(null);
        setShowNewClientModal(true);
    };

    useEffect(() => {
        fetchClients();
    }, []);

    const fetchClients = async () => {
        try {
            const res = await apiFetch('/clients');
            const data = await res.json();
            setClients(data);
        } catch (error) {
            console.error('Failed to fetch clients', error);
            setDashboardNotice({
                tone: 'error',
                message: error instanceof TypeError
                    ? 'Could not load clients because the backend API is unavailable.'
                    : 'Failed to load clients from database.',
            });
        }
    };

    const handleSaveClient = async () => {
        if (isSavingClient) {
            return;
        }

        const name = newClientName.trim();
        const pin = newClientPin.trim().toUpperCase();
        const password = newClientPassword.trim();

        if (!name || !pin || !password) {
            setNewClientModalError('Client name, KRA PIN, and KRA password are required before saving.');
            return;
        }

        setIsSavingClient(true);
        setNewClientModalError(null);

        try {
            const isEdit = editingClientId !== null;
            const url = isEdit ? `/clients/${editingClientId}` : '/clients';
            const res = await apiFetch(url, {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    pin,
                    password,
                    obligations: newClientObligations.map(normalizeClientObligation).join(', '),
                })
            });

            if (res.ok) {
                const updatedOrNewData = await res.json();
                if (newClientObligations.includes('paye') && newClientMasterCsv) {
                    setDashboardNotice({ tone: 'info', message: 'Uploading master CSV for this client...' });
                    await handleUploadMasterCsv(String(updatedOrNewData.id), newClientMasterCsv, { propagateError: true });
                    setDashboardNotice({ tone: 'success', message: isEdit ? 'Client updated and master CSV uploaded successfully.' : 'Client saved and master CSV uploaded successfully.' });
                } else {
                    setDashboardNotice({ tone: 'success', message: isEdit ? 'Client updated successfully.' : 'Client saved successfully.' });
                    await fetchClients();
                }
                resetNewClientForm();
            } else {
                const errorPayload = await res.json().catch(async () => ({
                    error: await res.text().catch(() => 'Failed to save client.'),
                }));
                const message = errorPayload.message || errorPayload.error || 'Failed to save client.';
                setNewClientModalError(message);
                setDashboardNotice({ tone: 'error', message });
            }
        } catch (error) {
            console.error('Save client error:', error);
            const message = error instanceof TypeError
                ? 'Could not reach the backend API. Start or restart the backend server on port 3001 and try again.'
                : error instanceof Error
                    ? error.message
                    : 'Failed to save client.';
            setNewClientModalError(message);
            setDashboardNotice({ tone: 'error', message });
        } finally {
            setIsSavingClient(false);
        }
    };

    const handleBulkCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setDashboardNotice({ tone: 'info', message: 'Uploading bulk clients CSV...' });

        try {
            const formData = new FormData();
            formData.append('clientsCsv', file);

            const res = await apiFetch('/clients/bulk', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (res.ok) {
                setDashboardNotice({ tone: 'success', message: data.message || 'Successfully uploaded bulk clients CSV.' });
                // Refresh client list
                const clientsRes = await apiFetch('/clients');
                if (clientsRes.ok) {
                    const clientsData = await clientsRes.json();
                    setClients(clientsData);
                }
            } else {
                setDashboardNotice({ tone: 'error', message: data.message || 'Failed to upload bulk clients.' });
            }
        } catch (error) {
            console.error('Bulk client upload error:', error);
            setDashboardNotice({ tone: 'error', message: 'Error communicating with the server during bulk import.' });
        } finally {
            // Reset input so the same file can be selected again if needed
            if (event.target) {
                event.target.value = '';
            }
        }
    };

    const handleGlobalMasterCsvUpload = async (file: File) => {
        setIsGlobalUploading(true);
        setDashboardNotice({ tone: 'info', message: 'Analyzing Master CSV...' });

        try {
            const formData = new FormData();
            formData.append('payrollFile', file);
            formData.append('generatePaye', 'true');
            formData.append('generateNssf', 'true');
            formData.append('generateSha', 'true');
            
            const response = await apiFetch('/payroll/generate-unified', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to generate unified payroll files.');
            }

            const data = await response.json();
            
            if (data.masterZipUrl) {
                const a = document.createElement('a');
                a.href = data.masterZipUrl;
                a.download = data.masterZipUrl.split('/').pop() || 'Payroll_Auto_Generated.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }

            setDashboardNotice({ tone: 'success', message: 'Auto-generated payroll files successfully downloaded!' });
            
        } catch (error: any) {
            setDashboardNotice({ tone: 'error', message: error.message || 'Error processing the Master CSV.' });
        } finally {
            setIsGlobalUploading(false);
        }
    };

    const handleUploadMasterCsv = async (clientId: string, file: File, options?: { propagateError?: boolean }) => {
        setUploadingClientIds(current => ({ ...current, [clientId]: true }));
        const formData = new FormData();
        formData.append('masterCsv', file);
        try {
            const res = await apiFetch(`/clients/${clientId}/master-csv`, {
                method: 'POST',
                body: formData
            });
            const payload = await res.json().catch(async () => ({ message: await res.text().catch(() => '') }));

            if (!res.ok) {
                const message = payload.message || payload.error || 'Failed to upload CSV.';
                setDashboardNotice({ tone: 'error', message });
                if (options?.propagateError) {
                    throw new Error(message);
                }
                return payload;
            }

            const message = payload.fallbackReason
                ? `${payload.message} ${payload.fallbackReason}`
                : (payload.message || 'Master CSV uploaded securely.');
            setDashboardNotice({ tone: 'success', message });
            await fetchClients();
            return payload;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Upload error.';
            setDashboardNotice({ tone: 'error', message });
            if (options?.propagateError) {
                throw err;
            }
        } finally {
            setUploadingClientIds(current => {
                const nextState = { ...current };
                delete nextState[clientId];
                return nextState;
            });
        }
    };

    const plan = plans[selectedPlan];
    const capacityValue = plan.capacity === 'Unlimited' ? 'Ã¢Ë†Å¾' : plan.capacity;
    const capacityPercentage = plan.capacity === 'Unlimited' ? 25 : Math.round((plan.used / (plan.capacity as number)) * 100);
    const payrollClients = clients.filter(isPayrollDeskClient);
    const payrollPendingCount = payrollClients.filter((client) => client.paye === 'due' || client.nssf === 'due' || client.sha === 'due').length;
    const taxPendingCount = clients.filter((client) => client.vat === 'due' || client.tot === 'due' || client.mri === 'due' || client.dst === 'due').length;

    const generatePayrollZip = async (client: ClientObligation) => {
        const sourceUrl = client.masterFileUrl || client.payrollSourceUrl;
        if (!sourceUrl) {
            throw new Error(`${client.name} does not have a stored payroll CSV yet.`);
        }

        const sourceResponse = await fetch(sourceUrl, { cache: 'no-store' });
        if (!sourceResponse.ok) {
            throw new Error(`Could not load the stored payroll CSV for ${client.name}.`);
        }

        const payrollFile = await sourceResponse.blob();
        const formData = new FormData();
        formData.append('payrollFile', payrollFile, `${client.name.replace(/\s+/g, '_')}_Unified_Payroll.csv`);
        formData.append('generatePaye', 'true');
        formData.append('generateNssf', 'true');
        formData.append('generateSha', 'true');
        formData.append('clientName', client.name);
        formData.append('clientId', client.id);

        const response = await apiFetch('/payroll/generate-unified', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(async () => ({ error: await response.text().catch(() => 'Failed to generate payroll ZIP.') }));
            throw new Error(errorPayload.error || 'Failed to generate payroll ZIP.');
        }

        const data = await response.json();

        setClients((current) => current.map((existingClient) => (
            existingClient.id === client.id
                ? {
                    ...markPayrollStatusesGenerated(existingClient),
                    payeZipUrl: data.paye?.url,
                    payeZipLabel: data.paye?.label,
                    nssfFileUrl: data.nssf?.url,
                    nssfFileLabel: data.nssf?.label,
                    shaFileUrl: data.sha?.url,
                    shaFileLabel: data.sha?.label,
                }
                : existingClient
        )));
    };

    const generateTotZip = async (client: ClientObligation) => {
        const val = totInputVals[client.id];
        if (!val || isNaN(parseFloat(val))) {
            setDashboardNotice({ tone: 'error', message: 'Please enter a valid gross sales/turnover amount first.'});
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
                body: JSON.stringify({
                    kraPin: client.pin,
                    year: yearP,
                    month: month,
                    turnover: parseFloat(val),
                    clientName: client.name
                })
            });
            
            if (!response.ok) {
                const errResult = await response.json().catch(() => ({}));
                throw new Error(errResult.error || 'Failed to generate TOT ZIP');
            }
            
            const data = await response.json();
            
            setClients((current) => current.map((existingClient) => (
                existingClient.id === client.id
                    ? {
                        ...existingClient,
                        tot: 'generated',
                        lastGeneratedAt: new Date().toISOString(),
                        totZipUrl: data.totInfo?.url,
                        totZipLabel: data.totInfo?.label,
                    }
                    : existingClient
            )));
            setDashboardNotice({ tone: 'success', message: `Successfully generated TOT return ZIP for ${client.name}`});
        } catch (error) {
            console.error('TOT generation error:', error);
            setDashboardNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Error generating TOT.'});
        }
    };

    const handleUpdateSingleStatus = (clientId: string, field: 'paye' | 'nssf' | 'sha', newStatus: TaxStatus) => {
        setClients(current => current.map(c => {
            if (c.id === clientId) {
                return {
                    ...c,
                    [field]: newStatus,
                };
            }
            return c;
        }));
        setDashboardNotice({ tone: 'success', message: `Updated ${field.toUpperCase()} status.` });
    };

    
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
                    const resultVatSummary = data.result?.vatSummary && typeof data.result.vatSummary === 'object'
                        ? data.result.vatSummary as VatPreparationSummary
                        : undefined;

                    if (currentJobs[clientId].state !== data.state || 
                        currentJobs[clientId].progress !== data.progress || 
                        currentJobs[clientId].message !== newMessage ||
                        currentJobs[clientId].receiptUrl !== resultReceiptUrl ||
                        currentJobs[clientId].prnUrl !== resultPrnUrl ||
                        currentJobs[clientId].generatedZipUrl !== resultGeneratedZipUrl ||
                        currentJobs[clientId].sourcePackageUrl !== resultSourcePackageUrl ||
                        currentJobs[clientId].generatedZipLabel !== data.result?.generatedZipLabel ||
                        currentJobs[clientId].sourcePackageLabel !== data.result?.sourcePackageLabel ||
                        JSON.stringify(currentJobs[clientId].vatSummary ?? null) !== JSON.stringify(resultVatSummary ?? null)) {
                        
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
                setClients((current) => current.map((client) => {
                    const update = vatClientUpdates[client.id];
                    if (!update) {
                        return client;
                    }

                    return {
                        ...client,
                        ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)),
                    };
                }));
            }
        };

        const interval = setInterval(checkJobs, 2000);
        return () => clearInterval(interval);
    }, [activeJobs]);
    
    const handleGenerateClientZip = async (client: ClientObligation) => {
        setGeneratingClientIds((current) => ({ ...current, [client.id]: true }));
        setDashboardNotice({ tone: 'info', message: `Generating payroll ZIP for ${client.name}...` });

        try {
            await generatePayrollZip(client);
            setDashboardNotice({ tone: 'success', message: `Saved the latest payroll ZIP for ${client.name} to the workspace.` });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to generate the payroll ZIP.';
            console.error('Error generating client payroll ZIP:', error);
            setDashboardNotice({ tone: 'error', message });
        } finally {
            setGeneratingClientIds((current) => {
                const nextState = { ...current };
                delete nextState[client.id];
                return nextState;
            });
        }
    };

    const handleGenerateAllZips = async () => {
        const clientsWithSources = payrollClients.filter((client) => Boolean(client.masterFileUrl || client.payrollSourceUrl));
        if (clientsWithSources.length === 0) {
            setDashboardNotice({ tone: 'error', message: 'Add or seed at least one payroll CSV before generating ZIPs.' });
            return;
        }

        setIsGeneratingZips(true);
        setDashboardNotice({ tone: 'info', message: `Generating payroll ZIPs for ${clientsWithSources.length} client${clientsWithSources.length === 1 ? '' : 's'}...` });

        try {
            const batchSize = 5;
            for (let i = 0; i < clientsWithSources.length; i += batchSize) {
                const batch = clientsWithSources.slice(i, i + batchSize);
                await Promise.all(batch.map(async (client) => {
                    setGeneratingClientIds((current) => ({ ...current, [client.id]: true }));
                    try {
                        await generatePayrollZip(client);
                    } catch (e) {
                        console.error('Failed for client', client.name, e);
                    } finally {
                        setGeneratingClientIds((current) => {
                            const nextState = { ...current };
                            delete nextState[client.id];
                            return nextState;
                        });
                    }
                }));
            }

            setDashboardNotice({ tone: 'success', message: `Generated ${clientsWithSources.length} payroll ZIP${clientsWithSources.length === 1 ? '' : 's'} and saved the latest copies in the workspace.` });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to generate the payroll ZIPs.';
            console.error('Error generating payroll ZIPs:', error);
            setDashboardNotice({ tone: 'error', message });
        } finally {
            setGeneratingClientIds({});
            setIsGeneratingZips(false);
        }
    };


    const handleAutoFile = async (client: ClientObligation) => {
        try {
            if (isPendingFilingJob(activeJobs[client.id])) {
                setDashboardNotice({
                    tone: 'info',
                    message: `A filing is already ${activeJobs[client.id].state === 'active' ? 'in progress' : 'queued'} for ${client.name}.`,
                });
                return;
            }

            let activeClient = client;
            if (activeClient.masterFileUrl || activeClient.payrollSourceUrl) {
                setDashboardNotice({ tone: 'info', message: `Generating required ZIP files before filing for ${client.name}...` });
                
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

                const response = await apiFetch('/payroll/generate-unified', {
                    method: 'POST',
                    body: formData,
                });
                
                if (!response.ok) throw new Error('Failed to generate payroll ZIP.');
                const data = await response.json();
                
                activeClient = {
                    ...activeClient,
                    payeZipUrl: data.paye?.url
                };

                setClients((current) => current.map(c => 
                    c.id === client.id ? { ...c, payeZipUrl: data.paye?.url } : c
                ));
            }

            if (!activeClient.payeZipUrl) {
                throw new Error("No PAYE ZIP available to upload.");
            }

            setDashboardNotice({ tone: 'info', message: `Dispatching KRA filing job for ${client.name}...` });
            
            const payload = {
                kraPin: activeClient.pin,
                kraPassword: (activeClient as any).password || activeClient.iTaxPassword || "1234",
                periodFrom: "2026-01-01", // mock Date format YYYY-MM-DD
                periodTo: "2026-01-31", // mock Date format YYYY-MM-DD
                taxObligationType: "paye",
                payeZipUrl: activeClient.payeZipUrl,
                ownsRentalProperty: false
            };

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const dataResp = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) {
                    const duplicateState = (dataResp.jobState || 'waiting') as FilingJobState;
                    setActiveJobs((prev) => ({
                        ...prev,
                        [client.id]: {
                            id: dataResp.jobId,
                            state: duplicateState,
                            progress: prev[client.id]?.id === dataResp.jobId ? prev[client.id].progress : 0,
                            message: dataResp.message || 'A filing is already queued or active.',
                            failedReason: '',
                        },
                    }));
                    setDashboardNotice({ tone: 'info', message: dataResp.message || `A filing is already queued or active for ${client.name}.` });
                    return;
                }

                throw new Error(dataResp.message || dataResp.error || 'Failed to queue filing job.');
            }

            setDashboardNotice({ tone: 'success', message: `Auto-filing job queued successfully for ${client.name}.` });
            setActiveJobs((prev) => ({ ...prev, [client.id]: { id: dataResp.jobId, state: (dataResp.jobState || 'waiting') as FilingJobState, progress: 0, message: 'Queueing job...', failedReason: '' } }));
        } catch(e: any) {
            setDashboardNotice({ tone: 'error', message: e.message });
        }
    };

    const getVatPreviousCreditAmount = (client: ClientObligation) => {
        const rawValue = vatPreviousCreditVals[client.id];
        if (!rawValue || rawValue.trim().length === 0) {
            return 0;
        }

        const parsedValue = parseFloat(rawValue);
        if (!Number.isFinite(parsedValue) || parsedValue < 0) {
            throw new Error(`Enter a valid non-negative VAT credit value for ${client.name}.`);
        }

        return parsedValue;
    };

    const handlePrepareVat = async (client: ClientObligation) => {
        try {
            if (isPendingFilingJob(activeJobs[client.id])) {
                setDashboardNotice({
                    tone: 'info',
                    message: `A VAT job is already ${activeJobs[client.id].state === 'active' ? 'in progress' : 'queued'} for ${client.name}.`,
                });
                return;
            }

            const previousCredit = getVatPreviousCreditAmount(client);
            const { periodFrom, periodTo } = getPreviousMonthIsoRange();

            setDashboardNotice({ tone: 'info', message: `Generating VAT ZIP for ${client.name}. The worker will download the KRA auto-populated package first.` });

            const payload = {
                clientName: client.name,
                kraPin: client.pin,
                kraPassword: (client as any).password || client.iTaxPassword || client.pin,
                periodFrom,
                periodTo,
                taxObligationType: 'vat',
                ownsRentalProperty: false,
                prepareVatOnly: true,
                vatPreviousCredit: previousCredit,
            };

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const dataResp = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) {
                    const duplicateState = (dataResp.jobState || 'waiting') as FilingJobState;
                    setActiveJobs((prev) => ({
                        ...prev,
                        [client.id]: {
                            id: dataResp.jobId,
                            state: duplicateState,
                            progress: prev[client.id]?.id === dataResp.jobId ? prev[client.id].progress : 0,
                            message: dataResp.message || 'A VAT ZIP generation job is already queued or active.',
                            failedReason: '',
                            obligationType: 'vat',
                        },
                    }));
                    setDashboardNotice({ tone: 'info', message: dataResp.message || `A VAT ZIP generation job is already queued or active for ${client.name}.` });
                    return;
                }

                throw new Error(dataResp.message || dataResp.error || 'Failed to queue VAT ZIP generation job.');
            }

            setActiveJobs((prev) => ({
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
            setDashboardNotice({ tone: 'success', message: `VAT ZIP generation job queued for ${client.name}. Review the summary when it finishes, then file VAT.` });
        } catch (error: any) {
            setDashboardNotice({ tone: 'error', message: error.message || `Failed to prepare VAT for ${client.name}.` });
        }
    };

    const handleConfirmVatFiling = async (client: ClientObligation) => {
        try {
            if (isPendingFilingJob(activeJobs[client.id])) {
                setDashboardNotice({
                    tone: 'info',
                    message: `A VAT job is already ${activeJobs[client.id].state === 'active' ? 'in progress' : 'queued'} for ${client.name}.`,
                });
                return;
            }

            const effectiveVatZipUrl = client.vatZipUrl ?? activeJobs[client.id]?.generatedZipUrl;
            const preparedPreviousCredit = client.vatPreviousCredit ?? activeJobs[client.id]?.vatSummary?.previousCredit ?? 0;

            if (!effectiveVatZipUrl) {
                throw new Error(`Generate VAT ZIP for ${client.name} before filing.`);
            }

            const previousCredit = getVatPreviousCreditAmount(client);
            if (!isSameMoney(preparedPreviousCredit, previousCredit)) {
                throw new Error(`The VAT credit value changed for ${client.name}. Generate VAT ZIP again before filing.`);
            }

            const { periodFrom, periodTo } = getPreviousMonthIsoRange();

            setDashboardNotice({ tone: 'info', message: `Filing VAT for ${client.name} with the generated ZIP.` });

            const payload = {
                clientName: client.name,
                kraPin: client.pin,
                kraPassword: (client as any).password || client.iTaxPassword || client.pin,
                periodFrom,
                periodTo,
                taxObligationType: 'vat',
                ownsRentalProperty: false,
                vatZipUrl: effectiveVatZipUrl,
            };

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const dataResp = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) {
                    const duplicateState = (dataResp.jobState || 'waiting') as FilingJobState;
                    setActiveJobs((prev) => ({
                        ...prev,
                        [client.id]: {
                            id: dataResp.jobId,
                            state: duplicateState,
                            progress: prev[client.id]?.id === dataResp.jobId ? prev[client.id].progress : 0,
                            message: dataResp.message || 'A VAT auto filing job is already queued or active.',
                            failedReason: '',
                            obligationType: 'vat',
                        },
                    }));
                    setDashboardNotice({ tone: 'info', message: dataResp.message || `A VAT auto filing job is already queued or active for ${client.name}.` });
                    return;
                }

                throw new Error(dataResp.message || dataResp.error || 'Failed to queue VAT auto filing job.');
            }

            setActiveJobs((prev) => ({
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
            setDashboardNotice({ tone: 'success', message: `VAT auto filing job queued for ${client.name}. The worker will upload the generated ZIP and generate the PRN after filing.` });
        } catch (error: any) {
            setDashboardNotice({ tone: 'error', message: error.message || `Failed to confirm VAT filing for ${client.name}.` });
        }
    };

    const handleGeneratePrn = async (client: ClientObligation, type: string) => {
        setDashboardNotice({ tone: 'info', message: `Queuing PRN Generation for ${client.name} (${type})...` });

        try {
            const taxObligationMap: Record<string, string> = {
                'PAYE': 'paye',
                'TOT': 'turnover_tax',
                'MRI': 'monthly_rental_income',
                'VAT': 'vat'
            };

            const payload = {
                kraPin: client.pin,
                kraPassword: (client as any).password || client.iTaxPassword || "1234",
                periodFrom: '2026-04-01',
                periodTo: '2026-04-30',
                taxObligationType: taxObligationMap[type],
                printPrnOnly: true
            };

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || `Failed to queue ${type} PRN generation.`);
            }

            const rData = await res.json();
            setActiveJobs(prev => ({
                ...prev,
                [client.id]: { id: rData.jobId, state: 'waiting', progress: 0, message: 'Queueing PRN job...', receiptUrl: undefined, prnUrl: undefined }
            }));
            
            setDashboardNotice({ tone: 'success', message: `${type} PRN generation queued for ${client.name}.` });

        } catch (e: any) {
            setDashboardNotice({ tone: 'error', message: e.message });
        }
    };

    const handleAutoFileNssf = async (client: ClientObligation) => {
        if (!client.nssfFileUrl || !client.masterFileUrl) {
            setDashboardNotice({ tone: 'error', message: `No NSSF File or Master CSV available for ${client.name}. Please generate ZIP first.` });
            return;
        }

        setDashboardNotice({ tone: 'info', message: `Starting NSSF Auto-filing for ${client.name}...` });

        try {
            const payload = {
                nssfFileUrl: client.nssfFileUrl,
                masterFileUrl: client.masterFileUrl,
                period: "04/2026", // Mock or dynamic based on app state
            };

            const res = await apiFetch('/tax/file-nssf-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const dataResp = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) {
                    const duplicateState = dataResp.jobState || 'waiting';
                    setActiveJobs((prev) => ({
                        ...prev,
                        [client.id]: {
                            id: dataResp.jobId,
                            state: duplicateState,
                            progress: prev[client.id]?.id === dataResp.jobId ? prev[client.id].progress : 0,
                            message: dataResp.message || 'A filing is already queued or active.',
                            failedReason: '',
                        },
                    }));
                    setDashboardNotice({ tone: 'info', message: dataResp.message || `A filing is already queued for ${client.name}.` });
                    return;
                }
                throw new Error(dataResp.message || dataResp.error || 'Failed to file NSSF.');
            }

            setActiveJobs((prev) => ({
                ...prev,
                [client.id]: {
                    id: dataResp.jobId,
                    state: 'waiting',
                    progress: 0,
                    message: 'Job queued...',
                    failedReason: '',
                },
            }));

            setDashboardNotice({ tone: 'success', message: `NSSF auto-filing queued successfully for ${client.name}.` });
        } catch(e: any) {
            setDashboardNotice({ tone: 'error', message: e.message });
        }
    };

    const handleFileNil = async (client: ClientObligation) => {
        const sel = nilSelections[client.id];
        if (!sel || !sel.type || !sel.periodFrom || !sel.periodTo) {
            setDashboardNotice({ tone: 'error', message: `Please specify the obligation type and period for ${client.name}.` });
            return;
        }

        setDashboardNotice({ tone: 'info', message: `Starting Nil Auto-filing for ${client.name}... ` });
        try {
            let totYear, totMonth;
            if (sel.type === 'turnover_tax' && sel.periodFrom) {
                // periodFrom usually like YYYY-MM-DD or DD/MM/YYYY
                const parts = sel.periodFrom.includes('-') ? sel.periodFrom.split('-') : sel.periodFrom.split('/');
                totYear = sel.periodFrom.includes('-') ? parseInt(parts[0], 10) : parseInt(parts[2], 10);
                totMonth = sel.periodFrom.includes('-') ? parseInt(parts[1], 10) : parseInt(parts[1], 10);
            }

            const payload = {
                kraPin: client.pin,
                kraPassword: (client as any).password || client.iTaxPassword || client.pin,
                periodFrom: sel.periodFrom,
                periodTo: sel.periodTo,
                taxObligationType: sel.type,
                ownsRentalProperty: (sel.type === 'income_tax_resident_individual' || sel.type === 'income_tax_non_resident_individual') ? !!sel.ownsRentalProperty : false,
                isNil: true,
                ...(totYear && totMonth && { totYear, totMonth }),
            };

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const dataResp = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) {
                    const duplicateState = dataResp.jobState || 'waiting';
                    setActiveJobs((prev) => ({
                        ...prev,
                        [client.id]: { id: dataResp.jobId, state: duplicateState, progress: 0, message: 'Reconnected to running job.' }
                    }));
                    setDashboardNotice({ tone: 'info', message: 'Reconnected to an existing Nil job.' });
                } else {
                    throw new Error(dataResp.message || 'Auto-file request failed');
                }
            } else if (dataResp.jobId) {
                setActiveJobs((prev) => ({
                    ...prev,
                    [client.id]: { id: dataResp.jobId, state: dataResp.jobState || 'waiting', progress: 0, message: 'Starting...' }
                }));
                setDashboardNotice({ tone: 'success', message: 'Nil Auto-file queued successfully.' });
            }
        } catch (err: any) {
            setDashboardNotice({ tone: 'error', message: err.message || 'Failed to trigger Nil return' });
        }
    };

    const handleFileMri = async (client: ClientObligation) => {
        const amountStr = mriInputVals[client.id];
        const amount = amountStr ? parseFloat(amountStr) : 0;
        if (isNaN(amount) || amount <= 0) {
            setDashboardNotice({ tone: 'error', message: `Please enter a valid rental income amount for ${client.name}.` });
            return;
        }

        setDashboardNotice({ tone: 'info', message: `Starting MRI Auto-filing for ${client.name}... ` });
        try {
            const isNilMri = amount === 0;
            const payload = {
                kraPin: client.pin,
                kraPassword: (client as any).password || client.iTaxPassword || client.pin,
                periodFrom: "2026-04-01",
                periodTo: "2026-04-30",
                taxObligationType: "monthly_rental_income",
                ownsRentalProperty: true,
                rentalIncomeAmount: amount,
                isNil: isNilMri,
            };

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const dataResp = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) {
                    const duplicateState = dataResp.jobState || 'waiting';
                    setActiveJobs((prev) => ({
                        ...prev,
                        [client.id]: { id: dataResp.jobId, state: duplicateState, progress: 0, message: 'Reconnected to running job.' }
                    }));
                    setDashboardNotice({ tone: 'info', message: 'Reconnected to an existing MRI job.' });
                } else {
                    throw new Error(dataResp.message || 'Auto-file request failed');
                }
            } else if (dataResp.jobId) {
                setActiveJobs((prev) => ({
                    ...prev,
                    [client.id]: { id: dataResp.jobId, state: 'waiting', progress: 0, message: 'MRI Job queued...' }
                }));
                setDashboardNotice({ tone: 'success', message: 'MRI filing job started successfully.' });
            }
        } catch (error) {
            console.error('Auto-file error:', error);
            setDashboardNotice({ tone: 'error', message: `Failed to queue MRI filing for ${client.name}.` });
        }
    };

    const handleFileTot = async (client: ClientObligation) => {
        const amountStr = totInputVals[client.id];
        const amount = amountStr ? parseFloat(amountStr) : 0;
        if (isNaN(amount) || amount <= 0) {
            setDashboardNotice({ tone: 'error', message: `Please enter a valid turnover amount for ${client.name}.` });
            return;
        }

        setDashboardNotice({ tone: 'info', message: `Starting TOT Auto-filing for ${client.name}... ` });
        try {
            const currentDate = new Date();
            currentDate.setMonth(currentDate.getMonth() - 1);
            const year = currentDate.getFullYear();
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            const periodFrom = `${year}-${month}-01`;
            const lastDay = new Date(year, currentDate.getMonth() + 1, 0).getDate();
            const periodTo = `${year}-${month}-${lastDay}`;

            const isNilTot = amount === 0;
            const payload = {
                kraPin: client.pin,
                kraPassword: (client as any).password || client.iTaxPassword || client.pin,
                periodFrom,
                periodTo,
                taxObligationType: "turnover_tax",
                totTurnover: amount,
                totYear: year, // Keep as number
                totMonth: currentDate.getMonth() + 1, // Keep as number
                isNil: isNilTot
            };

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const dataResp = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) {
                    const duplicateState = dataResp.jobState || 'waiting';
                    setActiveJobs((prev) => ({
                        ...prev,
                        [client.id]: { id: dataResp.jobId, state: duplicateState, progress: 0, message: 'Reconnected to running job.' }
                    }));
                    setDashboardNotice({ tone: 'info', message: 'Reconnected to an existing TOT job.' });
                } else {
                    throw new Error(dataResp.message || 'Auto-file request failed');
                }
            } else if (dataResp.jobId) {
                setActiveJobs((prev) => ({
                    ...prev,
                    [client.id]: { id: dataResp.jobId, state: 'waiting', progress: 0, message: 'TOT Job queued...' }
                }));
                setDashboardNotice({ tone: 'success', message: 'TOT filing job started successfully.' });
            }
        } catch (error) {
            console.error('Auto-file error:', error);
            setDashboardNotice({ tone: 'error', message: `Failed to queue TOT filing for ${client.name}.` });
        }
    };

    const handleCancelAutoFile = async (client: ClientObligation) => {
        const activeJob = activeJobs[client.id];
        if (!activeJob || isTerminalFilingJob(activeJob)) {
            return;
        }

        setCancellingClientIds((current) => ({ ...current, [client.id]: true }));

        try {
            const response = await apiFetch(`/tax/filing-status/${activeJob.id}/cancel`, {
                method: 'POST',
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.message || 'Failed to cancel the filing job.');
            }

            const nextState = (data.jobState || (activeJob.state === 'active' ? 'cancelling' : 'cancelled')) as FilingJobState;
            setActiveJobs((current) => ({
                ...current,
                [client.id]: {
                    ...current[client.id],
                    state: nextState,
                    message: data.message || (nextState === 'cancelled'
                        ? 'Job cancelled before processing started.'
                        : 'Cancellation requested. Waiting for the worker to stop.'),
                },
            }));
            setDashboardNotice({
                tone: 'info',
                message: data.message || (nextState === 'cancelled'
                    ? `Cancelled the queued filing for ${client.name}.`
                    : `Cancellation requested for ${client.name}.`),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to cancel the filing job.';
            setDashboardNotice({ tone: 'error', message });
        } finally {
            setCancellingClientIds((current) => {
                const nextState = { ...current };
                delete nextState[client.id];
                return nextState;
            });
        }
    };

    const handleSaveClientDetails = async (updatedClient: ClientObligation) => {
        const name = updatedClient.name?.trim();
        const pin = updatedClient.pin?.trim().toUpperCase();
        const password = (updatedClient.iTaxPassword || (updatedClient as any).password || '').trim();

        if (!updatedClient.id || !name || !pin || !password) {
            throw new Error('Client name, KRA PIN, and KRA password are required before saving.');
        }

        const res = await apiFetch(`/clients/${updatedClient.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                pin,
                password,
                obligations: updatedClient.obligations || '',
                sector: updatedClient.sector || '',
            }),
        });

        const payload = await res.json().catch(async () => ({ message: await res.text().catch(() => '') }));

        if (!res.ok) {
            throw new Error(payload.message || payload.error || 'Failed to save client details.');
        }

        await fetchClients();
        setSelectedClient(payload);
        setDashboardNotice({ tone: 'success', message: 'Client details saved successfully.' });
    };

    const renderGlobalPayrollUpload = () => (
        <div className="my-4 overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-br from-slate-800/80 to-slate-900/40 shadow-sm backdrop-blur relative">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"></div>
            
            <div className="px-5 py-5 sm:px-6">
                <div className="max-w-3xl">
                    <h2 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent mb-1">Automate Your Payroll Processing</h2>
                    <p className="text-sm text-slate-400 mb-4 leading-relaxed">
                        Say goodbye to manual client entry. Upload any client's Master CSV here. We'll automatically extract the company details, create the client profile if they don't exist, and instantly generate the final PAYE, NSSF, and SHA files ready for portals.
                    </p>

                    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-stretch">
                        <label className="relative group cursor-pointer w-full sm:w-auto">
                            <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-400 opacity-20 blur transition group-hover:opacity-40"></div>
                            <div className="relative flex flex-1 items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 shadow-md backdrop-blur transition-all group-hover:bg-emerald-500/20">
                                {isGlobalUploading ? (
                                    <><RefreshCw className="h-4 w-4 text-emerald-400 animate-spin" /><span className="text-sm font-bold text-emerald-100/90 tracking-wide">Processing...</span></>
                                ) : (
                                    <><UploadCloud className="h-4 w-4 text-emerald-400 group-hover:scale-110 transition-transform" /><span className="text-sm font-bold text-emerald-100/90 tracking-wide">Upload Master CSV & Auto-Generate</span></>
                                )}
                            </div>
                            <input 
                                type="file" 
                                className="hidden" 
                                accept=".csv,.xlsx" 
                                disabled={isGlobalUploading}
                                onChange={(e) => {
                                    if (e.target.files?.[0]) {
                                        handleGlobalMasterCsvUpload(e.target.files[0]);
                                        e.target.value = '';
                                    }
                                }}
                            />
                        </label>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                        <div className="h-4 w-1 rounded-full bg-slate-700"></div>
                        <p className="text-xs text-slate-500 font-medium tracking-wide">
                            Need the required format? <a href="/Axon_Unified_Payroll_Template_v4.xlsx" download className="text-emerald-400 hover:text-emerald-300 hover:underline transition-colors focus:outline-none ml-1">Download our complete Unified Template</a> (Ensure Employer Details are in Rows 1-3).
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
    );

    const render9thDeskGrid = () => (
        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 rounded-t-2xl bg-slate-900/80 px-4 py-4 gap-3 sm:gap-0">
                <h3 className="font-bold text-white">Payroll Clients</h3>
                <div className="flex flex-wrap items-center gap-2">
                    <button 
                        onClick={handleGenerateAllZips} 
                        disabled={isGeneratingZips}
                        className={`inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 sm:px-4 sm:py-2 text-xs sm:text-sm font-bold text-white transition hover:bg-slate-700 ${isGeneratingZips ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        {isGeneratingZips ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4 shrink-0" />} 
                        <span className="hidden sm:inline">{isGeneratingZips ? 'Generating...' : 'Generate All ZIPs'}</span>
                        <span className="sm:hidden">{isGeneratingZips ? '...' : 'Gen All'}</span>
                    </button>
                    <button className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 sm:px-4 sm:py-2 text-xs sm:text-sm font-bold text-slate-950 transition hover:bg-emerald-400">
                        <Rocket className="h-4 w-4 shrink-0" /> <span className="hidden sm:inline">Auto-File All</span><span className="sm:hidden">Auto-File</span>
                    </button>
                </div>
            </div>
            <div className="pb-16 sm:pb-32 overflow-x-auto lg:overflow-visible">
                <div className="grid grid-cols-1 gap-4 p-4 lg:hidden">
                    {payrollClients.map((client) => (
                        <div key={client.id} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 shadow-lg backdrop-blur flex flex-col gap-4 overflow-visible">
                            <div className="flex flex-col border-b border-slate-700/50 pb-3">
                                <h4 className="text-sm font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer" onClick={() => openNewClientModal(client)} title="Edit client details">{client.name}</h4>
                                <span className="text-xs text-slate-500">{client.pin}</span>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3 text-xs overflow-visible">
                                <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 overflow-visible"><div className="flex flex-col"><span className="text-slate-400 font-semibold">PAYE</span>{(client.payeAmount !== undefined && client.payeAmount !== null) ? <span className="text-[10px] text-slate-400">KES {client.payeAmount.toLocaleString()}</span> : <span className="text-[10px] text-slate-500">KES 0</span>}</div> <InteractiveStatusBadge status={client.paye} generatedAt={client.lastGeneratedAt} lastFiledDate={client.payeLastFiledDate} receiptUrl={client.payeReceiptUrl} onUpdateStatus={(s) => handleUpdateSingleStatus(client.id, 'paye', s)} /></div>
                                <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 overflow-visible"><div className="flex flex-col"><span className="text-slate-400 font-semibold">NITA</span>{(client.nitaAmount !== undefined && client.nitaAmount !== null) ? <span className="text-[10px] text-slate-400">KES {client.nitaAmount.toLocaleString()}</span> : <span className="text-[10px] text-slate-500">KES 0</span>}</div> <StatusBadge status="due" /></div>
                                <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 overflow-visible"><div className="flex flex-col"><span className="text-slate-400 font-semibold">H. Levy</span>{(client.housingLevyAmount !== undefined && client.housingLevyAmount !== null) ? <span className="text-[10px] text-slate-400">KES {client.housingLevyAmount.toLocaleString()}</span> : <span className="text-[10px] text-slate-500">KES 0</span>}</div> <StatusBadge status="due" /></div>
                                <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 overflow-visible"><div className="flex flex-col"><span className="text-slate-400 font-semibold">NSSF</span>{(client.nssfAmount !== undefined && client.nssfAmount !== null) ? <span className="text-[10px] text-slate-400">KES {client.nssfAmount.toLocaleString()}</span> : <span className="text-[10px] text-slate-500">KES 0</span>}</div> <InteractiveStatusBadge status={client.nssf} generatedAt={client.lastGeneratedAt} lastFiledDate={client.nssfLastFiledDate} receiptUrl={client.nssfReceiptUrl} onUpdateStatus={(s) => handleUpdateSingleStatus(client.id, 'nssf', s)} /></div>
                                <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 overflow-visible"><div className="flex flex-col"><span className="text-slate-400 font-semibold">SHA</span>{(client.shaAmount !== undefined && client.shaAmount !== null) ? <span className="text-[10px] text-slate-400">KES {client.shaAmount.toLocaleString()}</span> : <span className="text-[10px] text-slate-500">KES 0</span>}</div> <InteractiveStatusBadge status={client.sha} generatedAt={client.lastGeneratedAt} lastFiledDate={client.shaLastFiledDate} receiptUrl={client.shaReceiptUrl} onUpdateStatus={(s) => handleUpdateSingleStatus(client.id, 'sha', s)} /></div>
                                <div className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2"><span className="text-slate-400 font-semibold">eLevy</span> <StatusBadge status={client.eLevy} /></div>
                            </div>
                            
                            <div className="flex flex-col gap-2 pt-2 border-t border-slate-700/50">
                                {client.masterFileUrl ? (
                                    <div className="flex items-center gap-2 w-full">
                                        <a href={client.masterFileUrl} target="_blank" rel="noreferrer" className="flex-1 flex items-center justify-center rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-600 hover:text-white transition">
                                            <FileSpreadsheet className="h-4 w-4 mr-2 shrink-0 text-slate-400" />
                                            <span className="truncate">{client.masterFileLabel || 'View Master CSV'}</span>
                                        </a>
                                        <label className="flex shrink-0 items-center justify-center cursor-pointer rounded-lg border border-slate-600 bg-slate-700/30 p-2 hover:bg-slate-600 transition" title="Replace CSV">
                                            <RefreshCw className="h-4 w-4 text-slate-400 hover:text-white" />
                                            <input 
                                                type="file" 
                                                className="hidden" 
                                                accept=".csv,.xlsx" 
                                                onChange={(e) => {
                                                    if (e.target.files?.[0]) {
                                                        if (window.confirm('Replace the existing Master CSV?')) {
                                                            handleUploadMasterCsv(client.id, e.target.files[0]);
                                                        }
                                                    }
                                                }}
                                            />
                                        </label>
                                        <button 
                                            onClick={async () => {
                                                if (window.confirm('Remove this Master CSV?')) {
                                                    try {
                                                        const res = await apiFetch(`/clients/${client.id}/master-csv`, { method: 'DELETE' });
                                                        if (res.ok) {
                                                            fetchClients();
                                                            setDashboardNotice({ tone: 'success', message: 'Master CSV removed successfully.' });
                                                        }
                                                    } catch (err) {
                                                        console.error('Error removing CSV:', err);
                                                    }
                                                }
                                            }}
                                            className="flex shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 p-2 hover:bg-red-500/20 transition" title="Remove Master CSV">
                                            <X className="h-4 w-4 text-red-400" />
                                        </button>
                                    </div>
                                ) : (
                                    <label className="inline-flex cursor-pointer items-center justify-center w-full rounded-lg border border-dashed border-slate-600 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-800 hover:text-white transition">
                                        {uploadingClientIds[client.id] ? (
                                            <><RefreshCw className="h-3 w-3 mr-2 animate-spin" /> Uploading...</>
                                        ) : 'Upload Master CSV'}
                                        <input 
                                            type="file" 
                                            className="hidden" 
                                            accept=".csv,.xlsx" 
                                            onChange={(e) => {
                                                if (e.target.files?.[0]) {
                                                    handleUploadMasterCsv(client.id, e.target.files[0]);
                                                }
                                            }}
                                        />
                                    </label>
                                )}
                                
                                <div className="flex flex-col gap-2 mt-2">
                                    {client.payeZipUrl && (
                                        <a href={client.payeZipUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center w-full rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition">
                                            <ZipIcon className="h-4 w-4 mr-2 shrink-0" />
                                            <span className="truncate">{client.payeZipLabel || 'Download PAYE ZIP'}</span>
                                        </a>
                                    )}
                                    {client.nssfFileUrl && (
                                        <a href={client.nssfFileUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center w-full rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 text-xs font-semibold text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition">
                                            <ExcelIcon className="h-4 w-4 mr-2 shrink-0" />
                                            <span className="truncate">{client.nssfFileLabel || 'Download NSSF CSV'}</span>
                                        </a>
                                    )}
                                    {client.shaFileUrl && (
                                        <a href={client.shaFileUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center w-full rounded-lg bg-violet-500/10 border border-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-400 hover:bg-violet-500/20 hover:text-violet-300 transition">
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
                                            <span className="text-[10px] text-slate-400 font-mono">{activeJobs[client.id].progress}%</span>
                                        </div>
                                        <div className="w-full bg-slate-800 rounded-full h-1.5 mb-1 overflow-hidden">
                                            <div 
                                                className={`h-1.5 rounded-full transition-all duration-500 ${getFilingProgressTone(activeJobs[client.id])}`}
                                                style={{ width: `${Math.max(activeJobs[client.id].progress, 5)}%` }}
                                            ></div>
                                        </div>
                                        <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                                            {activeJobs[client.id].state === 'failed'
                                                ? <span className="text-red-400">{activeJobs[client.id].failedReason || 'An error occurred during filing.'}</span>
                                                : activeJobs[client.id].message}
                                        </div>
                                        {isPendingFilingJob(activeJobs[client.id]) && (
                                            <button
                                                onClick={() => void handleCancelAutoFile(client)}
                                                disabled={Boolean(cancellingClientIds[client.id]) || activeJobs[client.id].state === 'cancelling'}
                                                className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold text-amber-300 transition hover:bg-amber-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                                            >
                                                {Boolean(cancellingClientIds[client.id]) || activeJobs[client.id].state === 'cancelling'
                                                    ? <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
                                                    : <X className="h-3 w-3 shrink-0" />}
                                                <span>{activeJobs[client.id].state === 'cancelling' ? 'Cancelling...' : 'Cancel Job'}</span>
                                            </button>
                                        )}
                                    </div>
                                )}
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <button
                                        onClick={() => void handleGenerateClientZip(client)}
                                        disabled={!(client.masterFileUrl || client.payrollSourceUrl) || Boolean(generatingClientIds[client.id]) || isGeneratingZips}
                                        className="flex items-center justify-center w-full gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-2.5 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                                    >
                                        {generatingClientIds[client.id] ? <RefreshCw className="h-4 w-4 animate-spin shrink-0" /> : <PlayCircle className="h-4 w-4 shrink-0" />}
                                        <span className="truncate">{(client.masterFileUrl || client.payrollSourceUrl) ? (generatingClientIds[client.id] ? 'Generating...' : 'Auto Gen ZIP') : 'No CSV'}</span>
                                    </button>
                                    <div className="flex w-full gap-2">
                                        <button
                                            onClick={() => handleAutoFile(client)}
                                            disabled={(!client.masterFileUrl && !client.payrollSourceUrl && !client.payeZipUrl) || isPendingFilingJob(activeJobs[client.id])}
                                            className="flex items-center justify-center flex-1 gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-2.5 text-[10px] font-bold text-blue-400 transition hover:bg-blue-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                                            title="Auto File PAYE"
                                        >
                                            <Rocket className="h-4 w-4 shrink-0" /> <span className="truncate">{getAutoFileLabel(activeJobs[client.id])}</span>
                                        </button>
                                        <button
                                            onClick={() => handleAutoFileNssf(client)}
                                            disabled={!client.nssfFileUrl || !client.masterFileUrl}
                                            className="flex items-center justify-center flex-1 gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-2.5 text-[10px] font-bold text-blue-400 transition hover:bg-blue-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                                            title="Auto File NSSF"
                                        >
                                            <Cloud className="h-4 w-4 shrink-0" /> <span className="truncate">AutoFile NSSF</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="overflow-x-auto">
<table className="hidden lg:table w-full table-fixed text-left text-sm text-slate-300">
                    <thead className="border-b border-slate-800 bg-slate-900 text-xs uppercase text-slate-400">
                        <tr>
                            <th className="w-[16%] px-2 py-3 sm:px-4 sm:py-4 font-semibold uppercase tracking-wider">Client Portfolio</th>
                            <th className="w-[18%] px-2 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider">Master CSV</th>
                            <th className='px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center'>PAYE</th>
                              <th className='px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center'>NITA</th>
                              <th className='px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center'>H. Levy</th>
                              <th className='px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center'>NSSF</th>
                              <th className='px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center'>SHA</th>
                            <th className="w-[10%] px-2 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider">Latest Files</th>
                            <th className="w-[16%] px-2 py-3 sm:px-4 sm:py-4 font-semibold text-right uppercase tracking-wider">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {payrollClients.map((client) => (
                            <tr key={client.id} className="transition hover:bg-slate-800/50">
                                <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4">
                                    <div className="font-semibold break-words text-emerald-400 hover:text-emerald-300 cursor-pointer" onClick={() => openNewClientModal(client)} title="Edit client details">{client.name}</div>
                                    <div className="mt-1 text-xs text-slate-500">{client.pin}</div>
                                </td>
                                <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-2 sm:py-2">
                                    {client.masterFileUrl ? (
                                        <div className="flex max-w-[180px] flex-col gap-1.5 xl:max-w-[220px]">
                                            <a href={client.masterFileUrl} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2 truncate rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition">
                                                <FileSpreadsheet className="h-3 w-3 shrink-0 text-slate-500" />
                                                <span className="truncate">{client.masterFileLabel || 'Open file'}</span>
                                            </a>
                                            <div className="flex items-center justify-end gap-1.5">
                                                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-700/30 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-300 hover:bg-slate-600 transition" title="Replace CSV/XLSX">
                                                    <RefreshCw className="h-3 w-3 text-slate-400" />
                                                    <span>Replace</span>
                                                    <input 
                                                        type="file" 
                                                        className="hidden" 
                                                        accept=".csv,.xlsx" 
                                                        onChange={(e) => {
                                                            if (e.target.files?.[0]) {
                                                                if (window.confirm('Replace the existing Master CSV?')) {
                                                                    handleUploadMasterCsv(client.id, e.target.files[0]);
                                                                }
                                                            }
                                                        }}
                                                    />
                                                </label>
                                                <button 
                                                    onClick={async () => {
                                                        if (window.confirm('Remove this Master CSV?')) {
                                                            try {
                                                                const res = await apiFetch(`/clients/${client.id}/master-csv`, { method: 'DELETE' });
                                                                if (res.ok) {
                                                                    fetchClients();
                                                                    setDashboardNotice({ tone: 'success', message: 'Master CSV removed successfully.' });
                                                                }
                                                            } catch (err) {
                                                                console.error('Error removing CSV:', err);
                                                            }
                                                        }
                                                    }}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-300 hover:bg-red-500/20 transition" title="Remove Master CSV">
                                                    <X className="h-3 w-3 text-red-400" />
                                                    <span>Remove</span>
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <label className="inline-flex w-full max-w-[180px] cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-800 hover:text-white transition xl:max-w-[220px]">
                                            {uploadingClientIds[client.id] ? (
                                                <><RefreshCw className="h-3 w-3 mr-2 animate-spin" /> Uploading...</>
                                            ) : 'Upload Master CSV'}
                                            <input 
                                                type="file" 
                                                className="hidden" 
                                                accept=".csv,.xlsx" 
                                                onChange={(e) => {
                                                    if (e.target.files?.[0]) {
                                                        handleUploadMasterCsv(client.id, e.target.files[0]);
                                                    }
                                                }}
                                            />
                                        </label>
                                    )}
                                </td>
                                <td className="whitespace-normal min-w-0 px-1 py-3 sm:px-2 sm:py-2 text-center overflow-visible">
                                    <div className="flex flex-col items-center gap-1">
                                        {(client.payeAmount !== undefined && client.payeAmount !== null) ? <span className="text-[10px] font-bold text-slate-300">KES {client.payeAmount.toLocaleString()}</span> : <span className="text-[10px] font-bold text-slate-500">KES 0</span>}
                                        <InteractiveStatusBadge status={client.paye} generatedAt={client.lastGeneratedAt} lastFiledDate={client.payeLastFiledDate} receiptUrl={client.payeReceiptUrl} onUpdateStatus={(s) => handleUpdateSingleStatus(client.id, 'paye', s)} />
                                    </div>
                                </td>
                                <td className="whitespace-normal min-w-0 px-1 py-3 sm:px-2 sm:py-2 text-center overflow-visible">
                                    <div className="flex flex-col items-center gap-1">
                                        {(client.nitaAmount !== undefined && client.nitaAmount !== null) ? <span className="text-[10px] font-bold text-slate-300">KES {client.nitaAmount.toLocaleString()}</span> : <span className="text-[10px] font-bold text-slate-500">KES 0</span>}
                                        <StatusBadge status="due" />
                                    </div>
                                </td>
                                <td className="whitespace-normal min-w-0 px-1 py-3 sm:px-2 sm:py-2 text-center overflow-visible">
                                    <div className="flex flex-col items-center gap-1">
                                        {(client.housingLevyAmount !== undefined && client.housingLevyAmount !== null) ? <span className="text-[10px] font-bold text-slate-300">KES {client.housingLevyAmount.toLocaleString()}</span> : <span className="text-[10px] font-bold text-slate-500">KES 0</span>}
                                        <StatusBadge status="due" />
                                    </div>
                                </td>
                                <td className="whitespace-normal min-w-0 px-1 py-3 sm:px-2 sm:py-2 text-center overflow-visible">
                                    <div className="flex flex-col items-center gap-1">
                                        {(client.nssfAmount !== undefined && client.nssfAmount !== null) ? <span className="text-[10px] font-bold text-slate-300">KES {client.nssfAmount.toLocaleString()}</span> : <span className="text-[10px] font-bold text-slate-500">KES 0</span>}
                                        <InteractiveStatusBadge status={client.nssf} generatedAt={client.lastGeneratedAt} lastFiledDate={client.nssfLastFiledDate} receiptUrl={client.nssfReceiptUrl} onUpdateStatus={(s) => handleUpdateSingleStatus(client.id, 'nssf', s)} />
                                    </div>
                                </td>
                                <td className="whitespace-normal min-w-0 px-1 py-3 sm:px-2 sm:py-2 text-center overflow-visible">
                                    <div className="flex flex-col items-center gap-1">
                                        {(client.shaAmount !== undefined && client.shaAmount !== null) ? <span className="text-[10px] font-bold text-slate-300">KES {client.shaAmount.toLocaleString()}</span> : <span className="text-[10px] font-bold text-slate-500">KES 0</span>}
                                        <InteractiveStatusBadge status={client.sha} generatedAt={client.lastGeneratedAt} lastFiledDate={client.shaLastFiledDate} receiptUrl={client.shaReceiptUrl} onUpdateStatus={(s) => handleUpdateSingleStatus(client.id, 'sha', s)} />
                                    </div>
                                </td>
                                <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-2 sm:py-2">
                                    <div className="flex flex-col gap-1.5">
                                        {client.payeZipUrl ? (
                                            <a href={client.payeZipUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-[100px] md:max-w-[150px] items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:underline" title={client.payeZipLabel}>
                                                <ZipIcon className="h-3 w-3 shrink-0" /> <span className="truncate font-semibold">PAYE</span>
                                            </a>
                                        ) : <span className="text-xs text-slate-500 italic">No PAYE</span>}
                                        {client.nssfFileUrl ? (
                                            <a href={client.nssfFileUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-[100px] md:max-w-[150px] items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 hover:underline" title={client.nssfFileLabel}>
                                                <ExcelIcon className="h-3 w-3 shrink-0" /> <span className="truncate font-semibold">NSSF</span>
                                            </a>
                                        ) : null}
                                        {client.shaFileUrl ? (
                                            <a href={client.shaFileUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-[100px] md:max-w-[150px] items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 hover:underline" title={client.shaFileLabel}>
                                                <ExcelIcon className="h-3 w-3 shrink-0" /> <span className="truncate font-semibold">SHA</span>
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
                                                onClick={() => void handleGenerateClientZip(client)}
                                                disabled={!(client.masterFileUrl || client.payrollSourceUrl) || Boolean(generatingClientIds[client.id]) || isGeneratingZips}
                                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold leading-tight text-emerald-400 transition hover:bg-emerald-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                                            >
                                                {generatingClientIds[client.id] ? <RefreshCw className="h-3 w-3 animate-spin shrink-0" /> : <PlayCircle className="h-3 w-3 shrink-0" />}
                                                {generatingClientIds[client.id] ? 'Generating...' : 'Generate PAYE ZIP'}
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => handleAutoFile(client)}
                                            disabled={!client.payeZipUrl || isPendingFilingJob(activeJobs[client.id])}
                                            className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold leading-tight transition ${!client.payeZipUrl || isPendingFilingJob(activeJobs[client.id]) ? 'border-slate-700 bg-slate-800 text-slate-500 cursor-not-allowed' : 'border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500 hover:text-slate-950'}`}
                                            title="Auto File PAYE"
                                        >
                                            <Rocket className="h-3 w-3 shrink-0" /> <span className="truncate">Auto File PAYE</span>
                                        </button>
                                        <button
                                            onClick={() => handleGeneratePrn(client, 'PAYE')}
                                            disabled={isPendingFilingJob(activeJobs[client.id])}
                                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold leading-tight text-amber-400 transition hover:bg-amber-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
                                            title="Print PAYE PRN"
                                        >
                                            <Download className="h-3 w-3 shrink-0" /> <span className="truncate">Print PAYE PRN</span>
                                        </button>
                                        <button
                                            onClick={() => handleAutoFileNssf(client)}
                                            disabled={!client.nssfFileUrl || !client.masterFileUrl}
                                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-bold leading-tight text-blue-400 transition hover:bg-blue-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                                            title="Auto File NSSF"
                                        >
                                            <Cloud className="h-3 w-3 shrink-0" /> <span className="truncate">Auto File NSSF</span>
                                        </button>
                                    </div>
                                    {activeJobs[client.id] && (
                                        <div className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-left">
                                            <div className="flex items-center justify-between gap-2 mb-1">
                                                <span className="text-[10px] text-slate-300 font-medium font-mono uppercase tracking-wider truncate">
                                                    {getFilingStatusLabel(activeJobs[client.id])}
                                                </span>
                                                <span className="text-[10px] text-slate-400 font-mono">{activeJobs[client.id].progress}%</span>
                                            </div>
                                            <div className="w-full bg-slate-800 rounded-full h-1.5 mb-1 overflow-hidden">
                                                <div 
                                                    className={`h-1.5 rounded-full transition-all duration-500 ${getFilingProgressTone(activeJobs[client.id])}`}
                                                    style={{ width: `${Math.max(activeJobs[client.id].progress, 5)}%` }}
                                                ></div>
                                            </div>
                                            <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                                                {activeJobs[client.id].state === 'failed'
                                                    ? <span className="text-red-400">{activeJobs[client.id].failedReason || 'An error occurred during filing.'}</span>
                                                    : activeJobs[client.id].message}
                                            </div>
                                            {isPendingFilingJob(activeJobs[client.id]) && (
                                                <button
                                                    onClick={() => void handleCancelAutoFile(client)}
                                                    disabled={Boolean(cancellingClientIds[client.id]) || activeJobs[client.id].state === 'cancelling'}
                                                    className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold text-amber-300 transition hover:bg-amber-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                                                >
                                                    {Boolean(cancellingClientIds[client.id]) || activeJobs[client.id].state === 'cancelling'
                                                        ? <RefreshCw className="h-3 w-3 animate-spin" />
                                                        : <X className="h-3 w-3" />}
                                                    {activeJobs[client.id].state === 'cancelling' ? 'Cancelling...' : 'Cancel Job'}
                                                </button>
                                            )}
                                            {isTerminalFilingJob(activeJobs[client.id]) && (activeJobs[client.id].receiptUrl || activeJobs[client.id].prnUrl) && (
                                                <div className="mt-2 flex flex-col gap-1.5">
                                                    {activeJobs[client.id].receiptUrl && activeJobs[client.id].receiptUrl !== activeJobs[client.id].prnUrl && (
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
    );

    const renderMatrixGrid = () => {
        // Flatten clients into specific obligations for the VAT & Monthly Returns
        let obligations: { client: any; type: string; status: TaxStatus }[] = [];
        clients.forEach(c => {
            if (c.vat !== 'na') obligations.push({ client: c, type: 'VAT', status: c.vat });
            if (c.tot !== 'na') obligations.push({ client: c, type: 'TOT', status: c.tot });
            if (c.dst !== 'na') obligations.push({ client: c, type: 'DST', status: c.dst });
            if (c.mri !== 'na') obligations.push({ client: c, type: 'MRI', status: c.mri });
        });

        // Filter obligations based on toggle
        if (monthlyReturnFilter !== 'ALL') {
            obligations = obligations.filter(ob => ob.type === monthlyReturnFilter);
        }

        
        return (
            <div className="mt-8">
                {/* 1. The Toggle UI */}
                <div className="mb-6 flex flex-wrap gap-3 items-center">
                    {['VAT', 'TOT', 'MRI', 'DST', 'ALL'].map(t => (
                        <button
                            key={t}
                            onClick={() => setMonthlyReturnFilter(t as any)}
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
                                const isEtimsConnected = etimsConnections[ob.client.id];
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
                                const vatInputValue = vatPreviousCreditVals[ob.client.id]
                                    ?? (typeof ob.client.vatPreviousCredit === 'number' ? String(ob.client.vatPreviousCredit) : '');
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
                                                {isEtimsConnected ? (
                                                    <div className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-4 py-2 mt-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                                                        <CheckCircle2 className="h-4 w-4" /> eTIMS Connected
                                                    </div>
                                                ) : (
                                                    <button 
                                                        onClick={() => setEtimsModalClient(ob.client)}
                                                        className="inline-flex items-center gap-2 rounded-xl bg-blue-500/10 px-4 py-2.5 mt-1 text-xs font-bold text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition shadow-sm border border-blue-500/20"
                                                    >
                                                        <Cloud className="h-4 w-4" /> Connect eTIMS Data
                                                    </button>
                                                )}

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
                                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Monthly Rental Income</label>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-medium text-slate-500">KES</span>
                                                    <input
                                                        type="number"
                                                        placeholder="Rent Amount"
                                                        value={mriInputVals[ob.client.id] || ''}
                                                        onChange={e => setMriInputVals(prev => ({ ...prev, [ob.client.id]: e.target.value }))}
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
                                                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Previous Month VAT Credit</label>
                                                    <div className="mt-1 flex items-center gap-2">
                                                        <span className="text-xs font-medium text-slate-500">KES</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            placeholder="Carry-forward credit"
                                                            value={vatInputValue}
                                                            onChange={e => setVatPreviousCreditVals(prev => ({ ...prev, [ob.client.id]: e.target.value }))}
                                                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-blue-500 transition shadow-inner"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-slate-400 font-medium">Input VAT <span className="font-normal text-[10px] ml-1 text-slate-500">(Purchases)</span></span>
                                                    <span className="text-slate-200 font-bold border-b border-transparent">KES {formatTaxAmount(vatSummary.inputVat)}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-slate-400 font-medium">Output VAT <span className="font-normal text-[10px] ml-1 text-slate-500">(Sales)</span></span>
                                                    <span className="text-slate-200 font-bold border-b border-transparent">KES {formatTaxAmount(vatSummary.outputVat)}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-slate-400 font-medium">Previous Credit <span className="font-normal text-[10px] ml-1 text-slate-500">(Applied)</span></span>
                                                    <span className="text-slate-200 font-bold border-b border-transparent">KES {formatTaxAmount(vatSummary.previousCredit)}</span>
                                                </div>
                                                <div className="border-t border-slate-700/80 my-1 pt-2.5 flex justify-between items-center text-xs">
                                                    <span className={`font-bold ${vatSummary.netVatBalance >= 0 ? 'text-blue-400' : 'text-emerald-400'}`}>{vatBalanceLabel} <span className="font-normal text-[10px] ml-1 opacity-70">(After credit)</span></span>
                                                    <span className={`font-black text-[13px] drop-shadow-sm ${vatSummary.netVatBalance >= 0 ? 'text-blue-400' : 'text-emerald-400'}`}>KES {formatTaxAmount(vatBalanceValue)}</span>
                                                </div>
                                                {vatHasPreparedArtifacts ? (
                                                    <div className="flex flex-col gap-2 rounded-lg border border-slate-700/70 bg-slate-950/40 p-3 text-[11px] text-slate-300">
                                                        <span className={`font-semibold ${vatCreditMatchesPrepared ? 'text-emerald-400' : 'text-amber-400'}`}>
                                                            {vatCreditMatchesPrepared
                                                                ? 'VAT summary is ready. File VAT when you are satisfied with the figures.'
                                                                : 'The VAT credit input changed after generation. Regenerate VAT ZIP before filing VAT.'}
                                                        </span>
                                                        <div className="flex flex-wrap gap-2">
                                                            {vatSourcePackageUrl && (
                                                                <a href={vatSourcePackageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 font-semibold text-slate-300 hover:bg-slate-800/80 transition" title={ob.client.vatSourcePackageLabel}>
                                                                    <Download className="h-3 w-3" /> Source Package
                                                                </a>
                                                            )}
                                                            {vatGeneratedZipUrl && (
                                                                <a href={vatGeneratedZipUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 font-semibold text-emerald-400 hover:bg-emerald-500/20 transition" title={ob.client.vatZipLabel}>
                                                                    <Download className="h-3 w-3" /> Generated VAT ZIP
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-[11px] text-slate-500">Generate VAT ZIP to download the KRA package, build the upload ZIP, and review the summary before filing VAT.</span>
                                                )}
                                            </div>
                                        )}
                                        {ob.type === 'TOT' && (
                                            <div className="flex flex-col gap-3 rounded-xl bg-blue-900/5 border border-blue-500/20 p-4 shadow-sm group-hover:border-blue-500/30 transition">
                                                <div>
                                                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Gross Sales / Turnover</label>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-xs font-medium text-slate-500">KES</span>
                                                        <input
                                                            type="number"
                                                            placeholder="Sales Amount"
                                                            value={totInputVals[ob.client.id] || ''}
                                                            onChange={e => setTotInputVals(prev => ({ ...prev, [ob.client.id]: e.target.value }))}
                                                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-blue-500 transition shadow-inner"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="border-t border-slate-700/80 pt-2 flex justify-between items-center text-xs">
                                                    <span className="font-bold text-blue-400">1.5% Computed TOT</span>
                                                    <span className="font-black text-[13px] text-blue-400 drop-shadow-sm">
                                                        KES {totInputVals[ob.client.id] && !isNaN(parseFloat(totInputVals[ob.client.id])) ? (parseFloat(totInputVals[ob.client.id]) * 0.015).toLocaleString(undefined, {minimumFractionDigits: 2}) : '0.00'}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col gap-2 mt-2 border-t border-slate-700/80 pt-3">
                                                    {ob.client.totZipUrl && (
                                                        <div className="flex flex-col gap-1">
                                                            <a href={ob.client.totZipUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition">
                                                                <Download className="h-3 w-3" /> Download Generated ZIP
                                                            </a>
                                                            <span className="text-[10px] text-center text-slate-500">
                                                                Generated: {new Date(ob.client.lastGeneratedAt || Date.now()).toLocaleString()}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <button 
                                                        onClick={async () => { await generateTotZip(ob.client); }}
                                                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 text-[11px] font-bold text-blue-400 hover:bg-blue-500/20 transition hover:scale-[1.02]"
                                                    >
                                                        <RefreshCw className="h-3 w-3" /> {ob.client.totZipUrl ? 'Regenerate TOT ZIP' : 'Generate TOT ZIP'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        {ob.type === 'MRI' && (
                                            <div className="flex flex-col rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 shadow-sm group-hover:border-rose-900/30 transition">
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="font-bold text-rose-400">7.5% Computed Tax</span>
                                                    <span className="font-black text-[13px] text-rose-400 drop-shadow-sm">
                                                        KES {mriInputVals[ob.client.id] && !isNaN(parseFloat(mriInputVals[ob.client.id])) 
                                                            ? (parseFloat(mriInputVals[ob.client.id]) * 0.075).toLocaleString(undefined, {minimumFractionDigits: 2}) 
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
                                                        onClick={() => handlePrepareVat(ob.client)}
                                                        disabled={isPendingFilingJob(activeJobs[ob.client.id])}
                                                        className={`flex w-full justify-center items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition shadow-sm drop-shadow ${isPendingFilingJob(activeJobs[ob.client.id]) ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed' : 'bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300'}`}
                                                    >
                                                        {vatGenerateActionLabel}
                                                    </button>
                                                    <button
                                                        onClick={() => handleConfirmVatFiling(ob.client)}
                                                        disabled={isPendingFilingJob(activeJobs[ob.client.id]) || !vatHasPreparedArtifacts || !vatCreditMatchesPrepared}
                                                        className={`flex w-full justify-center items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition shadow-sm drop-shadow ${isPendingFilingJob(activeJobs[ob.client.id]) || !vatHasPreparedArtifacts || !vatCreditMatchesPrepared ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300'}`}
                                                    >
                                                        File VAT (Auto File)
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => {
                                                        if (ob.type === 'MRI') handleFileMri(ob.client);
                                                        else if (ob.type === 'TOT') handleFileTot(ob.client);
                                                        else if (ob.type === 'PAYE') handleAutoFile(ob.client);
                                                        else if (ob.type === 'NSSF') handleAutoFileNssf(ob.client);
                                                    }}
                                                    disabled={isPendingFilingJob(activeJobs[ob.client.id]) || (ob.type === 'TOT' && !ob.client.totZipUrl)}
                                                    className={`flex w-full justify-center items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition shadow-sm drop-shadow ${isPendingFilingJob(activeJobs[ob.client.id]) || (ob.type === 'TOT' && !ob.client.totZipUrl) ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300'}`}
                                                >
                                                    Process Return
                                                </button>
                                            )}
                                            
                                            <button 
                                                onClick={() => handleGeneratePrn(ob.client, ob.type)}
                                                disabled={isPendingFilingJob(activeJobs[ob.client.id])}
                                                className="flex w-full justify-center items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/20 hover:text-amber-300 transition shadow-sm drop-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="Generate Payment Slip directly without filing"
                                            >
                                                Print PRN
                                            </button>
                                            {isTerminalFilingJob(activeJobs[ob.client.id]) && (latestReceiptUrl || latestPrnUrl) && (
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
    };

    return (
        <div className="flex h-screen bg-slate-950 font-sans antialiased selection:bg-emerald-500/30">
            {/* Mobile Sidebar Overlay */}
            {isSidebarOpen && (
                <div 
                    className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}
            
            <div className="flex w-full overflow-hidden relative">
                {/* Sidebar */}
                <Sidebar 
                    payrollPendingCount={payrollPendingCount} 
                    taxPendingCount={taxPendingCount} 
                    plan={plan} 
                    capacityValue={capacityValue} 
                    capacityPercentage={capacityPercentage} 
                />

                {/* Main Content */}
                <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto relative bg-slate-950">
                    {/* Mobile Header Line */}
                    <div className="lg:hidden flex items-center justify-between sticky top-0 z-30 bg-slate-950/90 backdrop-blur border-b border-slate-800 p-4">
                        <div className="flex items-center gap-3">
                            <button onClick={() => setIsSidebarOpen(true)} className="text-slate-400 hover:text-white">
                                <Menu className="h-6 w-6" />
                            </button>
                            <div className="flex items-center gap-2">
                                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500 text-slate-950">
                                    <Building2 className="h-4 w-4" />
                                </div>
                                <span className="text-lg font-bold tracking-tight text-white">Kwanta<span className="text-emerald-500">.</span></span>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 px-4 py-6 md:px-8 md:py-8 lg:px-12">
                        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div>
                                {view === 'overview' && <h1 className="text-3xl font-black text-white">Practice Overview</h1>}
                                {view === 'desk-9th' && <h1 className="text-3xl font-black text-emerald-400">Payroll Pipeline</h1>}
                                {view === 'desk-20th' && <h1 className="text-3xl font-black text-blue-400">Monthly Returns Pipeline</h1>}
                                {view === 'desk-elevy' && <h1 className="text-3xl font-black text-fuchsia-400">Tourism Fund E-Levy Pipeline</h1>}
                                {view === 'clients' && <h1 className="text-3xl font-black text-white">Client Portfolio</h1>}
                                <p className="mt-2 text-sm text-slate-400">Manage bulk payroll processing for {payrollClients.length} active client{payrollClients.length === 1 ? '' : 's'}.</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
                                <div className="flex items-center rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 w-full sm:w-auto">
                                    <Search className="h-4 w-4 text-slate-500 shrink-0" />
                                    <input type="text" placeholder="Search client or PIN..." className="ml-2 bg-transparent text-sm text-white placeholder-slate-500 outline-none w-full" />
                                </div>
                                {view === 'clients' && (
                                    <button onClick={openNewClientModal} className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-emerald-400">
                                        <Plus className="h-4 w-4" /> New Client
                                    </button>
                                )}
                            </div>
                        </header>

                    {dashboardNotice && (
                        <div className={`mt-6 rounded-2xl border px-4 py-3 text-sm font-medium ${dashboardNotice.tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : dashboardNotice.tone === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-slate-700 bg-slate-900/70 text-slate-200'}`}>
                            {dashboardNotice.message}
                        </div>
                    )}

                    {selectedClient && <div className="mt-10"><CompanyDetails client={selectedClient} onBack={() => setSelectedClient(null)} onSave={handleSaveClientDetails} /></div>}
                    {!selectedClient && view === 'overview' && (
                        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_350px]">
                            {/* Left Col: Summary / Stats */}
                            <div className="space-y-6">
                                <h2 className="text-xl font-bold text-white">Upcoming Deadlines</h2>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <button onClick={() => setView('desk-9th')} className="text-left rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition-all hover:bg-slate-800 hover:border-slate-700">
                                        <div className="flex items-center justify-between">
                                        <p className="text-sm font-medium text-slate-400">Payroll Processing</p>
                                            <CalendarClock className="h-5 w-5 text-emerald-500" />
                                        </div>
                                        <p className="mt-4 text-3xl font-black text-white">{payrollPendingCount} <span className="text-lg font-normal text-slate-500">pending packs</span></p>
                                    </button>
                                    <button onClick={() => setView('desk-20th')} className="text-left rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition-all hover:bg-slate-800 hover:border-slate-700">
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm font-medium text-slate-400">VAT & Monthly Returns (Taxes)</p>
                                            <CalendarClock className="h-5 w-5 text-blue-500" />
                                        </div>
                                        <p className="mt-4 text-3xl font-black text-white">{taxPendingCount} <span className="text-lg font-normal text-slate-500">remittances</span></p>
                                    </button>
                                </div>

                                <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
                                    <h3 className="mb-4 text-lg font-bold text-white">Recent Activity</h3>
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between border-b border-slate-800/50 pb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                                                    <CheckCircle2 className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-white">Blue Coast Hotels</p>
                                                    <p className="text-xs text-slate-500">PAYE data ready ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ 2 hours ago</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between border-b border-slate-800/50 pb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                                                    <ShieldAlert className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-white">TechFlow Solutions</p>
                                                    <p className="text-xs text-slate-500">VAT pending ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ 4 hours ago</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between pb-2">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-slate-400">
                                                    <Activity className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-white">System Status: KRA Portal</p>
                                                    <p className="text-xs text-slate-500">Operational ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Updated 5 min ago</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Right Col: Fast Workflows */}
                            <div className="space-y-6">
                                <h2 className="text-xl font-bold text-white">Fast Workflows</h2>
                                <div className="grid gap-3">
                                    {/* Green theme */}
                                    <button 
                                        onClick={openNewClientModal}
                                        className="group relative flex items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-400 p-5 text-left shadow-lg transition-all hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(16,185,129,0.3)]"
                                    >
                                        <div className="relative z-10">
                                            <p className="text-lg font-black text-slate-950">Onboard Client</p>
                                            <p className="mt-1 text-xs font-semibold text-emerald-950/70">Add client & set obligations</p>
                                        </div>
                                        <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                                            <Plus className="h-5 w-5 text-slate-950" />
                                        </div>
                                    </button>

                                    <div className="grid gap-2">
                                        <button 
                                            onClick={() => document.getElementById('bulkCsvUpload')?.click()}
                                            className="group relative flex items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-teal-600 to-teal-400 p-5 text-left shadow-lg transition-all hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(20,184,166,0.3)]"
                                        >
                                            <div className="relative z-10">
                                                <p className="text-lg font-black text-slate-950">Bulk Import</p>
                                                <p className="mt-1 text-xs font-semibold text-teal-950/70">Upload CSV template</p>
                                            </div>
                                            <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                                                <Upload className="h-5 w-5 text-slate-950" />
                                            </div>
                                        </button>
                                        <button 
                                            onClick={() => {
                                                const csvContent = "Company Name,PIN,Password,Obligations,Email,Phone,NSSF Login,NSSF Password,SHA Login,SHA Password,eTIMS Login,eTIMS Password,eLevy Login,eLevy Password\nExample Company Ltd,P051234567M,UserPass123!,\"paye, nssf, mri\",test@example.com,0700000000,NSSF001,NssfPass123,SHA001,ShaPass123,ETIMS001,EtimsPass123,ELEVY001,ElevyPass123";
                                                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                                                const url = URL.createObjectURL(blob);
                                                const link = document.createElement('a');
                                                link.setAttribute('href', url);
                                                link.setAttribute('download', 'Clients_Bulk_Upload_Template.csv');
                                                document.body.appendChild(link);
                                                link.click();
                                                document.body.removeChild(link);
                                            }}
                                            className="text-xs text-center text-teal-400 hover:text-teal-300 transition-colors underline"
                                        >
                                            Download CSV Template
                                        </button>
                                    </div>
                                    <input 
                                        type="file" 
                                        id="bulkCsvUpload" 
                                        accept=".csv" 
                                        className="hidden" 
                                        onChange={handleBulkCsvUpload} 
                                    />

                                    {/* Red theme */}
                                    <button 
                                        onClick={() => setView('desk-9th')}
                                        className="group relative flex items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-red-600 to-red-500 p-5 text-left shadow-lg transition-all hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(220,38,38,0.3)]"
                                    >
                                        <div className="relative z-10">
                                            <p className="text-lg font-black text-white">Process Payroll</p>
                                            <p className="mt-1 text-xs font-medium text-red-100">Unified PAYE, NSSF, SHA</p>
                                        </div>
                                        <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                                            <UploadCloud className="h-5 w-5 text-white" />
                                        </div>
                                    </button>
                                    
                                    {/* White/Light theme */}
                                    <button 
                                        onClick={() => setView('desk-20th')}
                                        className="group relative flex items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-slate-100 to-white p-5 text-left shadow-lg transition-all hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(255,255,255,0.15)]"
                                    >
                                        <div className="relative z-10">
                                            <p className="text-lg font-black text-slate-950">Nil Filing Run</p>
                                            <p className="mt-1 text-xs font-semibold text-slate-500">Auto-file empty returns</p>
                                        </div>
                                        <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900/5 backdrop-blur-md">
                                            <Activity className="h-5 w-5 text-slate-950" />
                                        </div>
                                    </button>

                                    {/* Black theme */}
                                    <button 
                                        onClick={() => setView('clients')}
                                        className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-900 to-slate-800 p-5 text-left shadow-lg transition-all hover:scale-[1.02] hover:border-slate-600 hover:shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
                                    >
                                        <div className="relative z-10">
                                            <p className="text-lg font-black text-white">Client Registry</p>
                                            <p className="mt-1 text-xs font-medium text-slate-400">View portfolios matrix</p>
                                        </div>
                                        <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/5 bg-white/10 backdrop-blur-md">
                                            <Building2 className="h-5 w-5 text-white" />
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {!selectedClient && view === 'desk-9th' && (
                        <div className="mt-10">
                            {renderGlobalPayrollUpload()}
                            {render9thDeskGrid()}
                        </div>
                    )}

                    {!selectedClient && view === 'desk-20th' && (
                        <div className="mt-10">
                            <div className="grid gap-6 sm:grid-cols-4">
                                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                                    <p className="text-sm font-medium text-slate-400">VAT Returns Due</p>
                                    <p className="mt-2 text-3xl font-bold text-white">2</p>
                                </div>
                                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                                    <p className="text-sm font-medium text-slate-400">TOT Returns Due</p>
                                    <p className="mt-2 text-3xl font-bold text-white">1</p>
                                </div>
                                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                                    <p className="text-sm font-medium text-slate-400">MRI Returns</p>
                                    <p className="mt-2 text-3xl font-bold text-white">1</p>
                                </div>
                                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-5">
                                    <p className="text-sm font-medium text-blue-400">Status Check</p>
                                    <button className="mt-4 w-full rounded-lg bg-blue-500 py-2 text-xs font-bold text-white hover:bg-blue-400">
                                        Verify KRA API
                                    </button>
                                </div>
                            </div>
                            {renderMatrixGrid()}
                        </div>
                    )}

                    {!selectedClient && view === 'desk-elevy' && (
                        <div className="mt-10">
                            <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
                                <div className="pb-16 sm:pb-32 overflow-x-auto lg:overflow-visible">
                                    <table className="w-full text-left text-sm text-slate-300">
                                        <thead className="border-b border-slate-800 bg-slate-900 rounded-t-2xl text-xs uppercase text-slate-400">
                                            <tr>
                                                <th className="px-2 py-3 sm:px-4 sm:py-4 font-semibold uppercase tracking-wider">Client Portfolio</th>
                                                <th className="px-2 py-3 sm:px-4 sm:py-4 font-semibold uppercase tracking-wider">Tourism Fund E-Levy</th>
                                                <th className="px-2 py-3 sm:px-4 sm:py-4 font-semibold text-right uppercase tracking-wider">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/50">
                                            {clients.filter(c => c.eLevy !== 'na').map((client) => (
                                                <tr key={client.id} className="transition hover:bg-slate-800/50">
                                                    <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4">
                                                        <div className="font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer" onClick={() => openNewClientModal(client)} title="Edit client details">{client.name}</div>
                                                        <div className="mt-1 text-xs text-slate-500">{client.pin}</div>
                                                    </td>
                                                    <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4"><StatusBadge status={client.eLevy} /></td>
                                                    <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4 text-right">
                                                        <button className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700">Actions</button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                                 {!selectedClient && view === 'desk-nil' && (
                        <div className="mt-10">
                            <div className="mb-6 flex flex-col gap-2 border-b border-slate-800 pb-5">
                                <h2 className="text-xl font-bold text-white">Nil & ITR Filing Desk</h2>
                                <p className="text-sm text-slate-400">File Nil returns and Annual Income Tax Returns for your clients.</p>
                            </div>
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
                                <div className="overflow-x-auto pb-16">
                                    <table className="w-full text-left text-sm text-slate-300">
                                        <thead className="border-b border-slate-800 bg-slate-900 text-xs uppercase text-slate-400">
                                            <tr>
                                                <th className="px-6 py-4 font-semibold tracking-wider w-1/3">Client & PIN</th>
                                                <th className="px-6 py-4 font-semibold tracking-wider">Tax Obligation</th>
                                                <th className="px-6 py-4 font-semibold tracking-wider">Period (From - To)</th>
                                                <th className="px-6 py-4 font-semibold tracking-wider text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/50">
                                            {clients.map(client => {
                                                const sel = nilSelections[client.id] || { type: '', periodFrom: '2026-01-01', periodTo: '2026-12-31' };
                                                const job = activeJobs[client.id];
                                                const isProcessing = job && !isTerminalFilingJob(job);
                                                
                                                return (
                                                    <tr key={client.id} className="group transition hover:bg-slate-800/30">
                                                        <td className="px-6 py-4">
                                                            <div className="font-bold text-white">{client.name}</div>
                                                            <div className="text-xs text-slate-500 font-mono mt-0.5">{client.pin}</div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <select 
                                                                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                                                                value={sel.type}
                                                                onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, type: e.target.value } }))}
                                                            >
                                                                <option value="" disabled>Choose Obligation</option>
                                                                {TAX_OBLIGATION_OPTIONS.filter(o => o.filingMode === 'nil').map(o => (
                                                                    <option key={o.value} value={o.value}>{o.label}</option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td className="px-6 py-4">
    <div className="flex flex-col gap-2">
        <div className="flex gap-2">
            <input
                type="date"
                value={sel.periodFrom}
                onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, periodFrom: e.target.value } }))}
                className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-amber-500"
            />
            <span className="flex items-center text-slate-500">-</span>
            <input
                type="date"
                value={sel.periodTo}
                onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, periodTo: e.target.value } }))}
                className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-amber-500"
            />
        </div>
        {(sel.type === "income_tax_resident_individual" || sel.type === "income_tax_non_resident_individual") && (
            <label className="flex items-center gap-2 mt-1 cursor-pointer w-max">
                <input 
                    type="checkbox"
                    checked={sel.ownsRentalProperty || false}
                    onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, ownsRentalProperty: e.target.checked } }))}
                    className="rounded bg-slate-800 border-slate-700 focus:ring-amber-500 accent-amber-500 h-3.5 w-3.5"
                />
                <span className="text-[11px] text-slate-400">Owns Rental Property?</span>
            </label>
        )}
    </div>
</td>
                                                        <td className="px-6 py-4 text-right">
                                                            <button
                                                                onClick={() => handleFileNil(client)}
                                                                disabled={isProcessing}
                                                                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition ${isProcessing ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-amber-500 hover:bg-amber-400 text-amber-950 shadow-lg'}`}
                                                            >
                                                                {isProcessing ? 'Processing' : 'File Nil'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {view === 'clients' && !selectedClient && (
                        <ClientTable
                            clients={clients}
                            onSelectClient={setSelectedClient}
                            onEditClient={openNewClientModal}
                        />
                    )}
       </div>
                </main>
            </div>

            
                                

                    {showNewClientModal && (
                        <NewClientModal
                            editingClientId={editingClientId}
                            newClientName={newClientName}
                            setNewClientName={setNewClientName}
                            newClientPin={newClientPin}
                            setNewClientPin={setNewClientPin}
                            newClientPassword={newClientPassword}
                            setNewClientPassword={setNewClientPassword}
                            newClientObligations={newClientObligations}
                            setNewClientObligations={setNewClientObligations}
                            newClientMasterCsv={newClientMasterCsv}
                            setNewClientMasterCsv={setNewClientMasterCsv}
                            newClientModalError={newClientModalError}
                            setNewClientModalError={setNewClientModalError}
                            isSavingClient={isSavingClient}
                            resetNewClientForm={resetNewClientForm}
                            handleSaveClient={handleSaveClient}
                        />
                    )}
        </div>
    );
}

