import { Router } from 'express';
import { db } from '../db/kysely';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { logAudit } from '../services/auditService';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';

const router = Router();

function formatMoney(n: number): string {
    return (typeof n === 'number' ? n.toFixed(2) : '0.00');
}

// All portal routes require authentication
router.use(authMiddleware);

// GET /api/portal/dashboard — aggregated dashboard data
router.get('/dashboard', async (req: AuthRequest, res) => {
    try {
        const employeeId = req.employee!.id;
        const clientId = req.employee!.clientId;

        // Latest payslip data from payroll (use the first employee that matches kraPin in payroll data)
        // Actually, we fetch from the employees table payrollNumber to match master payroll
        const employee = await db
            .selectFrom('employees')
            .selectAll()
            .where('id', '=', employeeId)
            .executeTakeFirst();

        // Leave summary
        const leaveRequests = await db
            .selectFrom('leave_requests')
            .selectAll()
            .where('employeeId', '=', employeeId)
            .where('clientId', '=', clientId)
            .orderBy('createdAt', 'desc')
            .execute();

        const leaveSummary = {
            total: leaveRequests.length,
            pending: leaveRequests.filter(l => l.status === 'Pending').length,
            approved: leaveRequests.filter(l => l.status === 'Approved').length,
            rejected: leaveRequests.filter(l => l.status === 'Rejected').length,
            cancelled: leaveRequests.filter(l => l.status === 'Cancelled').length,
        };

        // Loan summary
        const loans = await db
            .selectFrom('loans')
            .selectAll()
            .where('employeeId', '=', employeeId)
            .where('clientId', '=', clientId)
            .orderBy('createdAt', 'desc')
            .execute();

        const loanSummary = {
            total: loans.length,
            active: loans.filter(l => l.status === 'Active' || l.status === 'Approved').length,
            paid: loans.filter(l => l.status === 'Paid').length,
            totalPrincipal: loans.reduce((sum, l) => sum + l.principal, 0),
            outstandingBalance: loans.reduce((sum, l) => sum + (l.totalRepayable - l.amountPaid), 0),
        };

        // Attendance summary (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const attendance = await db
            .selectFrom('attendance_records')
            .selectAll()
            .where('employeeId', '=', employeeId)
            .where('clientId', '=', clientId)
            .where('date', '>=', thirtyDaysAgo.toISOString().split('T')[0])
            .orderBy('date', 'desc')
            .execute();

        const attendanceSummary = {
            total: attendance.length,
            present: attendance.filter(a => a.status === 'Present').length,
            absent: attendance.filter(a => a.status === 'Absent').length,
            late: attendance.filter(a => a.status === 'Late').length,
            halfDay: attendance.filter(a => a.status === 'Half-Day').length,
            onLeave: attendance.filter(a => a.status === 'Leave').length,
        };

        // Recent leave (last 5)
        const recentLeave = leaveRequests.slice(0, 5);

        // Recent loans (last 5)
        const recentLoans = loans.slice(0, 5);

        // Payroll summary — unpaid leave
        const payrollEntries = await db
            .selectFrom('payroll_entries')
            .selectAll()
            .where('employeeId', '=', employeeId)
            .where('clientId', '=', clientId)
            .execute();

        const totalUnpaidLeaveDays = payrollEntries.reduce((sum, e) => sum + (e.unpaidLeaveDays || 0), 0);
        const totalLoanDeduction = payrollEntries.reduce((sum, e) => sum + (e.loanDeduction || 0), 0);

        // Recent attendance (last 5)
        const recentAttendance = attendance.slice(0, 5);

        res.json({
            employee: {
                employeeName: employee?.employeeName || '',
                kraPin: employee?.kraPin || '',
                idNumber: employee?.idNumber || '',
                email: employee?.email || '',
                phone: employee?.phone || '',
                department: employee?.department || '',
                jobTitle: employee?.jobTitle || '',
                employmentType: employee?.employmentType || '',
                employmentStatus: employee?.employmentStatus || '',
                dateJoined: employee?.dateJoined || '',
                basicPay: employee?.basicPay || 0,
                nssfNo: employee?.nssfNo || '',
                shaNo: employee?.shaNo || '',
                bankName: employee?.bankName || '',
                bankAccount: employee?.bankAccount || '',
                bankCode: employee?.bankCode || '',
            },
            leaveSummary,
            loanSummary,
            attendanceSummary,
            totalUnpaidLeaveDays,
            totalLoanDeduction,
            recentLeave,
            recentLoans,
            recentAttendance,
        });
    } catch (err) {
        console.error('Error fetching portal dashboard:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/portal/leave — submit leave request
router.post('/leave', async (req: AuthRequest, res) => {
    try {
        const employeeId = req.employee!.id;
        const clientId = req.employee!.clientId;
        const { leaveType, startDate, endDate, daysCount, hours, reason, isPaid } = req.body;

        if (!leaveType || !startDate || !endDate) {
            res.status(400).json({ message: 'Leave type, start date, and end date are required' });
            return;
        }

        const now = new Date().toISOString();
        const result = await db
            .insertInto('leave_requests')
            .values({
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
            })
            .executeTakeFirst();

        const id = Number(result.insertId || 0);
        const record = await db
            .selectFrom('leave_requests')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        logAudit({
            clientId,
            employeeId,
            action: 'CREATE',
            entityType: 'leave_request',
            entityId: id,
            newValues: record,
            performedBy: req.employee!.employeeName,
        });

        res.status(201).json(record);
    } catch (err) {
        console.error('Error submitting leave via portal:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/portal/leave/:id — edit own pending leave request
router.put('/leave/:id', async (req: AuthRequest, res) => {
    try {
        const employeeId = req.employee!.id;
        const clientId = req.employee!.clientId;
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) { res.status(400).json({ message: 'Invalid ID' }); return; }

        const { leaveType, startDate, endDate, daysCount, hours, reason, isPaid } = req.body;

        const existing = await db
            .selectFrom('leave_requests')
            .selectAll()
            .where('id', '=', id)
            .where('employeeId', '=', employeeId)
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        if (!existing) return res.status(404).json({ message: 'Leave request not found' });

        await db
            .updateTable('leave_requests')
            .set({
                leaveType: leaveType !== undefined ? leaveType : existing.leaveType,
                startDate: startDate !== undefined ? startDate : existing.startDate,
                endDate: endDate !== undefined ? endDate : existing.endDate,
                daysCount: daysCount !== undefined ? daysCount : existing.daysCount,
                hours: hours !== undefined ? hours : existing.hours,
                reason: reason !== undefined ? reason : existing.reason,
                isPaid: isPaid !== undefined ? (isPaid === false || isPaid === 0 ? 0 : 1) : existing.isPaid,
                updatedAt: new Date().toISOString(),
            })
            .where('id', '=', id)
            .execute();

        const updated = await db
            .selectFrom('leave_requests')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        logAudit({
            clientId,
            employeeId,
            action: 'UPDATE',
            entityType: 'leave_request',
            entityId: id,
            oldValues: existing,
            newValues: updated,
            performedBy: req.employee!.employeeName,
        });

        res.json(updated);
    } catch (err) {
        console.error('Error updating portal leave request:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/portal/leave/:id — delete own leave request
router.delete('/leave/:id', async (req: AuthRequest, res) => {
    try {
        const employeeId = req.employee!.id;
        const clientId = req.employee!.clientId;
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) { res.status(400).json({ message: 'Invalid ID' }); return; }

        const existing = await db
            .selectFrom('leave_requests')
            .selectAll()
            .where('id', '=', id)
            .where('employeeId', '=', employeeId)
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        if (!existing) { res.status(404).json({ message: 'Leave request not found' }); return; }

        await db
            .deleteFrom('leave_requests')
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .execute();

        logAudit({
            clientId,
            employeeId,
            action: 'DELETE',
            entityType: 'leave_request',
            entityId: id,
            oldValues: existing,
            performedBy: req.employee!.employeeName,
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting portal leave request:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/portal/loans — submit loan request
router.post('/loans', async (req: AuthRequest, res) => {
    try {
        const employeeId = req.employee!.id;
        const clientId = req.employee!.clientId;
        const { loanType, principal, installments, interestRate, notes } = req.body;

        if (!principal || principal <= 0) {
            res.status(400).json({ message: 'Principal amount is required' });
            return;
        }

        const monthlyDeduction = principal / (installments || 1);
        const totalInterest = interestRate
            ? Math.round(principal * (interestRate / 100))
            : 0;
        const totalRepayable = principal + totalInterest;
        const now = new Date().toISOString();

        const result = await db
            .insertInto('loans')
            .values({
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
            })
            .executeTakeFirst();

        const id = Number(result.insertId || 0);
        const record = await db
            .selectFrom('loans')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        logAudit({
            clientId,
            employeeId,
            action: 'CREATE',
            entityType: 'loan',
            entityId: id,
            newValues: record,
            performedBy: req.employee!.employeeName,
        });

        res.status(201).json(record);
    } catch (err) {
        console.error('Error submitting loan via portal:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/portal/payslip — download payslip PDF
router.get('/payslip', async (req: AuthRequest, res) => {
    try {
        const kraPin = req.employee!.kraPin;
        const clientId = req.employee!.clientId;
        const employeeId = req.employee!.id;

        const employee = await db.selectFrom('employees').selectAll().where('id', '=', employeeId).executeTakeFirst();
        if (!employee) { res.status(404).json({ message: 'Employee not found' }); return; }

        const client = await db.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();

        // Fetch latest payroll entry for actual computed data
        const entry = await db.selectFrom('payroll_entries').selectAll()
            .where('employeeId', '=', employeeId).where('clientId', '=', clientId)
            .orderBy('createdAt', 'desc').executeTakeFirst();

        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Payslip_${kraPin}.pdf`);
        doc.pipe(res);

        const leftX = 40;
        const rightX = 310;
        const earningsAmountX = 240;
        const deductionsAmountX = 550;
        let y = 40;

        // Logo
        if (client?.logoUrl) {
            try {
                const logoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', client.logoUrl.replace(/^\//, ''));
                if (fs.existsSync(logoPath)) doc.image(logoPath, leftX, y, { width: 60 });
            } catch { /* ignore */ }
        }

        doc.fontSize(14).font('Helvetica-Bold').text(client?.name || 'Company', { align: 'center' });
        doc.fontSize(8).font('Helvetica').text(`KRA PIN: ${client?.pin || ''}`, { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica-Bold').text('PAYSLIP', { align: 'center' });
        doc.moveDown(0.3);

        doc.fontSize(8).font('Helvetica');
        doc.text(`Employee: ${employee.employeeName}`, leftX, doc.y);
        doc.text(`KRA PIN: ${employee.kraPin}`, rightX, doc.y);
        doc.moveDown(0.3);
        doc.text(`ID Number: ${employee.idNumber}`, leftX, doc.y);
        doc.text(`Department: ${employee.department || ''}`, rightX, doc.y);
        doc.text(`Payroll No: ${employee.payrollNumber || ''}`, leftX, doc.y);
        if (entry) doc.text(`Period: Current`, rightX, doc.y);
        doc.moveDown(0.8);

        const e = entry || {} as any;
        const basicPay = e.basicPay || employee.basicPay || 0;
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

        // ── Column Headers ──
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

        // Earnings
        doc.fontSize(8).font('Helvetica');
        doc.text('Basic Pay', leftX, earnY); doc.text(basicPay.toFixed(2), earningsAmountX, earnY);
        earnY += rowH;

        if (benefits > 0) { doc.text('Benefits', leftX, earnY); doc.text(benefits.toFixed(2), earningsAmountX, earnY); earnY += rowH; }
        if (overtimePay > 0) { doc.text('Overtime Pay', leftX, earnY); doc.text(overtimePay.toFixed(2), earningsAmountX, earnY); earnY += rowH; }
        if (bonusPay > 0) { doc.text('Bonus Pay', leftX, earnY); doc.text(bonusPay.toFixed(2), earningsAmountX, earnY); earnY += rowH; }

        // Gross separator
        earnY += 4;
        doc.rect(leftX, earnY, 200, 1).fill('#ddd');
        earnY += 6;
        doc.font('Helvetica-Bold').text('Gross Pay', leftX, earnY);
        doc.text(grossPay.toFixed(2), earningsAmountX, earnY);
        earnY += rowH;

        // Deductions
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

        // Deductions separator
        dedY += 4;
        doc.rect(rightX, dedY, 200, 1).fill('#ddd');
        dedY += 6;
        const totalDed = shaDeduction + nssfDeduction + ahlDeduction + loanDeduction + otherDeductions + payeTax + unpaidLeaveDeduction + absentDeduction + lateDeduction;
        doc.font('Helvetica-Bold').text('Total Deductions', rightX, dedY);
        doc.text(totalDed.toFixed(2), deductionsAmountX, dedY);
        dedY += rowH;

        // Net Pay bar
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
        console.error('Error generating portal payslip:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/portal/p9 — download P9 PDF
router.get('/p9', async (req: AuthRequest, res) => {
    try {
        const kraPin = req.employee!.kraPin;
        const clientId = req.employee!.clientId;
        const employeeId = req.employee!.id;

        const employee = await db.selectFrom('employees').selectAll().where('id', '=', employeeId).executeTakeFirst();
        if (!employee) { res.status(404).json({ message: 'Employee not found' }); return; }

        const client = await db.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();

        // Fetch latest payroll entry for actual computed data
        const entry = await db.selectFrom('payroll_entries').selectAll()
            .where('employeeId', '=', employeeId).where('clientId', '=', clientId)
            .orderBy('createdAt', 'desc').executeTakeFirst();

        const e = entry || {} as any;
        const basicPay = e.basicPay || employee.basicPay || 0;
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

        // Other values for P9
        const totalCashPay = basicPay || 0;
        const carBenefit = employee.carBenefit || 0;
        const meals = employee.mealsBenefit || 0;
        const nonCash = employee.nonCashBenefits || 0;
        const housingBenefit = employee.housingBenefit || 0;
        const otherBenefits = employee.otherBenefits || 0;
        const otherPension = employee.otherPension || 0;
        const postRetMedical = employee.postRetMedical || 0;
        const mortgage = employee.mortgageInterest || 0;
        const taxablePay = e.taxablePay || (grossPay - (shaDed + nssfDed + ahl + otherPension + postRetMedical + mortgage));

        const doc = new PDFDocument({ size: 'A4', margin: 25 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=P9_${kraPin}.pdf`);
        doc.pipe(res);

        const pageWidth = doc.page.width - 50;
        const leftMargin = 25;
        let y = leftMargin;

        // ── Logos Row (Company + KRA) ──
        if (client?.logoUrl) {
            try {
                const companyLogoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', client.logoUrl.replace(/^\//, ''));
                if (fs.existsSync(companyLogoPath)) doc.image(companyLogoPath, leftMargin, y, { width: 50 });
            } catch { /* ignore */ }
        }
        try {
            const kraLogoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'logos', 'kra.png');
            if (fs.existsSync(kraLogoPath)) doc.image(kraLogoPath, leftMargin + pageWidth - 60, y, { width: 55 });
        } catch { /* ignore */ }
        y += 60;

        // ── KRA Header ──
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#000');
        doc.text('KENYA REVENUE AUTHORITY', leftMargin, y, { align: 'center', width: pageWidth });
        y += 11;
        doc.fontSize(7).font('Helvetica').fillColor('#333');
        doc.text('DOMESTIC TAXES DEPARTMENT  |  TAX DEDUCTION CARD YEAR ' + taxYear, leftMargin, y, { align: 'center', width: pageWidth });
        y += 14;

        // ── Employer / Employee Top Fields ──
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000');
        doc.text('Employers Name', leftMargin, y);
        doc.text(client?.name || '', leftMargin + 90, y, { width: 200 });
        doc.text("Employer's PIN", leftMargin + 320, y);
        doc.text(client?.pin || '', leftMargin + 390, y, { width: 120 });
        y += 11;
        doc.text("Employee's Main Name", leftMargin, y);
        doc.text(employee.employeeName, leftMargin + 90, y, { width: 200 });
        doc.text("Employee's PIN", leftMargin + 320, y);
        doc.text(employee.kraPin, leftMargin + 390, y, { width: 120 });
        y += 11;
        doc.text("Employee's Other Names", leftMargin, y);
        y += 14;

        // ── Monthly Table (KRA P9 with E1/E2/E3) ──
        // 18 columns: Month | A | B | C | D | E1 | E2 | E3 | F | G | H | I | J | K | L | M | N | O
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

        // Header background
        doc.rect(leftMargin, y, pageWidth, 44).fill('#1e293b');

        // Column letters
        doc.fontSize(4.5).font('Helvetica-Bold').fillColor('#fff');
        colLetters.forEach((letter, i) => {
            if (letter) doc.text(letter, colXs[i] + 1, y + 2, { width: colWidth - 2, align: 'center' });
        });

        // Header labels
        doc.fontSize(4.5).font('Helvetica-Bold').fillColor('#fff');
        headers.forEach((h, i) => {
            const lines = h.split('\n');
            lines.forEach((line, li) => {
                doc.text(line, colXs[i] + 1, y + 10 + (li * 6), { width: colWidth - 2, align: i === 0 ? 'left' : 'center' });
            });
        });

        y += 44;

        // Kshs. row
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

        // TOTAL row
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

        // ── Bottom Section ──
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
        notes.forEach(note => {
            doc.text(note, leftMargin, rowY, { width: pageWidth });
            rowY += 7;
        });

        rowY += 4;
        doc.fontSize(5).font('Helvetica').fillColor('#999');
        doc.text('This is a computer-generated P9 form. No signature required.', leftMargin, rowY, { align: 'center', width: pageWidth });

        doc.end();
    } catch (err) {
        console.error('Error generating portal P9:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/portal/documents — list employee documents
router.get('/documents', async (req: AuthRequest, res) => {
    try {
        const employeeId = req.employee!.id;
        const clientId = req.employee!.clientId;
        const docs = await db
            .selectFrom('documents')
            .selectAll()
            .where('employeeId', '=', employeeId)
            .where('clientId', '=', clientId)
            .orderBy('uploadedAt', 'desc')
            .execute();
        res.json(docs);
    } catch (err) {
        console.error('Error fetching portal documents:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/portal/documents/:id/download — download a specific document
router.get('/documents/:id/download', async (req: AuthRequest, res) => {
    try {
        const employeeId = req.employee!.id;
        const clientId = req.employee!.clientId;
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) { res.status(400).json({ message: 'Invalid ID' }); return; }

        const doc = await db
            .selectFrom('documents')
            .selectAll()
            .where('id', '=', id)
            .where('employeeId', '=', employeeId)
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        if (!doc) { res.status(404).json({ message: 'Document not found' }); return; }

        const uploadDir = path.join(__dirname, '../../uploads/documents');
        const filePath = path.join(uploadDir, doc.fileName);
        if (!fs.existsSync(filePath)) { res.status(404).json({ message: 'File not found on disk' }); return; }
        res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${doc.originalName}"`);
        res.sendFile(filePath);
    } catch (err) {
        console.error('Error downloading portal document:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
