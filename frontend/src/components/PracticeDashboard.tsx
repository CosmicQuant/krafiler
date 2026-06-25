import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import CompanyDetails from './CompanyDetails';
import { useUIStore } from '../store/uiStore';
import { useClients, useSaveClient } from '../hooks/useClients';
import { useFilingActions } from '../hooks/useFilingActions';
import { useJobListener } from '../hooks/useJobListener';
import { useAuth } from '../contexts/AuthContext';
import { Sidebar } from './dashboard/Sidebar';
import { NewClientModal } from './dashboard/NewClientModal';
import { OverviewView } from './dashboard/views/OverviewView';
import { ClientsView } from './dashboard/views/ClientsView';
import { PayrollViewShell } from './dashboard/views/PayrollViewShell';
import { VatClientView } from './dashboard/views/VatClientView';
import { TotClientView } from './dashboard/views/TotClientView';
import { MriClientView } from './dashboard/views/MriClientView';
import { DstClientView } from './dashboard/views/DstClientView';
import { NilClientView } from './dashboard/views/NilClientView';

import { apiFetch } from '../services/api';

import {
  Building2,
  Menu,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';

import { ClientObligation, ActiveDashboardJob } from '../types';
import { normalizeClientObligation } from '../utils/dashboardUtils';

export default function PracticeDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const queryClient = useQueryClient();

  // UI Store
  const {
    view,
    setView,
    isSidebarOpen,
    setIsSidebarOpen,
    showNewClientModal,
    setShowNewClientModal,
  } = useUIStore();

  // Clients from React Query
  const { data: fetchedClients } = useClients();
  const [clients, setClients] = useState<ClientObligation[]>([]);

  useEffect(() => {
    if (fetchedClients) {
      setClients(fetchedClients);
    }
  }, [fetchedClients]);

  // Client save mutation
  const saveClientMutation = useSaveClient();
  const isSavingClient = saveClientMutation.isPending;

  // Local state
  const [selectedClient, setSelectedClient] = useState<ClientObligation | null>(null);
  const hasObligation = (val?: string | null) => !!val && val !== 'na';

  const handleGoToPayrollView = (client: ClientObligation) => {
    navigate(`/dashboard/client/${client.id}/payroll`);
  };

  const [, setIsGeneratingZips] = useState(false);
  const [, setIsGlobalUploading] = useState(false);
  const [, setGeneratingClientIds] = useState<Record<string, boolean>>({});
  const [activeJobs, setActiveJobs] = useState<Record<string, ActiveDashboardJob>>({});
  const [nilSelections, setNilSelections] = useState<Record<string, { type: string; periodFrom: string; periodTo: string; ownsRentalProperty?: boolean }>>({});
  const [cancellingClientIds, setCancellingClientIds] = useState<Record<string, boolean>>({});
  const [, setUploadingClientIds] = useState<Record<string, boolean>>({});
  const [dashboardNotice, setDashboardNotice] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);

  // New Client Modal State
  const [editingClientId, setEditingClientId] = useState<number | null>(null);
  const [newClientObligations, setNewClientObligations] = useState<string[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPin, setNewClientPin] = useState('');
  const [newClientPassword, setNewClientPassword] = useState('');
  const [mriInputVals, setMriInputVals] = useState<Record<string, string>>({});
  const [totInputVals, setTotInputVals] = useState<Record<string, string>>({});
  const [vatPreviousCreditVals] = useState<Record<string, string>>({});
  const [vatSectionBWithoutPinVals, setVatSectionBWithoutPinVals] = useState<Record<string, string>>({});
  const [newClientMasterCsv, setNewClientMasterCsv] = useState<File | null>(null);
  const [newClientModalError, setNewClientModalError] = useState<string | null>(null);
  const [newClientPayStructure, setNewClientPayStructure] = useState<'fixed' | 'prorated'>('fixed');

  const resetNewClientForm = () => {
    setEditingClientId(null);
    setShowNewClientModal(false);
    setNewClientName('');
    setNewClientPin('');
    setNewClientPassword('');
    setNewClientObligations([]);
    setNewClientMasterCsv(null);
    setNewClientModalError(null);
    setNewClientPayStructure('fixed');
  };

  const openNewClientModal = (clientToEdit?: ClientObligation) => {
    setNewClientMasterCsv(null);

    if (clientToEdit?.id) {
      setEditingClientId(Number(clientToEdit.id));
      setNewClientName(clientToEdit.name);
      setNewClientPin(clientToEdit.pin);
      setNewClientPassword(clientToEdit.password || '');
      setNewClientObligations(
        Array.isArray(clientToEdit.obligations)
          ? clientToEdit.obligations.map((s: string) => normalizeClientObligation(s)).filter(Boolean)
          : clientToEdit.obligations
            ? String(clientToEdit.obligations)
                .split(',')
                .map((s: string) => normalizeClientObligation(s))
                .filter(Boolean)
            : [],
      );
      setNewClientPayStructure((clientToEdit as any).payStructure || 'fixed');
    } else {
      setEditingClientId(null);
      setNewClientName('');
      setNewClientPin('');
      setNewClientPassword('');
      setNewClientObligations([]);
      setNewClientPayStructure('fixed');
    }
    setNewClientModalError(null);
    setShowNewClientModal(true);
  };

  const filingActions = useFilingActions({
    setDashboardNotice,
    setClients,
    setSelectedClient,
    setActiveJobs,
    setGeneratingClientIds,
    setCancellingClientIds,
    setUploadingClientIds,
    setIsGeneratingZips,
    setIsGlobalUploading,
    getActiveJobs: () => activeJobs,
    getNilSelections: () => nilSelections,
    getVatPreviousCreditVals: () => vatPreviousCreditVals,
    getVatSectionBWithoutPinVals: () => vatSectionBWithoutPinVals,
    getMriInputVals: () => mriInputVals,
    getTotInputVals: () => totInputVals,
  });

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

    setNewClientModalError(null);

    try {
      const result = await saveClientMutation.mutateAsync({
        id: editingClientId !== null ? String(editingClientId) : null,
        data: {
          name,
          pin,
          password,
          obligations: newClientObligations.map(normalizeClientObligation).join(', '),
          payStructure: newClientPayStructure,
        },
      });

      if (newClientObligations.includes('paye') && newClientMasterCsv) {
        await filingActions.uploadMasterCsv(String(result.id), newClientMasterCsv, { propagateError: true });
        setDashboardNotice({
          tone: 'success',
          message: editingClientId !== null
            ? 'Client updated and master CSV uploaded successfully.'
            : 'Client saved and master CSV uploaded successfully.',
        });
      } else {
        setDashboardNotice({
          tone: 'success',
          message: editingClientId !== null ? 'Client updated successfully.' : 'Client saved successfully.',
        });
      }
      resetNewClientForm();
    } catch (error) {
      console.error('Save client error:', error);
      const message =
        error instanceof TypeError
          ? 'Could not reach the backend API. Start or restart the backend server on port 3001 and try again.'
          : error instanceof Error
            ? error.message
            : 'Failed to save client.';
      setNewClientModalError(message);
      setDashboardNotice({ tone: 'error', message });
    }
  };

  const handleSaveClientDetails = async (updatedClient: ClientObligation) => {
    const name = updatedClient.name?.trim();
    const pin = updatedClient.pin?.trim().toUpperCase();

    if (!updatedClient.id || !name || !pin) {
      throw new Error('Client name and KRA PIN are required before saving.');
    }

    const payload: Record<string, any> = {
      name,
      pin,
      obligations: updatedClient.obligations || '',
      sector: updatedClient.sector || '',
      email: updatedClient.email || '',
      phone: updatedClient.phone || '',
      defaultWorkScheduleId: updatedClient.defaultWorkScheduleId ?? null,
      nssfNo: updatedClient.nssfNo || null,
      nssfPassword: updatedClient.nssfPassword || null,
      shaLogin: updatedClient.shaLogin || null,
      shaPassword: updatedClient.shaPassword || null,
      helbLogin: updatedClient.helbLogin || null,
      helbPassword: updatedClient.helbPassword || null,
    };

    // Only send password if it was actually entered/updated
    const password = (updatedClient.iTaxPassword || updatedClient.password || '').trim();
    if (password) {
      payload.password = password;
    }

    const res = await apiFetch(`/clients/${updatedClient.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const responseData = await res.json().catch(async () => ({ message: await res.text().catch(() => '') }));

    if (!res.ok) {
      throw new Error(responseData.message || responseData.error || 'Failed to save client details.');
    }

    await queryClient.invalidateQueries({ queryKey: ['clients'] });
    setSelectedClient(responseData);
    setDashboardNotice({ tone: 'success', message: 'Client details saved successfully.' });
  };

  // Real-time Firestore job listener (replaces 2-second REST polling)
  useJobListener(user, activeJobs, setActiveJobs, setClients);

  const payrollClients = useMemo(() => clients.filter((c) => hasObligation(c.paye) || hasObligation(c.nssf) || hasObligation(c.sha)), [clients]);
  const payrollPendingCount = useMemo(
    () => payrollClients.filter((client) => client.paye === 'due' || client.nssf === 'due' || client.sha === 'due').length,
    [payrollClients],
  );
  const taxPendingCount = useMemo(
    () => clients.filter((client) => client.vat === 'due' || client.tot === 'due' || client.mri === 'due' || client.dst === 'due').length,
    [clients],
  );

  return (
    <div className="flex h-screen bg-slate-50 font-sans antialiased selection:bg-red-100">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div className="flex w-full overflow-hidden relative">
        <Sidebar
          payrollPendingCount={payrollPendingCount}
          taxPendingCount={taxPendingCount}
        />

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto relative bg-white">
          {/* Mobile Header Line */}
          <div className="lg:hidden flex items-center justify-between sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setIsSidebarOpen(true)} className="text-slate-400 hover:text-slate-900">
                <Menu className="h-6 w-6" />
              </button>
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#ff0613] text-white">
                  <Building2 className="h-4 w-4" />
                </div>
                <span className="text-lg font-bold tracking-tight text-slate-900">
                  zani
                </span>
              </div>
            </div>
          </div>

          <div className="flex-1 px-4 py-6 md:px-8 md:py-8 lg:px-12">
            <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                {view === 'overview' && <h1 className="text-3xl font-black text-slate-900">Practice Overview</h1>}
                {view === 'payroll' && <h1 className="text-3xl font-black text-[#ff0613]">Payroll Pipeline</h1>}
                {view === 'vat' && <h1 className="text-3xl font-black text-blue-600">VAT Returns</h1>}
                {view === 'tot' && <h1 className="text-3xl font-black text-emerald-600">ToT Returns</h1>}
                {view === 'mri' && <h1 className="text-3xl font-black text-rose-600">MRI Returns</h1>}
                {view === 'dst' && <h1 className="text-3xl font-black text-fuchsia-600">DST Returns</h1>}
                {view === 'nil-filing' && <h1 className="text-3xl font-black text-slate-900">Nil Filing</h1>}
                {view === 'income-tax-individual' && <h1 className="text-3xl font-black text-blue-600">Income Tax Individual</h1>}
                {view === 'income-tax-company' && <h1 className="text-3xl font-black text-blue-600">Income Tax Company</h1>}
                {view === 'clients' && <h1 className="text-3xl font-black text-slate-900">Client Portfolio</h1>}
                <p className="mt-2 text-sm text-slate-500">
                  {view === 'payroll' ? (
                    <>Manage bulk payroll processing for {payrollClients.length} active client{payrollClients.length === 1 ? '' : 's'}.</>
                  ) : view === 'clients' ? (
                    <>Manage your client portfolio.</>
                  ) : (
                    <>Manage returns for your clients.</>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
                <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 w-full sm:w-auto">
                  <Search className="h-4 w-4 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    placeholder="Search client or PIN..."
                    className="ml-2 bg-transparent text-sm text-slate-900 placeholder-slate-400 outline-none w-full"
                  />
                </div>
                {view === 'clients' && (
                  <button
                    onClick={() => openNewClientModal()}
                    className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-[#ff0613] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#d80000]"
                  >
                    <Plus className="h-4 w-4" /> New Client
                  </button>
                )}
              </div>
            </header>

            {/* Error / Success notices only (info suppressed — button animations handle loading states) */}
            {dashboardNotice && dashboardNotice.tone !== 'info' && (
              <div
                className={`mb-4 rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-between ${
                  dashboardNotice.tone === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                <span>{dashboardNotice.message}</span>
                <button
                  onClick={() => setDashboardNotice(null)}
                  className="ml-3 rounded p-1 hover:bg-white/60 transition"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Payroll Pipeline Routes — explicit pathname matching */}
            {(() => {
              // Extract client ID from pathname (e.g. /dashboard/client/160/payroll)
              const pathMatch = location.pathname.match(/\/dashboard\/client\/([^/]+)/);
              const pathClientId = pathMatch ? pathMatch[1] : null;
              const resolvedClient = pathClientId != null
                ? clients.find((c) => String(c.id) === pathClientId) || selectedClient || null
                : selectedClient || null;

              if (!fetchedClients) {
                return (
                  <div className="mt-10 flex items-center justify-center py-20">
                    <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
                  </div>
                );
              }

              if (!resolvedClient) {
                return <Navigate to="/dashboard" replace />;
              }

              const p = location.pathname;
              const isPayroll = p.startsWith('/dashboard/client/') && p.includes('/payroll');

              if (!isPayroll) return null;

              return (
                <div className="mt-10">
                  <PayrollViewShell
                    clients={clients}
                    initialClient={resolvedClient}
                  />
                </div>
              );
            })()}

            {selectedClient && view !== 'payroll' && !location.pathname.includes('/payroll') && (
              <div className="mt-10">
                <CompanyDetails
                  client={selectedClient}
                  onBack={() => setSelectedClient(null)}
                  onSave={handleSaveClientDetails}
                  onGoToPayrollView={() => handleGoToPayrollView(selectedClient)}
                />
              </div>
            )}

            {!selectedClient && view === 'overview' && (
              <OverviewView
                clients={clients}
                activeJobs={activeJobs}
                onOpenNewClientModal={() => openNewClientModal()}
                onNavigateToView={(v) => setView(v)}
                onBulkCsvUpload={filingActions.bulkCsvUpload(() => queryClient.invalidateQueries({ queryKey: ['clients'] }))}
                onSelectClient={setSelectedClient}
                onCancelJob={filingActions.cancelAutoFile}
                cancellingClientIds={cancellingClientIds}
              />
            )}

            {view === 'payroll' && !location.pathname.includes('/payroll') && (
              <PayrollViewShell
                clients={clients}
                initialClient={null}
              />
            )}

            {!selectedClient && view === 'vat' && (
              <VatClientView
                clients={clients}
                activeJobs={activeJobs}
                vatSectionBWithoutPinVals={vatSectionBWithoutPinVals}
                setVatSectionBWithoutPinVals={setVatSectionBWithoutPinVals}
                onPrepareVat={filingActions.prepareVat}
                onPrepareCurrentMonthVat={filingActions.prepareCurrentMonthVat}
                onConfirmVatFiling={filingActions.confirmVatFiling}
                onGeneratePrn={filingActions.generatePrn}
                onCancelJob={filingActions.cancelAutoFile}
                setClients={setClients}
              />
            )}
            {!selectedClient && view === 'tot' && (
              <TotClientView
                clients={clients}
                activeJobs={activeJobs}
                totInputVals={totInputVals}
                setTotInputVals={setTotInputVals}
                onFileTot={filingActions.fileTot}
                onGenerateTotZip={filingActions.generateTotZip}
                onGeneratePrn={filingActions.generatePrn}
                onCancelJob={filingActions.cancelAutoFile}
                cancellingClientIds={cancellingClientIds}
              />
            )}
            {!selectedClient && view === 'mri' && (
              <MriClientView
                clients={clients}
                activeJobs={activeJobs}
                mriInputVals={mriInputVals}
                setMriInputVals={setMriInputVals}
                onFileMri={filingActions.fileMri}
                onGeneratePrn={filingActions.generatePrn}
                onCancelJob={filingActions.cancelAutoFile}
                cancellingClientIds={cancellingClientIds}
              />
            )}
            {!selectedClient && view === 'dst' && (
              <DstClientView
                clients={clients}
                activeJobs={activeJobs}
                onAutoFile={filingActions.autoFile}
                onGeneratePrn={filingActions.generatePrn}
                onCancelJob={filingActions.cancelAutoFile}
                cancellingClientIds={cancellingClientIds}
              />
            )}

            {view === 'clients' && !selectedClient && (
              <ClientsView
                clients={clients}
                onSelectClient={setSelectedClient}
                onEditClient={openNewClientModal}
              />
            )}

            {!selectedClient && view === 'nil-filing' && (
              <NilClientView
                clients={clients}
                activeJobs={activeJobs}
                nilSelections={nilSelections}
                setNilSelections={setNilSelections}
                onFileNil={filingActions.fileNil}
                onCancelJob={filingActions.cancelAutoFile}
                cancellingClientIds={cancellingClientIds}
              />
            )}
            {!selectedClient && view === 'income-tax-individual' && (
              <NilClientView
                clients={clients}
                activeJobs={activeJobs}
                nilSelections={nilSelections}
                setNilSelections={setNilSelections}
                onFileNil={filingActions.fileNil}
                onCancelJob={filingActions.cancelAutoFile}
                cancellingClientIds={cancellingClientIds}
                filterType="income-tax-individual"
              />
            )}
            {!selectedClient && view === 'income-tax-company' && (
              <NilClientView
                clients={clients}
                activeJobs={activeJobs}
                nilSelections={nilSelections}
                setNilSelections={setNilSelections}
                onFileNil={filingActions.fileNil}
                onCancelJob={filingActions.cancelAutoFile}
                cancellingClientIds={cancellingClientIds}
                filterType="income-tax-company"
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
          newClientPayStructure={newClientPayStructure}
          setNewClientPayStructure={setNewClientPayStructure}
          isSavingClient={isSavingClient}
          resetNewClientForm={resetNewClientForm}
          handleSaveClient={handleSaveClient}
        />
      )}
    </div>
  );
}
