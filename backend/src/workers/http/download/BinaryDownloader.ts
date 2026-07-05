import fs from 'fs';
import path from 'path';
import { KraHttpSession } from '../session/KraHttpSession';
import { KraError, KraErrorCode } from '../errors';

export class BinaryDownloader {
    private session: KraHttpSession;

    constructor(session: KraHttpSession) {
        this.session = session;
    }

    async downloadPdf(urlOrFunction: string, destPath: string): Promise<void> {
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

        if (urlOrFunction === 'downloadReturnsReceipt()') {
            throw new KraError(
                KraErrorCode.RECEIPT_DOWNLOAD_FAILED,
                'Receipt download via JavaScript function is not yet implemented in HTTP mode. The submission response must expose a noticeId.'
            );
        }

        const pathToFetch = urlOrFunction.startsWith('http')
            ? new URL(urlOrFunction).pathname + new URL(urlOrFunction).search
            : urlOrFunction;

        const buffer = await this.session.getBuffer(pathToFetch, {
            timeout: 60_000,
            headers: {
                Accept: 'application/pdf,application/octet-stream,*/*',
                Referer: 'https://itax.kra.go.ke/KRA-Portal/eReturns.htm?actionCode=fileNilReturn',
            },
        });

        if (!this.isPdf(buffer)) {
            const preview = buffer.slice(0, 500).toString().replace(/\s+/g, ' ');
            throw new KraError(
                KraErrorCode.RECEIPT_DOWNLOAD_FAILED,
                `Downloaded receipt is not a valid PDF (preview: ${preview})`,
                { rawResponse: preview }
            );
        }

        await fs.promises.writeFile(destPath, buffer);
    }

    private isPdf(buffer: Buffer): boolean {
        return buffer.length > 4 && buffer.toString('ascii', 0, 4) === '%PDF';
    }
}
