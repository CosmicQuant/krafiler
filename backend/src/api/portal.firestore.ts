import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { AuthenticatedRequest } from '../middleware/verifyAuth';
import { logAudit } from '../services/auditService';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';

const router = Router();

function formatMoney(n: number): string {
    return (typeof n === 'number' ? n.toFixed(2) : '0.00');
}

// Combined request type because server.ts mounts /api/portal with verifyAuth,
// and the router itself applies authMiddleware.
type PortalRequest = AuthRequest & AuthenticatedRequest;

// All portal routes require employee authentication
router.use(authMiddleware);

// Helper: look up the Firestore employee doc by kraPin + ownerUid
async function getFirestoreEmployee(req: PortalRequest) {
    const uid = (req as any).user?.uid;
    if (!uid) return null;
    const kraPin = req.employee!.kraPin;
    const snapshot = await adminDb
        .collection('employees')
        .where('ownerUid', '==', uid)
        .where('kraPin', '==', kraPin)
        .limit(1)
        .get();
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

// GET /api/portal/dashboard
router.get('/dashboard', async (req: PortalRequest, res) => {
    try {
        const emp = await getFirestoreEmployee(req);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = emp.id;
        const clientId = (emp as any).clientId;
        const uid = (req as any).user!.uid;

        // Leave summary
        const leaveSnapshot = await adminDb
            .collection('leaveRequests')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employeeId', '==', employeeId)
            .orderBy('createdAt', 'desc')
            .get();
        const leaveRequests = leaveSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        const leaveSummary = {
            total: leaveRequests.length,
            pending: leaveRequests.filter((l: any) => l.status === 'Pending').length,
            approved: leaveRequests.filter((l: any) => l.status === 'Approved').length,
            rejected: leaveRequests.filter((l: any) => l.status === 'Rejected').length,
            cancelled: leaveRequests.filter((l: any) => l.status === 'Cancelled').length,
        };

        // Loan summary
        const loanSnapshot = await adminDb
            .collection('loans')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employeeId', '==', employeeId)
            .orderBy('createdAt', 'desc')
            .get();
        const loans = loanSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        const loanSummary = {
            total: loans.length,
            active: loans.filter((l: any) => l.status === 'Active' || l.status === 'Approved').length,
            paid: loans.filter((l: any) => l.status === 'Paid').length,
            totalPrincipal: loans.reduce((sum, l: any) => sum + (l.principal || 0), 0),
            outstandingBalance: loans.reduce((sum, l: any) => sum + ((l.totalRepayable || 0) - (l.amountPaid || 0)), 0),
        };

        // Attendance summary (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const attendanceSnapshot = await adminDb
            .collection('attendanceRecords')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employeeId', '==', employeeId)
            .where('date', '>=', thirtyDaysAgo.toISOString().split('T')[0])
            .orderBy('date', 'desc')
            .get();
        const attendance = attendanceSnapshot.docs.map((d) => d.data());
        const attendanceSummary = {
            total: attendance.length,
            present: attendance.filter((a: any) => a.status === 'Present').length,
            absent: attendance.filter((a: any) => a.status === 'Absent').length,
            late: attendance.filter((a: any) => a.status === 'Late').length,
            halfDay: attendance.filter((a: any) => a.status === 'Half-Day').length,
            onLeave: attendance.filter((a: any) => a.status === 'Leave').length,
        };

        // Payroll summary
        const payrollSnapshot = await adminDb
            .collection('payrollEntries')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employeeId', '==', employeeId)
            .get();
        const payrollEntries = payrollSnapshot.docs.map((d) => d.data());
        const totalUnpaidLeaveDays = payrollEntries.reduce((sum, e: any) => sum + (e.unpaidLeaveDays || 0), 0);
        const totalLoanDeduction = payrollEntries.reduce((sum, e: any) => sum + (e.loanDeduction || 0), 0);

        res.json({
            employee: {
                employeeName: (emp as any).employeeName || '',
                kraPin: (emp as any).kraPin || '',
                idNumber: (emp as any).idNumber || '',
                email: (emp as any).email || '',
                phone: (emp as any).phone || '',
                department: (emp as any).department || '',
                jobTitle: (emp as any).jobTitle || '',
                employmentType: (emp as any).employmentType || '',
                employmentStatus: (emp as any).employmentStatus || '',
                dateJoined: (emp as any).dateJoined || '',
                basicPay: (emp as any).basicPay || 0,
                nssfNo: (emp as any).nssfNo || '',
                shaNo: (emp as any).shaNo || '',
                bankName: (emp as any).bankName || '',
                bankAccount: (emp as any).bankAccount || '',
                bankCode: (emp as any).bankCode || '',
            },
            leaveSummary,
            loanSummary,
            attendanceSummary,
            totalUnpaidLeaveDays,
            totalLoanDeduction,
            recentLeave: leaveRequests.slice(0, 5),
            recentLoans: loans.slice(0, 5),
            recentAttendance: attendance.slice(0, 5),
        });
    } catch (err) {
        console.error('Error fetching portal dashboard from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/portal/leave
router.post('/leave', async (req: PortalRequest, res) => {
    try {
        const emp = await getFirestoreEmployee(req);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = emp.id;
        const clientId = (emp as any).clientId;
        const uid = (req as any).user!.uid;
        const { leaveType, startDate, endDate, daysCount, hours, reason, isPaid } = req.body;

        if (!leaveType || !startDate || !endDate) {
            res.status(400).json({ message: 'Leave type, start date, and end date are required' });
            return;
        }

        const now = new Date().toISOString();
        const docRef = await adminDb.collection('leaveRequests').add({
            ownerUid: uid,
            clientId,
            employeeId,
            employeeName: req.employee!.employeeName,
            kraPin: req.employee!.kraPin,
            leaveType: leaveType || 'Annual',
            startDate: startDate || '',
            endDate: endDate || '',
            daysCount: daysCount || 1,
            hours: hours || 0,
            reason: reason || '',
            status: 'Pending',
            isPaid: isPaid === false || isPaid === 0 ? 0 : 1,
            createdAt: now,
            updatedAt: now,
        });

        const record = { id: docRef.id, ...(await docRef.get()).data() };

        logAudit({
            clientId: clientId as any,
            employeeId: employeeId as any,
            action: 'CREATE',
            entityType: 'leave_request',
            entityId: docRef.id as any,
            newValues: record,
            performedBy: req.employee!.employeeName,
        });

        res.status(201).json(record);
    } catch (err) {
        console.error('Error submitting leave via portal (Firestore):', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/portal/leave/:id
router.put('/leave/:id', async (req: PortalRequest, res) => {
    try {
        const emp = await getFirestoreEmployee(req);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = emp.id;
        const clientId = (emp as any).clientId;
        const uid = (req as any).user!.uid;
        const id = req.params.id;

        const { leaveType, startDate, endDate, daysCount, hours, reason, isPaid } = req.body;

        const docRef = adminDb.collection('leaveRequests').doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.employeeId !== employeeId) {
            return res.status(404).json({ message: 'Leave request not found' });
        }

        const existing = doc.data() as any;
        const updateData: any = { updatedAt: new Date().toISOString() };
        if (leaveType !== undefined) updateData.leaveType = leaveType;
        if (startDate !== undefined) updateData.startDate = startDate;
        if (endDate !== undefined) updateData.endDate = endDate;
        if (daysCount !== undefined) updateData.daysCount = daysCount;
        if (hours !== undefined) updateData.hours = hours;
        if (reason !== undefined) updateData.reason = reason;
        if (isPaid !== undefined) updateData.isPaid = isPaid === false || isPaid === 0 ? 0 : 1;

        await docRef.update(updateData);
        const updated = { id: docRef.id, ...(await docRef.get()).data() };

        logAudit({
            clientId: clientId as any,
            employeeId: employeeId as any,
            action: 'UPDATE',
            entityType: 'leave_request',
            entityId: id as any,
            oldValues: existing,
            newValues: updated,
            performedBy: req.employee!.employeeName,
        });

        res.json(updated);
    } catch (err) {
        console.error('Error updating portal leave request (Firestore):', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/portal/leave/:id
router.delete('/leave/:id', async (req: PortalRequest, res) => {
    try {
        const emp = await getFirestoreEmployee(req);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = emp.id;
        const clientId = (emp as any).clientId;
        const uid = (req as any).user!.uid;
        const id = req.params.id;

        const docRef = adminDb.collection('leaveRequests').doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.employeeId !== employeeId) {
            return res.status(404).json({ message: 'Leave request not found' });
        }

        const existing = doc.data() as any;
        await docRef.delete();

        logAudit({
            clientId: clientId as any,
            employeeId: employeeId as any,
            action: 'DELETE',
            entityType: 'leave_request',
            entityId: id as any,
            oldValues: existing,
            performedBy: req.employee!.employeeName,
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting portal leave request (Firestore):', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/portal/loans
router.post('/loans', async (req: PortalRequest, res) => {
    try {
        const emp = await getFirestoreEmployee(req);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = emp.id;
        const clientId = (emp as any).clientId;
        const uid = (req as any).user!.uid;
        const { loanType, principal, installments, interestRate, notes } = req.body;

        if (!principal || principal <= 0) {
            res.status(400).json({ message: 'Principal amount is required' });
            return;
        }

        const monthlyDeduction = principal / (installments || 1);
        const totalInterest = interestRate ? Math.round(principal * (interestRate / 100)) : 0;
        const totalRepayable = principal + totalInterest;
        const now = new Date().toISOString();

        const docRef = await adminDb.collection('loans').add({
            ownerUid: uid,
            clientId,
            employeeId,
            employeeName: req.employee!.employeeName,
            kraPin: req.employee!.kraPin,
            loanType: loanType || 'Salary Advance',
            principal: principal || 0,
            monthlyDeduction: Math.round(monthlyDeduction * 100) / 100,
            installments: installments || 1,
            remainingInstallments: installments || 1,
            interestRate: interestRate || 0,
            totalInterest,
            totalRepayable,
            amountPaid: 0,
            status: 'Pending',
            disbursedAt: null,
            notes: notes || '',
            createdAt: now,
            updatedAt: now,
        });

        const record = { id: docRef.id, ...(await docRef.get()).data() };

        logAudit({
            clientId: clientId as any,
            employeeId: employeeId as any,
            action: 'CREATE',
            entityType: 'loan',
            entityId: docRef.id as any,
            newValues: record,
            performedBy: req.employee!.employeeName,
        });

        res.status(201).json(record);
    } catch (err) {
        console.error('Error submitting loan via portal (Firestore):', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/portal/payslip
router.get('/payslip', async (req: PortalRequest, res) => {
    try {
        const emp = await getFirestoreEmployee(req);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = emp.id;
        const clientId = (emp as any).clientId;
        const uid = (req as any).user!.uid;
        const kraPin = (emp as any).kraPin;

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        const client = clientDoc.exists ? { id: clientDoc.id, ...clientDoc.data() } : null;

        const entrySnapshot = await adminDb
            .collection('payrollEntries')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employeeId', '==', employeeId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
        const entry = entrySnapshot.empty ? {} : entrySnapshot.docs[0].data();

        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Payslip_${kraPin}.pdf`);
        doc.pipe(res);

        const { resolveLogoPath } = await import('../lib/cloudStorage');
        const logoLocalPath = await resolveLogoPath(client as any, uid);

        const leftX = 40;
        const rightX = 310;
        const earningsAmountX = 240;
        const deductionsAmountX = 550;
        let y = 40;

        if (logoLocalPath) {
            try {
                doc.image(logoLocalPath, leftX, y, { width: 60 });
            } catch { /* ignore */ }
        }

        doc.fontSize(14).font('Helvetica-Bold').text((client as any)?.name || 'Company', { align: 'center' });
        doc.fontSize(8).font('Helvetica').text(`KRA PIN: ${(client as any)?.pin || ''}`, { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica-Bold').text('PAYSLIP', { align: 'center' });
        doc.moveDown(0.3);

        doc.fontSize(8).font('Helvetica');
        doc.text(`Employee: ${(emp as any).employeeName}`, leftX, doc.y);
        doc.text(`KRA PIN: ${(emp as any).kraPin}`, rightX, doc.y);
        doc.moveDown(0.3);
        doc.text(`ID Number: ${(emp as any).idNumber}`, leftX, doc.y);
        doc.text(`Department: ${(emp as any).department || ''}`, rightX, doc.y);
        doc.text(`Payroll No: ${(emp as any).payrollNumber || ''}`, leftX, doc.y);
        if (entry) doc.text(`Period: Current`, rightX, doc.y);
        doc.moveDown(0.8);

        const e = entry as any;
        const basicPay = e.basicPay || (emp as any).basicPay || 0;
        const benefits = e.benefits || 0;
        const overtimePay = e.overtimePay || 0;
        const bonusPay = (e.bonusPay || 0) + (e.nonTaxableBonus || 0);
        const grossPay = e.grossPay || (basicPay + benefits + overtimePay + bonusPay);
        const unpaidLeaveDays = e.unpaidLeaveDays || 0;
        const unpaidLeaveDeduction = unpaidLeaveDays > 0 ? Math.round((basicPay / 30) * unpaidLeaveDays * 100) / 100 : 0;
        const absentDays = e.absentDays || 0;
        const lateDays = e.lateDays || 0;
        const dailyRate = basicPay / 30;
        const hourlyRate = dailyRate / 8;
        const absentDeduction = absentDays * dailyRate;
        const lateDeduction = lateDays * hourlyRate;
        const loanDeduction = e.loanDeduction || 0;
        const shaDeduction = e.shaDeduction || Math.round(grossPay * 0.0275 * 100) / 100;
        const nssfDeduction = e.nssfDeduction || Math.round(Math.min(grossPay * 0.06, 6480) * 100) / 100;
        const ahlDeduction = e.ahlDeduction || Math.round(grossPay * 0.015 * 100) / 100;
        const payeTax = e.payeTax || 0;
        const otherDeductions = e.otherDeductions || 0;
        const netPay = e.netPay || (grossPay - shaDeduction - nssfDeduction - ahlDeduction - loanDeduction - otherDeductions - payeTax);
        const daysWorked = e.daysWorked || 30;

        const colY = doc.y;
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('EARNINGS', leftX, colY);
        doc.text('Amount (KES)', earningsAmountX, colY);
        doc.text('DEDUCTIONS', rightX, colY);
        doc.text('Amount (KES)', deductionsAmountX, colY);
        doc.moveDown(0.4);

        let earnY = doc.y;
        let dedY = doc.y;
        const rowH = 14;

        doc.fontSize(8).font('Helvetica');
        doc.text('Basic Pay', leftX, earnY); doc.text(basicPay.toFixed(2), earningsAmountX, earnY);
        earnY += rowH;

        if (benefits > 0) { doc.text('Benefits', leftX, earnY); doc.text(benefits.toFixed(2), earningsAmountX, earnY); earnY += rowH; }
        if (overtimePay > 0) { doc.text('Overtime Pay', leftX, earnY); doc.text(overtimePay.toFixed(2), earningsAmountX, earnY); earnY += rowH; }
        if (bonusPay > 0) { doc.text('Bonus Pay', leftX, earnY); doc.text(bonusPay.toFixed(2), earningsAmountX, earnY); earnY += rowH; }

        earnY += 4;
        doc.rect(leftX, earnY, 200, 1).fill('#ddd');
        earnY += 6;
        doc.font('Helvetica-Bold').text('Gross Pay', leftX, earnY);
        doc.text(grossPay.toFixed(2), earningsAmountX, earnY);
        earnY += rowH;

        doc.font('Helvetica');
        doc.text('PAYE Tax', rightX, dedY); doc.text(payeTax.toFixed(2), deductionsAmountX, dedY); dedY += rowH;
        doc.text('SHA', rightX, dedY); doc.text(shaDeduction.toFixed(2), deductionsAmountX, dedY); dedY += rowH;
        doc.text('NSSF', rightX, dedY); doc.text(nssfDeduction.toFixed(2), deductionsAmountX, dedY); dedY += rowH;
        doc.text('AHL', rightX, dedY); doc.text(ahlDeduction.toFixed(2), deductionsAmountX, dedY); dedY += rowH;

        if (unpaidLeaveDays > 0) {
            doc.text(`Unpaid Leave (${unpaidLeaveDays} days)`, rightX, dedY);
            doc.text(unpaidLeaveDeduction.toFixed(2), deductionsAmountX, dedY); dedY += rowH;
        }
        if (absentDays > 0) {
            doc.text(`Absenteeism (${absentDays} days)`, rightX, dedY);
            doc.text(absentDeduction.toFixed(2), deductionsAmountX, dedY); dedY += rowH;
        }
        if (lateDays > 0) {
            doc.text(`Lateness (${lateDays} hrs)`, rightX, dedY);
            doc.text(lateDeduction.toFixed(2), deductionsAmountX, dedY); dedY += rowH;
        }
        if (loanDeduction > 0) { doc.text('Loan Deduction', rightX, dedY); doc.text(loanDeduction.toFixed(2), deductionsAmountX, dedY); dedY += rowH; }
        if (otherDeductions > 0) { doc.text('Other Deductions', rightX, dedY); doc.text(otherDeductions.toFixed(2), deductionsAmountX, dedY); dedY += rowH; }

        dedY += 4;
        doc.rect(rightX, dedY, 200, 1).fill('#ddd');
        dedY += 6;
        const totalDed = shaDeduction + nssfDeduction + ahlDeduction + loanDeduction + otherDeductions + payeTax + unpaidLeaveDeduction + absentDeduction + lateDeduction;
        doc.font('Helvetica-Bold').text('Total Deductions', rightX, dedY);
        doc.text(totalDed.toFixed(2), deductionsAmountX, dedY);
        dedY += rowH;

        const finalY = Math.max(earnY, dedY) + 20;
        doc.rect(leftX, finalY, 510, 24).fill('#1e293b');
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff');
        doc.text('NET PAY', leftX + 8, finalY + 6);
        doc.text(`KES ${netPay.toFixed(2)}`, deductionsAmountX - 30, finalY + 6);
        doc.fillColor('#000');

        doc.moveDown(2);
        doc.fontSize(7).font('Helvetica').text(`Days Worked: ${daysWorked}  |  Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.end();
    } catch (err) {
        console.error('Error generating portal payslip (Firestore):', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/portal/p9
router.get('/p9', async (req: PortalRequest, res) => {
    try {
        const emp = await getFirestoreEmployee(req);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = emp.id;
        const clientId = (emp as any).clientId;
        const uid = (req as any).user!.uid;
        const kraPin = (emp as any).kraPin;

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        const client = clientDoc.exists ? { id: clientDoc.id, ...clientDoc.data() } : null;

        const entrySnapshot = await adminDb
            .collection('payrollEntries')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employeeId', '==', employeeId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
        const entry = entrySnapshot.empty ? {} : entrySnapshot.docs[0].data();

        const e = entry as any;
        const basicPay = e.basicPay || (emp as any).basicPay || 0;
        const benefits = e.benefits || 0;
        const overtimePay = e.overtimePay || 0;
        const bonusPay = (e.bonusPay || 0) + (e.nonTaxableBonus || 0);
        const grossPay = e.grossPay || (basicPay + benefits + overtimePay + bonusPay);
        const shaDed = e.shaDeduction || Math.round(grossPay * 0.0275 * 100) / 100;
        const nssfDed = e.nssfDeduction || Math.round(Math.min(grossPay * 0.06, 6480) * 100) / 100;
        const ahl = e.ahlDeduction || Math.round(grossPay * 0.015 * 100) / 100;
        const payeTax = e.payeTax || 0;
        const loanDed = e.loanDeduction || 0;
        const otherDed = e.otherDeductions || 0;
        const netPay = e.netPay || Math.max(0, grossPay - shaDed - nssfDed - ahl - loanDed - otherDed - payeTax);
        const personalRelief = 2400;
        const insuranceRelief = 0;
        const taxYear = new Date().getFullYear().toString();
        const monthNum = new Date().getMonth() + 1;

        const totalCashPay = basicPay || 0;
        const carBenefit = (emp as any).carBenefit || 0;
        const meals = (emp as any).mealsBenefit || 0;
        const nonCash = (emp as any).nonCashBenefits || 0;
        const housingBenefit = (emp as any).housingBenefit || 0;
        const otherBenefits = (emp as any).otherBenefits || 0;
        const otherPension = (emp as any).otherPension || 0;
        const postRetMedical = (emp as any).postRetMedical || 0;
        const mortgage = (emp as any).mortgageInterest || 0;
        const taxablePay = e.taxablePay || (grossPay - (shaDed + nssfDed + ahl + otherPension + postRetMedical + mortgage));

        const { resolveLogoPath } = await import('../lib/cloudStorage');
        const p9LogoPath = await resolveLogoPath(client as any, uid);

        const doc = new PDFDocument({ size: 'A4', margin: 25 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=P9_${kraPin}.pdf`);
        doc.pipe(res);

        const pageWidth = doc.page.width - 50;
        const leftMargin = 25;
        let y = leftMargin;

        if (p9LogoPath) {
            try {
                doc.image(p9LogoPath, leftMargin, y, { width: 50 });
            } catch { /* ignore */ }
        }
        try {
            const kraLogoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'logos', 'kra.png');
            if (fs.existsSync(kraLogoPath)) doc.image(kraLogoPath, leftMargin + pageWidth - 60, y, { width: 55 });
        } catch { /* ignore */ }
        y += 60;

        doc.fontSize(9).font('Helvetica-Bold').fillColor('#000');
        doc.text('KENYA REVENUE AUTHORITY', leftMargin, y, { align: 'center', width: pageWidth });
        y += 11;
        doc.fontSize(7).font('Helvetica').fillColor('#333');
        doc.text('DOMESTIC TAXES DEPARTMENT  |  TAX DEDUCTION CARD YEAR ' + taxYear, leftMargin, y, { align: 'center', width: pageWidth });
        y += 14;

        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000');
        doc.text('Employers Name', leftMargin, y);
        doc.text((client as any)?.name || '', leftMargin + 90, y, { width: 200 });
        doc.text("Employer's PIN", leftMargin + 320, y);
        doc.text((client as any)?.pin || '', leftMargin + 390, y, { width: 120 });
        y += 11;
        doc.text("Employee's Main Name", leftMargin, y);
        doc.text((emp as any).employeeName, leftMargin + 90, y, { width: 200 });
        doc.text("Employee's PIN", leftMargin + 320, y);
        doc.text((emp as any).kraPin, leftMargin + 390, y, { width: 120 });
        y += 11;
        doc.text("Employee's Other Names", leftMargin, y);
        y += 14;

        const colCount = 18;
        const colWidth = Math.floor(pageWidth / colCount);
        const colXs = Array.from({ length: colCount }, (_, i) => leftMargin + i * colWidth);

        const headers = [
            'MONTH', 'Basic\nSalary', 'Benefits-\nNonCash', 'Value of\nQuarters', 'Total Gross\nPay',
            '30% of A\n(E1)', 'Actual\n(E2)', 'Lower of\nE1,E2(E3)', 'AHL', 'SHIF', 'PRMF',
            'Owner-\nOccupied', 'Total\nDeductions', 'Chargeable\nPay (D-J)', 'Tax\nCharged',
            'Personal\nRelief', 'Insurance\nRelief', 'PAYE Tax\n(L-M-N)'
        ];
        const colLetters = ['', 'A', 'B', 'C', 'D', 'E1', 'E2', 'E3', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];

        doc.rect(leftMargin, y, pageWidth, 44).fill('#1e293b');

        doc.fontSize(4.5).font('Helvetica-Bold').fillColor('#fff');
        colLetters.forEach((letter, i) => {
            if (letter) doc.text(letter, colXs[i] + 1, y + 2, { width: colWidth - 2, align: 'center' });
        });

        doc.fontSize(4.5).font('Helvetica-Bold').fillColor('#fff');
        headers.forEach((h, i) => {
            const lines = h.split('\n');
            lines.forEach((line, li) => {
                doc.text(line, colXs[i] + 1, y + 10 + (li * 6), { width: colWidth - 2, align: i === 0 ? 'left' : 'center' });
            });
        });

        y += 44;

        doc.rect(leftMargin, y, pageWidth, 9).fill('#e2e8f0');
        doc.fontSize(4.5).font('Helvetica').fillColor('#333');
        for (let i = 1; i < colCount; i++) {
            if (i < 5 || i > 7) { doc.text('Kshs.', colXs[i] + 1, y + 1, { width: colWidth - 2, align: 'center' }); }
        }
        y += 9;

        const benefitsNonCash = (carBenefit || 0) + (meals || 0) + (nonCash || 0);
        const valueOfQuarters = housingBenefit || 0;
        const e1_30PerA = totalCashPay * 0.30;
        const e2_actual = (nssfDed || 0) + (otherPension || 0);
        const e3_lower = Math.min(e1_30PerA, e2_actual);
        const totalDeductionsColJ = e3_lower + (shaDed || 0) + (ahl || 0) + (otherPension || 0) + (postRetMedical || 0) + (mortgage || 0);
        const taxCharged = (payeTax || 0) + (personalRelief || 0) + (insuranceRelief || 0);

        const monthLabels = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const currentMonthNum = monthNum || new Date().getMonth() + 1;

        let rowY = y;
        monthLabels.forEach((ml: string, mi: number) => {
            const isCurrent = mi + 1 === currentMonthNum;
            const bg = mi % 2 === 0 ? '#f8fafc' : '#ffffff';
            doc.rect(leftMargin, rowY, pageWidth, 12).fill(bg);

            doc.fontSize(4.5).font('Helvetica-Bold').fillColor('#000');
            doc.text(ml, colXs[0] + 2, rowY + 2, { width: colWidth - 2 });

            if (isCurrent) {
                const values = [
                    totalCashPay, benefitsNonCash, valueOfQuarters, grossPay,
                    e1_30PerA, e2_actual, e3_lower,
                    ahl, shaDed, postRetMedical, mortgage, totalDeductionsColJ,
                    taxablePay, taxCharged, personalRelief, insuranceRelief, payeTax
                ];
                doc.fontSize(4.5).font('Helvetica').fillColor('#000');
                values.forEach((val, vi) => {
                    doc.text(formatMoney(val), colXs[vi + 1] + 1, rowY + 2, { width: colWidth - 2, align: 'right' });
                });
            } else {
                doc.fontSize(4.5).font('Helvetica').fillColor('#94a3b8');
                for (let vi = 1; vi < colCount; vi++) {
                    doc.text('0.00', colXs[vi] + 1, rowY + 2, { width: colWidth - 2, align: 'right' });
                }
            }
            rowY += 12;
        });

        doc.rect(leftMargin, rowY, pageWidth, 13).fill('#1e293b');
        doc.fontSize(5).font('Helvetica-Bold').fillColor('#fff');
        doc.text('TOTAL', colXs[0] + 2, rowY + 2, { width: colWidth - 2 });
        const totalValues = [
            totalCashPay, benefitsNonCash, valueOfQuarters, grossPay,
            e1_30PerA, e2_actual, e3_lower,
            ahl, shaDed, postRetMedical, mortgage, totalDeductionsColJ,
            taxablePay, taxCharged, personalRelief, insuranceRelief, payeTax
        ];
        totalValues.forEach((val, vi) => {
            doc.text(formatMoney(val), colXs[vi + 1] + 1, rowY + 2, { width: colWidth - 2, align: 'right' });
        });
        rowY += 16;

        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000');
        doc.text('TOTAL CHARGEABLE PAY (COL. K) Kshs.', leftMargin, rowY);
        doc.text(formatMoney(taxablePay), leftMargin + 180, rowY, { width: 100, align: 'right' });
        rowY += 14;
        doc.text('TOTAL TAX (C ........................................................................)', leftMargin, rowY);
        doc.text(formatMoney(payeTax), leftMargin + 180, rowY, { width: 100, align: 'right' });
        rowY += 16;

        doc.fontSize(6).font('Helvetica-Bold').fillColor('#000');
        doc.text('IMPORTANT', leftMargin, rowY);
        rowY += 9;
        doc.fontSize(4.5).font('Helvetica').fillColor('#666');
        const notes = [
            '1. Use P9A',
            '2. (a) Deductible interest in respect of any month prior to December 2024 must not exceed Kshs. 25,000/- and commencing December 2024 must not exceed 30,000/-',
            '   (b) Where an employee is eligible to deduction on owner occupied interest.',
            '   (c) Where an employee contributes to a post retirement medical fund.',
            '   (d) Deductible contribution to the Social Health Insurance Fund (SHIF) and deductions made towards Affordable Housing Levy (AHL) are effective December 2024',
            '   (e) Personal Relief is Kshs. 2,400 per Month or 28,800 per year',
            '   (f) Insurance Relief is 15% of the Premium up to a Maximum of Kshs. 5,000 per month or Kshs. 60,000 per year',
        ];
        notes.forEach((note) => {
            doc.text(note, leftMargin, rowY, { width: pageWidth });
            rowY += 7;
        });

        rowY += 4;
        doc.fontSize(5).font('Helvetica').fillColor('#999');
        doc.text('This is a computer-generated P9 form. No signature required.', leftMargin, rowY, { align: 'center', width: pageWidth });

        doc.end();
    } catch (err) {
        console.error('Error generating portal P9 (Firestore):', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/portal/documents
router.get('/documents', async (req: PortalRequest, res) => {
    try {
        const emp = await getFirestoreEmployee(req);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = emp.id;
        const clientId = (emp as any).clientId;
        const uid = (req as any).user!.uid;

        const snapshot = await adminDb
            .collection('documents')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employeeId', '==', employeeId)
            .orderBy('uploadedAt', 'desc')
            .get();

        res.json(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching portal documents from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/portal/documents/:id/download
router.get('/documents/:id/download', async (req: PortalRequest, res) => {
    try {
        const emp = await getFirestoreEmployee(req);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        const employeeId = emp.id;
        const clientId = (emp as any).clientId;
        const uid = (req as any).user!.uid;
        const id = req.params.id;

        const doc = await adminDb.collection('documents').doc(id).get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId || doc.data()?.employeeId !== employeeId) {
            return res.status(404).json({ message: 'Document not found' });
        }

        const data = doc.data() as any;
        const uploadDir = path.join(__dirname, '../../uploads/documents');
        const filePath = path.join(uploadDir, data.fileName);
        if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found on disk' });
        res.setHeader('Content-Type', data.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${data.originalName}"`);
        res.sendFile(filePath);
    } catch (err) {
        console.error('Error downloading portal document (Firestore):', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
