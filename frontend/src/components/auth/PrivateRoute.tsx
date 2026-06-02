/**
 * PrivateRoute.tsx
 *
 * Route guard that redirects unauthenticated users to the login page.
 * Wraps React Router v7 routes.
 */

import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { PageSkeleton } from '../ui/Skeleton';

interface PrivateRouteProps {
    children: React.ReactNode;
}

export function PrivateRoute({ children }: PrivateRouteProps) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
                <div className="hidden lg:block">
                    <div className="flex h-full w-72 flex-col border-r border-slate-200 bg-white p-4 space-y-6">
                        <div className="h-8 w-32 animate-pulse rounded-lg bg-slate-200" />
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-10 w-full animate-pulse rounded-xl bg-slate-200" />
                        ))}
                        <div className="mt-auto h-10 w-full animate-pulse rounded-xl bg-slate-200" />
                    </div>
                </div>
                <div className="flex-1 overflow-auto p-6">
                    <PageSkeleton />
                </div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
}
