import { Router } from 'express';
import { openDb } from '../db/database';
import { db } from '../db/kysely';
import { logAudit } from '../services/auditService';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { PDFDocument as PDFLibDocument, rgb, StandardFonts } from 'pdf-lib';

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

        const { payrollNumber, employeeName, idNumber, kraPin, nssfNo, shaNo, phone, email, bankName, bankAccount, bankCode, department, departmentId, jobTitle, employmentType, employmentStatus, dateJoined, dateLeft, basicPay, role, standardCheckOut, standardCheckIn, identityType, residentialStatus, typeOfEmployee, pwd, exemptionCert, carBenefit, mealsBenefit, nonCashBenefits, typeOfHousing, housingBenefit, otherBenefits, otherPension, postRetMedical, mortgageInterest, insuranceRelief, payStructure, bonusPay } = req.body;

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
                standardCheckOut: standardCheckOut || '17:00',
                standardCheckIn: standardCheckIn || '08:00',
                identityType: identityType || 'National ID',
                residentialStatus: residentialStatus || 'Resident',
                typeOfEmployee: typeOfEmployee || 'Primary Employee',
                pwd: pwd || 'No',
                exemptionCert: exemptionCert || '',
                carBenefit: carBenefit || 0,
                mealsBenefit: mealsBenefit || 0,
                nonCashBenefits: nonCashBenefits || 0,
                typeOfHousing: typeOfHousing || 'Benefit not given',
                housingBenefit: housingBenefit || 0,
                otherBenefits: otherBenefits || 0,
                otherPension: otherPension || 0,
                postRetMedical: postRetMedical || 0,
                mortgageInterest: mortgageInterest || 0,
                insuranceRelief: insuranceRelief || 0,
                payStructure: payStructure || 'fixed',
                bonusPay: bonusPay || 0,
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

        const { payrollNumber, employeeName, idNumber, kraPin, nssfNo, shaNo, phone, email, bankName, bankAccount, bankCode, department, jobTitle, employmentType, employmentStatus, dateJoined, dateLeft, basicPay, role, departmentId, standardCheckOut, standardCheckIn, identityType, residentialStatus, typeOfEmployee, pwd, exemptionCert, carBenefit, mealsBenefit, nonCashBenefits, typeOfHousing, housingBenefit, otherBenefits, otherPension, postRetMedical, mortgageInterest, insuranceRelief, payStructure, bonusPay } = req.body;

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
                standardCheckOut: standardCheckOut !== undefined ? (standardCheckOut || '17:00') : existing.standardCheckOut,
                standardCheckIn: standardCheckIn !== undefined ? (standardCheckIn || '08:00') : existing.standardCheckIn,
                identityType: identityType !== undefined ? identityType : existing.identityType,
                residentialStatus: residentialStatus !== undefined ? residentialStatus : existing.residentialStatus,
                typeOfEmployee: typeOfEmployee !== undefined ? typeOfEmployee : existing.typeOfEmployee,
                pwd: pwd !== undefined ? pwd : existing.pwd,
                exemptionCert: exemptionCert !== undefined ? exemptionCert : existing.exemptionCert,
                carBenefit: carBenefit !== undefined ? carBenefit : existing.carBenefit,
                mealsBenefit: mealsBenefit !== undefined ? mealsBenefit : existing.mealsBenefit,
                nonCashBenefits: nonCashBenefits !== undefined ? nonCashBenefits : existing.nonCashBenefits,
                typeOfHousing: typeOfHousing !== undefined ? typeOfHousing : existing.typeOfHousing,
                housingBenefit: housingBenefit !== undefined ? housingBenefit : existing.housingBenefit,
                otherBenefits: otherBenefits !== undefined ? otherBenefits : existing.otherBenefits,
                otherPension: otherPension !== undefined ? otherPension : existing.otherPension,
                postRetMedical: postRetMedical !== undefined ? postRetMedical : existing.postRetMedical,
                mortgageInterest: mortgageInterest !== undefined ? mortgageInterest : existing.mortgageInterest,
                insuranceRelief: insuranceRelief !== undefined ? insuranceRelief : existing.insuranceRelief,
                payStructure: payStructure !== undefined ? payStructure : existing.payStructure,
                bonusPay: bonusPay !== undefined ? bonusPay : existing.bonusPay,
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
                    standardCheckOut: '17:00',
                    standardCheckIn: '08:00',
                    identityType: 'National ID',
                    residentialStatus: 'Resident',
                    typeOfEmployee: 'Primary Employee',
                    pwd: 'No',
                    exemptionCert: '',
                    carBenefit: 0,
                    mealsBenefit: 0,
                    nonCashBenefits: 0,
                    typeOfHousing: 'Benefit not given',
                    housingBenefit: 0,
                    otherBenefits: 0,
                    otherPension: 0,
                    postRetMedical: 0,
                    mortgageInterest: 0,
                    insuranceRelief: 0,
                    payStructure: 'fixed',
                    bonusPay: 0,
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

        // ── Logo ──
        if (client?.logoUrl) {
            try {
                const logoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', client.logoUrl.replace(/^\//, ''));
                if (fs.existsSync(logoPath)) {
                    doc.image(logoPath, leftMargin, y, { width: 70 });
                    y += 80;
                } else {
                    console.warn('Payslip logo not found at:', logoPath);
                }
            } catch (e: any) {
                console.warn('Payslip logo error:', e.message);
            }
        }

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

