import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { logAudit } from '../services/auditService';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

const HOLIDAYS_COLLECTION = 'holidays';

// GET /api/clients/:clientId/holidays
router.get('/:clientId/holidays', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const year = (req.query.year as string) || new Date().getFullYear().toString();

        const snapshot = await adminDb
            .collection(HOLIDAYS_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();

        const holidays = snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((h: any) => h.date?.startsWith(`${year}-`) || h.isRecurring);

        holidays.sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));
        res.json(holidays);
    } catch (err) {
        console.error('Error fetching holidays from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/holidays/all
router.get('/:clientId/holidays/all', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const snapshot = await adminDb
            .collection(HOLIDAYS_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .orderBy('date', 'asc')
            .get();
        res.json(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching all holidays from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/holidays
router.post('/:clientId/holidays', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { name, date, isRecurring, holidayType } = req.body;
        if (!name || !date) return res.status(400).json({ message: 'Name and date are required' });

        const now = Timestamp.now();
        const docRef = await adminDb.collection(HOLIDAYS_COLLECTION).add({
            ownerUid: uid,
            clientId,
            name,
            date,
            isRecurring: isRecurring === true || isRecurring === 1 ? true : false,
            holidayType: holidayType || 'company',
            createdAt: now,
            updatedAt: now,
        });

        const doc = await docRef.get();
        const holiday = { id: doc.id, ...doc.data() };
        logAudit({ clientId: clientId as any, action: 'CREATE', entityType: 'holiday', entityId: doc.id as any, newValues: holiday, performedBy: 'admin' } as any);
        res.status(201).json(holiday);
    } catch (err) {
        console.error('Error creating holiday in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/holidays/:id
router.put('/:clientId/holidays/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;
        const { name, date, isRecurring, holidayType } = req.body;

        const docRef = adminDb.collection(HOLIDAYS_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Holiday not found' });
        }

        const updateData: any = { updatedAt: Timestamp.now() };
        if (name !== undefined) updateData.name = name;
        if (date !== undefined) updateData.date = date;
        if (isRecurring !== undefined) updateData.isRecurring = isRecurring === true || isRecurring === 1 ? true : false;
        if (holidayType !== undefined) updateData.holidayType = holidayType;

        await docRef.update(updateData);
        const updated = await docRef.get();
        const holiday = { id: updated.id, ...updated.data() };
        logAudit({ clientId: clientId as any, action: 'UPDATE', entityType: 'holiday', entityId: id as any, newValues: holiday, performedBy: 'admin' } as any);
        res.json(holiday);
    } catch (err) {
        console.error('Error updating holiday in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/holidays/:id
router.delete('/:clientId/holidays/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;
        const docRef = adminDb.collection(HOLIDAYS_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Holiday not found' });
        }
        const holiday = { id: doc.id, ...doc.data() };
        await docRef.delete();
        logAudit({ clientId: clientId as any, action: 'DELETE', entityType: 'holiday', entityId: id as any, oldValues: holiday, performedBy: 'admin' } as any);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting holiday from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/holidays/seed-kenyan
router.post('/:clientId/holidays/seed-kenyan', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const year = (req.query.year as string) || new Date().getFullYear().toString();
        const y = parseInt(year, 10);

        const kenyanHolidays = [
            { name: "New Year's Day", date: `${year}-01-01`, isRecurring: true, holidayType: 'public' },
            { name: "Labour Day", date: `${year}-05-01`, isRecurring: true, holidayType: 'public' },
            { name: "Madaraka Day", date: `${year}-06-01`, isRecurring: true, holidayType: 'public' },
            { name: "Huduma Day", date: `${year}-10-10`, isRecurring: true, holidayType: 'public' },
            { name: "Mashujaa Day", date: `${year}-10-20`, isRecurring: true, holidayType: 'public' },
            { name: "Jamhuri Day", date: `${year}-12-12`, isRecurring: true, holidayType: 'public' },
            { name: "Christmas Day", date: `${year}-12-25`, isRecurring: true, holidayType: 'public' },
            { name: "Boxing Day", date: `${year}-12-26`, isRecurring: true, holidayType: 'public' },
            { name: "Good Friday", date: generateEasterDate(y, 'fri'), isRecurring: false, holidayType: 'public' },
            { name: "Easter Monday", date: generateEasterDate(y, 'mon'), isRecurring: false, holidayType: 'public' },
            { name: "Eid al-Fitr", date: generateEidAlFitr(y), isRecurring: false, holidayType: 'public' },
        ];

        const now = Timestamp.now();
        let inserted = 0;
        for (const h of kenyanHolidays) {
            const existing = await adminDb
                .collection(HOLIDAYS_COLLECTION)
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .where('name', '==', h.name)
                .where('date', '>=', `${year}-01-01`)
                .where('date', '<=', `${year}-12-31`)
                .limit(1)
                .get();
            if (existing.empty) {
                await adminDb.collection(HOLIDAYS_COLLECTION).add({
                    ownerUid: uid,
                    clientId,
                    name: h.name,
                    date: h.date,
                    isRecurring: h.isRecurring,
                    holidayType: h.holidayType,
                    createdAt: now,
                    updatedAt: now,
                });
                inserted++;
            }
        }

        res.json({ seeded: inserted, total: kenyanHolidays.length });
    } catch (err) {
        console.error('Error seeding Kenyan holidays in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

function generateEasterDate(year: number, type: 'fri' | 'mon'): string {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    const easterDate = new Date(year, month - 1, day);
    if (type === 'fri') easterDate.setDate(easterDate.getDate() - 2);
    if (type === 'mon') easterDate.setDate(easterDate.getDate() + 1);
    return easterDate.toISOString().split('T')[0];
}

function generateEidAlFitr(year: number): string {
    const eidDates: Record<number, string> = {
        2024: '2024-04-10', 2025: '2025-03-30', 2026: '2026-03-19',
        2027: '2027-03-08', 2028: '2028-02-26', 2029: '2029-02-15',
        2030: '2030-02-04',
    };
    return eidDates[year] || `${year}-03-15`;
}

export default router;
