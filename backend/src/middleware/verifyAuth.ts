/**
 * verifyAuth.ts
 *
 * Authentication middleware for the KRAFILER API.
 *
 * Phase 1 (current): Verifies Firebase ID Tokens via firebase-admin/auth.
 * Phase 0 fallback: DEV_BYPASS_AUTH=true allows local development with a
 *                    hardcoded 'dev' token while Firebase is being wired.
 *
 * Behavior:
 *   1. Reads `Authorization: Bearer <token>` header.
 *   2. Verifies the token with Firebase Admin SDK `verifyIdToken()`.
 *   3. Looks up the user doc in Firestore for plan/subscription info.
 *   4. Populates `req.user` with `uid`, `email`, `plan`, `subscriptionStatus`.
 *   5. If no token or verification fails → 401.
 *   6. If subscription is cancelled → 403.
 */

import { Request, Response, NextFunction } from 'express';
import { adminAuth, adminDb } from '../lib/firebaseAdmin';
import { logger } from '../logger';

export interface AuthenticatedUser {
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    plan: string;
    subscriptionStatus: string;
}

export interface AuthenticatedRequest extends Request {
    user?: AuthenticatedUser;
}

const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === 'true';

export async function verifyAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;
    logger.info({ path: req.path, hasAuthHeader: !!authHeader, headerPrefix: authHeader?.substring(0, 20) }, 'verifyAuth called');

    if (!authHeader?.startsWith('Bearer ')) {
        logger.warn({ path: req.path }, 'Missing Bearer token');
        res.status(401).json({ error: 'Unauthorized — Bearer token required' });
        return;
    }

    const idToken = authHeader.split('Bearer ')[1];

    // Dev bypass for local development ONLY
    if (DEV_BYPASS && idToken === 'dev') {
        if (process.env.NODE_ENV !== 'development') {
            logger.warn('DEV_BYPASS_AUTH is enabled in a non-development environment. This is a security risk.');
        }
        req.user = {
            uid: 'dev-user',
            email: 'dev@localhost',
            plan: 'firm',
            subscriptionStatus: 'active',
        };
        next();
        return;
    }

    try {
        const decoded = await adminAuth.verifyIdToken(idToken, true); // checkRevoked = true

        // Fetch user document from Firestore for plan/subscription data
        const userDoc = await adminDb.collection('users').doc(decoded.uid).get();
        const userData = userDoc.data();

        if (!userData) {
            // User authenticated but no user doc exists yet — create a default one
            const defaultUser = {
                uid: decoded.uid,
                email: decoded.email || '',
                displayName: decoded.name || '',
                photoURL: decoded.picture || '',
                role: 'accountant',
                plan: 'starter',
                subscriptionStatus: 'active',
                subscriptionEndsAt: null,
                clientCount: 0,
                filingsThisMonth: 0,
                monthResetAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            await adminDb.collection('users').doc(decoded.uid).set(defaultUser);

            req.user = {
                uid: decoded.uid,
                email: decoded.email || '',
                displayName: decoded.name || '',
                photoURL: decoded.picture || '',
                plan: 'starter',
                subscriptionStatus: 'active',
            };
            next();
            return;
        }

        if (userData.subscriptionStatus === 'cancelled') {
            res.status(403).json({ error: 'Subscription cancelled. Please renew your plan.' });
            return;
        }

        req.user = {
            uid: decoded.uid,
            email: decoded.email || '',
            displayName: decoded.name || '',
            photoURL: decoded.picture || '',
            plan: userData.plan || 'starter',
            subscriptionStatus: userData.subscriptionStatus || 'active',
        };

        next();
    } catch (err) {
        logger.warn({ err }, 'Firebase token verification failed');

        // In local dev, fall back to dev-user so existing SQLite data remains accessible
        // while the developer sets up ADC or resolves token issues.
        if (DEV_BYPASS) {
            logger.warn('Falling back to dev-user because DEV_BYPASS_AUTH=true and Firebase verification failed');
            req.user = {
                uid: 'dev-user',
                email: 'dev@localhost',
                plan: 'firm',
                subscriptionStatus: 'active',
            };
            next();
            return;
        }

        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
