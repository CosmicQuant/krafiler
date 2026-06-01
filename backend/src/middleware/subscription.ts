/**
 * subscription.ts
 *
 * Express middleware to enforce subscription plan limits.
 * Applied to protected routes after verifyAuth.
 */

import { Response, NextFunction } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { logger } from '../logger';
import { AuthenticatedRequest } from './verifyAuth';
import { PLAN_CONFIG } from '../api/subscriptions.firestore';

export async function checkSubscriptionLimits(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const uid = req.user?.uid;
    if (!uid) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    // Dev bypass — no limits in local dev
    if (process.env.DEV_BYPASS_AUTH === 'true' && uid === 'dev-user') {
        next();
        return;
    }

    try {
        const userDoc = await adminDb.collection('users').doc(uid).get();
        let userData = userDoc.data();

        if (!userData) {
            // Create a default user doc on-the-fly so the user isn't blocked
            const defaultUser = {
                uid,
                email: req.user!.email || '',
                plan: 'starter',
                subscriptionStatus: 'active',
                subscriptionEndsAt: null,
                clientCount: 0,
                filingsThisMonth: 0,
                monthResetAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            await adminDb.collection('users').doc(uid).set(defaultUser);
            userData = defaultUser;
            logger.info({ uid }, '[checkSubscriptionLimits] Created default user doc');
        }

        let plan = (userData.plan || 'starter') as keyof typeof PLAN_CONFIG;
        let limits = PLAN_CONFIG[plan];
        if (!limits) {
            logger.warn({ uid, plan }, '[checkSubscriptionLimits] Invalid plan, defaulting to starter');
            plan = 'starter';
            limits = PLAN_CONFIG['starter'];
        }

        // Check client limit on POST /api/clients (match both /clients and /api/clients)
        const isClientPost = (req.path === '/clients' || req.path.endsWith('/clients')) && req.method === 'POST';
        if (isClientPost) {
            const clientCount = userData.clientCount || 0;
            if (clientCount >= limits.maxClients) {
                logger.info({ uid, clientCount, limit: limits.maxClients }, '[checkSubscriptionLimits] Client limit reached');
                res.status(403).json({
                    error: 'Client limit reached.',
                    limit: limits.maxClients,
                    current: clientCount,
                    upgradeUrl: '/subscription',
                });
                return;
            }
        }

        // Check filing limit on POST /api/tax/file-return (and legacy nil-return)
        if (req.path.includes('/tax/file') && req.method === 'POST') {
            const filingsThisMonth = userData.filingsThisMonth || 0;
            if (filingsThisMonth >= limits.maxFilings) {
                logger.info({ uid, filingsThisMonth, limit: limits.maxFilings }, '[checkSubscriptionLimits] Filing limit reached');
                res.status(403).json({
                    error: 'Monthly filing limit reached.',
                    limit: limits.maxFilings,
                    current: filingsThisMonth,
                    upgradeUrl: '/subscription',
                });
                return;
            }
        }

        // Attach limits to request for downstream use
        (req as any).planLimits = limits;
        next();
    } catch (err: any) {
        logger.error({ err, uid }, '[checkSubscriptionLimits] Error');
        res.status(500).json({ error: 'Failed to check subscription limits.' });
    }
}
