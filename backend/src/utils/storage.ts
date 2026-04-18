/**
 * storage.ts
 *
 * Mock cloud storage adapter.
 * Replace the body of `uploadReceiptToStorage` with the real AWS S3 SDK
 * (or GCS / Azure Blob) implementation before deploying to production.
 */

import fs from 'fs/promises';
import path from 'path';

export interface UploadResult {
    /** Public/pre-signed URL to the uploaded PDF receipt. */
    fileUrl: string;
    /** S3 (or equivalent) bucket name. */
    bucket: string;
    /** Object key within the bucket. */
    key: string;
}

/**
 * [MOCK] Uploads a local PDF receipt to cloud object storage.
 *
 * Production replacement — AWS S3 example:
 * ```ts
 * import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
 *
 * const s3 = new S3Client({ region: process.env.AWS_REGION });
 * const fileBuffer = await fs.readFile(localFilePath);
 * await s3.send(new PutObjectCommand({
 *   Bucket: bucket,
 *   Key: key,
 *   Body: fileBuffer,
 *   ContentType: 'application/pdf',
 *   ServerSideEncryption: 'AES256',
 * }));
 * const fileUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
 * ```
 *
 * @param localFilePath - Absolute path to the downloaded PDF on disk.
 * @param jobId         - Unique filing job ID (used to namespace the S3 key).
 * @returns {@link UploadResult} with the public URL and storage coordinates.
 */
export async function uploadReceiptToStorage(
    localFilePath: string,
    jobId: string
): Promise<UploadResult> {
    // Simulate cloud upload latency
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    const fileName = path.basename(localFilePath);
    const bucket = process.env.S3_BUCKET_NAME ?? 'kra-receipts-bucket';
    const key = `receipts/${jobId}/${fileName}`;
    const fileUrl = `https://${bucket}.s3.${process.env.AWS_REGION ?? 'us-east-1'}.amazonaws.com/${key}`;

    console.log(`[Storage] [MOCK] Uploaded: ${localFilePath} -> s3://${bucket}/${key}`);

    return { fileUrl, bucket, key };
}

/**
 * Deletes a temporary local file after it has been uploaded to cloud storage.
 * Failures are logged but not re-thrown — a cleanup failure must not abort
 * the overall job success.
 */
export async function cleanupTempFile(filePath: string): Promise<void> {
    try {
        await fs.unlink(filePath);
        console.log(`[Storage] Cleaned up temp file: ${filePath}`);
    } catch (err) {
        console.warn(`[Storage] Failed to clean up temp file "${filePath}":`, err);
    }
}
