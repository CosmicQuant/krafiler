/**
 * cloudStorage.ts
 *
 * Google Cloud Storage utility module.
 *
 * Phase 3: Replaces local disk file storage with Cloud Storage.
 * All uploads generate signed URLs for frontend download.
 *
 * Bucket layout:
 *   gs://{bucket}/users/{uid}/clients/{clientId}/documents/{fileName}
 *   gs://{bucket}/users/{uid}/clients/{clientId}/receipts/{jobId}/receipt.pdf
 *   gs://{bucket}/users/{uid}/clients/{clientId}/master-csv/{fileName}
 *   gs://{bucket}/users/{uid}/clients/{clientId}/logos/{fileName}
 *   gs://{bucket}/system/templates/{templateName}
 */

import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs';
import { logger } from '../logger';

const BUCKET_NAME = process.env.CLOUD_STORAGE_BUCKET || 'taxpulse';

// Reuse the same Storage instance that firebase-admin uses internally
// so we don't create duplicate connections.
let storageInstance: Storage | null = null;

function getStorage(): Storage {
    if (!storageInstance) {
        storageInstance = new Storage();
    }
    return storageInstance;
}

function getBucket() {
    logger.info({ bucket: BUCKET_NAME, envBucket: process.env.CLOUD_STORAGE_BUCKET }, 'Resolving Cloud Storage bucket');
    return getStorage().bucket(BUCKET_NAME);
}

// Ensure bucket exists (idempotent; safe to call on startup)
export async function ensureBucketExists(): Promise<void> {
    const bucket = getBucket();
    const [exists] = await bucket.exists();
    if (!exists) {
        logger.info({ bucket: BUCKET_NAME }, 'Creating Cloud Storage bucket');
        await bucket.create({
            location: process.env.GOOGLE_CLOUD_REGION || 'us-central1',
            standard: true,
        });
        // Set lifecycle: delete temp/ prefix after 7 days
        await bucket.setMetadata({
            lifecycle: {
                rule: [
                    {
                        action: { type: 'Delete' },
                        condition: {
                            age: 7,
                            matchesPrefix: ['users/*/temp/'],
                        },
                    },
                ],
            },
        });
    }
}

/**
 * Upload a local file to Cloud Storage and return its public/signed URL.
 */
export async function uploadFile(
    localPath: string,
    destination: string,
    options?: { contentType?: string; metadata?: Record<string, string> }
): Promise<string> {
    const bucket = getBucket();
    const file = bucket.file(destination);

    await bucket.upload(localPath, {
        destination,
        contentType: options?.contentType || 'application/octet-stream',
        metadata: {
            metadata: options?.metadata || {},
        },
    });

    logger.info({ destination }, 'File uploaded to Cloud Storage');
    return destination;
}

/**
 * Upload a Buffer directly to Cloud Storage.
 */
export async function uploadBuffer(
    buffer: Buffer,
    destination: string,
    options?: { contentType?: string; metadata?: Record<string, string> }
): Promise<string> {
    const bucket = getBucket();
    const file = bucket.file(destination);

    await file.save(buffer, {
        contentType: options?.contentType || 'application/octet-stream',
        metadata: {
            metadata: options?.metadata || {},
        },
    });

    logger.info({ destination }, 'Buffer uploaded to Cloud Storage');
    return destination;
}

/**
 * Generate a signed URL for reading a file (15-minute expiry by default).
 */
export async function getSignedDownloadUrl(
    destination: string,
    expiresMinutes = 15
): Promise<string> {
    const bucket = getBucket();
    const file = bucket.file(destination);

    const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + expiresMinutes * 60 * 1000,
    });

    return url;
}

/**
 * Generate a signed URL for uploading a file directly from the client.
 */
export async function getSignedUploadUrl(
    destination: string,
    contentType: string,
    expiresMinutes = 15
): Promise<string> {
    const bucket = getBucket();
    const file = bucket.file(destination);

    const [url] = await file.getSignedUrl({
        action: 'write',
        expires: Date.now() + expiresMinutes * 60 * 1000,
        contentType,
    });

    return url;
}

/**
 * Download a Cloud Storage file to a local temporary path.
 */
export async function downloadToTemp(
    destination: string,
    tempDir = process.env.TEMP_DIR || 'C:\\Temp'
): Promise<string> {
    const bucket = getBucket();
    const file = bucket.file(destination);
    const localPath = path.join(tempDir, path.basename(destination));

    await file.download({ destination: localPath });
    return localPath;
}

/**
 * Delete a file from Cloud Storage.
 */
export async function deleteFile(destination: string): Promise<void> {
    const bucket = getBucket();
    const file = bucket.file(destination);
    await file.delete({ ignoreNotFound: true });
    logger.info({ destination }, 'File deleted from Cloud Storage');
}

/**
 * Create a readable stream for a Cloud Storage file.
 */
export function createReadStream(destination: string): NodeJS.ReadableStream {
    const bucket = getBucket();
    const file = bucket.file(destination);
    return file.createReadStream();
}

/**
 * Check if a file exists in Cloud Storage.
 */
export async function fileExists(destination: string): Promise<boolean> {
    const bucket = getBucket();
    const file = bucket.file(destination);
    const [exists] = await file.exists();
    return exists;
}

/**
 * Build a GCS destination path for a client document.
 */
export function docPath(uid: string, clientId: string, fileName: string): string {
    return `users/${uid}/clients/${clientId}/documents/${fileName}`;
}

/**
 * Build a GCS destination path for a receipt.
 */
export function receiptPath(uid: string, clientId: string, jobId: string, fileName: string): string {
    return `users/${uid}/clients/${clientId}/receipts/${jobId}/${fileName}`;
}

/**
 * Build a GCS destination path for a master CSV.
 */
export function masterCsvPath(uid: string, clientId: string, fileName: string): string {
    return `users/${uid}/clients/${clientId}/master-csv/${fileName}`;
}

/**
 * Build a GCS destination path for a client logo.
 */
export function logoPath(uid: string, clientId: string, fileName: string): string {
    return `users/${uid}/clients/${clientId}/logos/${fileName}`;
}

/**
 * Build a GCS destination path for a temporary file.
 */
export function tempPath(uid: string, fileName: string): string {
    return `users/${uid}/temp/${fileName}`;
}

/**
 * Resolve a logo path for PDF generation.
 * If logoGcsPath is present, downloads to a temp file and returns the local path.
 * Otherwise, falls back to the local logoUrl path.
 */
export async function resolveLogoPath(
    clientData: { logoGcsPath?: string; logoUrl?: string },
    uid: string
): Promise<string | null> {
    if (clientData.logoGcsPath) {
        try {
            const tempFile = await downloadToTemp(clientData.logoGcsPath);
            return tempFile;
        } catch (e) {
            logger.warn({ err: e, gcsPath: clientData.logoGcsPath }, 'Failed to download logo from GCS');
        }
    }
    if (clientData.logoUrl) {
        const localPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', clientData.logoUrl.replace(/^\//, ''));
        if (fs.existsSync(localPath)) {
            return localPath;
        }
    }
    return null;
}
