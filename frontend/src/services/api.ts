/**
 * api.ts
 *
 * Authenticated REST client for the KRAFILER frontend.
 *
 * Phase 1: Injects Firebase ID Token via `getAuth().currentUser.getIdToken()`.
 * Phase 0 fallback: Returns 'dev' token when DEV_BYPASS_AUTH is active
 *                    and no Firebase user is signed in.
 *
 * All API calls automatically include:
 *   - `Authorization: Bearer <token>` header
 *   - `Content-Type: application/json` for POST/PUT/PATCH
 *   - JSON parsing for 2xx responses
 *   - Structured error throwing for non-2xx responses
 */

import { auth } from '../lib/firebase';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Returns the current Firebase ID token, or the dev bypass token
 * when running locally without a signed-in Firebase user.
 */
async function getAuthToken(): Promise<string | null> {
    const user = auth.currentUser;
    if (user) {
        try {
            return await user.getIdToken(true); // force refresh = true
        } catch {
            // If Firebase token refresh fails in dev, fall back to bypass token
            // so the user can still access local SQLite data.
            if (import.meta.env.DEV || import.meta.env.VITE_DEV_BYPASS_AUTH === 'true') {
                return 'dev';
            }
            return null;
        }
    }
    // Fallback for local dev when no Firebase user is signed in
    if (import.meta.env.DEV || import.meta.env.VITE_DEV_BYPASS_AUTH === 'true') {
        return 'dev';
    }
    return null;
}

export class ApiError extends Error {
    status: number;
    data?: unknown;

    constructor(message: string, status: number, data?: unknown) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
    }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await getAuthToken();
    console.log('[apiFetch] path:', path, 'hasToken:', !!token, 'tokenPrefix:', token ? token.substring(0, 20) + '...' : 'null');
    const headers: Record<string, string> = {
        ...(init?.headers as Record<string, string>),
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    } else {
        console.warn('[apiFetch] No auth token for path:', path);
    }

    // Auto-set Content-Type for JSON bodies
    if (init?.body && typeof init.body === 'string' && !headers['Content-Type']) {
        try {
            JSON.parse(init.body);
            headers['Content-Type'] = 'application/json';
        } catch {
            // Not JSON, leave as-is
        }
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
    });

    return response;
}

/**
 * Convenience wrapper that parses JSON and throws structured errors.
 */
export async function apiFetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const response = await apiFetch(path, init);

    let data: unknown;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const message =
            (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string')
                ? data.message
                : (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string')
                    ? data.error
                    : `HTTP ${response.status}`;
        throw new ApiError(message, response.status, data);
    }

    return data as T;
}
