import { Router } from 'express';
import { db } from '../db/kysely';
import { logAudit } from '../services/auditService';

const router = Router();

// GET /api/clients/:clientId/work-schedules
router.get('/:clientId/work-schedules', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const schedules = await db
            .selectFrom('work_schedules')
            .selectAll()
            .where('clientId', '=', clientId)
            .execute();

        res.json(schedules);
    } catch (err) {
        console.error('Error fetching work schedules:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/work-schedules/:id
router.get('/:clientId/work-schedules/:id', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const id = parseInt(req.params.id, 10);
        if (isNaN(clientId) || isNaN(id)) return res.status(400).json({ message: 'Invalid ID' });

        const schedule = await db
            .selectFrom('work_schedules')
            .selectAll()
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        if (!schedule) return res.status(404).json({ message: 'Schedule not found' });
        res.json(schedule);
    } catch (err) {
        console.error('Error fetching work schedule:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/work-schedules
router.post('/:clientId/work-schedules', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { name, config, standardCheckIn, standardCheckOut, saturdayCheckOut } = req.body;
        if (!name || !config) return res.status(400).json({ message: 'Name and config are required' });

        const now = new Date().toISOString();
        const result = await db
            .insertInto('work_schedules')
            .values({
                clientId,
                name,
                config: typeof config === 'string' ? config : JSON.stringify(config),
                standardCheckIn: standardCheckIn || '08:00',
                standardCheckOut: standardCheckOut || '17:00',
                saturdayCheckOut: saturdayCheckOut || null,
                createdAt: now,
                updatedAt: now,
            })
            .executeTakeFirst();

        const id = Number(result.insertId);
        const schedule = await db.selectFrom('work_schedules').selectAll().where('id', '=', id).executeTakeFirst();

        logAudit({ clientId, action: 'CREATE', entityType: 'work_schedule', entityId: id, newValues: schedule, performedBy: 'admin' });
        res.status(201).json(schedule);
    } catch (err) {
        console.error('Error creating work schedule:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/work-schedules/:id
router.put('/:clientId/work-schedules/:id', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const id = parseInt(req.params.id, 10);
        if (isNaN(clientId) || isNaN(id)) return res.status(400).json({ message: 'Invalid ID' });

        const { name, config, standardCheckIn, standardCheckOut, saturdayCheckOut } = req.body;
        const now = new Date().toISOString();

        const updateData: any = { updatedAt: now };
        if (name !== undefined) updateData.name = name;
        if (config !== undefined) updateData.config = typeof config === 'string' ? config : JSON.stringify(config);
        if (standardCheckIn !== undefined) updateData.standardCheckIn = standardCheckIn;
        if (standardCheckOut !== undefined) updateData.standardCheckOut = standardCheckOut;
        if (saturdayCheckOut !== undefined) updateData.saturdayCheckOut = saturdayCheckOut;

        await db.updateTable('work_schedules').set(updateData).where('id', '=', id).where('clientId', '=', clientId).execute();
        const schedule = await db.selectFrom('work_schedules').selectAll().where('id', '=', id).executeTakeFirst();

        logAudit({ clientId, action: 'UPDATE', entityType: 'work_schedule', entityId: id, newValues: schedule, performedBy: 'admin' });
        res.json(schedule);
    } catch (err) {
        console.error('Error updating work schedule:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/work-schedules/:id
router.delete('/:clientId/work-schedules/:id', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const id = parseInt(req.params.id, 10);
        if (isNaN(clientId) || isNaN(id)) return res.status(400).json({ message: 'Invalid ID' });

        const schedule = await db.selectFrom('work_schedules').selectAll().where('id', '=', id).where('clientId', '=', clientId).executeTakeFirst();
        if (!schedule) return res.status(404).json({ message: 'Schedule not found' });

        await db.deleteFrom('work_schedules').where('id', '=', id).where('clientId', '=', clientId).execute();
        logAudit({ clientId, action: 'DELETE', entityType: 'work_schedule', entityId: id, oldValues: schedule, performedBy: 'admin' });
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting work schedule:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/work-schedules/seed-defaults
router.post('/:clientId/work-schedules/seed-defaults', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });
        const now = new Date().toISOString();

        const defaults = [
            {
                name: 'Standard 5-Day (Mon-Fri)',
                config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 0, Sun: 0 }),
                standardCheckIn: '08:00', standardCheckOut: '17:00',
            },
            {
                name: 'Standard 6-Day (Mon-Sat Full)',
                config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 8, Sun: 0 }),
                standardCheckIn: '08:00', standardCheckOut: '17:00',
            },
            {
                name: 'Standard 6-Day (Mon-Sat Half)',
                config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 4, Sun: 0 }),
                standardCheckIn: '08:00', standardCheckOut: '17:00',
                saturdayCheckOut: '13:00',
            },
            {
                name: '6-Day Week (Sun-Fri)',
                config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 0, Sun: 8 }),
                standardCheckIn: '08:00', standardCheckOut: '17:00',
            },
            {
                name: '4-Day Week (Mon-Thu)',
                config: JSON.stringify({ Mon: 10, Tue: 10, Wed: 10, Thu: 10, Fri: 0, Sat: 0, Sun: 0 }),
                standardCheckIn: '08:00', standardCheckOut: '18:00',
            },
        ];

        let inserted = 0;
        for (const d of defaults) {
            const existing = await db.selectFrom('work_schedules').selectAll()
                .where('clientId', '=', clientId).where('name', '=', d.name).executeTakeFirst();
            if (!existing) {
                await db.insertInto('work_schedules').values({
                    clientId, ...d, createdAt: now, updatedAt: now,
                }).execute();
                inserted++;
            }
        }
        res.json({ seeded: inserted });
    } catch (err) {
        console.error('Error seeding default schedules:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
