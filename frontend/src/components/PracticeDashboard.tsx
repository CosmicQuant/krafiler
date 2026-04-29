import { useState, useEffect } from 'react';
import CompanyDetails from './CompanyDetails';
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
} from 'lucide-react';
import { Link } from 'react-router-dom';

type DashboardView = 'overview' | 'desk-9th' | 'desk-20th' | 'desk-elevy' | 'clients' | 'settings';
type PlanKey = 'starter' | 'growth' | 'enterprise';

type PracticePlan = {
    label: string;
    capacity: number | 'Unlimited';
    used: number;
};

const plans: Record<PlanKey, PracticePlan> = {
    starter: { label: 'Practice Starter', capacity: 10, used: 8 },
    growth: { label: 'Growing Firm', capacity: 50, used: 42 },
    enterprise: { label: 'Enterprise Desk', capacity: 'Unlimited', used: 142 },
};

const apiFetch = (path: string, init?: RequestInit) => fetch(`/api${path}`, init);

export type TaxStatus = 'done' | 'due' | 'na' | 'generated' | 'filed' | 'paid';

export type ClientObligation = {
    iTaxPassword?: string;
    sector?: string;
    id: string;
    name: string;
    pin: string;
    masterFileUrl?: string;
    masterFileLabel?: string;
    payrollSourceUrl?: string;
    payeZipUrl?: string;
    payeZipLabel?: string;
    nssfFileUrl?: string;
    nssfFileLabel?: string;
    shaFileUrl?: string;
    shaFileLabel?: string;
    lastGeneratedAt?: string;
    payeAmount?: number;
    nitaAmount?: number;
    housingLevyAmount?: number;
    nssfAmount?: number;
    shaAmount?: number;
    // 9th/10th
    paye: TaxStatus;
    nssf: TaxStatus;
    sha: TaxStatus;
    eLevy: TaxStatus;
    // 20th
    vat: TaxStatus;
    tot: TaxStatus;
    mri: TaxStatus;
    dst: TaxStatus;

    payeLastFiledDate?: string;
    payeReceiptUrl?: string;
    nssfLastFiledDate?: string;
    nssfReceiptUrl?: string;
    shaLastFiledDate?: string;
    shaReceiptUrl?: string;
    eLevyLastFiledDate?: string;
    eLevyReceiptUrl?: string;
    vatLastFiledDate?: string;
    vatReceiptUrl?: string;
    totLastFiledDate?: string;
    totReceiptUrl?: string;
    mriLastFiledDate?: string;
    mriReceiptUrl?: string;
    dstLastFiledDate?: string;
    dstReceiptUrl?: string;
};

type FilingJobState = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'unknown' | 'cancelling' | 'cancelled';

type ActiveDashboardJob = {
    id: string;
    state: FilingJobState;
    progress: number;
    message: string;
    failedReason?: string;
};

function isPendingFilingJob(job?: ActiveDashboardJob | null) {
    return !!job && (job.state === 'waiting' || job.state === 'active' || job.state === 'delayed' || job.state === 'cancelling');
}

