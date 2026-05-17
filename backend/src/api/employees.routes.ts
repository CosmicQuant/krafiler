import { Router } from 'express';
import { openDb } from '../db/database';
import { db } from '../db/kysely';
import { logAudit } from '../services/auditService';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

const router = Router();

// ─── Employees CRUD ────────────────────────────────────────────────────────────

// GET /api/clients/:clientId/employees
router.get('/:clientId/employees', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const employees = await db
            .selectFrom('employees')
            .selectAll()
            .where('clientId', '=', clientId)
            .orderBy('employeeName', 'asc')
            .execute();

        res.json(employees);
    } catch (err) {
        console.error('Error fetching employees:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/employees
router.post('/:clientId/employees', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { payrollNumber, employeeName, idNumber, kraPin, nssfNo, shaNo, phone, email, bankName, bankAccount, bankCode, department, departmentId, jobTitle, employmentType, employmentStatus, dateJoined, dateLeft, basicPay, role } = req.body;

        const now = new Date().toISOString();
        const result = await db
            .insertInto('employees')
            .values({
        clientId,
                payrollNumber: payrollNumber || '',
                employeeName: employeeName || '',
                idNumber: idNumber || '',
                kraPin: kraPin || '',
                nssfNo: nssfNo || '',
                shaNo: shaNo || '',
                phone: phone || '',
                email: email || '',
                bankName: bankName || '',
                bankAccount: bankAccount || '',
                bankCode: bankCode || '',
                department: department || '',
                departmentId: departmentId || null,
                jobTitle: jobTitle || '',
                employmentType: employmentType || 'Permanent',
                employmentStatus: employmentStatus || 'Active',
                dateJoined: dateJoined || '',
                dateLeft: dateLeft || null,
                basicPay: basicPay || 0,
                role: role || 'employee',
                createdAt: now,
                updatedAt: now,
            })
            .executeTakeFirst();

        const id = Number(result.insertId || 0);

        const employee = await db
            .selectFrom('employees')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        logAudit({
            clientId,
            action: 'CREATE',
            entityType: 'employee',
            entityId: id,
            newValues: employee,
            performedBy: 'admin',
        });

        res.status(201).json(employee);
    } catch (err) {
        console.error('Error creating employee:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/employees/:id
router.put('/:clientId/employees/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const existing = await db
            .selectFrom('employees')
            .selectAll()
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        if (!existing) return res.status(404).json({ message: 'Employee not found' });

        const { payrollNumber, employeeName, idNumber, kraPin, nssfNo, shaNo, phone, email, bankName, bankAccount, bankCode, department, jobTitle, employmentType, employmentStatus, dateJoined, dateLeft, basicPay, role, departmentId } = req.body;

        await db
            .updateTable('employees')
            .set({
                payrollNumber: payrollNumber !== undefined ? payrollNumber : existing.payrollNumber,
                employeeName: employeeName !== undefined ? employeeName : existing.employeeName,
                idNumber: idNumber !== undefined ? idNumber : existing.idNumber,
                kraPin: kraPin !== undefined ? kraPin : existing.kraPin,
                nssfNo: nssfNo !== undefined ? nssfNo : existing.nssfNo,
                shaNo: shaNo !== undefined ? shaNo : existing.shaNo,
                phone: phone !== undefined ? phone : existing.phone,
                email: email !== undefined ? email : existing.email,
                bankName: bankName !== undefined ? bankName : existing.bankName,
                bankAccount: bankAccount !== undefined ? bankAccount : existing.bankAccount,
                bankCode: bankCode !== undefined ? bankCode : existing.bankCode,
                department: department !== undefined ? department : existing.department,
                departmentId: departmentId !== undefined ? departmentId : existing.departmentId,
                jobTitle: jobTitle !== undefined ? jobTitle : existing.jobTitle,
                employmentType: employmentType !== undefined ? employmentType : existing.employmentType,
                employmentStatus: employmentStatus !== undefined ? employmentStatus : existing.employmentStatus,
                dateJoined: dateJoined !== undefined ? dateJoined : existing.dateJoined,
                dateLeft: dateLeft !== undefined ? (dateLeft || null) : existing.dateLeft,
                basicPay: basicPay !== undefined ? basicPay : existing.basicPay,
                role: role !== undefined ? role : existing.role,
                updatedAt: new Date().toISOString(),
            })
            .where('id', '=', id)
            .execute();

        const updated = await db
            .selectFrom('employees')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        logAudit({
            clientId,
            employeeId: id,
            action: 'UPDATE',
            entityType: 'employee',
            entityId: id,
            oldValues: existing,
            newValues: updated,
            performedBy: 'admin',
        });

        res.json(updated);
    } catch (err) {
        console.error('Error updating employee:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/employees/:id
router.delete('/:clientId/employees/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const existing = await db
            .selectFrom('employees')
            .selectAll()
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        if (!existing) return res.status(404).json({ message: 'Employee not found' });

        await db
            .deleteFrom('employees')
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .execute();

        logAudit({
            clientId,
            employeeId: id,
            action: 'DELETE',
            entityType: 'employee',
            entityId: id,
            oldValues: existing,
            performedBy: 'admin',
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting employee:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/employees/import — import from master CSV payroll data
router.post('/:clientId/employees/import', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        // Get payroll data to extract current employees
        const legacyDb = await openDb();
        const client = await legacyDb.get('SELECT * FROM clients WHERE id = ?', [clientId]);
        if (!client) return res.status(404).json({ message: 'Client not found' });

        const payrollRes = await fetch(`${req.protocol}://${req.get('host')}/api/clients/${clientId}/payroll-data`);
        const payrollData = await payrollRes.json();

        if (!payrollData.hasData || !payrollData.employees?.length) {
            return res.status(400).json({ message: 'No payroll data found for this client. Upload a master CSV first.' });
        }

        const now = new Date().toISOString();
        let imported = 0;

        for (const emp of payrollData.employees) {
            const kraPin = String(emp['PIN of Employee'] ?? '');
            if (!kraPin) continue;

            const existing = await db
                .selectFrom('employees')
                .select('id')
                .where('clientId', '=', clientId)
                .where('kraPin', '=', kraPin)
                .executeTakeFirst();

            if (existing) continue;

            const payrollNumber = String(emp['Payroll Number'] ?? '');
            const employeeName = String(emp['Name of Employee'] ?? '');
            const idNumber = String(emp['ID Number'] ?? '');
            const nssfNo = String(emp['NSSF No'] ?? '');
            const shaNo = String(emp['SHA No'] ?? '');
            const residentialStatus = String(emp['Residential Status'] ?? '');
            const typeOfEmployee = String(emp['Type of Employee'] ?? '');

            await db
                .insertInto('employees')
                .values({
                    clientId,
                    payrollNumber,
                    employeeName,
                    idNumber,
                    kraPin,
                    nssfNo,
                    shaNo,
                    phone: '',
                    email: '',
                    bankName: '',
                    bankAccount: '',
                    bankCode: '',
                    department: '',
                    jobTitle: '',
                    employmentType: typeOfEmployee === 'Secondary Employee' ? 'Contract' : 'Permanent',
                    employmentStatus: 'Active',
                    dateJoined: '',
                    dateLeft: null,
                    basicPay: parseFloat(String(emp['Total Cash Pay (A)'] ?? '0')) || 0,
                    role: 'employee',
                    createdAt: now,
                    updatedAt: now,
                })
                .execute();

            imported++;
        }

        const total = await db
            .selectFrom('employees')
            .select(db.fn.countAll<number>().as('count'))
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        res.json({ imported, total: Number(total?.count || 0) });
    } catch (err) {
        console.error('Error importing employees:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── Payslip Generation ────────────────────────────────────────────────────────

function formatMoney(n: number): string {
    return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// GET /api/clients/:clientId/payslip/:employeeKraPin?period=MMYYYY
router.get('/:clientId/payslip/:employeeKraPin', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const employeeKraPin = req.params.employeeKraPin;
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        // Fetch payroll data
        const legacyDb = await openDb();
        const client = await legacyDb.get('SELECT * FROM clients WHERE id = ?', [clientId]);
        if (!client) return res.status(404).json({ message: 'Client not found' });

        const period = (req.query.period as string) || '';
        const periodLabel = period ? `${period.substring(0, 2)}/${period.substring(2)}` : new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

        const payrollRes = await fetch(`${req.protocol}://${req.get('host')}/api/clients/${clientId}/payroll-data`);
        const payrollData = await payrollRes.json();

        if (!payrollData.hasData || !payrollData.employees?.length) {
            return res.status(400).json({ message: 'No payroll data found' });
        }

        const emp = payrollData.employees.find(
            (e: any) => String(e['PIN of Employee'] ?? '').toUpperCase() === employeeKraPin.toUpperCase()
        );

        if (!emp) {
            return res.status(404).json({ message: 'Employee not found in payroll data' });
        }

        const companyName = payrollData.preamble?.companyName || client.name;
        const companyPin = payrollData.preamble?.companyPin || client.pin;
        const employeeName = String(emp['Name of Employee'] || '');
        const kraPin = String(emp['PIN of Employee'] || '');
        const idNo = String(emp['ID Number'] || '');
        const nssfNo = String(emp['NSSF No'] || '');
        const shaNo = String(emp['SHA No'] || '');
        const payrollNo = String(emp['Payroll Number'] || '');

        const grossPay = parseFloat(String(emp['Total Gross Pay (Ksh) (H)'] || '0')) || 0;
        const totalCashPay = parseFloat(String(emp['Total Cash Pay (A)'] || '0')) || 0;
        const carBenefit = parseFloat(String(emp['Value of Car Benefit (B)'] || '0')) || 0;
        const meals = parseFloat(String(emp['Value of Meals (C)'] || '0')) || 0;
        const nonCash = parseFloat(String(emp['Non Cash Benefits (D)'] || '0')) || 0;
        const housingBenefit = parseFloat(String(emp['Housing Benefit (F)'] || '0')) || 0;
        const otherBenefits = parseFloat(String(emp['Other Benefits (G)'] || '0')) || 0;

        const shaDed = parseFloat(String(emp['Social Health Insurance Fund (I)'] || '0')) || 0;
        const nssfDed = parseFloat(String(emp['NSSF Contribution (J)'] || '0')) || 0;
        const otherPension = parseFloat(String(emp['Other Pension Contribution (K)'] || '0')) || 0;
        const postRetMedical = parseFloat(String(emp['Post Retirement Medical Fund (L)'] || '0')) || 0;
        const mortgage = parseFloat(String(emp['Mortgage Interest (M)'] || '0')) || 0;
        const ahl = parseFloat(String(emp['Affordable Housing Levy (N)'] || '0')) || 0;
        const taxablePay = parseFloat(String(emp['Taxable Pay(Ksh) (O)'] || '0')) || 0;
        const personalRelief = parseFloat(String(emp['Monthly Personal Relief (Ksh) (P)'] || '0')) || 0;
        const insuranceRelief = parseFloat(String(emp['Amount of Insurance Relief (Q)'] || '0')) || 0;
        const payeTax = parseFloat(String(emp['PAYE Tax (Ksh) (R)'] || '0')) || 0;

        const totalDeductions = shaDed + nssfDed + ahl + payeTax + otherPension + postRetMedical;
        const netPay = grossPay - totalDeductions;

        // Generate PDF
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Payslip_${employeeName.replace(/\s+/g, '_')}_${periodLabel.replace(/\//g, '_')}.pdf"`);
        doc.pipe(res);

        const pageWidth = doc.page.width - 80;
        const leftMargin = 40;
        let y = leftMargin;

        // ── Header ──
        doc.fontSize(16).font('Helvetica-Bold').text(companyName, leftMargin, y);
        doc.fontSize(8).font('Helvetica').fillColor('#666').text(`KRA PIN: ${companyPin}`, leftMargin, y + 18);
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('PAYSLIP', leftMargin, y + 32);
        doc.fontSize(8).font('Helvetica').fillColor('#666').text(`Period: ${periodLabel}`, leftMargin + 300, y + 32);

        y += 52;

        // ── Employee Details ──
        doc.rect(leftMargin, y, pageWidth, 1).fill('#ddd');
        y += 8;
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000');
        doc.text('Employee Details', leftMargin, y);
        y += 14;

        const empDetails = [
            ['Name:', employeeName, 'Payroll No:', payrollNo],
            ['KRA PIN:', kraPin, 'ID No:', idNo],
            ['NSSF No:', nssfNo, 'SHA No:', shaNo],
        ];

        empDetails.forEach(row => {
            doc.fontSize(8).font('Helvetica').fillColor('#333');
            doc.text(row[0], leftMargin, y, { width: 80 });
            doc.font('Helvetica-Bold').text(row[1], leftMargin + 60, y, { width: 130 });
            doc.font('Helvetica').text(row[2], leftMargin + 220, y, { width: 80 });
            doc.font('Helvetica-Bold').text(row[3], leftMargin + 295, y, { width: 130 });
            y += 13;
        });

        y += 4;
        doc.rect(leftMargin, y, pageWidth, 1).fill('#ddd');
        y += 12;

        // ── Earnings Table ──
        const col1X = leftMargin;
        const col2X = leftMargin + 320;
        const colValX = leftMargin + 420;

        doc.fontSize(9).font('Helvetica-Bold').fillColor('#000');
        doc.text('Earnings', col1X, y);
        doc.text('Amount (KES)', colValX - 60, y);
        y += 16;

        const earnings = [
            ['Basic / Cash Pay', totalCashPay],
            ['Car Benefit', carBenefit],
            ['Meals', meals],
            ['Non-Cash Benefits', nonCash],
            ['Housing Benefit', housingBenefit],
            ['Other Benefits', otherBenefits],
        ];

        doc.fontSize(8).font('Helvetica').fillColor('#333');
        earnings.forEach(([label, amount]) => {
            doc.text(label as string, col1X, y);
            doc.text(formatMoney(amount as number), colValX, y, { align: 'right' });
            y += 12;
        });

        doc.rect(col1X, y, pageWidth, 1).fill('#eee');
        y += 6;
        doc.font('Helvetica-Bold').fillColor('#000');
        doc.text('Gross Pay', col1X, y);
        doc.text(formatMoney(grossPay), colValX, y, { align: 'right' });
        y += 18;

        // ── Deductions Table ──
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#000');
        doc.text('Deductions', col1X, y);
        doc.text('Amount (KES)', colValX - 60, y);
        y += 16;

        const deductions = [
            ['PAYE Tax', payeTax],
            ['SHIF (2.75%)', shaDed],
            ['NSSF (6%)', nssfDed],
            ['Housing Levy (1.5%)', ahl],
            ['Other Pension', otherPension],
            ['Post-Retirement Medical', postRetMedical],
        ];

        doc.fontSize(8).font('Helvetica').fillColor('#333');
        deductions.forEach(([label, amount]) => {
            doc.text(label as string, col1X, y);
            doc.text(formatMoney(amount as number), colValX, y, { align: 'right' });
            y += 12;
        });

        doc.rect(col1X, y, pageWidth, 1).fill('#eee');
        y += 6;
        doc.font('Helvetica-Bold').fillColor('#000');
        doc.text('Total Deductions', col1X, y);
        doc.text(formatMoney(totalDeductions), colValX, y, { align: 'right' });
        y += 20;

        // ── Net Pay ──
        doc.rect(leftMargin, y, pageWidth, 22).fill('#1e293b');
        y += 4;
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#ffffff');
        doc.text('NET PAY', leftMargin + 8, y + 2);
        doc.text(`KES ${formatMoney(netPay)}`, colValX - 10, y + 2, { align: 'right' });

        y += 35;

        // ── Footer ──
        doc.fontSize(7).font('Helvetica').fillColor('#999');
        doc.text('This is a computer-generated document. No signature required.', leftMargin, y, { align: 'center', width: pageWidth });

        doc.end();
    } catch (err) {
        console.error('Error generating payslip:', err);
        res.status(500).json({ message: 'Failed to generate payslip PDF' });
    }
});

// ─── P9 Generation (Annual Tax Deduction Card) ────────────────────────────────

// GET /api/clients/:clientId/p9/:employeeKraPin?period=MMYYYY
router.get('/:clientId/p9/:employeeKraPin', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const employeeKraPin = req.params.employeeKraPin;
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const legacyDb = await openDb();
        const client = await legacyDb.get('SELECT * FROM clients WHERE id = ?', [clientId]);
        if (!client) return res.status(404).json({ message: 'Client not found' });

        const period = (req.query.period as string) || '';
        const periodLabel = period ? `${period.substring(0, 2)}/${period.substring(2)}` : new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const taxYear = period ? `20${period.substring(2)}` : new Date().getFullYear().toString();

        const payrollRes = await fetch(`${req.protocol}://${req.get('host')}/api/clients/${clientId}/payroll-data`);
        const payrollData = await payrollRes.json();

        if (!payrollData.hasData || !payrollData.employees?.length) {
            return res.status(400).json({ message: 'No payroll data found' });
        }

        const emp = payrollData.employees.find(
            (e: any) => String(e['PIN of Employee'] ?? '').toUpperCase() === employeeKraPin.toUpperCase()
        );

        if (!emp) {
            return res.status(404).json({ message: 'Employee not found in payroll data' });
        }

        // Try to fetch employee record from employees table for extra details
        let employeeRecord: any = null;
        try {
            employeeRecord = await db
                .selectFrom('employees')
                .selectAll()
                .where('clientId', '=', clientId)
                .where('kraPin', '=', employeeKraPin)
                .executeTakeFirst();
        } catch { /* ignore */ }

        const companyName = payrollData.preamble?.companyName || client.name;
        const companyPin = payrollData.preamble?.companyPin || client.pin;
        const employeeName = String(emp['Name of Employee'] || '');
        const kraPin = String(emp['PIN of Employee'] || '');
        const idNo = String(emp['ID Number'] || '');
        const nssfNo = String(emp['NSSF No'] || '');
        const shaNo = String(emp['SHA No'] || '');
        const payrollNo = String(emp['Payroll Number'] || '');
        const department = employeeRecord?.department || '';
        const jobTitle = employeeRecord?.jobTitle || '';
        const employmentType = employeeRecord?.employmentType || '';

        const grossPay = parseFloat(String(emp['Total Gross Pay (Ksh) (H)'] || '0')) || 0;
        const totalCashPay = parseFloat(String(emp['Total Cash Pay (A)'] || '0')) || 0;
        const carBenefit = parseFloat(String(emp['Value of Car Benefit (B)'] || '0')) || 0;
        const meals = parseFloat(String(emp['Value of Meals (C)'] || '0')) || 0;
        const nonCash = parseFloat(String(emp['Non Cash Benefits (D)'] || '0')) || 0;
        const housingBenefit = parseFloat(String(emp['Housing Benefit (F)'] || '0')) || 0;
        const otherBenefits = parseFloat(String(emp['Other Benefits (G)'] || '0')) || 0;

        const shaDed = parseFloat(String(emp['Social Health Insurance Fund (I)'] || '0')) || 0;
        const nssfDed = parseFloat(String(emp['NSSF Contribution (J)'] || '0')) || 0;
        const otherPension = parseFloat(String(emp['Other Pension Contribution (K)'] || '0')) || 0;
        const postRetMedical = parseFloat(String(emp['Post Retirement Medical Fund (L)'] || '0')) || 0;
        const mortgage = parseFloat(String(emp['Mortgage Interest (M)'] || '0')) || 0;
        const ahl = parseFloat(String(emp['Affordable Housing Levy (N)'] || '0')) || 0;
        const taxablePay = parseFloat(String(emp['Taxable Pay(Ksh) (O)'] || '0')) || 0;
        const personalRelief = parseFloat(String(emp['Monthly Personal Relief (Ksh) (P)'] || '0')) || 0;
        const insuranceRelief = parseFloat(String(emp['Amount of Insurance Relief (Q)'] || '0')) || 0;
        const payeTax = parseFloat(String(emp['PAYE Tax (Ksh) (R)'] || '0')) || 0;

        // Generate P9 PDF
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="P9_${employeeName.replace(/\s+/g, '_')}_${taxYear}.pdf"`);
        doc.pipe(res);

        const pageWidth = doc.page.width - 80;
        const leftMargin = 40;
        let y = leftMargin;

        // ── Title ──
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#000');
        doc.text('P9 - ANNUAL TAX DEDUCTION CARD', leftMargin, y, { align: 'center', width: pageWidth });
        y += 6;
        doc.fontSize(8).font('Helvetica').fillColor('#666');
        doc.text(`Tax Year: ${taxYear}  |  Period: ${periodLabel}`, leftMargin, y, { align: 'center', width: pageWidth });
        y += 24;

        // ── Section A: Employer ──
        doc.rect(leftMargin, y, pageWidth, 1).fill('#ddd');
        y += 8;
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#000');
        doc.text('SECTION A: EMPLOYER DETAILS', leftMargin, y);
        y += 16;

        const empSectionY = y;
        doc.fontSize(8).font('Helvetica').fillColor('#333');
        doc.text('Employer Name:', leftMargin, y, { width: 120 });
        doc.font('Helvetica-Bold').text(companyName, leftMargin + 130, y, { width: 250 });
        y += 13;
        doc.font('Helvetica').fillColor('#333');
        doc.text('Employer KRA PIN:', leftMargin, y, { width: 120 });
        doc.font('Helvetica-Bold').text(companyPin, leftMargin + 130, y, { width: 250 });
        y += 13;
        doc.font('Helvetica').fillColor('#333');
        doc.text('Sector:', leftMargin, y, { width: 120 });
        doc.font('Helvetica-Bold').text(client.sector || '-', leftMargin + 130, y, { width: 250 });

        y = Math.max(y + 20, empSectionY + 50);
        doc.rect(leftMargin, y, pageWidth, 1).fill('#ddd');
        y += 8;

        // ── Section B: Employee ──
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#000');
        doc.text('SECTION B: EMPLOYEE DETAILS', leftMargin, y);
        y += 16;

        const empDetails = [
            ['Employee Name:', employeeName, 'Payroll No:', payrollNo],
            ['KRA PIN:', kraPin, 'ID Number:', idNo],
            ['NSSF No:', nssfNo, 'SHA No:', shaNo],
            ['Department:', department, 'Job Title:', jobTitle],
            ['Employment Type:', employmentType, '', ''],
        ];

        empDetails.forEach(row => {
            doc.fontSize(8).font('Helvetica').fillColor('#333');
            doc.text(row[0], leftMargin, y, { width: 100 });
            doc.font('Helvetica-Bold').text(row[1], leftMargin + 95, y, { width: 140 });
            doc.font('Helvetica').text(row[2], leftMargin + 250, y, { width: 80 });
            doc.font('Helvetica-Bold').text(row[3], leftMargin + 330, y, { width: 100 });
            y += 13;
        });

        y += 8;
        doc.rect(leftMargin, y, pageWidth, 1).fill('#ddd');
        y += 12;

        // ── Section C: Monthly Earnings Breakdown ──
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#000');
        doc.text('SECTION C: MONTHLY EARNINGS & DEDUCTIONS', leftMargin, y);
        y += 16;

        // Table header
        const colX = [leftMargin, leftMargin + 55, leftMargin + 125, leftMargin + 195, leftMargin + 260, leftMargin + 325, leftMargin + 395];
        const colW = colX.map((_, i) => i < colX.length - 1 ? colX[i + 1] - colX[i] - 2 : 100);
        const headers = ['Month', 'Cash Pay', 'Benefits', 'Gross Pay', 'NSSF', 'PAYE', 'Net Pay'];

        doc.fontSize(7).font('Helvetica-Bold').fillColor('#fff');
        doc.rect(leftMargin, y, pageWidth, 14).fill('#1e293b');
        headers.forEach((h, i) => {
            doc.text(h, colX[i] + 2, y + 3, { width: colW[i], align: i === 0 ? 'left' : 'right' });
        });
        y += 16;

        // Single month data
        const netPay = grossPay - shaDed - nssfDed - ahl - payeTax - otherPension - postRetMedical;
        const benefits = carBenefit + meals + nonCash + housingBenefit + otherBenefits;

        const monthLabel = periodLabel;
        const monthData = [monthLabel, totalCashPay, benefits, grossPay, nssfDed, payeTax, netPay];
        const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        let rowY = y;
        monthLabels.forEach((ml, mi) => {
            const isCurrent = ml === monthLabel.split('/')[0] || (period && parseInt(period.substring(0, 2)) === mi + 1);
            if (mi % 2 === 0) {
                doc.rect(leftMargin, rowY, pageWidth, 13).fill('#f8f8f8');
            }
            doc.fontSize(7).font('Helvetica').fillColor('#333');
            doc.text(ml, colX[0] + 2, rowY + 3, { width: colW[0] });

            if (isCurrent) {
                monthData.forEach((val, vi) => {
                    if (vi === 0) return;
                    doc.fontSize(7).font('Helvetica').fillColor('#333');
                    doc.text(formatMoney(typeof val === 'number' ? val : 0), colX[vi] + 2, rowY + 3, { width: colW[vi], align: 'right' });
                });
            } else {
                for (let vi = 1; vi < headers.length; vi++) {
                    doc.fontSize(7).font('Helvetica').fillColor('#ccc');
                    doc.text('-', colX[vi] + 2, rowY + 3, { width: colW[vi], align: 'right' });
                }
            }
            rowY += 13;
        });

        y = rowY + 4;

        // Annual totals row
        doc.rect(leftMargin, y, pageWidth, 16).fill('#1e293b');
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff');
        doc.text('ANNUAL TOTALS', colX[0] + 2, y + 4, { width: colW[0] });
        const annualValues = [totalCashPay, benefits, grossPay, nssfDed, payeTax, netPay];
        annualValues.forEach((val, vi) => {
            doc.text(formatMoney(val), colX[vi + 1] + 2, y + 4, { width: colW[vi + 1], align: 'right' });
        });
        y += 24;

        // ── Section D: Summary ──
        doc.rect(leftMargin, y, pageWidth, 1).fill('#ddd');
        y += 8;
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#000');
        doc.text('SECTION D: ANNUAL SUMMARY', leftMargin, y);
        y += 16;

        const summaryItems = [
            ['Total Cash Pay', formatMoney(totalCashPay)],
            ['Total Benefits', formatMoney(benefits)],
            ['Total Gross Pay', formatMoney(grossPay)],
            ['NSSF Contributions', formatMoney(nssfDed)],
            ['SHIF Contributions', formatMoney(shaDed)],
            ['Housing Levy', formatMoney(ahl)],
            ['PAYE Tax Deducted', formatMoney(payeTax)],
            ['Personal Relief', formatMoney(personalRelief)],
            ['Insurance Relief', formatMoney(insuranceRelief)],
            ['Net Pay', formatMoney(netPay)],
        ];

        const summaryCol1X = leftMargin;
        const summaryCol2X = leftMargin + 320;

        doc.fontSize(8).font('Helvetica').fillColor('#333');
        summaryItems.forEach(([label, amount], i) => {
            const isTotal = i === summaryItems.length - 1;
            if (isTotal) {
                doc.rect(summaryCol1X, y - 2, pageWidth - summaryCol1X + leftMargin, 18).fill('#1e293b');
                doc.fontSize(9).font('Helvetica-Bold').fillColor('#fff');
            }
            doc.text(label as string, summaryCol1X, y + 2);
            doc.text(amount as string, summaryCol2X, y + 2, { align: 'right', width: 100 });
            y += isTotal ? 22 : 14;
        });

        y += 16;

        // ── Certification ──
        doc.rect(leftMargin, y, pageWidth, 1).fill('#ddd');
        y += 8;
        doc.fontSize(8).font('Helvetica').fillColor('#666');
        doc.text('I certify that the information provided in this P9 form is true and correct.', leftMargin, y, { align: 'center', width: pageWidth });
        y += 16;
        doc.fontSize(8).font('Helvetica').fillColor('#333');
        doc.text('Employer\'s Signature: _______________________', leftMargin, y);
        doc.text('Date: _______________________', leftMargin + 300, y);
        y += 20;
        doc.fontSize(7).font('Helvetica').fillColor('#999');
        doc.text('This is a computer-generated document. No signature required.', leftMargin, y, { align: 'center', width: pageWidth });

        doc.end();
    } catch (err) {
        console.error('Error generating P9:', err);
        res.status(500).json({ message: 'Failed to generate P9 PDF' });
    }
});

export default router;
