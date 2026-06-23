import { Router, Request, Response } from 'express';
import { Resend } from 'resend';
import { adminDb } from '../lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '../logger';

const router = Router();

const EMAIL_HISTORY_COLLECTION = 'emailHistory';

/**
 * Map a Resend event type to the high-level status we store on the emailHistory doc.
 */
function eventTypeToStatus(eventType: string): string | null {
    switch (eventType) {
        case 'email.sent':
            return 'sent';
        case 'email.delivered':
            return 'delivered';
        case 'email.opened':
            return 'opened';
        case 'email.clicked':
            return 'clicked';
        case 'email.bounced':
            return 'bounced';
        case 'email.complained':
            return 'complained';
        case 'email.failed':
            return 'failed';
        case 'email.suppressed':
            return 'suppressed';
        case 'email.delivery_delayed':
            return 'delivery_delayed';
        default:
            return null;
    }
}

/**
 * Derive an order weight for statuses so we don't overwrite a more mature status
 * with an earlier one (e.g. a late email.sent overwriting email.delivered).
 */
const STATUS_WEIGHT: Record<string, number> = {
    pending: 0,
    failed: 1,
    suppressed: 2,
    bounced: 3,
    complained: 4,
    delivery_delayed: 5,
    sent: 6,
    delivered: 7,
    clicked: 8,
    opened: 9,
};

function shouldUpdateStatus(currentStatus: string | null | undefined, newStatus: string): boolean {
    const currentWeight = STATUS_WEIGHT[currentStatus || 'pending'] ?? 0;
    const newWeight = STATUS_WEIGHT[newStatus] ?? 0;
    return newWeight >= currentWeight;
}

/**
 * POST /api/webhooks/resend
 *
 * Public endpoint that receives Resend webhook events. The raw body is required
 * for signature verification. The route is mounted before express.json() so that
 * the raw parser handles this path.
 */
router.post('/resend', async (req: Request, res: Response): Promise<void> => {
    const rawBody = (req as any).rawBody as string | undefined;
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();

    if (!rawBody) {
        logger.error('[ResendWebhook] No raw body available');
        res.status(400).json({ error: 'Bad request' });
        return;
    }

    // Verify webhook signature when a secret is configured.
    if (webhookSecret) {
        const apiKey = process.env.RESEND_API_KEY?.trim();
        if (!apiKey) {
            logger.error('[ResendWebhook] RESEND_WEBHOOK_SECRET is set but RESEND_API_KEY is missing');
            res.status(500).json({ error: 'Server misconfiguration' });
            return;
        }

        try {
            const resend = new Resend(apiKey);
            resend.webhooks.verify({
                payload: rawBody,
                headers: {
                    id: req.headers['svix-id'] as string,
                    timestamp: req.headers['svix-timestamp'] as string,
                    signature: req.headers['svix-signature'] as string,
                },
                webhookSecret,
            });
        } catch (err: any) {
            logger.warn({ error: err.message }, '[ResendWebhook] Signature verification failed');
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }
    } else {
        logger.warn('[ResendWebhook] RESEND_WEBHOOK_SECRET not set — skipping signature verification (dev only)');
    }

    let event: any;
    try {
        event = JSON.parse(rawBody);
    } catch (err) {
        logger.error('[ResendWebhook] Invalid JSON payload');
        res.status(400).json({ error: 'Invalid JSON' });
        return;
    }

    const eventType = event?.type as string | undefined;
    const data = event?.data || {};
    const svixId = req.headers['svix-id'] as string | undefined;

    logger.info({ eventType, emailId: data.email_id, svixId }, '[ResendWebhook] Event received');

    if (!eventType) {
        res.status(200).json({ received: true, processed: false, reason: 'missing_event_type' });
        return;
    }

    try {
        const tags = data.tags || {};
        let historyId = tags.emailHistoryId as string | undefined;
        const resendEmailId = data.email_id as string | undefined;

        // If the tag is missing, try to correlate by the Resend email id stored on the history doc.
        if (!historyId && resendEmailId) {
            const snapshot = await adminDb
                .collection(EMAIL_HISTORY_COLLECTION)
                .where('resendEmailId', '==', resendEmailId)
                .limit(1)
                .get();

            if (!snapshot.empty) {
                historyId = snapshot.docs[0].id;
            }
        }

        const eventDoc: Record<string, any> = {
            type: eventType,
            createdAt: event.created_at ? new Date(event.created_at) : FieldValue.serverTimestamp(),
            receivedAt: FieldValue.serverTimestamp(),
            data,
            svixId: svixId || null,
        };

        if (historyId) {
            await adminDb
                .collection(EMAIL_HISTORY_COLLECTION)
                .doc(historyId)
                .collection('events')
                .add(eventDoc);

            const newStatus = eventTypeToStatus(eventType);
            if (newStatus) {
                const historyRef = adminDb.collection(EMAIL_HISTORY_COLLECTION).doc(historyId);
                await adminDb.runTransaction(async (tx) => {
                    const snap = await tx.get(historyRef);
                    if (!snap.exists) return;

                    const current = snap.data() as any;
                    if (shouldUpdateStatus(current.status, newStatus)) {
                        const update: Record<string, any> = { status: newStatus, updatedAt: new Date().toISOString() };
                        if (eventType === 'email.bounced' && data.bounce?.message) {
                            update.errorMessage = data.bounce.message;
                        } else if (eventType === 'email.failed' && data.error?.message) {
                            update.errorMessage = data.error.message;
                        }
                        tx.update(historyRef, update);
                    }
                });
            }
        } else {
            // We received an event we can't correlate to a sent email. Store it in a
            // fallback collection so it is not silently lost.
            await adminDb.collection('emailEventsUnmatched').add(eventDoc);
            logger.warn({ eventType, resendEmailId }, '[ResendWebhook] Could not correlate event to emailHistory');
        }

        res.status(200).json({ received: true, processed: true });
    } catch (err: any) {
        logger.error({ err: err.message, eventType }, '[ResendWebhook] Failed to process event');
        // Return 500 so Resend retries; the event may then be replayed from the dashboard.
        res.status(500).json({ error: 'Failed to process event' });
    }
});

export default router;
