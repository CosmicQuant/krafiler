import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LoginPage } from './components/auth/LoginPage';
import { PrivateRoute } from './components/auth/PrivateRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import PracticeDashboard from './components/PracticeDashboard';
import PracticeLandingPage from './components/PracticeLandingPage';
import SubscriptionPage from './components/SubscriptionPage';

function App() {
    return (
        <ErrorBoundary>
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
                        <Route
                            path="/subscription"
                            element={
                                <PrivateRoute>
                                    <SubscriptionPage />
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
        </ErrorBoundary>
    );
}

export default App;
