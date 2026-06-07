/**
 * firebaseAdmin.ts
 *
 * Firebase Admin SDK initialization for the KRAFILER backend.
 *
 * Local development: Uses Application Default Credentials (ADC) from
 * `gcloud auth application-default login`. No service account JSON key needed.
 *
 * Production (Cloud Run): The service account attached to the Cloud Run service
 * is used automatically via the metadata server.
 */

import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const projectId = process.env.FIREBASE_PROJECT_ID || 'taxpulse-498006';

function getCredential() {
    // If a service account key path is explicitly set (production / CI),
    // use it. Otherwise fall back to ADC (local dev + Cloud Run IAM).
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (serviceAccountPath) {
        return cert(serviceAccountPath);
    }
    return applicationDefault();
}

const adminApp = initializeApp({
    credential: getCredential(),
    projectId,
    storageBucket: process.env.CLOUD_STORAGE_BUCKET || 'taxpulse-498006.firebasestorage.app',
});

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
// Lazy: getStorage() requires the @google-cloud/storage tree to be fully resolved
// (uuid, readable-stream, etc.). Some entrypoints (e.g. the NSSF test script) do
// not need storage, so we expose it via a getter that initializes on first use.
let _adminStorage: ReturnType<typeof getStorage> | null = null;
export const adminStorage = new Proxy({} as ReturnType<typeof getStorage>, {
    get(_target, prop) {
        if (!_adminStorage) _adminStorage = getStorage(adminApp);
        return (_adminStorage as any)[prop];
    },
});

// Allow undefined values to be ignored during writes (safe for migrations)
adminDb.settings({ ignoreUndefinedProperties: true });

export { adminApp };
