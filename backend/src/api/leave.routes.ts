import { Router } from 'express';
import { db } from '../db/kysely';

const router = Router();

// GET /api/clients/:clientId/leave
router.get('/:clientId/leave', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const records = await db
            .selectFrom('leave_requests')
            .selectAll()
            .where('clientId', '=', clientId)
            .orderBy('createdAt', 'desc')
            .execute();

        res.json(records);
    } catch (err) {
        console.error('Error fetching leave requests:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/leave
router.post('/:clientId/leave', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { employeeId, employeeName, kraPin, leaveType, startDate, endDate, daysCount, reason, status } = req.body;

        const now = new Date().toISOString();
        const result = await db
            .insertInto('leave_requests')
            .values({
                clientId,
                employeeId: employeeId || 0,
                employeeName: employeeName || '',
                kraPin: kraPin || '',
                leaveType: leaveType || 'Annual',
                startDate: startDate || '',
                endDate: endDate || '',
                daysCount: daysCount || 1,
                reason: reason || '',
                status: status || 'Pending',
                createdAt: now,
                updatedAt: now,
            })
            .executeTakeFirst();

        const id = Number(result.insertId || 0);
        const record = await db
            .selectFrom('leave_requests')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        res.status(201).json(record);
    } catch (err) {
        console.error('Error creating leave request:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/leave/:id
router.put('/:clientId/leave/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const existing = await db
            .selectFrom('leave_requests')
            .selectAll()
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        if (!existing) return res.status(404).json({ message: 'Leave request not found' });

        const { employeeId, employeeName, kraPin, leaveType, startDate, endDate, daysCount, reason, status } = req.body;

        await db
            .updateTable('leave_requests')
            .set({
                employeeId: employeeId !== undefined ? employeeId : existing.employeeId,
                employeeName: employeeName !== undefined ? employeeName : existing.employeeName,
                kraPin: kraPin !== undefined ? kraPin : existing.kraPin,
                leaveType: leaveType !== undefined ? leaveType : existing.leaveType,
                startDate: startDate !== undefined ? startDate : existing.startDate,
                endDate: endDate !== undefined ? endDate : existing.endDate,
                daysCount: daysCount !== undefined ? daysCount : existing.daysCount,
                reason: reason !== undefined ? reason : existing.reason,
                status: status !== undefined ? status : existing.status,
                updatedAt: new Date().toISOString(),
            })
            .where('id', '=', id)
            .execute();

        const updated = await db
            .selectFrom('leave_requests')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        res.json(updated);
    } catch (err) {
        console.error('Error updating leave request:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/leave/:id
router.delete('/:clientId/leave/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        await db
            .deleteFrom('leave_requests')
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .execute();

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting leave request:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
