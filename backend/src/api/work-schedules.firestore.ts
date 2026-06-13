import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { logAudit } from '../services/auditService';
import { AuthenticatedRequest } from '../middleware/verifyAuth';
import { ensureDefaultWorkSchedules } from '../services/seedClientDefaults';

const router = Router();

const WORK_SCHEDULES_COLLECTION = 'workSchedules';

// GET /api/clients/:clientId/work-schedules
router.get('/:clientId/work-schedules', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        await ensureDefaultWorkSchedules(uid, clientId);
        const snapshot = await adminDb
            .collection(WORK_SCHEDULES_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();
        res.json(snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching work schedules from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/work-schedules/:id
router.get('/:clientId/work-schedules/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;
        const doc = await adminDb.collection(WORK_SCHEDULES_COLLECTION).doc(id).get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Schedule not found' });
        }
        res.json({ id: doc.id, ...doc.data() });
    } catch (err) {
        console.error('Error fetching work schedule from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/work-schedules
router.post('/:clientId/work-schedules', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { name, config, standardCheckIn, standardCheckOut, saturdayCheckOut } = req.body;
        if (!name || !config) return res.status(400).json({ message: 'Name and config are required' });

        const now = Timestamp.now();
        const docRef = await adminDb.collection(WORK_SCHEDULES_COLLECTION).add({
            ownerUid: uid,
            clientId,
            name,
            config: typeof config === 'string' ? config : JSON.stringify(config),
            standardCheckIn: standardCheckIn || '08:00',
            standardCheckOut: standardCheckOut || '17:00',
            saturdayCheckOut: saturdayCheckOut || null,
            createdAt: now,
            updatedAt: now,
        });

        const doc = await docRef.get();
        const schedule = { id: doc.id, ...doc.data() };
        logAudit({ clientId: clientId as any, action: 'CREATE', entityType: 'work_schedule', entityId: doc.id as any, newValues: schedule, performedBy: 'admin' } as any);
        res.status(201).json(schedule);
    } catch (err) {
        console.error('Error creating work schedule in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/work-schedules/:id
router.put('/:clientId/work-schedules/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;
        const { name, config, standardCheckIn, standardCheckOut, saturdayCheckOut } = req.body;

        const docRef = adminDb.collection(WORK_SCHEDULES_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Schedule not found' });
        }

        const updateData: any = { updatedAt: Timestamp.now() };
        if (name !== undefined) updateData.name = name;
        if (config !== undefined) updateData.config = typeof config === 'string' ? config : JSON.stringify(config);
        if (standardCheckIn !== undefined) updateData.standardCheckIn = standardCheckIn;
        if (standardCheckOut !== undefined) updateData.standardCheckOut = standardCheckOut;
        if (saturdayCheckOut !== undefined) updateData.saturdayCheckOut = saturdayCheckOut;

        await docRef.update(updateData);
        const updated = await docRef.get();
        const schedule = { id: updated.id, ...updated.data() };
        logAudit({ clientId: clientId as any, action: 'UPDATE', entityType: 'work_schedule', entityId: id as any, newValues: schedule, performedBy: 'admin' } as any);
        res.json(schedule);
    } catch (err) {
        console.error('Error updating work schedule in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/work-schedules/:id
router.delete('/:clientId/work-schedules/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;
        const docRef = adminDb.collection(WORK_SCHEDULES_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Schedule not found' });
        }
        const schedule = { id: doc.id, ...doc.data() };
        await docRef.delete();
        logAudit({ clientId: clientId as any, action: 'DELETE', entityType: 'work_schedule', entityId: id as any, oldValues: schedule, performedBy: 'admin' } as any);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting work schedule from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/work-schedules/seed-defaults
router.post('/:clientId/work-schedules/seed-defaults', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const now = Timestamp.now();

        const defaults = [
            { name: 'Standard 5-Day (Mon-Fri)', config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 0, Sun: 0 }), standardCheckIn: '08:00', standardCheckOut: '17:00' },
            { name: 'Standard 6-Day (Mon-Sat Full)', config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 8, Sun: 0 }), standardCheckIn: '08:00', standardCheckOut: '17:00' },
            { name: 'Standard 6-Day (Mon-Sat Half)', config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 4, Sun: 0 }), standardCheckIn: '08:00', standardCheckOut: '17:00', saturdayCheckOut: '13:00' },
            { name: '6-Day Week (Sun-Fri)', config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 0, Sun: 8 }), standardCheckIn: '08:00', standardCheckOut: '17:00' },
            { name: '4-Day Week (Mon-Thu)', config: JSON.stringify({ Mon: 10, Tue: 10, Wed: 10, Thu: 10, Fri: 0, Sat: 0, Sun: 0 }), standardCheckIn: '08:00', standardCheckOut: '18:00' },
        ];

        let inserted = 0;
        for (const d of defaults) {
            const existing = await adminDb
                .collection(WORK_SCHEDULES_COLLECTION)
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .where('name', '==', d.name)
                .limit(1)
                .get();
            if (existing.empty) {
                await adminDb.collection(WORK_SCHEDULES_COLLECTION).add({
                    ownerUid: uid,
                    clientId,
                    ...d,
                    createdAt: now,
                    updatedAt: now,
                });
                inserted++;
            }
        }
        res.json({ seeded: inserted });
    } catch (err) {
        console.error('Error seeding default schedules in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
