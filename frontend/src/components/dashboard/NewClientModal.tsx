import { Building2, CheckCircle2, Activity, X } from 'lucide-react';

type NewClientModalProps = {
    editingClientId: number | null;
    newClientName: string;
    setNewClientName: (v: string) => void;
    newClientPin: string;
    setNewClientPin: (v: string) => void;
    newClientPassword: string;
    setNewClientPassword: (v: string) => void;
    newClientObligations: string[];
    setNewClientObligations: React.Dispatch<React.SetStateAction<string[]>>;
    newClientMasterCsv: File | null;
    setNewClientMasterCsv: (f: File | null) => void;
    newClientModalError: string | null;
    setNewClientModalError: (e: string | null) => void;
    isSavingClient: boolean;
    resetNewClientForm: () => void;
    handleSaveClient: () => void;
};

export function NewClientModal({
    editingClientId,
    newClientName, setNewClientName,
    newClientPin, setNewClientPin,
    newClientPassword, setNewClientPassword,
    newClientObligations, setNewClientObligations,
    newClientMasterCsv, setNewClientMasterCsv,
    newClientModalError, setNewClientModalError,
    isSavingClient,
    resetNewClientForm,
    handleSaveClient,
}: NewClientModalProps) {
    return (
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
    );
}
