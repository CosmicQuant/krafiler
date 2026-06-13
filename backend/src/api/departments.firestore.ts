import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

const DEPARTMENTS_COLLECTION = 'departments';

router.get('/:clientId/departments', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const snapshot = await adminDb
            .collection(DEPARTMENTS_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .orderBy('name', 'asc')
            .get();
        res.json(snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching departments from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/:clientId/departments', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { name, headEmployeeId } = req.body;
        if (!name) return res.status(400).json({ message: 'Department name is required' });
        const now = Timestamp.now();
        const docRef = await adminDb.collection(DEPARTMENTS_COLLECTION).add({
            ownerUid: uid,
            clientId,
            name,
            headEmployeeId: headEmployeeId || null,
            createdAt: now,
            updatedAt: now,
        });
        const doc = await docRef.get();
        res.status(201).json({ id: doc.id, ...doc.data() });
    } catch (err) {
        console.error('Error creating department in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.put('/:clientId/departments/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;
        const { name, headEmployeeId } = req.body;
        const docRef = adminDb.collection(DEPARTMENTS_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Department not found' });
        }
        const updateData: any = { updatedAt: Timestamp.now() };
        if (name !== undefined) updateData.name = name;
        if (headEmployeeId !== undefined) updateData.headEmployeeId = headEmployeeId || null;
        await docRef.update(updateData);
        const updated = await docRef.get();
        res.json({ id: updated.id, ...updated.data() });
    } catch (err) {
        console.error('Error updating department in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.delete('/:clientId/departments/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;
        const docRef = adminDb.collection(DEPARTMENTS_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Department not found' });
        }
        await docRef.delete();
        // Clear departmentId on employees
        const employeesSnapshot = await adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('departmentId', '==', id)
            .get();
        const batch = adminDb.batch();
        for (const d of employeesSnapshot.docs) {
            batch.update(d.ref, { departmentId: null, updatedAt: Timestamp.now() });
        }
        await batch.commit();
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting department from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
