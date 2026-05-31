import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { sendPayslipEmail, sendP9Email, verifyConnection } from '../services/emailService';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

const EMAIL_HISTORY_COLLECTION = 'emailHistory';

// GET /api/clients/:clientId/email/history
router.get('/:clientId/email/history', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;

        const snapshot = await adminDb
            .collection(EMAIL_HISTORY_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .orderBy('sentAt', 'desc')
            .limit(100)
            .get();

        res.json(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching email history from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/email/send-payslips
router.post('/:clientId/email/send-payslips', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { employeeIds } = req.body;
        const period = (req.query.period as string) || '';
        const periodLabel = period ? `${period.substring(0, 2)}/${period.substring(2)}` : new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

        let query = adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId);

        const employeeSnapshot = await query.get();
        let employees = employeeSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (Array.isArray(employeeIds) && employeeIds.length > 0) {
            employees = employees.filter((e: any) => employeeIds.includes(e.id));
        }

        if (employees.length === 0) {
            return res.status(400).json({ message: 'No employees found' });
        }

        const authHeader = req.headers.authorization || '';
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        const payrollRes = await fetch(`${baseUrl}/api/clients/${clientId}/payroll-data`, {
            headers: { Authorization: authHeader },
        });
        const payrollData = await payrollRes.json();

        if (!payrollData.hasData || !payrollData.employees?.length) {
            return res.status(400).json({ message: 'No payroll data found' });
        }

        const companyName = payrollData.preamble?.companyName || 'Company';

        const now = new Date().toISOString();
        const results: { kraPin: string; employeeName: string; success: boolean; error?: string }[] = [];

        for (const emp of employees) {
            const empData = emp as any;
            if (!empData.email) {
                results.push({ kraPin: empData.kraPin, employeeName: empData.employeeName, success: false, error: 'No email address' });
                continue;
            }

            const payrollEmp = payrollData.employees.find(
                (e: any) => String(e['PIN of Employee'] ?? '').toUpperCase() === String(empData.kraPin).toUpperCase()
            );

            if (!payrollEmp) {
                results.push({ kraPin: empData.kraPin, employeeName: empData.employeeName, success: false, error: 'No payroll data for employee' });
                continue;
            }

            const pdfRes = await fetch(
                `${baseUrl}/api/clients/${clientId}/payslip/${empData.kraPin}${period ? `?period=${period}` : ''}`,
                { headers: { Authorization: authHeader } }
            );

            if (!pdfRes.ok) {
                results.push({ kraPin: empData.kraPin, employeeName: empData.employeeName, success: false, error: 'Failed to generate payslip' });
                continue;
            }

            const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
            const filename = `Payslip_${empData.employeeName.replace(/\s+/g, '_')}_${periodLabel.replace(/\//g, '_')}.pdf`;

            const emailResult = await sendPayslipEmail(empData.email, empData.employeeName, companyName, periodLabel, pdfBuffer, filename);

            await adminDb.collection(EMAIL_HISTORY_COLLECTION).add({
                ownerUid: uid,
                clientId,
                employeeId: empData.id,
                employeeName: empData.employeeName,
                kraPin: empData.kraPin,
                emailAddress: empData.email,
                documentType: 'payslip',
                status: emailResult.success ? 'sent' : 'failed',
                errorMessage: emailResult.error || null,
                sentAt: now,
            });

            results.push({
                kraPin: empData.kraPin,
                employeeName: empData.employeeName,
                success: emailResult.success,
                error: emailResult.error,
            });
        }

        const sent = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        res.json({ sent, failed, total: results.length, details: results });
    } catch (err) {
        console.error('Error sending payslips:', err);
        res.status(500).json({ message: 'Failed to send payslips' });
    }
});

// POST /api/clients/:clientId/email/send-p9s
router.post('/:clientId/email/send-p9s', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { employeeIds } = req.body;
        const taxYear = (req.query.year as string) || new Date().getFullYear().toString();

        let query = adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId);

        const employeeSnapshot = await query.get();
        let employees = employeeSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (Array.isArray(employeeIds) && employeeIds.length > 0) {
            employees = employees.filter((e: any) => employeeIds.includes(e.id));
        }

        if (employees.length === 0) {
            return res.status(400).json({ message: 'No employees found' });
        }

        const authHeader = req.headers.authorization || '';
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        const payrollRes = await fetch(`${baseUrl}/api/clients/${clientId}/payroll-data`, {
            headers: { Authorization: authHeader },
        });
        const payrollData = await payrollRes.json();
        const companyName = payrollData.preamble?.companyName || 'Company';

        const now = new Date().toISOString();
        const results: { kraPin: string; employeeName: string; success: boolean; error?: string }[] = [];

        for (const emp of employees) {
            const empData = emp as any;
            if (!empData.email) {
                results.push({ kraPin: empData.kraPin, employeeName: empData.employeeName, success: false, error: 'No email address' });
                continue;
            }

            const pdfRes = await fetch(
                `${baseUrl}/api/clients/${clientId}/p9/${empData.kraPin}?year=${taxYear}`,
                { headers: { Authorization: authHeader } }
            );

            if (!pdfRes.ok) {
                results.push({ kraPin: empData.kraPin, employeeName: empData.employeeName, success: false, error: 'Failed to generate P9' });
                continue;
            }

            const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
            const filename = `P9_${empData.employeeName.replace(/\s+/g, '_')}_${taxYear}.pdf`;

            const emailResult = await sendP9Email(empData.email, empData.employeeName, companyName, taxYear, pdfBuffer, filename);

            await adminDb.collection(EMAIL_HISTORY_COLLECTION).add({
                ownerUid: uid,
                clientId,
                employeeId: empData.id,
                employeeName: empData.employeeName,
                kraPin: empData.kraPin,
                emailAddress: empData.email,
                documentType: 'p9',
                status: emailResult.success ? 'sent' : 'failed',
                errorMessage: emailResult.error || null,
                sentAt: now,
            });

            results.push({
                kraPin: empData.kraPin,
                employeeName: empData.employeeName,
                success: emailResult.success,
                error: emailResult.error,
            });
        }

        const sent = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        res.json({ sent, failed, total: results.length, details: results });
    } catch (err) {
        console.error('Error sending P9s:', err);
        res.status(500).json({ message: 'Failed to send P9s' });
    }
});

// GET /api/clients/:clientId/email/verify
router.get('/:clientId/email/verify', async (_req, res) => {
    const ok = await verifyConnection();
    res.json({ connected: ok, message: ok ? 'SMTP connection verified' : 'SMTP not configured or connection failed' });
});

export default router;
