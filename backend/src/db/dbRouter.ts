/**
 * dbRouter.ts
 *
 * Database abstraction layer for the KRAFILER API.
 *
 * Phase 2 (current): SQLite is default. Firestore is used when
 * DATABASE_MODE=firestore. All route files import from here so the
 * switch is centralized.
 *
 * Usage in routes:
 *   import { getDb, isFirestore } from '../db/dbRouter';
 *   const db = getDb();
 *   if (isFirestore()) { ... } else { ... }
 */

export const DATABASE_MODE = process.env.DATABASE_MODE || 'sqlite';

export function isFirestore(): boolean {
    return DATABASE_MODE === 'firestore';
}

export function isSQLite(): boolean {
    return DATABASE_MODE === 'sqlite';
}

export function getDb() {
    if (isFirestore()) {
        return require('../lib/firebaseAdmin').adminDb;
    }
    return null; // SQLite routes use openDb() directly
}

export function requireFirestore() {
    if (!isFirestore()) {
        throw new Error('This operation requires DATABASE_MODE=firestore');
    }
    return require('../lib/firebaseAdmin').adminDb;
}
