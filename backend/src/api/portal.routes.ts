import { Router } from 'express';
import { db } from '../db/kysely';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

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
        const { leaveType, startDate, endDate, daysCount, reason } = req.body;

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
                reason: reason || '',
                status: 'Pending',
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

        res.status(201).json(record);
    } catch (err) {
        console.error('Error submitting leave via portal:', err);
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

        // Fetch the payroll data for this employee to generate payslip
        const employee = await db
            .selectFrom('employees')
            .selectAll()
            .where('id', '=', req.employee!.id)
            .executeTakeFirst();

        if (!employee) {
            res.status(404).json({ message: 'Employee not found' });
            return;
        }

        // Fetch the client for company details
        const client = await db
            .selectFrom('clients')
            .selectAll()
            .where('id', '=', clientId)
            .executeTakeFirst();

        // Generate payslip PDF using PDFKit
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Payslip_${kraPin}.pdf`);
        doc.pipe(res);

        // Company header
        doc.fontSize(16).font('Helvetica-Bold').text(client?.name || 'Company', { align: 'center' });
        doc.fontSize(8).font('Helvetica').text(`KRA PIN: ${client?.pin || ''}`, { align: 'center' });
        doc.moveDown(0.5);

        // Employee details
        doc.fontSize(10).font('Helvetica-Bold').text('PAYSLIP', { align: 'center' });
        doc.moveDown(0.5);

        const leftX = 40;
        const rightX = 300;
        const colWidth = 250;

        doc.fontSize(8).font('Helvetica');
        doc.text(`Employee Name: ${employee.employeeName}`, leftX, undefined, { width: colWidth });
        doc.text(`KRA PIN: ${employee.kraPin}`, rightX, undefined, { width: colWidth });
        doc.moveDown(0.3);
        doc.text(`ID Number: ${employee.idNumber}`, leftX, undefined, { width: colWidth });
        doc.text(`Department: ${employee.department}`, rightX, undefined, { width: colWidth });
        doc.text(`Payroll No: ${employee.payrollNumber}`, leftX, undefined, { width: colWidth });
        doc.text(`Basic Pay: KES ${Number(employee.basicPay).toLocaleString()}`, rightX, undefined, { width: colWidth });
        doc.moveDown(0.5);

        // Earnings & Deductions table
        const tableTop = doc.y;
        doc.fontSize(8).font('Helvetica-Bold');
        doc.text('Earnings', leftX, tableTop);
        doc.text('Amount (KES)', leftX + 150, tableTop);
        doc.text('Deductions', rightX, tableTop);
        doc.text('Amount (KES)', rightX + 150, tableTop);
        doc.moveDown(0.3);

        const grossPay = employee.basicPay;
        const shaDeduction = Math.round(grossPay * 0.0275 * 100) / 100;
        const nssfDeduction = Math.round(Math.min(grossPay * 0.06, 6480) * 100) / 100;
        const ahlDeduction = Math.round(grossPay * 0.015 * 100) / 100;
        const taxablePay = Math.max(0, grossPay - shaDeduction - nssfDeduction - ahlDeduction);
        const payeTax = Math.round(Math.max(0,
            taxablePay * 0.1 + Math.max(0, (taxablePay - 24000) * 0.05)
        ) * 100) / 100;
        const netPay = grossPay - shaDeduction - nssfDeduction - ahlDeduction - payeTax;

        doc.fontSize(8).font('Helvetica');
        doc.text('Basic Salary', leftX, doc.y);
        doc.text(grossPay.toFixed(2), leftX + 150, doc.y - 8);
        doc.text('PAYE Tax', rightX, doc.y - 8);
        doc.text(payeTax.toFixed(2), rightX + 150, doc.y - 8);
        doc.moveDown(0.3);
        doc.text('', leftX, doc.y);
        doc.text('SHA', rightX, doc.y - 8);
        doc.text(shaDeduction.toFixed(2), rightX + 150, doc.y - 8);
        doc.moveDown(0.3);
        doc.text('', leftX, doc.y);
        doc.text('NSSF', rightX, doc.y - 8);
        doc.text(nssfDeduction.toFixed(2), rightX + 150, doc.y - 8);
        doc.moveDown(0.3);
        doc.text('', leftX, doc.y);
        doc.text('AHL', rightX, doc.y - 8);
        doc.text(ahlDeduction.toFixed(2), rightX + 150, doc.y - 8);

        doc.moveDown(0.5);
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text(`Gross Pay: KES ${grossPay.toFixed(2)}`, leftX, doc.y);
        doc.text(`Net Pay: KES ${netPay.toFixed(2)}`, rightX, doc.y - 8);

        doc.moveDown(1);
        doc.fontSize(7).font('Helvetica').text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });

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

        const employee = await db
            .selectFrom('employees')
            .selectAll()
            .where('id', '=', req.employee!.id)
            .executeTakeFirst();

        if (!employee) {
            res.status(404).json({ message: 'Employee not found' });
            return;
        }

        const client = await db
            .selectFrom('clients')
            .selectAll()
            .where('id', '=', clientId)
            .executeTakeFirst();

        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=P9_${kraPin}.pdf`);
        doc.pipe(res);

        doc.fontSize(14).font('Helvetica-Bold').text('P9 ANNUAL TAX DEDUCTION CARD', { align: 'center' });
        doc.moveDown(0.5);

        doc.fontSize(8).font('Helvetica');
        doc.text(`Employer: ${client?.name || 'Company'}`, 40, doc.y);
        doc.text(`Employer PIN: ${client?.pin || ''}`, 40, doc.y);
        doc.text(`Employee: ${employee.employeeName}`, 40, doc.y);
        doc.text(`KRA PIN: ${employee.kraPin}`, 40, doc.y);
        doc.text(`ID Number: ${employee.idNumber}`, 40, doc.y);
        doc.moveDown(0.5);

        // Calculate annual figures (simplified: basicPay * 12)
        const monthlyGross = employee.basicPay;
        const annualGross = monthlyGross * 12;
        const monthlySha = Math.round(monthlyGross * 0.0275 * 100) / 100;
        const annualSha = monthlySha * 12;
        const monthlyNssf = Math.round(Math.min(monthlyGross * 0.06, 6480) * 100) / 100;
        const annualNssf = monthlyNssf * 12;
        const monthlyAhl = Math.round(monthlyGross * 0.015 * 100) / 100;
        const annualAhl = monthlyAhl * 12;

        // Tax calculation (simplified annual)
        const annualDeductions = annualSha + annualNssf + annualAhl;
        const annualTaxablePay = Math.max(0, annualGross - annualDeductions);
        const annualPersonalRelief = 2400 * 12;
        const annualInsuranceRelief = 0;
        const annualPaye = Math.max(0,
            Math.max(0, annualTaxablePay * 0.1)
            + Math.max(0, (annualTaxablePay - 288000) * 0.15)
            + Math.max(0, (annualTaxablePay - 388000) * 0.05)
            + Math.max(0, (annualTaxablePay - 6000000) * 0.025)
            + Math.max(0, (annualTaxablePay - 9600000) * 0.025)
            - annualPersonalRelief
            - annualInsuranceRelief
        );

        // Table
        doc.fontSize(9).font('Helvetica-Bold').text('Annual Summary', 40, doc.y);
        doc.moveDown(0.3);

        const items = [
            ['Annual Gross Pay', annualGross.toFixed(2)],
            ['Annual SHA Deduction', annualSha.toFixed(2)],
            ['Annual NSSF Deduction', annualNssf.toFixed(2)],
            ['Annual AHL Deduction', annualAhl.toFixed(2)],
            ['Annual Taxable Pay', annualTaxablePay.toFixed(2)],
            ['Annual Personal Relief', annualPersonalRelief.toFixed(2)],
            ['Annual PAYE Tax', annualPaye.toFixed(2)],
            ['Annual Net Pay', (annualGross - annualSha - annualNssf - annualAhl - annualPaye).toFixed(2)],
        ];

        doc.fontSize(8).font('Helvetica');
        items.forEach(([label, value]) => {
            doc.text(label, 40, doc.y, { continued: true });
            doc.text(value, 350, doc.y - 8, { align: 'right' });
        });

        doc.moveDown(1);
        doc.fontSize(7).font('Helvetica').text(`This is a computer-generated document. Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });

        doc.end();
    } catch (err) {
        console.error('Error generating portal P9:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
