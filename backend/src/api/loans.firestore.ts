import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { logAudit } from '../services/auditService';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

const LOANS_COLLECTION = 'loans';

// GET /api/clients/:clientId/loans
router.get('/:clientId/loans', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;

        const snapshot = await adminDb
            .collection(LOANS_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .orderBy('createdAt', 'desc')
            .get();

        res.json(snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching loans from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/loans
router.post('/:clientId/loans', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { employeeId, employeeName, kraPin, loanType, principal, monthlyDeduction, installments, remainingInstallments, interestRate, totalInterest, totalRepayable, amountPaid, status, disbursedAt, notes } = req.body;

        const now = Timestamp.now();
        const docRef = await adminDb.collection(LOANS_COLLECTION).add({
            ownerUid: uid,
            clientId,
            employeeId: employeeId || '',
            employeeName: employeeName || '',
            kraPin: kraPin || '',
            loanType: loanType || 'Salary Advance',
            principal: principal || 0,
            monthlyDeduction: monthlyDeduction || 0,
            installments: installments || 1,
            remainingInstallments: remainingInstallments || 1,
            interestRate: interestRate || 0,
            totalInterest: totalInterest || 0,
            totalRepayable: totalRepayable || 0,
            amountPaid: amountPaid || 0,
            status: status || 'Approved',
            disbursedAt: disbursedAt || null,
            notes: notes || '',
            createdAt: now,
            updatedAt: now,
        });

        const doc = await docRef.get();
        const record = { id: doc.id, ...doc.data() };

        logAudit({
            clientId: clientId as any,
            employeeId: employeeId as any,
            action: 'CREATE',
            entityType: 'loan',
            entityId: doc.id as any,
            newValues: record,
            performedBy: 'admin',
        } as any);

        res.status(201).json(record);
    } catch (err) {
        console.error('Error creating loan in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/loans/:id
router.put('/:clientId/loans/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;

        const docRef = adminDb.collection(LOANS_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        const existing = doc.data()!;
        const { employeeId, employeeName, kraPin, loanType, principal, monthlyDeduction, installments, remainingInstallments, interestRate, totalInterest, totalRepayable, amountPaid, status, disbursedAt, notes } = req.body;

        const updateData: any = { updatedAt: Timestamp.now() };
        if (employeeId !== undefined) updateData.employeeId = employeeId;
        if (employeeName !== undefined) updateData.employeeName = employeeName;
        if (kraPin !== undefined) updateData.kraPin = kraPin;
        if (loanType !== undefined) updateData.loanType = loanType;
        if (principal !== undefined) updateData.principal = principal;
        if (monthlyDeduction !== undefined) updateData.monthlyDeduction = monthlyDeduction;
        if (installments !== undefined) updateData.installments = installments;
        if (remainingInstallments !== undefined) updateData.remainingInstallments = remainingInstallments;
        if (interestRate !== undefined) updateData.interestRate = interestRate;
        if (totalInterest !== undefined) updateData.totalInterest = totalInterest;
        if (totalRepayable !== undefined) updateData.totalRepayable = totalRepayable;
        if (amountPaid !== undefined) updateData.amountPaid = amountPaid;
        if (status !== undefined) updateData.status = status;
        if (disbursedAt !== undefined) updateData.disbursedAt = disbursedAt;
        if (notes !== undefined) updateData.notes = notes;

        await docRef.update(updateData);
        const updated = await docRef.get();
        const updatedData = { id: updated.id, ...updated.data() };

        logAudit({
            clientId: clientId as any,
            employeeId: existing.employeeId as any,
            action: 'UPDATE',
            entityType: 'loan',
            entityId: id as any,
            oldValues: existing,
            newValues: updatedData,
            performedBy: 'admin',
        } as any);

        res.json(updatedData);
    } catch (err) {
        console.error('Error updating loan in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/loans/:id
router.delete('/:clientId/loans/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;

        const docRef = adminDb.collection(LOANS_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        const existing = doc.data()!;
        await docRef.delete();

        logAudit({
            clientId: clientId as any,
            employeeId: existing.employeeId as any,
            action: 'DELETE',
            entityType: 'loan',
            entityId: id as any,
            oldValues: existing,
            performedBy: 'admin',
        } as any);

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting loan from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
