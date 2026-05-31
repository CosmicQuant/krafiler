/**
 * migrateLocalFilesToGcs.ts
 *
 * One-off script to migrate existing local files to Google Cloud Storage.
 *
 * Run: npx ts-node --transpile-only src/scripts/migrateLocalFilesToGcs.ts
 *
 * What it migrates:
 *   1. Client master CSV files (frontend/public/clients/.../*.csv only)
 *   2. Client logos (frontend/public/clients/.../*.png, *.jpg, *.jpeg)
 *   3. Receipts (receipts/<jobId>/receipt.pdf)
 *   4. Employee documents (uploads/documents/...)
 *
 * What it SKIPS (generated artifacts that can be regenerated on demand):
 *   - .xlsx payroll workbooks
 *   - .zip compliance packages
 *
 * Safety:
 *   - Files are COPIED to GCS; local originals are NOT deleted.
 *   - Firestore docs are updated with new `gcsPath` fields.
 *   - If a file is already in GCS (gcsPath exists), it is skipped.
 *   - Dry-run mode supported: set DRY_RUN=true env var.
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { adminDb } from '../lib/firebaseAdmin';
import { logger } from '../logger';
import { uploadFile, masterCsvPath, logoPath, receiptPath, docPath, getSignedDownloadUrl } from '../lib/cloudStorage';

const DRY_RUN = process.env.DRY_RUN === 'true';
const CLIENTS_DIR = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients');
const RECEIPTS_DIR = path.resolve(__dirname, '..', '..', '..', 'receipts');
const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'documents');

// Generated artifacts that can be regenerated on demand — do not migrate
const SKIP_EXTENSIONS = new Set(['.xlsx', '.zip']);

async function migrateClientFiles() {
    logger.info('=== Migrating client files (master CSV + logos) ===');
    const snapshot = await adminDb.collection('clients').get();
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const doc of snapshot.docs) {
        const client = doc.data();
        const uid = client.ownerUid;
        const clientId = doc.id;

        if (!uid || uid === 'SYSTEM_MIGRATION') {
            logger.warn({ clientId }, 'Client has no ownerUid — skipping');
            skipped++;
            continue;
        }

        // ── Master CSV ──
        const masterFile = client.masterFile;
        if (masterFile?.url && !masterFile?.gcsPath) {
            const decUrl = decodeURIComponent(masterFile.url);
            const relPath = decUrl.replace(/^\/clients\//, '');
            const localPath = path.join(CLIENTS_DIR, relPath);

            const ext = path.extname(localPath).toLowerCase();
            if (SKIP_EXTENSIONS.has(ext)) {
                logger.info({ clientId, localPath }, 'Skipping generated artifact (.xlsx/.zip)');
                skipped++;
                continue;
            }

            if (fs.existsSync(localPath)) {
                const destName = path.basename(relPath);
                const gcsPath = masterCsvPath(uid, clientId, destName);
                if (!DRY_RUN) {
                    try {
                        await uploadFile(localPath, gcsPath, { contentType: 'text/csv' });
                        await doc.ref.update({ 'masterFile.gcsPath': gcsPath });
                        logger.info({ clientId, gcsPath }, 'Master CSV migrated');
                        migrated++;
                    } catch (err) {
                        logger.error({ err, clientId, localPath }, 'Failed to migrate master CSV');
                        errors++;
                    }
                } else {
                    logger.info({ clientId, localPath, gcsPath }, '[DRY-RUN] Would migrate master CSV');
                    migrated++;
                }
            } else {
                logger.warn({ clientId, localPath }, 'Master CSV not found on disk');
                skipped++;
            }
        }

        // ── Logo ──
        const logoUrl = client.logoUrl;
        if (logoUrl && !client.logoGcsPath) {
            const relPath = decodeURIComponent(logoUrl).replace(/^\/clients\//, '');
            const localPath = path.join(CLIENTS_DIR, relPath);

            const ext = path.extname(localPath).toLowerCase();
            if (SKIP_EXTENSIONS.has(ext)) {
                logger.info({ clientId, localPath }, 'Skipping generated artifact (.xlsx/.zip)');
                skipped++;
                continue;
            }

            if (fs.existsSync(localPath)) {
                const destName = path.basename(relPath);
                const gcsPath = logoPath(uid, clientId, destName);
                const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
                if (!DRY_RUN) {
                    try {
                        await uploadFile(localPath, gcsPath, { contentType: mimeType });
                        await doc.ref.update({ logoGcsPath: gcsPath });
                        logger.info({ clientId, gcsPath }, 'Logo migrated');
                        migrated++;
                    } catch (err) {
                        logger.error({ err, clientId, localPath }, 'Failed to migrate logo');
                        errors++;
                    }
                } else {
                    logger.info({ clientId, localPath, gcsPath }, '[DRY-RUN] Would migrate logo');
                    migrated++;
                }
            } else {
                logger.warn({ clientId, localPath }, 'Logo not found on disk');
                skipped++;
            }
        }
    }

    logger.info({ migrated, skipped, errors }, 'Client files migration complete');
}

async function migrateReceipts() {
    if (!fs.existsSync(RECEIPTS_DIR)) {
        logger.info('Receipts directory not found — skipping');
        return;
    }

    logger.info('=== Migrating receipts ===');
    const jobDirs = fs.readdirSync(RECEIPTS_DIR).filter((d) =>
        fs.statSync(path.join(RECEIPTS_DIR, d)).isDirectory()
    );

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const jobId of jobDirs) {
        const jobDoc = await adminDb.collection('jobs').doc(jobId).get();
        if (!jobDoc.exists) {
            logger.warn({ jobId }, 'Job not found in Firestore — skipping receipt');
            skipped++;
            continue;
        }

        const jobData = jobDoc.data()!;
        if (jobData.artifacts?.receiptGcsPath) {
            logger.info({ jobId }, 'Receipt already in GCS — skipping');
            skipped++;
            continue;
        }

        const uid = jobData.ownerUid;
        const clientId = jobData.clientId;
        const receiptDir = path.join(RECEIPTS_DIR, jobId);
        const files = fs.readdirSync(receiptDir).filter((f) => f.endsWith('.pdf'));

        for (const fileName of files) {
            const localPath = path.join(receiptDir, fileName);
            const gcsPath = receiptPath(uid, clientId, jobId, fileName);
            if (!DRY_RUN) {
                try {
                    await uploadFile(localPath, gcsPath, { contentType: 'application/pdf' });
                    await jobDoc.ref.update({ 'artifacts.receiptGcsPath': gcsPath });
                    logger.info({ jobId, gcsPath }, 'Receipt migrated');
                    migrated++;
                } catch (err) {
                    logger.error({ err, jobId, localPath }, 'Failed to migrate receipt');
                    errors++;
                }
            } else {
                logger.info({ jobId, localPath, gcsPath }, '[DRY-RUN] Would migrate receipt');
                migrated++;
            }
        }
    }

    logger.info({ migrated, skipped, errors }, 'Receipts migration complete');
}

async function migrateDocuments() {
    if (!fs.existsSync(UPLOADS_DIR)) {
        logger.info('Uploads/documents directory not found — skipping');
        return;
    }

    logger.info('=== Migrating employee documents ===');
    const snapshot = await adminDb.collection('documents').get();
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.gcsPath) {
            skipped++;
            continue;
        }

        const fileName = data.fileName;
        if (!fileName) {
            skipped++;
            continue;
        }

        const localPath = path.join(UPLOADS_DIR, fileName);
        if (!fs.existsSync(localPath)) {
            logger.warn({ docId: doc.id, localPath }, 'Document file not found on disk');
            skipped++;
            continue;
        }

        const uid = data.ownerUid;
        const clientId = data.clientId;
        const gcsPath = docPath(uid, clientId, fileName);
        if (!DRY_RUN) {
            try {
                await uploadFile(localPath, gcsPath, { contentType: data.mimeType || 'application/octet-stream' });
                await doc.ref.update({ gcsPath });
                logger.info({ docId: doc.id, gcsPath }, 'Document migrated');
                migrated++;
            } catch (err) {
                logger.error({ err, docId: doc.id, localPath }, 'Failed to migrate document');
                errors++;
            }
        } else {
            logger.info({ docId: doc.id, localPath, gcsPath }, '[DRY-RUN] Would migrate document');
            migrated++;
        }
    }

    logger.info({ migrated, skipped, errors }, 'Documents migration complete');
}

async function main() {
    if (DRY_RUN) {
        logger.warn('DRY RUN mode — no files will be uploaded and no Firestore docs modified');
    }

    await migrateClientFiles();
    await migrateReceipts();
    await migrateDocuments();

    logger.info('=== All file migrations complete ===');
    process.exit(0);
}

main().catch((err) => {
    logger.error({ err }, 'Migration failed');
    process.exit(1);
});
