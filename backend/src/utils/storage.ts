/**
 * storage.ts
 *
 * Receipt persistence helpers for keeping downloaded PDFs inside the workspace.
 */

import fs from 'fs/promises';
import path from 'path';

const RECEIPTS_DIR = path.resolve(__dirname, '..', '..', '..', 'receipts');

export interface StoredReceiptResult {
    /** Absolute path to the persisted PDF receipt inside the workspace. */
    receiptPath: string;
    /** Relative path from the workspace root, useful for UI/logging. */
    relativePath: string;
}

/**
 * Moves a downloaded PDF receipt from the temp browser download folder into a
 * persistent receipts directory within the workspace.
 *
 * @param localFilePath - Absolute path to the downloaded PDF on disk.
 * @param jobId         - Unique filing job ID (used to namespace the receipt).
 * @returns {@link StoredReceiptResult} with the final local file path.
 */
export async function storeReceiptLocally(
    localFilePath: string,
    jobId: string
): Promise<StoredReceiptResult> {
    const fileName = path.basename(localFilePath);
    const targetDir = path.join(RECEIPTS_DIR, jobId);
    const targetPath = path.join(targetDir, fileName);

    await fs.mkdir(targetDir, { recursive: true });
    await fs.rename(localFilePath, targetPath);

    console.log(`[Storage] Stored receipt locally: ${localFilePath} -> ${targetPath}`);

    return {
        receiptPath: targetPath,
        relativePath: path.relative(path.resolve(__dirname, '..', '..', '..'), targetPath),
    };
}
