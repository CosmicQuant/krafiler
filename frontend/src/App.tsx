import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LoginPage } from './components/auth/LoginPage';
import { PrivateRoute } from './components/auth/PrivateRoute';
import PracticeDashboard from './components/PracticeDashboard';
import PracticeLandingPage from './components/PracticeLandingPage';

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<PracticeLandingPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route
                        path="/dashboard/*"
                        element={
                            <PrivateRoute>
                                <PracticeDashboard />
                            </PrivateRoute>
                        }
                    />
                    <Route path="/accountant" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/auditor" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/payroll" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/kra" element={<Navigate to="/dashboard" replace />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
