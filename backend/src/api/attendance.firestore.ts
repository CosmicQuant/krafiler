import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp, Query } from 'firebase-admin/firestore';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

const ATTENDANCE_COLLECTION = 'attendanceRecords';
const OVERTIME_COLLECTION = 'overtimeRecords';

async function recalculateOvertimeForPeriod(
    clientId: string,
    employeeId: string,
    period: string,
    uid: string
): Promise<void> {
    if (!period || !employeeId) return;

    const empDoc = await adminDb.collection('employees').doc(employeeId).get();
    if (!empDoc.exists || empDoc.data()?.ownerUid !== uid || empDoc.data()?.clientId !== clientId) return;

    const emp = empDoc.data()!;
    const standardCO = emp.standardCheckOut || '17:00';
    const [sH, sM] = standardCO.split(':').map(Number);
    if (isNaN(sH)) return;

    const standardIn = emp.standardCheckIn || '08:00';
    const [siH, siM] = standardIn.split(':').map(Number);
    const standardWorkingMins = (isNaN(siH) ? 0 : (sH * 60 + sM) - (siH * 60 + siM));
    const standardWorkingHours = Math.max(1, standardWorkingMins / 60);
    const monthlyWorkingHours = standardWorkingHours * 30;
    const hourlyRate = (emp.basicPay || 0) / Math.max(1, monthlyWorkingHours);

    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const daysInMonth = new Date(year, month, 0).getDate();
    const periodStart = `${period}-01`;
    const periodEnd = `${period}-${String(daysInMonth).padStart(2, '0')}`;

    // Query attendance records for this employee in the period
    const attendanceSnapshot = await adminDb
        .collection(ATTENDANCE_COLLECTION)
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .where('employeeId', '==', employeeId)
        .where('date', '>=', periodStart)
        .where('date', '<=', periodEnd)
        .get();

    let totalOvertimeHours = 0;
    for (const doc of attendanceSnapshot.docs) {
        const ar = doc.data();
        if (!ar.checkOut) continue;
        const [cH, cM] = ar.checkOut.split(':').map(Number);
        if (isNaN(cH)) continue;
        const standardMins = sH * 60 + (sM || 0);
        const actualMins = cH * 60 + (cM || 0);
        if (actualMins > standardMins) {
            totalOvertimeHours += (actualMins - standardMins) / 60;
        }
    }

    // Delete old overtime record and insert fresh
    const existingOvertime = await adminDb
        .collection(OVERTIME_COLLECTION)
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .where('employeeId', '==', employeeId)
        .where('period', '==', period)
        .get();

    const batch = adminDb.batch();
    for (const doc of existingOvertime.docs) {
        batch.delete(doc.ref);
    }
    await batch.commit();

    if (totalOvertimeHours > 0) {
        const amount = Math.round(totalOvertimeHours * hourlyRate * 1.5 * 100) / 100;
        await adminDb.collection(OVERTIME_COLLECTION).add({
            ownerUid: uid,
            clientId,
            employeeId,
            period,
            hours: Math.round(totalOvertimeHours * 100) / 100,
            rate: Math.round(hourlyRate * 100) / 100,
            multiplier: 1.5,
            amount,
            description: '',
            createdAt: Timestamp.now(),
        });
    }
}

async function autoCalculateOvertime(
    clientId: string,
    employeeId: string,
    date: string,
    _checkOut: string,
    uid: string
): Promise<void> {
    if (!date || !employeeId) return;
    const period = date.substring(0, 7);
    await recalculateOvertimeForPeriod(clientId, employeeId, period, uid);
}

