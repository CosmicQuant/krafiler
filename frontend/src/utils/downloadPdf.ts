/**
 * downloadPdf.ts
 *
 * Utility to download PDF files from authenticated API endpoints.
 * Standard `<a href>` tags cannot send Authorization headers, so this
 * fetches the PDF via apiFetch (with Bearer token), creates a blob URL,
 * and triggers the download programmatically.
 */

import { apiFetch } from '../services/api';

export async function downloadPdf(
    url: string,
    filename: string,
    onError?: (msg: string) => void
): Promise<void> {
    try {
        const response = await apiFetch(url);
        if (!response.ok) {
            let errMsg = `Failed to download PDF (HTTP ${response.status})`;
            try {
                const data = await response.json();
                if (data && typeof data === 'object') {
                    errMsg = (data.message || data.error || errMsg) as string;
                }
            } catch {
                // ignore JSON parse failure
            }
            throw new Error(errMsg);
        }

        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        window.URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
        const msg = err?.message || 'Failed to download file';
        if (onError) onError(msg);
        else console.error('downloadPdf error:', msg);
    }
}
