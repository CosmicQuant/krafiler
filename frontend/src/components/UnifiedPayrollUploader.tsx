import React, { useState } from 'react';

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
        <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px', fontFamily: 'system-ui, sans-serif', border: '1px solid #ccc', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', backgroundColor: 'white' }}>
            <h2 style={{ borderBottom: '2px solid #eee', paddingBottom: '10px' }}>Unified Payroll Engine</h2>
            <p style={{ color: '#555' }}>Upload your exported Axon Unified Payroll CSV here to generate 2026 Compliance files (SHA, NSSF, iTax PAYE).</p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', marginTop: '10px' }}>
                    <label style={{ fontWeight: 'bold', marginBottom: '5px' }}>Upload CSV File</label>
                    <input type="file" accept=".csv" onChange={e => setFile(e.target.files?.[0] || null)} style={{ padding: '8px' }} required />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label style={{ fontWeight: 'bold' }}>Choose outputs</label>
                    {[
                        { key: 'paye' as const, label: 'KRA PAYE ZIP' },
                        { key: 'nssf' as const, label: 'NSSF workbook' },
                        { key: 'sha' as const, label: 'SHA workbook' }
                    ].map((option) => (
                        <label key={option.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#334155' }}>
                            <input
                                type="checkbox"
                                checked={options[option.key]}
                                onChange={() => handleToggle(option.key)}
                            />
                            <span>{option.label}</span>
                        </label>
                    ))}
                </div>

                <button type="submit" disabled={selectedCount === 0} style={{ padding: '12px', marginTop: '10px', backgroundColor: selectedCount === 0 ? '#94A3B8' : '#1E293B', color: 'white', border: 'none', borderRadius: '4px', cursor: selectedCount === 0 ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '16px' }}>
                    Generate Unified Returns
                </button>
            </form>

            {status && (
                <div style={{ marginTop: '20px', padding: '10px', borderRadius: '4px', backgroundColor: status.includes('Success') ? '#d4edda' : '#f8d7da', color: status.includes('Success') ? '#155724' : '#721c24' }}>
                    {status}
                </div>
            )}
        </div>
    );
}