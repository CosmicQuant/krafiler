import { Router } from 'express';
import { db } from '../db/kysely';

const router = Router();

router.get('/:clientId/departments', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });
        const depts = await db.selectFrom('departments').selectAll().where('clientId', '=', clientId).orderBy('name', 'asc').execute();
        res.json(depts);
    } catch (err) {
        console.error('Error fetching departments:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/:clientId/departments', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });
        const { name, headEmployeeId } = req.body;
        if (!name) return res.status(400).json({ message: 'Department name is required' });
        const now = new Date().toISOString();
        const result = await db.insertInto('departments').values({ clientId, name, headEmployeeId: headEmployeeId || null, createdAt: now, updatedAt: now }).executeTakeFirst();
        const id = Number(result.insertId || 0);
        const dept = await db.selectFrom('departments').selectAll().where('id', '=', id).executeTakeFirst();
        res.status(201).json(dept);
    } catch (err) {
        console.error('Error creating department:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.put('/:clientId/departments/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });
        const { name, headEmployeeId } = req.body;
        const now = new Date().toISOString();
        await db.updateTable('departments').set({ name, headEmployeeId: headEmployeeId || null, updatedAt: now }).where('id', '=', id).where('clientId', '=', clientId).execute();
        const dept = await db.selectFrom('departments').selectAll().where('id', '=', id).executeTakeFirst();
        res.json(dept);
    } catch (err) {
        console.error('Error updating department:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.delete('/:clientId/departments/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });
        await db.deleteFrom('departments').where('id', '=', id).where('clientId', '=', clientId).execute();
        await db.updateTable('employees').set({ departmentId: null }).where('departmentId', '=', id).execute();
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting department:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
