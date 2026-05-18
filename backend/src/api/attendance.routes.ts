import { Router } from 'express';
import { db } from '../db/kysely';

const router = Router();

async function autoCalculateOvertime(clientId: number, employeeId: number, date: string, checkOut: string): Promise<void> {
    if (!checkOut || !date || !employeeId) return;
    const emp = await db.selectFrom('employees').selectAll().where('id', '=', employeeId).where('clientId', '=', clientId).executeTakeFirst();
    if (!emp) return;

    const standardCO = emp.standardCheckOut || '17:00';
    const [sH, sM] = standardCO.split(':').map(Number);
    const [cH, cM] = checkOut.split(':').map(Number);
    if (isNaN(sH) || isNaN(cH)) return;

    const standardMins = sH * 60 + (sM || 0);
    const actualMins = cH * 60 + (cM || 0);
    if (actualMins <= standardMins) {
        await db.deleteFrom('overtime_records').where('clientId', '=', clientId).where('employeeId', '=', employeeId).where('period', '=', date.substring(0, 7)).execute();
        return;
    }

    const overtimeHours = (actualMins - standardMins) / 60;
    const hourlyRate = (emp.basicPay || 0) / 240;
    const amount = Math.round(overtimeHours * hourlyRate * 1.5 * 100) / 100;
    const period = date.substring(0, 7);

    await db.deleteFrom('overtime_records').where('clientId', '=', clientId).where('employeeId', '=', employeeId).where('period', '=', period).execute();
    await db.insertInto('overtime_records').values({
        clientId, employeeId, period,
        hours: Math.round(overtimeHours * 100) / 100,
        rate: Math.round(hourlyRate * 100) / 100,
        multiplier: 1.5,
        amount,
        description: '',
        createdAt: new Date().toISOString(),
    }).execute();
}

// GET /api/clients/:clientId/attendance
router.get('/:clientId/attendance', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        let query = db
            .selectFrom('attendance_records')
            .selectAll()
            .where('clientId', '=', clientId)
            .orderBy('date', 'desc');

        const { employeeKraPin, dateFrom, dateTo } = req.query;
        if (employeeKraPin && typeof employeeKraPin === 'string') {
            query = query.where('kraPin', '=', employeeKraPin);
        }
        if (dateFrom && typeof dateFrom === 'string') {
            query = query.where('date', '>=', dateFrom);
        }
        if (dateTo && typeof dateTo === 'string') {
            query = query.where('date', '<=', dateTo);
        }

        const records = await query.execute();
        res.json(records);
    } catch (err) {
        console.error('Error fetching attendance records:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/attendance
router.post('/:clientId/attendance', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { employeeId, employeeName, kraPin, date, checkIn, checkOut, status, notes } = req.body;

        const now = new Date().toISOString();
        const result = await db
            .insertInto('attendance_records')
            .values({
                clientId,
                employeeId: employeeId || 0,
                employeeName: employeeName || '',
                kraPin: kraPin || '',
                date: date || '',
                checkIn: checkIn || '',
                checkOut: checkOut || '',
                status: status || 'Present',
                notes: notes || '',
                createdAt: now,
                updatedAt: now,
            })
            .executeTakeFirst();

        const id = Number(result.insertId || 0);
        const record = await db
            .selectFrom('attendance_records')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        res.status(201).json(record);
        autoCalculateOvertime(clientId, employeeId || 0, date || '', checkOut || '').catch(() => {});
    } catch (err) {
        console.error('Error creating attendance record:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/attendance/:id
router.put('/:clientId/attendance/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const existing = await db
            .selectFrom('attendance_records')
            .selectAll()
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        if (!existing) return res.status(404).json({ message: 'Attendance record not found' });

        const { employeeId, employeeName, kraPin, date, checkIn, checkOut, status, notes } = req.body;

        await db
            .updateTable('attendance_records')
            .set({
                employeeId: employeeId !== undefined ? employeeId : existing.employeeId,
                employeeName: employeeName !== undefined ? employeeName : existing.employeeName,
                kraPin: kraPin !== undefined ? kraPin : existing.kraPin,
                date: date !== undefined ? date : existing.date,
                checkIn: checkIn !== undefined ? checkIn : existing.checkIn,
                checkOut: checkOut !== undefined ? checkOut : existing.checkOut,
                status: status !== undefined ? status : existing.status,
                notes: notes !== undefined ? notes : existing.notes,
                updatedAt: new Date().toISOString(),
            })
            .where('id', '=', id)
            .execute();

        const updated = await db
            .selectFrom('attendance_records')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        res.json(updated);
        const effEmployeeId = employeeId !== undefined ? employeeId : existing.employeeId;
        const effDate = date !== undefined ? date : existing.date;
        const effCheckOut = checkOut !== undefined ? checkOut : existing.checkOut;
        autoCalculateOvertime(clientId, effEmployeeId, effDate, effCheckOut).catch(() => {});
    } catch (err) {
        console.error('Error updating attendance record:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/attendance/:id
router.delete('/:clientId/attendance/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        await db
            .deleteFrom('attendance_records')
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .execute();

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting attendance record:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/attendance/bulk
router.post('/:clientId/attendance/bulk', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { records } = req.body;
        if (!Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ message: 'records must be a non-empty array' });
        }

        const now = new Date().toISOString();
        const values = records.map((r: any) => ({
            clientId,
            employeeId: r.employeeId || 0,
            employeeName: r.employeeName || '',
            kraPin: r.kraPin || '',
            date: r.date || '',
            checkIn: r.checkIn || '',
            checkOut: r.checkOut || '',
            status: r.status || 'Present',
            notes: r.notes || '',
            createdAt: now,
            updatedAt: now,
        }));

        const result = await db
            .insertInto('attendance_records')
            .values(values)
            .execute();

        res.status(201).json({ inserted: result.length });
    } catch (err) {
        console.error('Error bulk inserting attendance records:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
