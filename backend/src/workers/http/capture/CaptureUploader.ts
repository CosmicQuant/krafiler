import { uploadBuffer } from '../../../lib/cloudStorage';
import { logger } from '../../../logger';
import { CaptureContext } from './CaptureContext';
import {
    CaptureArtifactMeta,
    CaptureArtifactType,
    CaptureHttpEntry,
    CaptureManifest,
    CaptureStep,
} from './types';

const SECRET_FIELDS = new Set([
    'kraPassword',
    'nssfPassword',
    'password',
    'encryptedPassword',
    'iv',
    'authTag',
    'otpCode',
    'captcahText',
    'captchaResult',
]);

/**
 * Masks sensitive fields in a captured request body.
 */
function maskSecrets(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;
    if (body instanceof URLSearchParams) {
        const masked = new URLSearchParams();
        for (const [key, value] of body.entries()) {
            masked.set(key, SECRET_FIELDS.has(key) ? '[REDACTED]' : value);
        }
        return masked.toString();
    }
    const record = body as Record<string, unknown>;
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
        if (SECRET_FIELDS.has(key)) {
            masked[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
            masked[key] = maskSecrets(value);
        } else {
            masked[key] = value;
        }
    }
    return masked;
}

function bodyToString(body: unknown): string {
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (Buffer.isBuffer(body)) return body.toString('utf-8');
    try {
        return JSON.stringify(body);
    } catch {
        return String(body);
    }
}

function headersToRecord(headers: unknown): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    if (!headers || typeof headers !== 'object') return result;
    for (const [key, value] of Object.entries(headers)) {
        if (value === undefined || value === null) continue;
        result[key] = Array.isArray(value) ? value : String(value);
    }
    return result;
}

/**
 * Uploads capture artifacts to Cloud Storage and updates the in-memory context.
 */
export class CaptureUploader {
    async uploadHttpEntry(context: CaptureContext, entry: CaptureHttpEntry): Promise<void> {
        const seq = entry.seq;
        const step = entry.step;
        const timestamp = entry.timestamp;

        const requestBody = maskSecrets(entry.request.body);
        const requestPayload = {
            method: entry.request.method,
            url: entry.request.url,
            headers: headersToRecord(entry.request.headers),
            body: requestBody,
        };

        const responseBody = Buffer.isBuffer(entry.response.body)
            ? entry.response.body.toString('utf-8')
            : String(entry.response.body ?? '');

        const responsePayload = {
            statusCode: entry.response.statusCode,
            statusMessage: entry.response.statusMessage,
            headers: headersToRecord(entry.response.headers),
        };

        const requestMeta: Partial<Omit<CaptureArtifactMeta, 'seq' | 'step' | 'type' | 'fileName' | 'gcsPath' | 'timestamp' | 'contentType' | 'sizeBytes'>> = {
            url: entry.request.url,
        };

        const responseMeta: Partial<Omit<CaptureArtifactMeta, 'seq' | 'step' | 'type' | 'fileName' | 'gcsPath' | 'timestamp' | 'contentType' | 'sizeBytes'>> = {
            url: entry.request.url,
            statusCode: entry.response.statusCode,
        };

        await this.uploadText(context, step, 'request', JSON.stringify(requestPayload, null, 2), 'json', 'application/json', requestMeta);
        await this.uploadText(context, step, 'response', responseBody, 'html', 'text/html; charset=utf-8', responseMeta);
    }

    async uploadBuffer(
        context: CaptureContext,
        step: CaptureStep,
        type: CaptureArtifactType,
        buffer: Buffer,
        ext: string,
        contentType: string,
        meta?: Partial<Omit<CaptureArtifactMeta, 'seq' | 'step' | 'type' | 'fileName' | 'gcsPath' | 'timestamp' | 'contentType' | 'sizeBytes'>>
    ): Promise<void> {
        const seq = context.nextSeq();
        const fileName = `${String(seq).padStart(4, '0')}-${step}-${type}.${ext}`;
        const gcsPath = `${context.prefix}/${fileName}`;
        const timestamp = new Date().toISOString();

        try {
            await uploadBuffer(buffer, gcsPath, { contentType });
            const artifact: CaptureArtifactMeta = {
                seq,
                step,
                type,
                fileName,
                gcsPath,
                timestamp,
                contentType,
                sizeBytes: buffer.length,
                ...meta,
            };
            context.recordArtifact(artifact);
        } catch (err: any) {
            logger.warn({ err, gcsPath }, 'Failed to upload capture artifact');
        }
    }

    async uploadText(
        context: CaptureContext,
        step: CaptureStep,
        type: CaptureArtifactType,
        text: string,
        ext: string,
        contentType: string,
        meta?: Partial<Omit<CaptureArtifactMeta, 'seq' | 'step' | 'type' | 'fileName' | 'gcsPath' | 'timestamp' | 'contentType' | 'sizeBytes'>>
    ): Promise<void> {
        await this.uploadBuffer(context, step, type, Buffer.from(text, 'utf-8'), ext, contentType, meta);
    }

    async uploadJson(
        context: CaptureContext,
        step: CaptureStep,
        type: CaptureArtifactType,
        data: unknown
    ): Promise<void> {
        await this.uploadText(
            context,
            step,
            type,
            JSON.stringify(data, null, 2),
            'json',
            'application/json'
        );
    }

    async uploadManifest(context: CaptureContext, manifest: CaptureManifest): Promise<string> {
        const gcsPath = context.manifestPath();
        const text = JSON.stringify(manifest, null, 2);
        try {
            await uploadBuffer(Buffer.from(text, 'utf-8'), gcsPath, { contentType: 'application/json' });
            logger.info({ jobId: manifest.jobId, gcsPath }, 'Capture manifest uploaded');
            return gcsPath;
        } catch (err: any) {
            logger.warn({ err, gcsPath }, 'Failed to upload capture manifest');
            throw err;
        }
    }
}

export { maskSecrets, bodyToString, headersToRecord };
