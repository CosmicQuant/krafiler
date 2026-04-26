import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import PracticeDashboard from './components/PracticeDashboard';
import PracticeLandingPage from './components/PracticeLandingPage';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<PracticeLandingPage />} />
                <Route path="/dashboard" element={<PracticeDashboard />} />
                <Route path="/accountant" element={<Navigate to="/dashboard" replace />} />
                <Route path="/auditor" element={<Navigate to="/dashboard" replace />} />
                <Route path="/payroll" element={<Navigate to="/dashboard" replace />} />
                <Route path="/kra" element={<Navigate to="/dashboard" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
