import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { sendPayslipEmail, sendP9Email, sendBulkEmail, verifyConnection } from '../services/emailService';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

const EMAIL_HISTORY_COLLECTION = 'emailHistory';

interface CreateHistoryInput {
    ownerUid: string;
    clientId: string;
    employeeId: string;
    employeeName: string;
    kraPin: string;
    emailAddress: string;
    documentType: 'payslip' | 'p9';
    periodLabel?: string;
    taxYear?: string;
}

function createEmailHistoryDoc(input: CreateHistoryInput) {
    const ref = adminDb.collection(EMAIL_HISTORY_COLLECTION).doc();
    const now = new Date().toISOString();
    const payload = {
        ownerUid: input.ownerUid,
        clientId: input.clientId,
        employeeId: input.employeeId,
        employeeName: input.employeeName,
        kraPin: input.kraPin,
        emailAddress: input.emailAddress,
        documentType: input.documentType,
        status: 'pending',
        provider: null,
        resendEmailId: null,
        errorMessage: null,
        periodLabel: input.periodLabel || null,
        taxYear: input.taxYear || null,
        sentAt: now,
        createdAt: now,
        updatedAt: now,
    };
    return { ref, payload };
}

async function updateEmailHistoryStatus(
    historyId: string,
    update: Record<string, any>,
) {
    try {
        await adminDb.collection(EMAIL_HISTORY_COLLECTION).doc(historyId).update({
            ...update,
            updatedAt: new Date().toISOString(),
        });
    } catch (err) {
        console.error(`[EmailHistory] Failed to update ${historyId}:`, err);
    }
}

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

        res.json(snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching email history from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/email/history/:emailHistoryId/events
router.get('/:clientId/email/history/:emailHistoryId/events', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const { clientId, emailHistoryId } = req.params;

        const historyDoc = await adminDb.collection(EMAIL_HISTORY_COLLECTION).doc(emailHistoryId).get();
        if (!historyDoc.exists) {
            return res.status(404).json({ message: 'Email history not found' });
        }

        const historyData = historyDoc.data() as any;
        if (historyData.ownerUid !== uid || historyData.clientId !== clientId) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const eventsSnapshot = await adminDb
            .collection(EMAIL_HISTORY_COLLECTION)
            .doc(emailHistoryId)
            .collection('events')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();

        res.json(eventsSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching email events from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/email/send-payslips
router.post('/:clientId/email/send-payslips', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { employeeIds, includeP9 } = req.body;
        const period = (req.query.period as string) || '';
        const runId = (req.query.runId as string) || '';
        const periodLabel = period ? `${period.substring(0, 2)}/${period.substring(2)}` : new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const taxYear = period ? period.substring(0, 4) : new Date().getFullYear().toString();

        let query = adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId);

        const employeeSnapshot = await query.get();
        let employees = employeeSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

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

        const results: { kraPin: string; employeeName: string; success: boolean; error?: string; historyId?: string }[] = [];

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

            const attachments: { filename: string; content: Buffer; contentType: string }[] = [];

            // Payslip PDF
            const payslipQuery = new URLSearchParams();
            if (period) payslipQuery.set('period', period);
            if (runId) payslipQuery.set('runId', runId);
            const payslipUrl = `${baseUrl}/api/clients/${clientId}/payslip/${empData.kraPin}${payslipQuery.toString() ? `?${payslipQuery.toString()}` : ''}`;
            const payslipRes = await fetch(payslipUrl, { headers: { Authorization: authHeader } });

            if (!payslipRes.ok) {
                results.push({ kraPin: empData.kraPin, employeeName: empData.employeeName, success: false, error: 'Failed to generate payslip' });
                continue;
            }

            const payslipBuffer = Buffer.from(await payslipRes.arrayBuffer());
            const payslipFilename = `Payslip_${empData.employeeName.replace(/\s+/g, '_')}_${periodLabel.replace(/\//g, '_')}.pdf`;
            attachments.push({ filename: payslipFilename, content: payslipBuffer, contentType: 'application/pdf' });

            // Optional P9 PDF
            if (includeP9) {
                const p9Query = new URLSearchParams({ year: taxYear });
                if (runId) p9Query.set('runId', runId);
                const p9Url = `${baseUrl}/api/clients/${clientId}/p9/${empData.kraPin}?${p9Query.toString()}`;
                const p9Res = await fetch(p9Url, { headers: { Authorization: authHeader } });

                if (!p9Res.ok) {
                    results.push({ kraPin: empData.kraPin, employeeName: empData.employeeName, success: false, error: 'Failed to generate P9' });
                    continue;
                }

                const p9Buffer = Buffer.from(await p9Res.arrayBuffer());
                const p9Filename = `P9_${empData.employeeName.replace(/\s+/g, '_')}_${taxYear}.pdf`;
                attachments.push({ filename: p9Filename, content: p9Buffer, contentType: 'application/pdf' });
            }

            const { ref: historyRef, payload: historyPayload } = createEmailHistoryDoc({
                ownerUid: uid,
                clientId,
                employeeId: empData.id,
                employeeName: empData.employeeName,
                kraPin: empData.kraPin,
                emailAddress: empData.email,
                documentType: 'payslip',
                periodLabel,
            });

            await historyRef.set(historyPayload);

            const emailResult = includeP9
                ? await sendBulkEmail(
                    empData.email,
                    `Payslip & P9 Tax Card — ${companyName} — ${periodLabel}`,
                    `<p>Dear <strong>${empData.employeeName}</strong>,</p>
<p>Your payslip${includeP9 ? ' and P9 tax card' : ''} for <strong>${periodLabel}</strong> from <strong>${companyName}</strong> are attached.</p>
<p style="color:#666;font-size:12px;">This is an automated message from KRAFILER. Please do not reply.</p>`,
                    attachments,
                    {
                        emailHistoryId: historyRef.id,
                        clientId,
                        documentType: 'payslip',
                    }
                )
                : await sendPayslipEmail(
                    empData.email,
                    empData.employeeName,
                    companyName,
                    periodLabel,
                    payslipBuffer,
                    payslipFilename,
                    {
                        emailHistoryId: historyRef.id,
                        clientId,
                        documentType: 'payslip',
                    }
                );

            await updateEmailHistoryStatus(historyRef.id, {
                status: emailResult.success ? 'sent' : 'failed',
                provider: emailResult.provider || null,
                resendEmailId: emailResult.messageId || null,
                errorMessage: emailResult.error || null,
            });

            results.push({
                kraPin: empData.kraPin,
                employeeName: empData.employeeName,
                success: emailResult.success,
                error: emailResult.error,
                historyId: historyRef.id,
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
        const runId = (req.query.runId as string) || '';

        let query = adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId);

        const employeeSnapshot = await query.get();
        let employees = employeeSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

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

        const results: { kraPin: string; employeeName: string; success: boolean; error?: string; historyId?: string }[] = [];

        for (const emp of employees) {
            const empData = emp as any;
            if (!empData.email) {
                results.push({ kraPin: empData.kraPin, employeeName: empData.employeeName, success: false, error: 'No email address' });
                continue;
            }

            const p9Query = new URLSearchParams({ year: taxYear });
            if (runId) p9Query.set('runId', runId);
            const pdfRes = await fetch(
                `${baseUrl}/api/clients/${clientId}/p9/${empData.kraPin}?${p9Query.toString()}`,
                { headers: { Authorization: authHeader } }
            );

            if (!pdfRes.ok) {
                results.push({ kraPin: empData.kraPin, employeeName: empData.employeeName, success: false, error: 'Failed to generate P9' });
                continue;
            }

            const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
            const filename = `P9_${empData.employeeName.replace(/\s+/g, '_')}_${taxYear}.pdf`;

            const { ref: historyRef, payload: historyPayload } = createEmailHistoryDoc({
                ownerUid: uid,
                clientId,
                employeeId: empData.id,
                employeeName: empData.employeeName,
                kraPin: empData.kraPin,
                emailAddress: empData.email,
                documentType: 'p9',
                taxYear,
            });

            await historyRef.set(historyPayload);

            const emailResult = await sendP9Email(
                empData.email,
                empData.employeeName,
                companyName,
                taxYear,
                pdfBuffer,
                filename,
                {
                    emailHistoryId: historyRef.id,
                    clientId,
                    documentType: 'p9',
                }
            );

            await updateEmailHistoryStatus(historyRef.id, {
                status: emailResult.success ? 'sent' : 'failed',
                provider: emailResult.provider || null,
                resendEmailId: emailResult.messageId || null,
                errorMessage: emailResult.error || null,
            });

            results.push({
                kraPin: empData.kraPin,
                employeeName: empData.employeeName,
                success: emailResult.success,
                error: emailResult.error,
                historyId: historyRef.id,
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
    res.json({ connected: ok, message: ok ? 'Email provider configured' : 'Email provider not configured or connection failed' });
});

export default router;
