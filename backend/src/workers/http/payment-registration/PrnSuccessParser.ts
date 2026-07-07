import { KraError, KraErrorCode } from '../errors';

export interface PrnSuccessDetails {
    prnNumber: string;
    searchCode: string;
    noticeId: string;
    pdfUrl: string;
}

/**
 * Parse the KRA Payment Registration success page for the generated PRN,
 * search code, and the PDF download URL.
 */
export function parsePrnSuccessPage(html: string): PrnSuccessDetails {
    const prnMatch =
        html.match(/id=["\']prnNumber["\'][^>]*value=["\']([^"\']+)["\']/i) ??
        html.match(/Payment Registration Number:\s*<\/[^>]*>\s*<b>\s*([^<]+)\s*<\/b>/i) ??
        html.match(/Payment Registration Number:\s*<b>\s*([^<]+)\s*<\/b>/i);

    const searchCodeMatch = html.match(/Search Code:\s*<\/[^>]*>\s*<b>\s*([^<]+)\s*<\/b>/i) ??
        html.match(/Search Code:\s*<b>\s*([^<]+)\s*<\/b>/i);

    const downloadFnMatch = html.match(/function\s+downloadPinCertificate\(\)\s*\{([\s\S]*?)\}/i);

    if (!prnMatch?.[1]) {
        throw new KraError(
            KraErrorCode.UNKNOWN,
            'Could not extract PRN number from Payment Registration success page',
            { context: { pageSnippet: html.slice(0, 500) } }
        );
    }

    const prnNumber = prnMatch[1].trim();

    let noticeId = '';
    let pdfUrl = '';

    if (downloadFnMatch?.[1]) {
        const fnBody = downloadFnMatch[1];
        const noticeMatch = fnBody.match(/noticeId=([^&"\']+)/i);
        if (noticeMatch) {
            noticeId = noticeMatch[1].trim();
        }

        // The non-county branch is the standard receipt URL.
        const urlMatch = fnBody.match(/window\.open\(\s*["\'](\/KRA-Portal\/eCerificate\.htm\?actionCode=loadReceipt&noticeId=[^"\']+)["\']/i);
        if (urlMatch) {
            pdfUrl = `https://itax.kra.go.ke${urlMatch[1]}`;
        }
    }

    if (!pdfUrl) {
        // Fallback: build URL from parsed noticeId and prnNumber.
        if (noticeId) {
            pdfUrl = `https://itax.kra.go.ke/KRA-Portal/eCerificate.htm?actionCode=loadReceipt&noticeId=${noticeId}&noticeName=${encodeURIComponent(prnNumber)}`;
        }
    }

    if (!pdfUrl) {
        throw new KraError(
            KraErrorCode.UNKNOWN,
            'Could not determine PRN PDF download URL from success page',
            { context: { pageSnippet: html.slice(0, 500) } }
        );
    }

    return {
        prnNumber,
        searchCode: searchCodeMatch?.[1]?.trim() ?? '',
        noticeId,
        pdfUrl,
    };
}
