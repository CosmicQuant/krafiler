import { useState } from 'react';
import KraNilReturnForm from './components/KraNilReturnForm';
import UnifiedPayrollUploader from './components/UnifiedPayrollUploader';
import LandingPage from './components/LandingPage';

function App() {
    const [activeTab, setActiveTab] = useState<'LANDING' | 'KRA' | 'PAYROLL'>('LANDING');

    return (
        <div style={{ padding: activeTab === 'LANDING' ? '0' : '20px', fontFamily: 'sans-serif' }}>
            {activeTab !== 'LANDING' && (
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
                    <button
                        onClick={() => setActiveTab('LANDING')}
                        style={{
                            padding: '10px 20px',
                            cursor: 'pointer',
                            border: 'none',
                            borderRadius: '4px',
                            backgroundColor: '#1E293B',
                            color: 'white',
                            fontWeight: 'bold'
                        }}
                    >
                        UI Landing Page
                    </button>
                </div>
            )}

            {activeTab === 'LANDING' && (
                <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}>
                        <button
                            onClick={() => setActiveTab('PAYROLL')}
                            style={{
                                padding: '8px 16px',
                                cursor: 'pointer',
                                border: '1px solid white',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(0,0,0,0.5)',
                                color: 'white',
                                fontWeight: 'bold'
                            }}
                        >
                            Developer View
                        </button>
                    </div>
                    <LandingPage />
                </div>
            )}
            {activeTab === 'KRA' && <KraNilReturnForm />}
            {activeTab === 'PAYROLL' && <UnifiedPayrollUploader />}
        </div>
    );
}

export default App;
