import React, { useState } from 'react';

export default function UnifiedPayrollUploader() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<string>('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) {
            setStatus('Please attach the exported CSV!');
            return;
        }

        setStatus('Generating Compliance Files...');

        try {
            // Prepare the Multipart payload
            const formData = new FormData();
            formData.append('payrollFile', file);
            // Config values are now successfully parsed directly from the uploaded Excel template

            // Call the API endpoint
            const response = await fetch('http://localhost:3001/api/payroll/generate-unified', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                setStatus('Generation failed! Backend sent error status.');
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

                <button type="submit" style={{ padding: '12px', marginTop: '10px', backgroundColor: '#1E293B', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>
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