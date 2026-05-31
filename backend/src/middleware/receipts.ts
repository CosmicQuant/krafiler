/**
 * receipts.ts
 *
 * Auth-protected receipt serving endpoint.
 * Replaces the insecure `express.static('/api/receipts')` middleware.
 *
 * Phase 3: Falls back to Cloud Storage signed URLs when the receipt
 * is not found on local disk (Fire store mode).
 */

import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../logger';
import { isFirestore } from '../db/dbRouter';
import { getSignedDownloadUrl } from '../lib/cloudStorage';
import { adminDb } from '../lib/firebaseAdmin';

const RECEIPTS_DIR = process.env.RECEIPTS_DIR
    ? path.resolve(process.env.RECEIPTS_DIR)
    : path.resolve(__dirname, '..', '..', '..', 'receipts');

export async function serveReceipt(req: Request, res: Response): Promise<void> {
    const relativePath = req.params[0];

    if (!relativePath) {
        res.status(400).json({ error: 'Receipt path required' });
        return;
    }

    // Prevent directory traversal attacks
    const sanitized = relativePath.replace(/\.{2}/g, '').replace(/\\/g, '/');
    const filePath = path.join(RECEIPTS_DIR, sanitized);
    const resolvedDir = path.resolve(RECEIPTS_DIR);
    const resolvedFile = path.resolve(filePath);

    if (!resolvedFile.startsWith(resolvedDir)) {
        res.status(403).json({ error: 'Access denied' });
        return;
    }

    // 1. Try local disk first (SQLite mode or legacy receipts)
    try {
        await fs.access(filePath);
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
        // Not found locally — fall through to GCS lookup
    }

    // 2. Firestore mode: look up job and redirect to signed GCS URL
    if (isFirestore()) {
        const parts = sanitized.split('/');
        const jobId = parts[0]; // e.g. "receipts/<jobId>/receipt.pdf"
        if (jobId) {
            try {
                const jobDoc = await adminDb.collection('jobs').doc(jobId).get();
                if (jobDoc.exists) {
                    const jobData = jobDoc.data() as any;
                    const gcsPath = jobData?.artifacts?.receiptGcsPath;
                    if (gcsPath) {
                        const signedUrl = await getSignedDownloadUrl(gcsPath, 15);
                        return res.redirect(signedUrl);
                    }
                }
            } catch (err) {
                logger.error({ err, jobId }, 'Failed to resolve receipt from GCS');
            }
        }
    }

    res.status(404).json({ error: 'Receipt not found' });
}
