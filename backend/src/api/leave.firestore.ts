import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { logAudit } from '../services/auditService';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

const LEAVE_TYPES_COLLECTION = 'leaveTypes';
const LEAVE_REQUESTS_COLLECTION = 'leaveRequests';

// ─── Leave Types (client-configurable) ────────────────────────────────────────

// GET /api/clients/:clientId/leave-types
router.get('/:clientId/leave-types', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;

        const snapshot = await adminDb
            .collection(LEAVE_TYPES_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .orderBy('name', 'asc')
            .get();

        res.json(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching leave types from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/leave-types
router.post('/:clientId/leave-types', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { name, isPaid, maxDaysPerYear } = req.body;
        if (!name) return res.status(400).json({ message: 'Name is required' });

        const now = Timestamp.now();
        const docRef = await adminDb.collection(LEAVE_TYPES_COLLECTION).add({
            ownerUid: uid,
            clientId,
            name: name || '',
            isPaid: isPaid === false || isPaid === 0 ? false : true,
            maxDaysPerYear: maxDaysPerYear || null,
            createdAt: now,
            updatedAt: now,
        });

        const doc = await docRef.get();
        res.status(201).json({ id: doc.id, ...doc.data() });
    } catch (err) {
        console.error('Error creating leave type in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/leave-types/:id
router.put('/:clientId/leave-types/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;

        const docRef = adminDb.collection(LEAVE_TYPES_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Leave type not found' });
        }

        const { name, isPaid, maxDaysPerYear } = req.body;
        const updateData: any = { updatedAt: Timestamp.now() };
        if (name !== undefined) updateData.name = name;
        if (isPaid !== undefined) updateData.isPaid = isPaid === false || isPaid === 0 ? false : true;
        if (maxDaysPerYear !== undefined) updateData.maxDaysPerYear = maxDaysPerYear;

        await docRef.update(updateData);
        const updated = await docRef.get();
        res.json({ id: updated.id, ...updated.data() });
    } catch (err) {
        console.error('Error updating leave type in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/leave-types/:id
router.delete('/:clientId/leave-types/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;

        const docRef = adminDb.collection(LEAVE_TYPES_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Leave type not found' });
        }

        await docRef.delete();
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting leave type from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── Leave Requests ───────────────────────────────────────────────────────────

// GET /api/clients/:clientId/leave
router.get('/:clientId/leave', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;

        const snapshot = await adminDb
            .collection(LEAVE_REQUESTS_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .orderBy('createdAt', 'desc')
            .get();

        res.json(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching leave requests from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/leave
router.post('/:clientId/leave', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { employeeId, employeeName, kraPin, leaveType, startDate, endDate, startTime, endTime, daysCount, hours, reason, status, isPaid } = req.body;

        const now = Timestamp.now();
        const docRef = await adminDb.collection(LEAVE_REQUESTS_COLLECTION).add({
            ownerUid: uid,
            clientId,
            employeeId: employeeId || '',
            employeeName: employeeName || '',
            kraPin: kraPin || '',
            leaveType: leaveType || 'Annual',
            startDate: startDate || '',
            endDate: endDate || '',
            startTime: startTime || null,
            endTime: endTime || null,
            daysCount: daysCount || 1,
            hours: hours || 0,
            reason: reason || '',
            status: status || 'Pending',
            isPaid: isPaid === false || isPaid === 0 ? false : true,
            createdAt: now,
            updatedAt: now,
        });

        const doc = await docRef.get();
        const record = { id: doc.id, ...doc.data() };

        logAudit({
            clientId: clientId as any,
            employeeId: employeeId as any,
            action: 'CREATE',
            entityType: 'leave_request',
            entityId: doc.id as any,
            newValues: record,
            performedBy: 'admin',
        } as any);

        res.status(201).json(record);
    } catch (err) {
        console.error('Error creating leave request in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/leave/:id
router.put('/:clientId/leave/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;

        const docRef = adminDb.collection(LEAVE_REQUESTS_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Leave request not found' });
        }

        const existing = doc.data()!;
        const { employeeId, employeeName, kraPin, leaveType, startDate, endDate, startTime, endTime, daysCount, hours, reason, status, isPaid } = req.body;

        const updateData: any = { updatedAt: Timestamp.now() };
        if (employeeId !== undefined) updateData.employeeId = employeeId;
        if (employeeName !== undefined) updateData.employeeName = employeeName;
        if (kraPin !== undefined) updateData.kraPin = kraPin;
        if (leaveType !== undefined) updateData.leaveType = leaveType;
        if (startDate !== undefined) updateData.startDate = startDate;
        if (endDate !== undefined) updateData.endDate = endDate;
        if (startTime !== undefined) updateData.startTime = startTime;
        if (endTime !== undefined) updateData.endTime = endTime;
        if (daysCount !== undefined) updateData.daysCount = daysCount;
        if (hours !== undefined) updateData.hours = hours;
        if (reason !== undefined) updateData.reason = reason;
        if (status !== undefined) updateData.status = status;
        if (isPaid !== undefined) updateData.isPaid = isPaid === false || isPaid === 0 ? false : true;

        await docRef.update(updateData);
        const updated = await docRef.get();
        const updatedData = { id: updated.id, ...updated.data() };

        logAudit({
            clientId: clientId as any,
            employeeId: existing.employeeId as any,
            action: 'UPDATE',
            entityType: 'leave_request',
            entityId: id as any,
            oldValues: existing,
            newValues: updatedData,
            performedBy: 'admin',
        } as any);

        res.json(updatedData);
    } catch (err) {
        console.error('Error updating leave request in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/leave/:id
router.delete('/:clientId/leave/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;

        const docRef = adminDb.collection(LEAVE_REQUESTS_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Leave request not found' });
        }

        const existing = doc.data()!;
        await docRef.delete();

        logAudit({
            clientId: clientId as any,
            employeeId: existing.employeeId as any,
            action: 'DELETE',
            entityType: 'leave_request',
            entityId: id as any,
            oldValues: existing,
            performedBy: 'admin',
        } as any);

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting leave request from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
