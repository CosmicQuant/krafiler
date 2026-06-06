import { apiFetch } from '../services/api';

/**
 * Download a receipt (or any auth-protected file) using the authenticated API client.
 * Falls back to window.open for public URLs (e.g. signed GCS URLs).
 */
export async function downloadAuthFile(url: string, fallbackFilename = 'receipt.pdf') {
    if (!url) return;
    // If it's a full public URL (not our API), just open it
    if (url.startsWith('http')) {
        window.open(url, '_blank');
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
        a.download = url.split('/').pop() || fallbackFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(objectUrl);
    } catch (e: any) {
        alert('Failed to download: ' + e.message);
    }
}
