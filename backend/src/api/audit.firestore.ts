import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

const AUDIT_LOG_COLLECTION = 'auditLog';

router.get('/:clientId/audit-log', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const limit = Math.min(parseInt(String(req.query.limit)) || 200, 1000);

        const snapshot = await adminDb
            .collection(AUDIT_LOG_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        res.json(snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching audit log from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