// GET /api/clients/:clientId/attendance
router.get('/:clientId/attendance', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;

        let query: Query = adminDb
            .collection(ATTENDANCE_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .orderBy('date', 'desc');

        const { employeeKraPin, dateFrom, dateTo } = req.query;
        if (employeeKraPin && typeof employeeKraPin === 'string') {
            query = query.where('kraPin', '==', employeeKraPin);
        }
        if (dateFrom && typeof dateFrom === 'string') {
            query = query.where('date', '>=', dateFrom);
        }
        if (dateTo && typeof dateTo === 'string') {
            query = query.where('date', '<=', dateTo);
        }

        const snapshot = await query.get();
        const records = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

        // Deduplicate by employee + date, keeping the most recently updated record.
        // This prevents stale duplicate records from reappearing after a cell edit.
        const dedupMap = new Map<string, any>();
        for (const r of records) {
            const key = `${r.employeeId}-${r.date}`;
            const existing = dedupMap.get(key);
            const existingTs = existing?.updatedAt?.toMillis?.() || existing?.createdAt?.toMillis?.() || 0;
            const rTs = r.updatedAt?.toMillis?.() || r.createdAt?.toMillis?.() || 0;
            if (!existing || rTs >= existingTs) {
                dedupMap.set(key, r);
            }
        }
        res.json(Array.from(dedupMap.values()));
    } catch (err) {
        console.error('Error fetching attendance records:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/attendance
router.post('/:clientId/attendance', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { employeeId, employeeName, kraPin, date, checkIn, checkOut, status, notes } = req.body;

        const docRef = await adminDb.collection(ATTENDANCE_COLLECTION).add({
            ownerUid: uid,
            clientId,
            employeeId: employeeId || '',
            employeeName: employeeName || '',
            kraPin: kraPin || '',
            date: date || '',
            checkIn: checkIn || '',
            checkOut: checkOut || '',
            status: status || 'Present',
            notes: notes || '',
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });

        const record = await docRef.get();
        res.status(201).json({ id: record.id, ...record.data() });

        autoCalculateOvertime(clientId, employeeId || '', date || '', checkOut || '', uid).catch(() => {});
    } catch (err) {
        console.error('Error creating attendance record:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/attendance/:id
router.put('/:clientId/attendance/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;

        const docRef = adminDb.collection(ATTENDANCE_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }

        const existing = doc.data()!;
        const { employeeId, employeeName, kraPin, date, checkIn, checkOut, status, notes } = req.body;

        const updateData: any = { updatedAt: Timestamp.now() };
        if (employeeId !== undefined) updateData.employeeId = employeeId;
        if (employeeName !== undefined) updateData.employeeName = employeeName;
        if (kraPin !== undefined) updateData.kraPin = kraPin;
        if (date !== undefined) updateData.date = date;
        if (checkIn !== undefined) updateData.checkIn = checkIn;
        if (checkOut !== undefined) updateData.checkOut = checkOut;
        if (status !== undefined) updateData.status = status;
        if (notes !== undefined) updateData.notes = notes;

        await docRef.update(updateData);
        const updated = await docRef.get();

        res.json({ id: updated.id, ...updated.data() });

        const effEmployeeId = employeeId !== undefined ? employeeId : existing.employeeId;
        const effDate = date !== undefined ? date : existing.date;
        const effCheckOut = checkOut !== undefined ? checkOut : existing.checkOut;
        autoCalculateOvertime(clientId, effEmployeeId, effDate, effCheckOut, uid).catch(() => {});
    } catch (err) {
        console.error('Error updating attendance record:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/attendance/:id
router.delete('/:clientId/attendance/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;

        const docRef = adminDb.collection(ATTENDANCE_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }

        const existing = doc.data()!;
        await docRef.delete();

        recalculateOvertimeForPeriod(clientId, existing.employeeId, existing.date.substring(0, 7), uid).catch(() => {});

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting attendance record:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/attendance/bulk
router.post('/:clientId/attendance/bulk', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { records } = req.body;
        if (!Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ message: 'records must be a non-empty array' });
        }

        const BATCH_SIZE = 500; // Firestore batch limit
        let totalInserted = 0;

        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const chunk = records.slice(i, i + BATCH_SIZE);
            const batch = adminDb.batch();

            for (const r of chunk) {
                const docRef = adminDb.collection(ATTENDANCE_COLLECTION).doc();
                batch.set(docRef, {
                    ownerUid: uid,
                    clientId,
                    employeeId: r.employeeId || '',
                    employeeName: r.employeeName || '',
                    kraPin: r.kraPin || '',
                    date: r.date || '',
                    checkIn: r.checkIn || '',
                    checkOut: r.checkOut || '',
                    status: r.status || 'Present',
                    notes: r.notes || '',
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                });
            }

            await batch.commit();
            totalInserted += chunk.length;
        }

        res.status(201).json({ inserted: totalInserted });
    } catch (err: any) {
        console.error('Error bulk inserting attendance records:', err);
        res.status(500).json({ message: 'Internal server error', detail: err?.message });
    }
});

export default router;
