/**
 * OfflineBanner.tsx
 *
 * Sticky banner displayed at the top of the page when the user is offline.
 * Auto-hides when connectivity is restored.
 */

import { WifiOff, Wifi } from 'lucide-react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function OfflineBanner() {
    const { isOnline, wasOffline } = useNetworkStatus();

    if (isOnline) {
        // If user was offline before and is now back, show a brief "back online" indicator
        if (wasOffline) {
            return (
                <div className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-emerald-500 px-4 py-1.5 text-xs font-medium text-white shadow-lg transition-all duration-300">
                    <Wifi className="h-3.5 w-3.5" />
                    You are back online
                </div>
            );
        }
        return null;
    }

    return (
        <div className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-xs font-medium text-white shadow-lg transition-all duration-300">
            <WifiOff className="h-3.5 w-3.5" />
            You appear to be offline. Some features may be unavailable.
        </div>
    );
}
