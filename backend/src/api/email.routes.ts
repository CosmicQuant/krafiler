import { Router } from 'express';
import { db } from '../db/kysely';
import { sendPayslipEmail, sendP9Email, verifyConnection } from '../services/emailService';

const router = Router();

// GET /api/clients/:clientId/email/history — list email history
router.get('/:clientId/email/history', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const history = await db
            .selectFrom('email_history')
            .selectAll()
            .where('clientId', '=', clientId)
            .orderBy('sentAt', 'desc')
            .limit(100)
            .execute();

        res.json(history);
    } catch (err) {
        console.error('Error fetching email history:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/email/send-payslips — send payslips to employees
router.post('/:clientId/email/send-payslips', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { employeeIds } = req.body; // optional array of employee IDs, omit for all
        const period = (req.query.period as string) || '';
        const periodLabel = period ? `${period.substring(0, 2)}/${period.substring(2)}` : new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

        // Fetch employees (with optional filter)
        let query = db
            .selectFrom('employees')
            .selectAll()
            .where('clientId', '=', clientId);

        if (Array.isArray(employeeIds) && employeeIds.length > 0) {
            query = query.where('id', 'in', employeeIds);
        }

        const employees = await query.execute();
        if (employees.length === 0) {
            return res.status(400).json({ message: 'No employees found' });
        }

        // Fetch payroll data for payslip generation
        const payrollRes = await fetch(`${req.protocol}://${req.get('host')}/api/clients/${clientId}/payroll-data`);
        const payrollData = await payrollRes.json();

        if (!payrollData.hasData || !payrollData.employees?.length) {
            return res.status(400).json({ message: 'No payroll data found' });
        }

        const companyName = payrollData.preamble?.companyName || 'Company';

        const now = new Date().toISOString();
        const results: { kraPin: string; employeeName: string; success: boolean; error?: string }[] = [];

        for (const emp of employees) {
            if (!emp.email) {
                results.push({ kraPin: emp.kraPin, employeeName: emp.employeeName, success: false, error: 'No email address' });
                continue;
            }

            // Get payroll data for this specific employee
            const payrollEmp = payrollData.employees.find(
                (e: any) => String(e['PIN of Employee'] ?? '').toUpperCase() === emp.kraPin.toUpperCase()
            );

            if (!payrollEmp) {
                results.push({ kraPin: emp.kraPin, employeeName: emp.employeeName, success: false, error: 'No payroll data for employee' });
                continue;
            }

            // Generate payslip PDF via internal fetch
            const pdfRes = await fetch(
                `${req.protocol}://${req.get('host')}/api/clients/${clientId}/payslip/${emp.kraPin}${period ? `?period=${period}` : ''}`
            );

            if (!pdfRes.ok) {
                results.push({ kraPin: emp.kraPin, employeeName: emp.employeeName, success: false, error: 'Failed to generate payslip' });
                continue;
            }

            const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
            const filename = `Payslip_${emp.employeeName.replace(/\s+/g, '_')}_${periodLabel.replace(/\//g, '_')}.pdf`;

            const emailResult = await sendPayslipEmail(emp.email, emp.employeeName, companyName, periodLabel, pdfBuffer, filename);

            // Log to history
            await db
                .insertInto('email_history')
                .values({
                    clientId,
                    employeeId: emp.id,
                    employeeName: emp.employeeName,
                    kraPin: emp.kraPin,
                    emailAddress: emp.email,
                    documentType: 'payslip',
                    status: emailResult.success ? 'sent' : 'failed',
                    errorMessage: emailResult.error || null,
                    sentAt: now,
                })
                .execute();

            results.push({
                kraPin: emp.kraPin,
                employeeName: emp.employeeName,
                success: emailResult.success,
                error: emailResult.error,
            });
        }

        const sent = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        res.json({ sent, failed, total: results.length, details: results });
    } catch (err) {
        console.error('Error sending payslips:', err);
        res.status(500).json({ message: 'Failed to send payslips' });
    }
});

// POST /api/clients/:clientId/email/send-p9s — send P9s to employees
router.post('/:clientId/email/send-p9s', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { employeeIds } = req.body;
        const taxYear = (req.query.year as string) || new Date().getFullYear().toString();

        let query = db
            .selectFrom('employees')
            .selectAll()
            .where('clientId', '=', clientId);

        if (Array.isArray(employeeIds) && employeeIds.length > 0) {
            query = query.where('id', 'in', employeeIds);
        }

        const employees = await query.execute();
        if (employees.length === 0) {
            return res.status(400).json({ message: 'No employees found' });
        }

        const payrollRes = await fetch(`${req.protocol}://${req.get('host')}/api/clients/${clientId}/payroll-data`);
        const payrollData = await payrollRes.json();
        const companyName = payrollData.preamble?.companyName || 'Company';

        const now = new Date().toISOString();
        const results: { kraPin: string; employeeName: string; success: boolean; error?: string }[] = [];

        for (const emp of employees) {
            if (!emp.email) {
                results.push({ kraPin: emp.kraPin, employeeName: emp.employeeName, success: false, error: 'No email address' });
                continue;
            }

            const pdfRes = await fetch(
                `${req.protocol}://${req.get('host')}/api/clients/${clientId}/p9/${emp.kraPin}?year=${taxYear}`
            );

            if (!pdfRes.ok) {
                results.push({ kraPin: emp.kraPin, employeeName: emp.employeeName, success: false, error: 'Failed to generate P9' });
                continue;
            }

            const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
            const filename = `P9_${emp.employeeName.replace(/\s+/g, '_')}_${taxYear}.pdf`;

            const emailResult = await sendP9Email(emp.email, emp.employeeName, companyName, taxYear, pdfBuffer, filename);

            await db
                .insertInto('email_history')
                .values({
                    clientId,
                    employeeId: emp.id,
                    employeeName: emp.employeeName,
                    kraPin: emp.kraPin,
                    emailAddress: emp.email,
                    documentType: 'p9',
                    status: emailResult.success ? 'sent' : 'failed',
                    errorMessage: emailResult.error || null,
                    sentAt: now,
                })
                .execute();

            results.push({
                kraPin: emp.kraPin,
                employeeName: emp.employeeName,
                success: emailResult.success,
                error: emailResult.error,
            });
        }

        const sent = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        res.json({ sent, failed, total: results.length, details: results });
    } catch (err) {
        console.error('Error sending P9s:', err);
        res.status(500).json({ message: 'Failed to send P9s' });
    }
});

// GET /api/clients/:clientId/email/verify — test SMTP connection
router.get('/:clientId/email/verify', async (_req, res) => {
    const ok = await verifyConnection();
    res.json({ connected: ok, message: ok ? 'SMTP connection verified' : 'SMTP not configured or connection failed' });
});

export default router;
