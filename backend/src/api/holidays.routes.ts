import { Router } from 'express';
import { db } from '../db/kysely';
import { logAudit } from '../services/auditService';

const router = Router();

// GET /api/clients/:clientId/holidays
router.get('/:clientId/holidays', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const year = (req.query.year as string) || new Date().getFullYear().toString();

        const holidays = await db
            .selectFrom('holidays')
            .selectAll()
            .where('clientId', '=', clientId)
            .where((eb) => eb.or([eb('date', 'like', `${year}-%`), eb('isRecurring', '=', 1)]))
            .orderBy('date', 'asc')
            .execute();

        res.json(holidays);
    } catch (err) {
        console.error('Error fetching holidays:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/holidays/all
router.get('/:clientId/holidays/all', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const holidays = await db
            .selectFrom('holidays')
            .selectAll()
            .where('clientId', '=', clientId)
            .orderBy('date', 'asc')
            .execute();

        res.json(holidays);
    } catch (err) {
        console.error('Error fetching all holidays:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/holidays
router.post('/:clientId/holidays', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { name, date, isRecurring, holidayType } = req.body;
        if (!name || !date) return res.status(400).json({ message: 'Name and date are required' });

        const now = new Date().toISOString();
        const result = await db
            .insertInto('holidays')
            .values({
                clientId,
                name,
                date,
                isRecurring: isRecurring === true || isRecurring === 1 ? 1 : 0,
                holidayType: holidayType || 'company',
                createdAt: now,
                updatedAt: now,
            })
            .executeTakeFirst();

        const id = Number(result.insertId);
        const holiday = await db.selectFrom('holidays').selectAll().where('id', '=', id).executeTakeFirst();

        logAudit({ clientId, action: 'CREATE', entityType: 'holiday', entityId: id, newValues: holiday, performedBy: 'admin' });
        res.status(201).json(holiday);
    } catch (err) {
        console.error('Error creating holiday:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/holidays/:id
router.put('/:clientId/holidays/:id', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const id = parseInt(req.params.id, 10);
        if (isNaN(clientId) || isNaN(id)) return res.status(400).json({ message: 'Invalid ID' });

        const { name, date, isRecurring, holidayType } = req.body;
        const now = new Date().toISOString();

        const updateData: any = { updatedAt: now };
        if (name !== undefined) updateData.name = name;
        if (date !== undefined) updateData.date = date;
        if (isRecurring !== undefined) updateData.isRecurring = isRecurring === true || isRecurring === 1 ? 1 : 0;
        if (holidayType !== undefined) updateData.holidayType = holidayType;

        await db.updateTable('holidays').set(updateData).where('id', '=', id).where('clientId', '=', clientId).execute();
        const holiday = await db.selectFrom('holidays').selectAll().where('id', '=', id).executeTakeFirst();

        logAudit({ clientId, action: 'UPDATE', entityType: 'holiday', entityId: id, newValues: holiday, performedBy: 'admin' });
        res.json(holiday);
    } catch (err) {
        console.error('Error updating holiday:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/holidays/:id
router.delete('/:clientId/holidays/:id', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const id = parseInt(req.params.id, 10);
        if (isNaN(clientId) || isNaN(id)) return res.status(400).json({ message: 'Invalid ID' });

        const holiday = await db.selectFrom('holidays').selectAll().where('id', '=', id).where('clientId', '=', clientId).executeTakeFirst();
        if (!holiday) return res.status(404).json({ message: 'Holiday not found' });

        await db.deleteFrom('holidays').where('id', '=', id).where('clientId', '=', clientId).execute();
        logAudit({ clientId, action: 'DELETE', entityType: 'holiday', entityId: id, oldValues: holiday, performedBy: 'admin' });
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting holiday:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/holidays/seed-kenyan
router.post('/:clientId/holidays/seed-kenyan', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const year = (req.query.year as string) || new Date().getFullYear().toString();
        const y = parseInt(year, 10);

        // Kenyan public holidays for this year
        const kenyanHolidays = [
            // New Year
            { name: "New Year's Day", date: `${year}-01-01`, isRecurring: 1, holidayType: 'public' },
            // Good Friday (Easter - varies by year, using approximate dates)
            // Labour Day
            { name: "Labour Day", date: `${year}-05-01`, isRecurring: 1, holidayType: 'public' },
            // Madaraka Day
            { name: "Madaraka Day", date: `${year}-06-01`, isRecurring: 1, holidayType: 'public' },
            // Eid al-Fitr (varies by Islamic calendar, not fixed)
            // Moi Day / Huduma Day
            { name: "Huduma Day", date: `${year}-10-10`, isRecurring: 1, holidayType: 'public' },
            // Mashujaa Day
            { name: "Mashujaa Day", date: `${year}-10-20`, isRecurring: 1, holidayType: 'public' },
            // Jamhuri Day
            { name: "Jamhuri Day", date: `${year}-12-12`, isRecurring: 1, holidayType: 'public' },
            // Christmas
            { name: "Christmas Day", date: `${year}-12-25`, isRecurring: 1, holidayType: 'public' },
            // Boxing Day
            { name: "Boxing Day", date: `${year}-12-26`, isRecurring: 1, holidayType: 'public' },
            // Easter dates (approximate - varies)
            { name: "Good Friday", date: generateEasterDate(y, 'fri'), isRecurring: 0, holidayType: 'public' },
            { name: "Easter Monday", date: generateEasterDate(y, 'mon'), isRecurring: 0, holidayType: 'public' },
            { name: "Eid al-Fitr", date: generateEidAlFitr(y), isRecurring: 0, holidayType: 'public' },
        ];

        const now = new Date().toISOString();
        let inserted = 0;
        for (const h of kenyanHolidays) {
            const existing = await db.selectFrom('holidays')
                .selectAll()
                .where('clientId', '=', clientId)
                .where('name', '=', h.name)
                .where('date', 'like', `${year}-%`)
                .executeTakeFirst();
            if (!existing) {
                await db.insertInto('holidays').values({
                    clientId, name: h.name, date: h.date,
                    isRecurring: h.isRecurring, holidayType: h.holidayType,
                    createdAt: now, updatedAt: now,
                }).execute();
                inserted++;
            }
        }

        res.json({ seeded: inserted, total: kenyanHolidays.length });
    } catch (err) {
        console.error('Error seeding Kenyan holidays:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

function generateEasterDate(year: number, type: 'fri' | 'mon'): string {
    // Gaussian algorithm for Easter
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
    // Approximate Eid al-Fitr dates for recent years
    const eidDates: Record<number, string> = {
        2024: '2024-04-10', 2025: '2025-03-30', 2026: '2026-03-19',
        2027: '2027-03-08', 2028: '2028-02-26', 2029: '2029-02-15',
        2030: '2030-02-04',
    };
    return eidDates[year] || `${year}-03-15`;
}

export default router;
