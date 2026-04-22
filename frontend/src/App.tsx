import React, { useState } from 'react';
import KraNilReturnForm from './components/KraNilReturnForm';
import UnifiedPayrollUploader from './components/UnifiedPayrollUploader';

function App() {
    const [activeTab, setActiveTab] = useState<'KRA' | 'PAYROLL'>('PAYROLL');

    return (
        <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', justifyContent: 'center' }}>
                <button
                    onClick={() => setActiveTab('KRA')}
                    style={{
                        padding: '10px 20px',
                        cursor: 'pointer',
                        border: 'none',
                        borderRadius: '4px',
                        backgroundColor: activeTab === 'KRA' ? '#2563EB' : '#E5E7EB',
                        color: activeTab === 'KRA' ? 'white' : 'black',
                        fontWeight: 'bold'
                    }}
                >
                    KRA Return Filer (iTax / Playwright)
                </button>
                <button
                    onClick={() => setActiveTab('PAYROLL')}
                    style={{
                        padding: '10px 20px',
                        cursor: 'pointer',
                        border: 'none',
                        borderRadius: '4px',
                        backgroundColor: activeTab === 'PAYROLL' ? '#059669' : '#E5E7EB',
                        color: activeTab === 'PAYROLL' ? 'white' : 'black',
                        fontWeight: 'bold'
                    }}
                >
                    Axon Unified Payroll Engine
                </button>
            </div>

            {activeTab === 'KRA' && <KraNilReturnForm />}
            {activeTab === 'PAYROLL' && <UnifiedPayrollUploader />}
        </div>
    );
}

export default App;
