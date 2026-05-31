import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { adminDb } from '../lib/firebaseAdmin';
import { authMiddleware, AuthRequest, signToken } from '../middleware/auth';

const router = Router();

// POST /api/auth/employee/login
router.post('/employee/login', async (req, res) => {
    try {
        const { kraPin, password } = req.body;
        if (!kraPin || !password) {
            res.status(400).json({ message: 'KRA PIN and password are required' });
            return;
        }

        const snapshot = await adminDb
            .collection('employees')
            .where('kraPin', '==', kraPin)
            .limit(1)
            .get();

        if (snapshot.empty) {
            res.status(401).json({ message: 'Invalid KRA PIN or password' });
            return;
        }

        const employeeDoc = snapshot.docs[0];
        const employee = employeeDoc.data();

        if (!employee.passwordHash) {
            res.status(401).json({ message: 'Portal account not set up. Contact your administrator.' });
            return;
        }

        const valid = await bcrypt.compare(password, employee.passwordHash);
        if (!valid) {
            res.status(401).json({ message: 'Invalid KRA PIN or password' });
            return;
        }

        const token = signToken({
            id: employeeDoc.id,
            clientId: employee.clientId,
            kraPin: employee.kraPin,
            employeeName: employee.employeeName,
            email: employee.email,
        });

        res.json({
            token,
            employee: {
                id: employeeDoc.id,
                employeeName: employee.employeeName,
                kraPin: employee.kraPin,
                idNumber: employee.idNumber,
                email: employee.email,
                phone: employee.phone,
                department: employee.department,
                jobTitle: employee.jobTitle,
                employmentType: employee.employmentType,
                employmentStatus: employee.employmentStatus,
                dateJoined: employee.dateJoined,
                basicPay: employee.basicPay,
            },
        });
    } catch (err) {
        console.error('Error in employee login (Firestore):', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/auth/employee/me
router.get('/employee/me', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const id = req.employee!.id as string;
        const doc = await adminDb.collection('employees').doc(id).get();
        if (!doc.exists) {
            res.status(404).json({ message: 'Employee not found' });
            return;
        }
        const employee = doc.data()!;

        res.json({
            id: doc.id,
            employeeName: employee.employeeName,
            kraPin: employee.kraPin,
            idNumber: employee.idNumber,
            email: employee.email,
            phone: employee.phone,
            department: employee.department,
            jobTitle: employee.jobTitle,
            employmentType: employee.employmentType,
            employmentStatus: employee.employmentStatus,
            dateJoined: employee.dateJoined,
            basicPay: employee.basicPay,
            nssfNo: employee.nssfNo,
            shaNo: employee.shaNo,
            bankName: employee.bankName,
            bankAccount: employee.bankAccount,
            bankCode: employee.bankCode,
        });
    } catch (err) {
        console.error('Error fetching employee profile (Firestore):', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/auth/employee/set-password
router.post('/employee/set-password', async (req, res) => {
    try {
        const { kraPin, password } = req.body;
        if (!kraPin || !password) {
            res.status(400).json({ message: 'KRA PIN and password are required' });
            return;
        }
        if (password.length < 6) {
            res.status(400).json({ message: 'Password must be at least 6 characters' });
            return;
        }

        const snapshot = await adminDb
            .collection('employees')
            .where('kraPin', '==', kraPin)
            .limit(1)
            .get();

        if (snapshot.empty) {
            res.status(404).json({ message: 'Employee not found' });
            return;
        }

        const passwordHash = await bcrypt.hash(password, 10);
        await snapshot.docs[0].ref.update({
            passwordHash,
            passwordChangedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        res.json({ message: 'Password set successfully' });
    } catch (err) {
        console.error('Error setting password (Firestore):', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
