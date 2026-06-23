import { apiFetch } from '../services/api';

function cleanFilename(url: string, fallback: string): string {
    try {
        const parsed = new URL(url, window.location.origin);
        const base = parsed.pathname.split('/').pop()?.split('?')[0] || '';
        const cleaned = base.replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '');
        if (!cleaned) return fallback;
        return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
    } catch {
        return fallback;
    }
}

/**
 * Download a receipt (or any auth-protected file) using the authenticated API client.
 * Handles signed GCS URLs by downloading directly, and API routes via authenticated fetch.
 */
export async function downloadAuthFile(url: string, fallbackFilename = 'receipt.pdf') {
    if (!url) return;

    // If it's a signed GCS URL (storage.googleapis.com), download directly with a clean name
    if (url.includes('storage.googleapis.com')) {
        const a = document.createElement('a');
        a.href = url;
        a.download = fallbackFilename;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
    }

    // If it's a full public URL (not our API), open it
    if (url.startsWith('http')) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
    }

    try {
        // apiFetch already prepends /api, so strip it if the URL already has it
        const apiUrl = url.replace(/^\/api/, '');
        const res = await apiFetch(apiUrl);
        if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
        const blob = await res.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = cleanFilename(url, fallbackFilename);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(objectUrl);
    } catch (e: any) {
        alert('Failed to download: ' + e.message);
    }
}
