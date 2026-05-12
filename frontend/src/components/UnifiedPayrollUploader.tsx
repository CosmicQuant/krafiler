import { CheckCircle2, FileSpreadsheet, ShieldCheck, UploadCloud } from 'lucide-react';
import { useState } from 'react';

type PayrollOptions = {
    paye: boolean;
    nssf: boolean;
    sha: boolean;
};

export default function UnifiedPayrollUploader() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<string>('');
    const [options, setOptions] = useState<PayrollOptions>({
        paye: true,
        nssf: true,
        sha: true
    });

    const selectedCount = Object.values(options).filter(Boolean).length;

    const handleToggle = (key: keyof PayrollOptions) => {
        setOptions((current) => ({ ...current, [key]: !current[key] }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) {
            setStatus('Please attach the exported CSV!');
            return;
        }

        if (selectedCount === 0) {
            setStatus('Select at least one output to generate.');
            return;
        }

        setStatus('Generating Compliance Files...');

        try {
            // Prepare the Multipart payload
            const formData = new FormData();
            formData.append('payrollFile', file);
            formData.append('generatePaye', String(options.paye));
            formData.append('generateNssf', String(options.nssf));
            formData.append('generateSha', String(options.sha));

            // Call the API endpoint
            const response = await fetch('/api/payroll/generate-unified', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                setStatus(`Generation failed! ${errData.error || 'Server error'}`);
                return;
            }

            // Capture the binary ZIP file and force the browser to download it
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Unified_Compliance_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            setStatus('✅ Success! Files downloaded successfully.');
        } catch (error) {
            console.error('Upload Error:', error);
            setStatus('Network error occurred.');
        }
    };

    return (
        <div className="mx-auto max-w-5xl rounded-[28px] bg-white p-6 shadow-[0_18px_70px_rgba(15,23,42,0.08)] lg:p-8">
            <div className="grid gap-6 border-b border-slate-200 pb-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Unified payroll engine</p>
                    <h2 className="mt-3 text-3xl font-black tracking-[-0.05em] text-slate-950">Generate one practice-ready pack for payroll, NSSF, and SHA.</h2>
                    <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
                        Upload the exported Axon payroll CSV for a client and generate the authority-ready outputs your team needs for PAYE, NSSF, and SHA processing.
                    </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                    <div className="rounded-[24px] border border-slate-200 bg-[#f8faf5] p-4">
                        <div className="inline-flex rounded-2xl bg-slate-950 p-3 text-white">
                            <FileSpreadsheet className="h-4 w-4" />
                        </div>
                        <p className="mt-4 text-sm font-semibold text-slate-900">One source file</p>
                        <p className="mt-2 text-xs leading-6 text-slate-600">Use the master payroll export already prepared by the client team.</p>
                    </div>
                    <div className="rounded-[24px] border border-slate-200 bg-[#f8faf5] p-4">
                        <div className="inline-flex rounded-2xl bg-slate-950 p-3 text-white">
                            <ShieldCheck className="h-4 w-4" />
                        </div>
                        <p className="mt-4 text-sm font-semibold text-slate-900">Choose outputs</p>
                        <p className="mt-2 text-xs leading-6 text-slate-600">Produce only the PAYE, NSSF, or SHA files required for that client cycle.</p>
                    </div>
                    <div className="rounded-[24px] border border-slate-200 bg-[#f8faf5] p-4">
                        <div className="inline-flex rounded-2xl bg-slate-950 p-3 text-white">
                            <CheckCircle2 className="h-4 w-4" />
                        </div>
                        <p className="mt-4 text-sm font-semibold text-slate-900">Instant download</p>
                        <p className="mt-2 text-xs leading-6 text-slate-600">The generated ZIP is streamed back to the browser as soon as the backend finishes packaging.</p>
                    </div>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.8fr]">
                <div className="rounded-[24px] border border-dashed border-slate-300 bg-[#fbfbf7] p-6">
                    <div className="flex items-start gap-4">
                        <div className="inline-flex rounded-2xl bg-slate-950 p-3 text-white">
                            <UploadCloud className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-lg font-bold tracking-[-0.03em] text-slate-950">Attach exported payroll CSV</p>
                            <p className="mt-2 text-sm leading-7 text-slate-600">Pick the client payroll file to generate the unified compliance package.</p>
                        </div>
                    </div>

                    <label className="mt-6 block rounded-[22px] border border-slate-200 bg-white px-4 py-6 text-center text-sm font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950">
                        <span className="block font-semibold text-slate-900">{file ? file.name : 'Choose payroll CSV file'}</span>
                        <span className="mt-2 block text-xs text-slate-500">CSV only. Recommended: client export direct from Axon.</span>
                        <input type="file" accept=".csv" onChange={(event) => setFile(event.target.files?.[0] || null)} className="hidden" required />
                    </label>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white p-6">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Outputs</p>
                    <div className="mt-4 space-y-3">
                        {[
                            { key: 'paye' as const, label: 'KRA PAYE ZIP', summary: 'Prepared package for PAYE upload and supporting payroll return files.' },
                            { key: 'nssf' as const, label: 'NSSF workbook', summary: 'Employer-ready statutory workbook generated from the same payroll source.' },
                            { key: 'sha' as const, label: 'SHA workbook', summary: 'Health contribution workbook generated for the client payroll period.' }
                        ].map((option) => (
                            <label key={option.key} className="flex cursor-pointer items-start gap-3 rounded-[20px] border border-slate-200 bg-[#fbfbf7] px-4 py-4 transition hover:border-slate-950">
                                <input
                                    type="checkbox"
                                    checked={options[option.key]}
                                    onChange={() => handleToggle(option.key)}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-950"
                                />
                                <span className="block">
                                    <span className="block text-sm font-semibold text-slate-950">{option.label}</span>
                                    <span className="mt-1 block text-xs leading-6 text-slate-600">{option.summary}</span>
                                </span>
                            </label>
                        ))}
                    </div>

                    <div className="mt-5 rounded-[20px] bg-slate-950 px-4 py-4 text-sm text-white">
                        <p className="font-semibold">{selectedCount === 0 ? 'No outputs selected' : `${selectedCount} output${selectedCount === 1 ? '' : 's'} selected`}</p>
                        <p className="mt-2 text-white/70">Generate only the files you need for this client’s payroll cycle.</p>
                    </div>

                    <button type="submit" disabled={selectedCount === 0} className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-slate-950 px-5 py-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                        Generate unified returns
                    </button>
                </div>
            </form>

            {status && (
                <div className={`mt-6 rounded-[22px] px-5 py-4 text-sm font-medium ${status.includes('Success') ? 'bg-emerald-50 text-emerald-800' : status.includes('Generating') ? 'bg-slate-100 text-slate-700' : 'bg-red-50 text-red-700'}`}>
                    {status}
                </div>
            )}
        </div>
    );
}