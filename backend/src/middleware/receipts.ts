/**
 * receipts.ts
 *
 * Auth-protected receipt serving endpoint.
 * Replaces the insecure `express.static('/api/receipts')` middleware.
 *
 * Looks up local disk first, then streams the file directly from Cloud Storage.
 */

import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../logger';
import { adminDb } from '../lib/firebaseAdmin';
import { Storage } from '@google-cloud/storage';

const RECEIPTS_DIR = process.env.RECEIPTS_DIR
    ? path.resolve(process.env.RECEIPTS_DIR)
    : path.resolve(__dirname, '..', '..', '..', 'receipts');

const BUCKET_NAME = process.env.CLOUD_STORAGE_BUCKET || 'taxpulse';
const storage = new Storage();

export async function serveReceipt(req: Request, res: Response): Promise<void> {
    // With app.get('/api/receipts/*', ...), Express puts the wildcard in req.params[0]
    const relativePath = (req.params[0] || '').replace(/^\/+/, '');
    logger.info({ relativePath, originalUrl: req.originalUrl, url: req.url, params: req.params }, 'serveReceipt called');

    if (!relativePath) {
        logger.warn('serveReceipt: no relativePath');
        res.status(400).json({ error: 'Receipt path required' });
        return;
    }

    // Prevent directory traversal attacks
    const sanitized = relativePath.replace(/\.\./g, '').replace(/\\/g, '/');
    const filePath = path.join(RECEIPTS_DIR, sanitized);
    const resolvedDir = path.resolve(RECEIPTS_DIR);
    const resolvedFile = path.resolve(filePath);
    logger.info({ sanitized, filePath, resolvedFile, resolvedDir }, 'serveReceipt paths');

    if (!resolvedFile.startsWith(resolvedDir)) {
        logger.warn({ resolvedFile, resolvedDir }, 'serveReceipt: access denied');
        res.status(403).json({ error: 'Access denied' });
        return;
    }

    // 1. Try local disk first (legacy receipts)
    try {
        await fs.access(filePath);
        logger.info({ filePath }, 'serveReceipt: serving from local disk');
        res.setHeader('Content-Disposition', 'inline');
        res.sendFile(resolvedFile, (err) => {
            if (err) {
                logger.error({ err, path: resolvedFile }, 'Failed to send receipt file');
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to serve receipt' });
                }
            }
        });
        return;
    } catch {
        logger.info({ filePath }, 'serveReceipt: not found locally');
    }

    // 2. Look up job and stream directly from GCS (avoids signed-URL IAM issues)
    const parts = sanitized.split('/');
    const possibleJobIds: string[] = [parts[0]]; // Legacy: first segment is jobId

    // For GCS paths like "users/<uid>/clients/<id>/receipts/<jobId>/receipt.pdf"
    const receiptsIdx = parts.indexOf('receipts');
    if (receiptsIdx >= 0 && parts[receiptsIdx + 1]) {
        possibleJobIds.push(parts[receiptsIdx + 1]);
    }
    logger.info({ possibleJobIds, parts }, 'serveReceipt: looking up job IDs');

    for (const id of possibleJobIds) {
        if (!id) continue;
        try {
            logger.info({ jobId: id }, 'serveReceipt: querying Firestore job');
            const jobDoc = await adminDb.collection('jobs').doc(id).get();
            if (jobDoc.exists) {
                const jobData = jobDoc.data() as any;
                const gcsPath = jobData?.artifacts?.receiptGcsPath;
                logger.info({ jobId: id, gcsPath }, 'serveReceipt: found job');
                if (gcsPath) {
                    logger.info({ gcsPath, bucket: BUCKET_NAME }, 'serveReceipt: streaming from GCS');
                    const file = storage.bucket(BUCKET_NAME).file(gcsPath);
                    const [exists] = await file.exists();
                    logger.info({ gcsPath, exists }, 'serveReceipt: GCS file exists check');
                    if (!exists) {
                        logger.warn({ gcsPath, jobId: id }, 'Receipt GCS path does not exist');
                        continue;
                    }
                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Content-Disposition', `inline; filename="${path.basename(gcsPath)}"`);
                    file.createReadStream().pipe(res);
                    logger.info({ gcsPath }, 'serveReceipt: streaming started');
                    return;
                }
            } else {
                logger.info({ jobId: id }, 'serveReceipt: job not found in Firestore');
            }
        } catch (err) {
            logger.error({ err, jobId: id }, 'Failed to stream receipt from GCS');
        }
    }

    logger.warn({ relativePath, sanitized }, 'serveReceipt: returning 404');
    res.status(404).json({ error: 'Receipt not found' });
}
