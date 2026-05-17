import { Router } from 'express';
import { db } from '../db/kysely';

const router = Router();

router.get('/:clientId/audit-log', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });
        const limit = Math.min(parseInt(String(req.query.limit)) || 200, 1000);
        const logs = await db.selectFrom('audit_log').selectAll().where('clientId', '=', clientId).orderBy('createdAt', 'desc').limit(limit).execute();
        res.json(logs);
    } catch (err) {
        console.error('Error fetching audit log:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
