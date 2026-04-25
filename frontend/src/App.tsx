import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import UnifiedPayrollUploader from './components/UnifiedPayrollUploader';
import IndividualDashboard from './components/IndividualDashboard';
import AccountantDashboard from './components/AccountantDashboard';
import KraNilReturnForm from './components/KraNilReturnForm';
import { TaxObligationType } from './types';

// Wrapper for the landing page so it handles Kra actions smoothly
function LandingWrapper() {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}>
        <button
          onClick={() => window.location.href='/payroll'}
          style={{
            padding: '8px 16px',
            cursor: 'pointer',
            border: '1px solid white',
            borderRadius: '4px',
            backgroundColor: 'rgba(0,0,0,0.5)',
            color: 'white',
            fontWeight: 'bold',
            marginRight: '10px'
          }}
        >
          Payroll Engine
        </button>
        <button
          onClick={() => window.location.href='/accountant'}
          style={{
            padding: '8px 16px',
            cursor: 'pointer',
            border: '1px solid white',
            borderRadius: '4px',
            backgroundColor: '#2563EB',
            color: 'white',
            fontWeight: 'bold',
            marginRight: '10px'
          }}
        >
          Pro Login
        </button>
        <button
          onClick={() => window.location.href='/dashboard'}
          style={{
            padding: '8px 16px',
            cursor: 'pointer',
            border: '1px solid white',
            borderRadius: '4px',
            backgroundColor: '#059669',
            color: 'white',
            fontWeight: 'bold'
          }}
        >
          Individual Login
        </button>
      </div>
      <LandingPage onOpenKraWorkspace={() => window.location.href='/kra'} />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingWrapper />} />
        <Route path="/kra" element={<KraNilReturnForm initialTaxObligationType="vat" />} />
        <Route path="/accountant" element={<AccountantDashboard />} />
        <Route path="/dashboard" element={<IndividualDashboard />} />
        <Route path="/payroll" element={<div className="bg-gray-50 min-h-screen pt-12"><UnifiedPayrollUploader /></div>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