function generateP9WithPdfKit(res: any, data: any) {
    const {
        companyName, companyPin, client, employeeName, kraPin, idNo, nssfNo, shaNo, payrollNo,
        department, jobTitle, employmentType, grossPay, totalCashPay, carBenefit, meals, nonCash,
        housingBenefit, otherBenefits, shaDed, nssfDed, otherPension, postRetMedical, mortgage,
        ahl, taxablePay, personalRelief, insuranceRelief, payeTax, taxYear, periodLabel,
    } = data;

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="P9_${employeeName.replace(/\s+/g, '_')}_${taxYear}.pdf"`);
    doc.pipe(res);

    const pageWidth = doc.page.width - 80;
    const leftMargin = 40;
    let y = leftMargin;

    if (client?.logoUrl) {
        try {
            const logoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', client.logoUrl.replace(/^\//, ''));
            doc.image(logoPath, leftMargin, y, { fit: [80, 60], align: 'center' });
            y += 70;
        } catch { /* ignore */ }
    }

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#000');
    doc.text('P9 - ANNUAL TAX DEDUCTION CARD', leftMargin, y, { align: 'center', width: pageWidth });
    y += 6;
    doc.fontSize(8).font('Helvetica').fillColor('#666');
    doc.text(`Tax Year: ${taxYear}  |  Period: ${periodLabel}`, leftMargin, y, { align: 'center', width: pageWidth });
    y += 24;

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

    empDetails.forEach((row: any) => {
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

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000');
    doc.text('SECTION C: MONTHLY EARNINGS & DEDUCTIONS', leftMargin, y);
    y += 16;

    const colX = [leftMargin, leftMargin + 55, leftMargin + 125, leftMargin + 195, leftMargin + 260, leftMargin + 325, leftMargin + 395];
    const colW = colX.map((_: any, i: number) => i < colX.length - 1 ? colX[i + 1] - colX[i] - 2 : 100);
    const headers = ['Month', 'Cash Pay', 'Benefits', 'Gross Pay', 'NSSF', 'PAYE', 'Net Pay'];

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#fff');
    doc.rect(leftMargin, y, pageWidth, 14).fill('#1e293b');
    headers.forEach((h: string, i: number) => {
        doc.text(h, colX[i] + 2, y + 3, { width: colW[i], align: i === 0 ? 'left' : 'right' });
    });
    y += 16;

    const netPay = grossPay - shaDed - nssfDed - ahl - payeTax - otherPension - postRetMedical;
    const benefits = carBenefit + meals + nonCash + housingBenefit + otherBenefits;

    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    let rowY = y;
    monthLabels.forEach((ml: string, mi: number) => {
        const isCurrent = ml === periodLabel.split('/')[0];
        if (mi % 2 === 0) {
            doc.rect(leftMargin, rowY, pageWidth, 13).fill('#f8f8f8');
        }
        doc.fontSize(7).font('Helvetica').fillColor('#333');
        doc.text(ml, colX[0] + 2, rowY + 3, { width: colW[0] });

        if (isCurrent) {
            [totalCashPay, benefits, grossPay, nssfDed, payeTax, netPay].forEach((val: any, vi: number) => {
                doc.fontSize(7).font('Helvetica').fillColor('#333');
                doc.text(formatMoney(typeof val === 'number' ? val : 0), colX[vi + 1] + 2, rowY + 3, { width: colW[vi + 1], align: 'right' });
            });
        } else {
            for (let vi = 1; vi < headers.length; vi++) {
                doc.fontSize(7).font('Helvetica').fillColor('#ccc');
                doc.text('0.00', colX[vi] + 2, rowY + 3, { width: colW[vi], align: 'right' });
            }
        }
        rowY += 13;
    });

    y = rowY + 4;
    doc.rect(leftMargin, y, pageWidth, 16).fill('#1e293b');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff');
    doc.text('ANNUAL TOTALS', colX[0] + 2, y + 4, { width: colW[0] });
    [totalCashPay, benefits, grossPay, nssfDed, payeTax, netPay].forEach((val: any, vi: number) => {
        doc.text(formatMoney(val), colX[vi + 1] + 2, y + 4, { width: colW[vi + 1], align: 'right' });
    });
    y += 24;

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
    summaryItems.forEach(([label, amount]: any, i: number) => {
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
}

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

        // Generate P9 PDF using template
        const templatePath = path.resolve(__dirname, '..', '..', '..', 'P9-FORM-Template-2025.pdf');
        const templateBytes = fs.readFileSync(templatePath);
        const pdfDoc = await PDFLibDocument.load(templateBytes);
        const pages = pdfDoc.getPages();
        const page = pages[0];
        const { width, height } = page.getSize();

        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const black = rgb(0, 0, 0);
        const darkGray = rgb(0.2, 0.2, 0.2);

        const drawText = (text: string, x: number, y: number, opts?: { size?: number; bold?: boolean; color?: any; align?: 'left' | 'right' }) => {
            const f = opts?.bold ? fontBold : font;
            const s = opts?.size || 8;
            const c = opts?.color || black;
            const txt = String(text ?? '');
            if (opts?.align === 'right') {
                const tw = f.widthOfTextAtSize(txt, s);
                page.drawText(txt, { x: x - tw, y, size: s, font: f, color: c });
            } else {
                page.drawText(txt, { x, y, size: s, font: f, color: c });
            }
        };

        const fmt = (n: number) => (typeof n === 'number' ? n.toFixed(2) : '0.00');
        const z = (v: any) => (v === undefined || v === null || v === '' || Number(v) === 0 ? '0.00' : fmt(Number(v)));

        // ── Overlay Logo ──
        if (client?.logoUrl) {
            try {
                const logoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', client.logoUrl.replace(/^\//, ''));
                const logoBytes = fs.readFileSync(logoPath);
                const ext = path.extname(logoPath).toLowerCase();
                let logoImg;
                if (ext === '.png') logoImg = await pdfDoc.embedPng(logoBytes);
                else if (ext === '.jpg' || ext === '.jpeg') logoImg = await pdfDoc.embedJpg(logoBytes);
                else logoImg = await pdfDoc.embedPng(logoBytes);
                page.drawImage(logoImg, { x: 40, y: height - 90, width: 80, height: 60 });
            } catch { /* ignore missing logo */ }
        }

        // ── Header Info ──
        drawText(`Tax Year: ${taxYear}  |  Period: ${periodLabel}`, width / 2 - 80, height - 30, { size: 8, color: darkGray });

        // ── Section A: Employer (approximate positions for standard KRA P9) ──
        drawText(companyName, 160, height - 140, { bold: true });
        drawText(companyPin, 160, height - 155, { bold: true });
        drawText(client.sector || '-', 160, height - 170);

        // ── Section B: Employee ──
        drawText(employeeName, 160, height - 205, { bold: true });
        drawText(kraPin, 420, height - 205, { bold: true });
        drawText(idNo, 160, height - 220, { bold: true });
        drawText(nssfNo, 420, height - 220, { bold: true });
        drawText(shaNo, 160, height - 235, { bold: true });
        drawText(payrollNo, 420, height - 235, { bold: true });
        drawText(department, 160, height - 250);
        drawText(jobTitle, 420, height - 250);
        drawText(employmentType, 160, height - 265);

        // ── Section C: Monthly Table ──
        const netPay = grossPay - shaDed - nssfDed - ahl - payeTax - otherPension - postRetMedical;
        const benefits = carBenefit + meals + nonCash + housingBenefit + otherBenefits;
        const monthLabel = periodLabel;
        const monthNum = period ? parseInt(period.substring(0, 2)) : new Date().getMonth() + 1;
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // Approximate row positions for monthly table (starting around y=420 on standard P9)
        const tableStartY = height - 380;
        const rowHeight = 18;
        const colPositions = [45, 130, 210, 290, 370, 450, 530];

        for (let mi = 0; mi < 12; mi++) {
            const rowY = tableStartY - (mi * rowHeight);
            const isCurrent = mi + 1 === monthNum;

            // Month label
            drawText(monthNames[mi], colPositions[0], rowY);

            if (isCurrent) {
                drawText(z(totalCashPay), colPositions[1], rowY, { align: 'right' });
                drawText(z(benefits), colPositions[2], rowY, { align: 'right' });
                drawText(z(grossPay), colPositions[3], rowY, { align: 'right' });
                drawText(z(nssfDed), colPositions[4], rowY, { align: 'right' });
                drawText(z(payeTax), colPositions[5], rowY, { align: 'right' });
                drawText(z(netPay), colPositions[6], rowY, { align: 'right' });
            } else {
                // Fill zero for non-current months as requested
                for (let ci = 1; ci < colPositions.length; ci++) {
                    drawText('0.00', colPositions[ci], rowY, { align: 'right', color: rgb(0.7, 0.7, 0.7) });
                }
            }
        }

        // Annual totals row
        const totalY = tableStartY - (12 * rowHeight);
        drawText('TOTALS', colPositions[0], totalY, { bold: true });
        drawText(z(totalCashPay), colPositions[1], totalY, { align: 'right', bold: true });
        drawText(z(benefits), colPositions[2], totalY, { align: 'right', bold: true });
        drawText(z(grossPay), colPositions[3], totalY, { align: 'right', bold: true });
        drawText(z(nssfDed), colPositions[4], totalY, { align: 'right', bold: true });
        drawText(z(payeTax), colPositions[5], totalY, { align: 'right', bold: true });
        drawText(z(netPay), colPositions[6], totalY, { align: 'right', bold: true });

        // ── Section D: Summary fields (approximate positions) ──
        const summaryY = height - 650;
        const summaryCol2 = 480;
        drawText(z(totalCashPay), summaryCol2, summaryY, { align: 'right' });
        drawText(z(benefits), summaryCol2, summaryY - 16, { align: 'right' });
        drawText(z(grossPay), summaryCol2, summaryY - 32, { align: 'right' });
        drawText(z(nssfDed), summaryCol2, summaryY - 48, { align: 'right' });
        drawText(z(shaDed), summaryCol2, summaryY - 64, { align: 'right' });
        drawText(z(ahl), summaryCol2, summaryY - 80, { align: 'right' });
        drawText(z(payeTax), summaryCol2, summaryY - 96, { align: 'right' });
        drawText(z(personalRelief), summaryCol2, summaryY - 112, { align: 'right' });
        drawText(z(insuranceRelief), summaryCol2, summaryY - 128, { align: 'right' });
        drawText(z(netPay), summaryCol2, summaryY - 148, { align: 'right', bold: true });

        let useFallback = false;
        try {
            const pdfBytes = await pdfDoc.save();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="P9_${employeeName.replace(/\s+/g, '_')}_${taxYear}.pdf"`);
            res.send(Buffer.from(pdfBytes));
        } catch (pdfLibErr) {
            console.error('pdf-lib P9 generation failed, falling back to PDFKit:', pdfLibErr);
            useFallback = true;
        }

        if (useFallback) {
            generateP9WithPdfKit(res, {
                companyName, companyPin, client, employeeName, kraPin, idNo, nssfNo, shaNo, payrollNo,
                department, jobTitle, employmentType, grossPay, totalCashPay, carBenefit, meals, nonCash,
                housingBenefit, otherBenefits, shaDed, nssfDed, otherPension, postRetMedical, mortgage,
                ahl, taxablePay, personalRelief, insuranceRelief, payeTax, taxYear, periodLabel,
            });
        }
    } catch (err) {
        console.error('Error generating P9:', err);
        res.status(500).json({ message: 'Failed to generate P9 PDF' });
    }
});

// POST /api/clients/:clientId/employees/sync-by-pin — upsert by KRA PIN
router.post('/:clientId/employees/sync-by-pin', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { kraPin } = req.body;
        if (!kraPin) return res.status(400).json({ message: 'kraPin is required' });

        const existing = await db
            .selectFrom('employees')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('kraPin', '=', kraPin)
            .executeTakeFirst();

        const now = new Date().toISOString();
        const fields = { ...req.body, clientId, updatedAt: now } as any;

        if (existing) {
            await db.updateTable('employees').set(fields).where('id', '=', existing.id).execute();
            res.json({ synced: true, id: existing.id, action: 'updated' });
        } else {
            const result = await db.insertInto('employees').values({ ...fields, createdAt: now } as any).executeTakeFirst();
            res.status(201).json({ synced: true, id: Number(result.insertId || 0), action: 'created' });
        }
    } catch (err) {
        console.error('Error syncing employee:', err);
        res.status(500).json({ message: 'Failed to sync employee' });
    }
});

export default router;
