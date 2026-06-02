/**
 * useNetworkStatus.ts
 *
 * Hook that tracks browser online/offline state and returns:
 * - isOnline: boolean
 * - wasOffline: boolean (true if user has gone offline at least once during session)
 */

import { useState, useEffect, useCallback } from 'react';

interface NetworkStatus {
    isOnline: boolean;
    wasOffline: boolean;
}

export function useNetworkStatus(): NetworkStatus {
    const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
    const [wasOffline, setWasOffline] = useState<boolean>(false);

    const handleOnline = useCallback(() => {
        setIsOnline(true);
    }, []);

    const handleOffline = useCallback(() => {
        setIsOnline(false);
        setWasOffline(true);
    }, []);

    useEffect(() => {
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [handleOnline, handleOffline]);

    return { isOnline, wasOffline };
}