function isTerminalFilingJob(job?: ActiveDashboardJob | null) {
    return !!job && (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled');
}

function getAutoFileLabel(job?: ActiveDashboardJob | null) {
    if (!job) {
        return 'Auto-File';
    }

    if (job.state === 'waiting' || job.state === 'delayed') {
        return 'Queued...';
    }

    if (job.state === 'active') {
        return 'Filing...';
    }

    if (job.state === 'cancelling') {
        return 'Cancelling...';
    }

    return 'Auto-File';
}

function getFilingStatusLabel(job: ActiveDashboardJob) {
    if (job.state === 'completed') {
        return '✓ Finished';
    }

    if (job.state === 'failed') {
        return '⚠ Failed';
    }

    if (job.state === 'cancelled') {
        return '■ Cancelled';
    }

    if (job.state === 'cancelling') {
        return '◌ Cancelling';
    }

    return '⚙ Filing...';
}

function getFilingProgressTone(job: ActiveDashboardJob) {
    if (job.state === 'completed') {
        return 'bg-emerald-500';
    }

    if (job.state === 'failed') {
        return 'bg-red-500';
    }

    if (job.state === 'cancelled') {
        return 'bg-slate-500';
    }

    if (job.state === 'cancelling') {
        return 'bg-amber-500';
    }

    return 'bg-blue-500';
}



function StatusBadge({ status, generatedAt, lastFiledDate, receiptUrl }: { status: TaxStatus; generatedAt?: string; lastFiledDate?: string; receiptUrl?: string }) {
    if (status === 'na') return <span className="text-slate-600">-</span>;
    if (status === 'done') return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Done</span>;
    if (status === 'generated') return (
        <span className="inline-flex flex-col items-center">
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-semibold text-blue-400"><FileArchive className="h-3 w-3" /> Generated</span>
            {generatedAt && <span className="mt-1 text-[9px] font-medium text-slate-500 opacity-80">{generatedAt}</span>}
        </span>
    );
    if (status === 'filed') return (
        <span className="inline-flex flex-col items-center">
            {receiptUrl ? (
                <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-semibold text-indigo-400 hover:bg-indigo-500/30 transition-colors" title="Download Returns Receipt">
                    <CheckCircle2 className="h-3 w-3" /> Filed
                </a>
            ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-semibold text-indigo-400"><CheckCircle2 className="h-3 w-3" /> Filed</span>
            )}
            {lastFiledDate && <span className="mt-1 text-[10px] font-medium text-slate-400">{lastFiledDate}</span>}
        </span>
    );
    if (status === 'paid') return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Paid</span>;
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-400"><Clock className="h-3 w-3" /> Due</span>;
}

function InteractiveStatusBadge({ 
    status, 
    generatedAt,
    lastFiledDate,
    receiptUrl,
    onUpdateStatus 
}: { 
    status: TaxStatus; 
    generatedAt?: string;
    lastFiledDate?: string;
    receiptUrl?: string;
    onUpdateStatus: (newStatus: TaxStatus) => void 
}) {
    if (status === 'na' || status === 'done' || status === 'due') {
        return <StatusBadge status={status} lastFiledDate={lastFiledDate} receiptUrl={receiptUrl} />;
    }

    return (
        <div className="group relative inline-flex flex-col items-center justify-center">
            <div className="cursor-pointer transition" role="button" tabIndex={0}>
                <StatusBadge status={status} generatedAt={generatedAt} lastFiledDate={lastFiledDate} receiptUrl={receiptUrl} />
            </div>
            <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 z-50 hidden flex-col w-32 scale-95 opacity-0 group-hover:flex group-hover:scale-100 group-hover:opacity-100 items-center justify-center transition-all origin-top duration-200">
                <div className="rounded-xl border border-slate-700 bg-slate-800 shadow-2xl p-1.5 text-xs overflow-hidden flex flex-col gap-1 w-full">
                    <button 
                        onClick={() => onUpdateStatus('filed')}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-semibold text-indigo-400 hover:bg-indigo-500/20"
                    >
                        <CheckCircle2 className="h-3 w-3" /> Mark Filed
                    </button>
                    <button 
                        onClick={() => onUpdateStatus('paid')}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-semibold text-emerald-400 hover:bg-emerald-500/20"
                    >
                        <CheckCircle2 className="h-3 w-3" /> Mark Paid
                    </button>
                </div>
            </div>
        </div>
    );
}

function isPayrollDeskClient(client: ClientObligation) {
    return client.paye !== 'na' || client.nssf !== 'na' || client.sha !== 'na';
}

function markPayrollStatusesGenerated(client: ClientObligation): ClientObligation {
    const timestamp = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return {
        ...client,
        paye: client.paye === 'na' ? 'na' : 'generated',
        nssf: client.nssf === 'na' ? 'na' : 'generated',
        sha: client.sha === 'na' ? 'na' : 'generated',
        lastGeneratedAt: timestamp,
    };
}

const ExcelIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z" fill="#107C41" />
        <path d="M14 2V8H20" fill="#185C37" />
        <path d="M7 11.5L9 14L7 16.5H9L10 15L11 16.5H13L11 14L13 11.5H11L10 13L9 11.5H7Z" fill="white" />
    </svg>
);

const ZipIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M13 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V9L13 2Z" fill="#F2C811" />
        <path d="M13 2V9H20" fill="#D4AF37" />
        <rect x="9" y="4" width="2" height="2" fill="#71717A" />
        <rect x="9" y="8" width="2" height="2" fill="#71717A" />
        <rect x="9" y="12" width="2" height="2" fill="#71717A" />
        <rect x="11" y="6" width="2" height="2" fill="#71717A" />
        <rect x="11" y="10" width="2" height="2" fill="#71717A" />
        <rect x="9" y="14" width="4" height="3" rx="1" fill="#A1A1AA" />
    </svg>
);

export default function PracticeDashboard() {
    const [view, setView] = useState<DashboardView>('desk-9th');
    const [monthlyReturnFilter, setMonthlyReturnFilter] = useState<'ALL' | 'VAT' | 'TOT' | 'MRI' | 'DST'>('VAT');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState<PlanKey>('growth');
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
        if (clientToEdit?.id) {
            setEditingClientId(clientToEdit.id);
            setNewClientName(clientToEdit.name);
            setNewClientPin(clientToEdit.pin);
            setNewClientPassword(clientToEdit.password);
            setNewClientObligations(clientToEdit.obligations ? clientToEdit.obligations.split(',').map((s: string) => s.trim()) : []);
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
                    obligations: newClientObligations.join(', '),
                })
            });

            if (res.ok) {
                const updatedOrNewData = await res.json();
                if (newClientObligations.includes('paye') && newClientMasterCsv) {
                    setDashboardNotice({ tone: 'info', message: 'Generating standardized master CSV...' });
                    await handleUploadMasterCsv(updatedOrNewData.id, newClientMasterCsv);
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

    const handleUploadMasterCsv = async (clientId: string, file: File) => {
        setUploadingClientIds(current => ({ ...current, [clientId]: true }));
        const formData = new FormData();
        formData.append('masterCsv', file);
        try {
            const res = await apiFetch(`/clients/${clientId}/master-csv`, {
                method: 'POST',
                body: formData
            });
            if (res.ok) {
                setDashboardNotice({ tone: 'success', message: 'Master CSV uploaded securely.' });
                fetchClients(); // Refresh client data to show new URL
            } else {
                setDashboardNotice({ tone: 'error', message: 'Failed to upload CSV.' });
            }
        } catch (err) {
            setDashboardNotice({ tone: 'error', message: 'Upload error.' });
        } finally {
            setUploadingClientIds(current => {
                const nextState = { ...current };
                delete nextState[clientId];
                return nextState;
            });
        }
    };

    const plan = plans[selectedPlan];
    const capacityValue = plan.capacity === 'Unlimited' ? '∞' : plan.capacity;
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

            for (const [clientId, job] of Object.entries(currentJobs)) {
                if (isTerminalFilingJob(job)) continue;

                try {
                    const res = await apiFetch(`/tax/filing-status/${job.id}`);
                    if (!res.ok) continue;
                    const data = await res.json();
                    
                    const newMessage = data.lastStep?.message ?? currentJobs[clientId].message ?? 'Processing...';
                    const nextProgress = typeof data.progress === 'number' ? data.progress : currentJobs[clientId].progress;
                    if (currentJobs[clientId].state !== data.state || currentJobs[clientId].progress !== data.progress || currentJobs[clientId].message !== newMessage) {
                        currentJobs[clientId] = {
                            id: data.jobId,
                            state: data.state as FilingJobState,
                            progress: nextProgress,
                            message: newMessage,
                            failedReason: data.failedReason || ''
                        };
                        hasChanges = true;
                    }
                } catch (e) {
                     // suppress network errors so UI doesn't crash
                }
            }

            if (hasChanges) {
                setActiveJobs((prev) => ({ ...prev, ...currentJobs }));
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
                                    <button
                                        onClick={() => handleAutoFile(client)}
                                        disabled={(!client.masterFileUrl && !client.payrollSourceUrl && !client.payeZipUrl) || isPendingFilingJob(activeJobs[client.id])}
                                        className="flex items-center justify-center w-full gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-2.5 text-xs font-bold text-blue-400 transition hover:bg-blue-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                                    >
                                        <Rocket className="h-4 w-4 shrink-0" /> <span className="truncate">{getAutoFileLabel(activeJobs[client.id])}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="overflow-x-auto">
<table className="hidden lg:table w-full text-left text-sm text-slate-300">
                    <thead className="border-b border-slate-800 bg-slate-900 text-xs uppercase text-slate-400">
                        <tr>
                            <th className="px-2 py-3 sm:px-4 sm:py-4 font-semibold uppercase tracking-wider">Client Portfolio</th>
                            <th className="px-2 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider">Master CSV</th>
                            <th className='px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center'>PAYE</th>
                              <th className='px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center'>NITA</th>
                              <th className='px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center'>H. Levy</th>
                              <th className='px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center'>NSSF</th>
                              <th className='px-1 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider text-center'>SHA</th>
                            <th className="px-2 py-3 sm:px-2 sm:py-2 font-semibold uppercase tracking-wider">Latest Files</th>
                            <th className="px-2 py-3 sm:px-4 sm:py-4 font-semibold text-right uppercase tracking-wider w-32 min-w-[120px]">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {payrollClients.map((client) => (
                            <tr key={client.id} className="transition hover:bg-slate-800/50">
                                <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4">
                                    <div className="font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer" onClick={() => openNewClientModal(client)} title="Edit client details">{client.name}</div>
                                    <div className="mt-1 text-xs text-slate-500">{client.pin}</div>
                                </td>
                                <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-2 sm:py-2">
                                    {client.masterFileUrl ? (
                                        <div className="flex items-center gap-1.5 max-w-[160px] md:max-w-[240px]">
                                            <a href={client.masterFileUrl} target="_blank" rel="noreferrer" className="flex flex-1 items-center gap-2 truncate rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition">
                                                <FileSpreadsheet className="h-3 w-3 shrink-0 text-slate-500" />
                                                <span className="truncate">{client.masterFileLabel || 'Open file'}</span>
                                            </a>
                                            <label className="cursor-pointer shrink-0 rounded-lg border border-slate-600 bg-slate-700/30 p-1.5 hover:bg-slate-600 transition" title="Replace CSV/XLSX">
                                                <RefreshCw className="h-3 w-3 text-slate-400" />
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
                                                className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 p-1.5 hover:bg-red-500/20 transition" title="Remove Master CSV">
                                                <X className="h-3 w-3 text-red-400" />
                                            </button>
                                        </div>
                                    ) : (
                                        <label className="inline-flex min-w-[120px] cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-800 hover:text-white transition">
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
                                <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4 text-right">
                                    <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2 mb-2">
                                        <button
                                            onClick={() => void handleGenerateClientZip(client)}
                                            disabled={!(client.masterFileUrl || client.payrollSourceUrl) || Boolean(generatingClientIds[client.id]) || isGeneratingZips}
                                            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-bold leading-tight text-emerald-400 transition hover:bg-emerald-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                                        >
                                            {generatingClientIds[client.id] ? <RefreshCw className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                                            {(client.masterFileUrl || client.payrollSourceUrl) ? (generatingClientIds[client.id] ? 'Generating...' : 'Auto Gen ZIP') : 'No CSV'}
                                        </button>
                                        <button
                                            onClick={() => handleAutoFile(client)}
                                            disabled={!(client.masterFileUrl || client.payrollSourceUrl || client.payeZipUrl) || isPendingFilingJob(activeJobs[client.id])}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-bold leading-tight text-blue-400 transition hover:bg-blue-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                                        >
                                            <Rocket className="h-3 w-3" /> {getAutoFileLabel(activeJobs[client.id])}
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
                                            <div className="flex flex-col gap-2 rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 shadow-sm group-hover:border-slate-600 transition">
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-slate-400 font-medium">Input VAT <span className="font-normal text-[10px] ml-1 text-slate-500">(Purchases)</span></span>
                                                    <span className="text-slate-200 font-bold border-b border-transparent">KES {isEtimsConnected ? '68,400.00' : '0.00'}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-slate-400 font-medium">Output VAT <span className="font-normal text-[10px] ml-1 text-slate-500">(Sales)</span></span>
                                                    <span className="text-slate-200 font-bold border-b border-transparent">KES {isEtimsConnected ? '124,500.00' : '0.00'}</span>
                                                </div>
                                                <div className="border-t border-slate-700/80 my-1 pt-2.5 flex justify-between items-center text-xs">
                                                    <span className="font-bold text-blue-400">VAT Payable <span className="font-normal text-[10px] ml-1 opacity-70">(Remaining)</span></span>
                                                    <span className="font-black text-[13px] text-blue-400 drop-shadow-sm">KES {isEtimsConnected ? '56,100.00' : '0.00'}</span>
                                                </div>
                                            </div>
                                        )}
                                        {ob.type === 'TOT' && (
                                            <div className="flex flex-col gap-2 rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 shadow-sm group-hover:border-slate-600 transition">
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-slate-400 font-medium">Total Sales <span className="font-normal text-[10px] ml-1 text-slate-500">(eTIMS)</span></span>
                                                    <span className="text-slate-200 font-bold border-b border-transparent">KES {isEtimsConnected ? '450,000.00' : '0.00'}</span>
                                                </div>
                                                <div className="border-t border-slate-700/80 my-1 pt-2.5 flex justify-between items-center text-xs">
                                                    <span className="font-bold text-blue-400">1.5% Computed TOT</span>
                                                    <span className="font-black text-[13px] text-blue-400 drop-shadow-sm">KES {isEtimsConnected ? '6,750.00' : '0.00'}</span>
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
                                        <button className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition shadow-sm drop-shadow mt-1">
                                            Process Return
                                        </button>
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
                <aside className={`absolute inset-y-0 left-0 z-50 w-72 shrink-0 border-r border-slate-800 bg-slate-950 p-6 flex flex-col transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                    <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-slate-950">
                                <Building2 className="h-5 w-5" />
                            </div>
                            <div>
                                <span className="text-xl font-bold tracking-tight text-white">Kwanta<span className="text-emerald-500">.</span></span>
                            </div>
                        </div>
                        <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
                            <X className="h-6 w-6" />
                        </button>
                    </div>

                    <nav className="mt-10 space-y-1.5 flex-1">
                        <button onClick={() => { setView('overview'); setIsSidebarOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'overview' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}>
                            <LayoutDashboard className="h-4 w-4" /> Overview
                        </button>
                        
                        <div className="pt-6 pb-2 px-3">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Tax Filing Desks</p>
                        </div>
                        <button onClick={() => { setView('desk-9th'); setIsSidebarOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'desk-9th' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:bg-slate-900 border border-transparent'}`}>
                            <span className="flex items-center gap-3"><Users className="h-4 w-4" /> Payroll Processing</span>
                            <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-amber-500/20 px-1 text-xs font-bold text-amber-500">{payrollPendingCount}</span>
                        </button>
                        <button onClick={() => { setView('desk-20th'); setIsSidebarOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'desk-20th' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-slate-400 hover:bg-slate-900 border border-transparent'}`}>
                            <span className="flex items-center gap-3"><TerminalSquare className="h-4 w-4" /> VAT & Monthly Returns</span>
                            <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-amber-500/20 px-1 text-xs font-bold text-amber-500">{taxPendingCount}</span>
                        </button>
                        <button onClick={() => { setView('desk-elevy'); setIsSidebarOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'desk-elevy' ? 'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20' : 'text-slate-400 hover:bg-slate-900 border border-transparent'}`}>
                            <span className="flex items-center gap-3"><Activity className="h-4 w-4" /> Tourism Fund Desk</span>
                        </button>

                        <div className="pt-6 pb-2 px-3">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Tax Practice</p>
                        </div>
                        <button onClick={() => { setView('clients'); setIsSidebarOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'clients' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}>
                            <Building2 className="h-4 w-4" /> Client Database
                        </button>
                    </nav>

                    <div className="mt-auto border-t border-slate-800 pt-6">
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
                            <p className="text-xs font-medium text-slate-400">{plan.label}</p>
                            <div className="mt-2 flex items-end justify-between">
                                <p className="text-xl font-bold text-white">{plan.used} <span className="text-sm font-normal text-slate-500">/ {capacityValue} PINs</span></p>
                            </div>
                            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                                <div className={`h-full rounded-full ${capacityPercentage > 85 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${capacityPercentage}%` }} />
                            </div>
                            <select 
                                value={selectedPlan} 
                                onChange={(e) => setSelectedPlan(e.target.value as PlanKey)}
                                className="mt-4 w-full rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-white border border-slate-700 outline-none"
                            >
                                <option value="starter">Practice Starter</option>
                                <option value="growth">Growing Firm</option>
                                <option value="enterprise">Enterprise Desk</option>
                            </select>
                        </div>
                        <Link to="/" className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium text-slate-400 transition hover:bg-slate-900 hover:text-white">
                            <LogOut className="h-4 w-4" /> Sign Out
                        </Link>
                    </div>
                </aside>

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

                    {selectedClient && <div className="mt-10"><CompanyDetails client={selectedClient} onBack={() => setSelectedClient(null)} onSave={(updated) => { setClients(clients.map(c => c.id === updated.id ? updated : c)); setSelectedClient(null); }} /></div>}
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
                                                    <p className="text-xs text-slate-500">PAYE data ready â€¢ 2 hours ago</p>
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
                                                    <p className="text-xs text-slate-500">VAT pending â€¢ 4 hours ago</p>
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
                                                    <p className="text-xs text-slate-500">Operational â€¢ Updated 5 min ago</p>
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
                                 {view === 'clients' && !selectedClient && (
                        <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
                            <div className="overflow-x-auto pb-8">
                                <table className="w-full text-left text-sm text-slate-300">
                                    <thead className="border-b border-slate-800 bg-slate-900/50">
                                        <tr>
                                            <th className="px-4 py-4 font-semibold uppercase tracking-wider">Firm / Client</th>
                                            <th className="px-4 py-4 font-semibold uppercase tracking-wider">KRA PIN</th>
                                            <th className="px-4 py-4 font-semibold uppercase tracking-wider">Active Obligations</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {clients.map(client => (
                                            <tr key={client.id} className="transition hover:bg-slate-800/50">
                                                <td className="px-4 py-4">
                                                    <button onClick={() => setSelectedClient(client)} className="flex items-center gap-3 text-left hover:opacity-80">
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400"><Building2 className="h-5 w-5" /></div>
                                                        <div className="font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer" onClick={() => openNewClientModal(client)} title="Edit client details">{client.name}</div>
                                                    </button>
                                                </td>
                                                <td className="px-4 py-4 font-mono text-slate-400">{client.pin}</td>
                                                <td className="px-4 py-4">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {Object.entries({ vat: client.vat, tot: client.tot, mri: client.mri, paye: client.paye, nssf: client.nssf, sha: client.sha, eLevy: client.eLevy }).map(([obs, status]) => {
                                                            if (status !== 'na' && status) {
                                                                return <span key={obs} className="inline-flex rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-300">{obs}</span>;
                                                            }
                                                            return null;
                                                        })}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
       </div>
                </main>
            </div>

            
                                

                    {showNewClientModal && (
                        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm">
                            <div className="flex min-h-full items-start justify-center py-4 sm:items-center">
                                <div className="flex w-full max-w-2xl max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
                                    <div className="flex shrink-0 items-center justify-between border-b border-slate-800 p-6">
                                        <div>
                                            <h2 className="text-xl font-bold text-white">{editingClientId ? 'Edit Client' : 'Onboard New Client'}</h2>
                                            <p className="mt-1 text-sm text-slate-400">Add a client and select their active obligations.</p>
                                        </div>
                                        <button type="button" onClick={resetNewClientForm} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white">
                                            <X className="h-5 w-5" />
                                        </button>
                                    </div>

                                    <div className="flex-1 overflow-y-auto p-6">
                                        <div className="space-y-6">
                                            <div className="grid gap-4 sm:grid-cols-2">
                                                <div>
                                                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Client Name</label>
                                                    <input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} type="text" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500" placeholder="e.g. Acme Corp" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">KRA PIN</label>
                                                    <input value={newClientPin} onChange={(e) => setNewClientPin(e.target.value.toUpperCase())} type="text" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500" placeholder="e.g. P123456789A" />
                                                </div>
                                                <div className="sm:col-span-2">
                                                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">KRA Password</label>
                                                    <input value={newClientPassword} onChange={(e) => setNewClientPassword(e.target.value)} type="password" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500" placeholder="Keep this secure" />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Select Active Obligations</label>
                                                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                                    {[
                                                        { id: 'paye', label: 'PAYE' },
                                                        { id: 'nssf', label: 'NSSF' },
                                                        { id: 'sha', label: 'SHA' },
                                                        { id: 'elevy', label: 'eLevy' },
                                                        { id: 'vat', label: 'VAT' },
                                                        { id: 'tot', label: 'TOT' },
                                                        { id: 'mri', label: 'MRI' },
                                                        { id: 'dst', label: 'DST' },
                                                    ].map((obs) => {
                                                        const isActive = newClientObligations.includes(obs.id);
                                                        return (
                                                            <button
                                                                key={obs.id}
                                                                type="button"
                                                                onClick={() => {
                                                                    setNewClientModalError(null);
                                                                    setNewClientObligations((prev) => (
                                                                        prev.includes(obs.id)
                                                                            ? prev.filter((currentObligation) => currentObligation !== obs.id)
                                                                            : [...prev, obs.id]
                                                                    ));
                                                                }}
                                                                className={`flex items-center justify-center rounded-xl border p-4 text-sm font-bold transition-all ${
                                                                    isActive
                                                                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                                                                        : 'border-slate-700 bg-slate-800/30 text-slate-400 hover:border-slate-600 hover:bg-slate-800'
                                                                }`}
                                                            >
                                                                {obs.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {newClientObligations.some((obligation) => ['paye', 'nssf', 'sha'].includes(obligation)) && (
                                                <div className="animate-in slide-in-from-top-2 fade-in duration-300">
                                                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                                                        <div className="mb-4 flex items-center justify-between gap-3">
                                                            <div className="flex items-center gap-3">
                                                                <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                                                                    <Building2 className="h-4 w-4" /> Unified Payroll Master
                                                                </h3>
                                                                <span className="flex h-5 items-center rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">Optional</span>
                                                            </div>
                                                            {newClientMasterCsv && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        if (window.confirm('Are you sure you want to remove this Master CSV?')) {
                                                                            setNewClientMasterCsv(null);
                                                                        }
                                                                    }}
                                                                    className="rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-400 transition hover:bg-red-500/20 hover:text-red-300"
                                                                >
                                                                    Remove File
                                                                </button>
                                                            )}
                                                        </div>
                                                        <p className="mt-2 text-xs text-emerald-200/70">
                                                            Upload any master payroll spreadsheet containing employee details (Name, ID, PIN, NHIF, NSSF).
                                                            The system will automatically ingest the data, format it to the KRA Unified Payroll standard,
                                                            and generate the Master CSV for you.
                                                        </p>

                                                        {!newClientMasterCsv && (
                                                            <div className="mt-4 flex w-full items-center justify-center">
                                                                <label htmlFor="dropzone-file" className="flex h-24 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-500/30 bg-slate-900/50 transition hover:border-emerald-500/50 hover:bg-emerald-500/10">
                                                                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                                                        <p className="mb-1 text-sm font-bold text-slate-400">
                                                                            Click to upload <span className="font-normal text-slate-500">or drag and drop</span>
                                                                        </p>
                                                                        <p className="text-xs text-slate-500">.CSV or .XLSX</p>
                                                                    </div>
                                                                    <input
                                                                        id="dropzone-file"
                                                                        type="file"
                                                                        accept=".csv, .xlsx, .xls"
                                                                        className="hidden"
                                                                        onChange={(e) => {
                                                                            if (e.target.files && e.target.files.length > 0) {
                                                                                setNewClientMasterCsv(e.target.files[0]);
                                                                            }
                                                                        }}
                                                                    />
                                                                </label>
                                                            </div>
                                                        )}

                                                        {newClientMasterCsv && (
                                                            <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-500/20 p-4">
                                                                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                                                                <span className="text-sm font-bold text-emerald-300">File Selected: {newClientMasterCsv.name}</span>
                                                                <span className="text-xs text-emerald-400/80">Ready to automatically generate standard KRA templates on process.</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {newClientObligations.some((obligation) => ['vat', 'tot', 'dst'].includes(obligation)) && (
                                                <div className="animate-in slide-in-from-top-2 fade-in duration-300">
                                                    <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-5">
                                                        <div className="mb-2 flex items-center justify-between">
                                                            <div className="flex items-center gap-3">
                                                                <h3 className="flex items-center gap-2 text-sm font-bold text-blue-400">
                                                                    <Activity className="h-4 w-4" /> Non-Payroll Return Obligations
                                                                </h3>
                                                            </div>
                                                        </div>
                                                        <p className="text-xs text-blue-300">For VAT, TOT, and DST setup, proceed to the <strong>VAT & Monthly Returns</strong> after saving. There, you can upload the specific Sales & Purchases CSV datasets dynamically per period.</p>
                                                    </div>
                                                </div>
                                            )}

                                            {newClientObligations.includes('mri') && (
                                                <div className="animate-in slide-in-from-top-2 fade-in duration-300">
                                                    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5">
                                                        <div className="mb-2 flex items-center justify-between">
                                                            <div className="flex items-center gap-3">
                                                                <h3 className="flex items-center gap-2 text-sm font-bold text-rose-400">
                                                                    <Building2 className="h-4 w-4" /> Monthly Rental Income Setup
                                                                </h3>
                                                            </div>
                                                        </div>
                                                        <p className="text-xs text-rose-300">Proceed to the <strong>VAT & Monthly Returns</strong> to enter the real-time rent amount manually per client before filing.</p>
                                                    </div>
                                                </div>
                                            )}

                                            {newClientModalError && (
                                                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
                                                    {newClientModalError}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-800 bg-slate-900/50 p-6">
                                        <button type="button" onClick={resetNewClientForm} className="rounded-xl px-5 py-2.5 text-sm font-bold text-slate-400 transition hover:text-white">
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSaveClient}
                                            disabled={isSavingClient}
                                            className={`rounded-xl px-6 py-2.5 text-sm font-bold text-slate-950 shadow-[0_0_20px_rgba(16,185,129,0.2)] transition ${
                                                isSavingClient
                                                    ? 'cursor-not-allowed bg-emerald-500/60 text-slate-900/70'
                                                    : 'bg-emerald-500 hover:bg-emerald-400'
                                            }`}
                                        >
                                            {isSavingClient ? 'Saving...' : 'Save Client'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
        </div>
    );
}