/**
 * subscriptions.firestore.ts
 *
 * Subscription & billing routes for KRAFILER SaaS.
 * Integrates with Paystack for M-Pesa, cards, and bank transfers.
 */

import { Router, Request, Response } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { logger } from '../logger';
import { initializeTransaction, verifyTransaction, listSubscriptions } from '../services/paystack';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

export const PLAN_CONFIG = {
    starter:  { name: 'Starter',  maxClients: 5,   maxFilings: 25,  amountKes: 1500 },
    solo:     { name: 'Solo',     maxClients: 15,  maxFilings: 100, amountKes: 3500 },
    practice: { name: 'Practice', maxClients: 75,  maxFilings: 500, amountKes: 8500 },
    firm:     { name: 'Firm',     maxClients: Infinity, maxFilings: Infinity, amountKes: 18000 },
};

// Convert KES amount to kobo (lowest currency unit)
function toKobo(kes: number): number {
    return kes * 100;
}

/**
 * GET /api/subscriptions/plans
 * Returns the list of available plans (static, no Paystack call needed).
 */
router.get('/plans', async (_req: Request, res: Response) => {
    const plans = Object.entries(PLAN_CONFIG).map(([key, config]) => ({
        id: key,
        name: config.name,
        maxClients: config.maxClients,
        maxFilings: config.maxFilings,
        amountKes: config.amountKes,
        amountKobo: toKobo(config.amountKes),
        interval: 'monthly',
        currency: 'KES',
    }));
    res.status(200).json({ plans });
});

/**
 * GET /api/subscriptions/me
 * Returns the current user's subscription status.
 */
router.get('/me', async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.user?.uid;
    if (!uid) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const userDoc = await adminDb.collection('users').doc(uid).get();
    const userData = userDoc.data();
    if (!userData) {
        res.status(404).json({ error: 'User not found' });
        return;
    }

    res.status(200).json({
        plan: userData.plan || 'starter',
        subscriptionStatus: userData.subscriptionStatus || 'active',
        subscriptionEndsAt: userData.subscriptionEndsAt || null,
        clientCount: userData.clientCount || 0,
        filingsThisMonth: userData.filingsThisMonth || 0,
        paystackCustomerCode: userData.paystackCustomerCode || null,
        paystackSubscriptionCode: userData.paystackSubscriptionCode || null,
    });
});

/**
 * POST /api/subscriptions/initialize
 * Initializes a Paystack transaction (one-off payment or first subscription charge).
 */
router.post('/initialize', async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.user?.uid;
    const email = req.user?.email;
    if (!uid || !email) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const { planId, callbackUrl } = req.body;
    if (!planId || !PLAN_CONFIG[planId as keyof typeof PLAN_CONFIG]) {
        res.status(400).json({ error: 'Invalid or missing planId' });
        return;
    }

    const plan = PLAN_CONFIG[planId as keyof typeof PLAN_CONFIG];
    const reference = `krafiler_${uid}_${Date.now()}`;

    try {
        const tx = await initializeTransaction({
            email,
            amount: toKobo(plan.amountKes),
            reference,
            callback_url: callbackUrl || undefined,
            metadata: { uid, planId, source: 'krafiler_web' },
        });

        // Store pending transaction reference on user doc for later verification
        await adminDb.collection('users').doc(uid).update({
            pendingTransactionRef: reference,
            pendingPlanId: planId,
            updatedAt: FieldValue.serverTimestamp(),
        });

        res.status(200).json({
            authorizationUrl: tx.authorization_url,
            reference: tx.reference,
            accessCode: tx.access_code,
        });
    } catch (err: any) {
        logger.error({ err: err.message, uid, planId }, 'Failed to initialize Paystack transaction');
        res.status(500).json({ error: err.message || 'Failed to initialize payment.' });
    }
});

/**
 * GET /api/subscriptions/verify/:reference
 * Verifies a Paystack transaction and activates the subscription.
 */
router.get('/verify/:reference', async (req: AuthenticatedRequest, res: Response) => {
    const uid = req.user?.uid;
    if (!uid) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const { reference } = req.params;
    try {
        const tx = await verifyTransaction(reference);
        if (tx.status !== 'success') {
            res.status(402).json({ error: 'Payment not successful.', status: tx.status });
            return;
        }

        const userDoc = await adminDb.collection('users').doc(uid).get();
        const userData = userDoc.data();
        const planId = userData?.pendingPlanId || 'starter';
        const plan = PLAN_CONFIG[planId as keyof typeof PLAN_CONFIG];

        // Activate subscription
        const now = Timestamp.now();
        const endDate = Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days

        await adminDb.collection('users').doc(uid).update({
            plan: planId,
            subscriptionStatus: 'active',
            subscriptionEndsAt: endDate,
            paystackCustomerCode: tx.channel || userData?.paystackCustomerCode || null,
            monthResetAt: now,
            clientCount: 0,
            filingsThisMonth: 0,
            pendingTransactionRef: FieldValue.delete(),
            pendingPlanId: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Record subscription in Firestore for history
        await adminDb.collection('subscriptions').add({
            userId: uid,
            reference: tx.reference,
            plan: planId,
            amount: tx.amount,
            currency: tx.currency || 'KES',
            status: 'active',
            paidAt: tx.paid_at ? Timestamp.fromDate(new Date(tx.paid_at)) : now,
            createdAt: FieldValue.serverTimestamp(),
        });

        res.status(200).json({
            success: true,
            plan: planId,
            status: 'active',
            subscriptionEndsAt: endDate.toDate().toISOString(),
        });
    } catch (err: any) {
        logger.error({ err: err.message, uid, reference }, 'Failed to verify Paystack transaction');
        res.status(500).json({ error: err.message || 'Verification failed.' });
    }
});

/**
 * POST /api/subscriptions/webhook
 * Paystack webhook endpoint (public — signature verification required in production).
 */
router.post('/webhook', async (req: Request, res: Response) => {
    // TODO: verify Paystack signature with PAYSTACK_SECRET_KEY hash
    const event = req.body;
    logger.info({ event }, 'Paystack webhook received');

    if (event?.event === 'charge.success') {
        const data = event.data;
        const metadata = data?.metadata || {};
        const uid = metadata.uid;
        const planId = metadata.planId;

        if (uid && planId) {
            const now = Timestamp.now();
            const endDate = Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);

            await adminDb.collection('users').doc(uid).update({
                plan: planId,
                subscriptionStatus: 'active',
                subscriptionEndsAt: endDate,
                monthResetAt: now,
                updatedAt: FieldValue.serverTimestamp(),
            });

            await adminDb.collection('subscriptions').add({
                userId: uid,
                reference: data.reference,
                plan: planId,
                amount: data.amount,
                currency: data.currency || 'KES',
                status: 'active',
                paidAt: data.paid_at ? Timestamp.fromDate(new Date(data.paid_at)) : now,
                createdAt: FieldValue.serverTimestamp(),
            });
        }
    }

    if (event?.event === 'subscription.disable') {
        const data = event.data;
        const customer = data?.customer;
        if (customer) {
            // Find user by paystackCustomerCode and mark as cancelled
            // Simplification: find user doc with matching customer code
            const snap = await adminDb.collection('users').where('paystackCustomerCode', '==', customer.customer_code).limit(1).get();
            if (!snap.empty) {
                await snap.docs[0].ref.update({
                    subscriptionStatus: 'cancelled',
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
        }
    }

    res.status(200).send('OK');
});

export default router;
