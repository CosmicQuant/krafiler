import { useState } from 'react';
import { ArrowLeft, Save, Building2, FileSpreadsheet, Percent, Calculator, FileArchive, Cloud } from 'lucide-react';
import { ClientObligation } from '../types';

interface CompanyDetailsProps {
    client: ClientObligation; // We'll pass the client from PracticeDashboard
    onBack: () => void;
    onSave: (updatedClient: ClientObligation) => void | Promise<void>;
    onFileAction?: (client: ClientObligation) => void;
}

const ALL_OBLIGATIONS = [
    { key: 'paye', label: 'PAYE' },
    { key: 'nssf', label: 'NSSF' },
    { key: 'sha', label: 'SHA' },
    { key: 'vat', label: 'VAT' },
    { key: 'tot', label: 'TOT' },
    { key: 'mri', label: 'MRI' },
    { key: 'eLevy', label: 'E-Levy' },
    { key: 'dst', label: 'DST' },
];

export default function CompanyDetails({ client, onBack, onSave, onFileAction }: CompanyDetailsProps) {
    const [formData, setFormData] = useState({ ...client });
    const [selectedObligations, setSelectedObligations] = useState<string[]>(() => {
        if (client.obligations) {
            return client.obligations.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
        }
        return [];
    });
    const [vatInput, setVatInput] = useState('');
    const [vatOutput, setVatOutput] = useState('');
    const [totSales, setTotSales] = useState('');
    const [isUploadingCSV, setIsUploadingCSV] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const handleUploadCSV = async (file: File) => {
        setIsUploadingCSV(true);
        const data = new FormData();
        data.append('masterCsv', file);
        try {
            const res = await fetch(`/api/clients/${client.id}/master-csv`, {
                method: 'POST',
                body: data
            });
            if (res.ok) {
                const responseData = await res.json();
                setFormData((prev: ClientObligation) => ({
                    ...prev,
                    masterFileUrl: responseData.masterFileUrl,
                    masterFileLabel: responseData.masterFileLabel
                }));
            } else {
                const errorData = await res.json().catch(async () => ({ message: await res.text().catch(() => '') }));
                alert(errorData.message || errorData.error || 'Failed to upload Master CSV.');
            }
        } catch (err) {
            console.error('Upload failed:', err);
            alert(err instanceof Error ? err.message : 'Network error while uploading Master CSV.');
        } finally {
            setIsUploadingCSV(false);
        }
    };

    const calculatedVat = (parseFloat(vatOutput) || 0) - (parseFloat(vatInput) || 0);
    const calculatedTot = (parseFloat(totSales) || 0) * 0.015;

    const handleSave = async () => {
        if (isSaving) {
            return;
        }

        setIsSaving(true);
        setSaveError(null);

        try {
            await onSave({
                ...formData,
                obligations: selectedObligations.join(','),
            });
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Failed to save client details.');
        } finally {
            setIsSaving(false);
        }
    };

    const toggleObligation = (key: string) => {
        setSelectedObligations(prev => {
            if (prev.includes(key)) {
                return prev.filter(k => k !== key);
            }
            return [...prev, key];
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <button onClick={onBack} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition">
                    <ArrowLeft className="h-4 w-4" /> Back to Dashboard
                </button>
                <button onClick={() => void handleSave()} disabled={isSaving} className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-slate-950 transition ${isSaving ? 'cursor-not-allowed bg-[#ff0613]/60 text-slate-900/70' : 'bg-[#ff0613] hover:bg-[#d80000]'}`}>
                    <Save className="h-4 w-4" /> {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>

            {saveError && (
                <div className="rounded-xl border border-red-500/40 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {saveError}
                </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_350px]">
                {/* Main Details Form */}
                <div className="space-y-6">
                    <div className="rounded-2xl border border-slate-200 bg-white p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <Building2 className="h-6 w-6 text-emerald-500" />
                            <h2 className="text-xl font-bold text-slate-900">Company Profile</h2>
                        </div>
                        
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">Company Name</label>
                                <input
                                    type="text"
                                    value={formData.name || ''}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">KRA PIN</label>
                                <input
                                    type="text"
                                    value={formData.pin || ''}
                                    onChange={e => setFormData({ ...formData, pin: e.target.value.toUpperCase() })}
                                    maxLength={11}
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">Email Address</label>
                                <input
                                    type="email"
                                    value={formData.email || ''}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="client@example.com"
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">Phone Number</label>
                                <input
                                    type="tel"
                                    value={formData.phone || ''}
                                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="07XXXXXXXX"
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">iTax Password</label>
                                <input
                                    type="password"
                                    value={formData.iTaxPassword || ''}
                                    onChange={e => setFormData({ ...formData, iTaxPassword: e.target.value })}
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">Industry / Sector</label>
                                <input
                                    type="text"
                                    value={formData.sector || ''}
                                    onChange={e => setFormData({ ...formData, sector: e.target.value })}
                                    placeholder="e.g. Technology, Retail"
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Obligations */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-6">
                        <h2 className="text-xl font-bold text-slate-900 mb-4">Obligations</h2>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {ALL_OBLIGATIONS.map(obs => (
                                <label
                                    key={obs.key}
                                    className={`flex items-center gap-2 rounded-xl border p-3 cursor-pointer transition ${
                                        selectedObligations.includes(obs.key)
                                            ? 'border-[#ff0613]/30 bg-red-50'
                                            : 'border-slate-200 bg-slate-50'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedObligations.includes(obs.key)}
                                        onChange={() => toggleObligation(obs.key)}
                                        className="rounded border-slate-300 text-[#ff0613] focus:ring-[#ff0613] h-4 w-4"
                                    />
                                    <span className="text-sm font-semibold text-slate-700">{obs.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Conditional Tax Sections based on Obligations */}
                    {selectedObligations.includes('vat') && (
                        <div className="rounded-2xl border border-blue-500/20 bg-white p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <Percent className="h-6 w-6 text-blue-600" />
                                <h2 className="text-xl font-bold text-slate-900">VAT Calculator</h2>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">Total Output TAX (Sales)</label>
                                    <input
                                        type="number"
                                        placeholder="Ksh."
                                        value={vatOutput}
                                        onChange={e => setVatOutput(e.target.value)}
                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:bg-white transition"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-xs font-bold text-slate-500">Total Input TAX (Purchases)</label>
                                    <input
                                        type="number"
                                        placeholder="Ksh."
                                        value={vatInput}
                                        onChange={e => setVatInput(e.target.value)}
                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:bg-white transition"
                                    />
                                </div>
                            </div>
                            <div className="mt-4 flex items-center justify-between rounded-xl bg-blue-50 p-4 border border-blue-500/20">
                                <span className="text-sm font-semibold text-blue-700">Payable VAT (Output - Input):</span>
                                <span className={`text-lg font-black ${calculatedVat > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                    {calculatedVat > 0 ? `Ksh. ${calculatedVat.toLocaleString()}` : calculatedVat < 0 ? `(Refund) Ksh. ${Math.abs(calculatedVat).toLocaleString()}` : "Ksh. 0"}
                                </span>
                            </div>
                        </div>
                    )}

                    {selectedObligations.includes('tot') && (
                        <div className="rounded-2xl border border-amber-500/20 bg-white p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <Calculator className="h-6 w-6 text-[#ff0613]" />
                                <h2 className="text-xl font-bold text-slate-900">TOT (Turnover Tax) Calculator</h2>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-bold text-slate-500">Gross Monthly Sales (Turnover)</label>
                                <input
                                    type="number"
                                    placeholder="Ksh."
                                    value={totSales}
                                    onChange={e => setTotSales(e.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613] focus:bg-white transition"
                                />
                            </div>
                            <div className="mt-4 flex items-center justify-between rounded-xl bg-red-50 p-4 border border-amber-500/20">
                                <span className="text-sm font-semibold text-amber-700">Calculated TOT (1.5%):</span>
                                <span className="text-lg font-black text-[#ff0613]">
                                    Ksh. {calculatedTot.toLocaleString()}
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Sidebar: Payroll & Files */}
                <div className="space-y-6">
                    {(selectedObligations.includes('paye') || selectedObligations.includes('nssf') || selectedObligations.includes('sha')) && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-5">
                            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500">Payroll Data</h3>
                            <div className="space-y-3">
                                {formData.masterFileUrl ? (
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <div className="flex items-center gap-3 truncate">
                                                <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-500" />
                                                <div className="flex flex-col truncate">
                                                    <span className="text-xs font-semibold text-slate-900 truncate">{formData.masterFileLabel || 'Master CSV'}</span>
                                                    <span className="text-[10px] text-slate-500">Uploaded ready for processing</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <a href={formData.masterFileUrl} download className="text-xs font-medium text-blue-600 hover:underline">View</a>
                                                <label className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline">
                                                    {isUploadingCSV ? '...' : 'Replace'}
                                                    <input 
                                                        type="file" 
                                                        className="hidden" 
                                                        accept=".csv,.xlsx" 
                                                        onChange={(e) => {
                                                            if (e.target.files?.[0]) handleUploadCSV(e.target.files[0]);
                                                        }}
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center hover:bg-slate-50 transition">
                                        {isUploadingCSV ? (
                                            <span className="text-xs font-medium text-slate-500 animate-pulse">Uploading...</span>
                                        ) : (
                                            <>
                                                <Cloud className="mb-2 h-6 w-6 text-slate-500" />
                                                <span className="text-xs font-medium text-slate-600">Upload Master CSV</span>
                                                <span className="mt-1 text-[10px] text-slate-500">Auto-generates ZIPs &amp; records</span>
                                            </>
                                        )}
                                        <input 
                                            type="file" 
                                            className="hidden" 
                                            accept=".csv,.xlsx" 
                                            onChange={(e) => {
                                                if (e.target.files?.[0]) handleUploadCSV(e.target.files[0]);
                                            }}
                                        />
                                    </label>
                                )}

                                {client.payeZipUrl ? (
                                    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="flex items-center gap-3">
                                            <FileArchive className="h-5 w-5 text-amber-500" />
                                            <div className="flex flex-col">
                                                <span className="text-xs font-semibold text-slate-900">Generated PAYE</span>
                                                <span className="text-[10px] text-slate-500">Ready to file</span>
                                            </div>
                                        </div>
                                        <a href={client.payeZipUrl} download className="text-xs text-blue-600 hover:underline">ZIP</a>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4">
                                        <span className="text-xs font-medium text-slate-500">No Payroll ZIP</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                        <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500">Active Obligations</h3>
                        <div className="flex flex-wrap gap-2">
                            {ALL_OBLIGATIONS.map(obs => {
                                const isActive = selectedObligations.includes(obs.key);
                                if (!isActive) return null;
                                return (
                                    <span key={obs.key} className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase text-slate-600 border border-slate-200">
                                        {obs.label}
                                    </span>
                                );
                            })}
                            {selectedObligations.length === 0 && (
                                <span className="text-xs text-slate-500">No obligations selected</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}