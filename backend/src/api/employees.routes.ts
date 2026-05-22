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

        const { payrollNumber, employeeName, idNumber, kraPin, nssfNo, shaNo, phone, email, bankName, bankAccount, bankCode, department, departmentId, jobTitle, employmentType, employmentStatus, dateJoined, dateLeft, basicPay, role, standardCheckOut, standardCheckIn, identityType, residentialStatus, typeOfEmployee, pwd, exemptionCert, carBenefit, mealsBenefit, nonCashBenefits, typeOfHousing, housingBenefit, otherBenefits, otherPension, postRetMedical, mortgageInterest, insuranceRelief, payStructure, bonusPay, workScheduleId, offDay } = req.body;

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
                workScheduleId: workScheduleId || null,
                offDay: offDay || null,
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

        const { payrollNumber, employeeName, idNumber, kraPin, nssfNo, shaNo, phone, email, bankName, bankAccount, bankCode, department, jobTitle, employmentType, employmentStatus, dateJoined, dateLeft, basicPay, role, departmentId, standardCheckOut, standardCheckIn, identityType, residentialStatus, typeOfEmployee, pwd, exemptionCert, carBenefit, mealsBenefit, nonCashBenefits, typeOfHousing, housingBenefit, otherBenefits, otherPension, postRetMedical, mortgageInterest, insuranceRelief, payStructure, bonusPay, workScheduleId, offDay } = req.body;

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
                workScheduleId: workScheduleId !== undefined ? (workScheduleId ? parseInt(workScheduleId, 10) : null) : existing.workScheduleId,
                offDay: offDay !== undefined ? (offDay || null) : existing.offDay,
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
        ahl, taxablePay, personalRelief, insuranceRelief, payeTax, taxYear, periodLabel, monthNum,
    } = data;

    const doc = new PDFDocument({ margin: 25, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="P9_${employeeName.replace(/\s+/g, '_')}_${taxYear}.pdf"`);
    doc.pipe(res);

    const pageWidth = doc.page.width - 50;
    const leftMargin = 25;
    let y = leftMargin;

    // ── Logos Row (Company + KRA) ──
    // Company logo on the left
    if (client?.logoUrl) {
        try {
            const companyLogoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', client.logoUrl.replace(/^\//, ''));
            if (fs.existsSync(companyLogoPath)) {
                doc.image(companyLogoPath, leftMargin, y, { width: 50 });
            }
        } catch { /* ignore */ }
    }
    // KRA logo on the right
    try {
        const kraLogoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'logos', 'kra.png');
        if (fs.existsSync(kraLogoPath)) {
            doc.image(kraLogoPath, leftMargin + pageWidth - 60, y, { width: 55 });
        }
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
    doc.text(companyName, leftMargin + 90, y, { width: 200 });
    doc.text("Employer's PIN", leftMargin + 320, y);
    doc.text(companyPin, leftMargin + 390, y, { width: 120 });
    y += 11;
    doc.text("Employee's Main Name", leftMargin, y);
    doc.text(employeeName, leftMargin + 90, y, { width: 200 });
    doc.text("Employee's PIN", leftMargin + 320, y);
    doc.text(kraPin, leftMargin + 390, y, { width: 120 });
    y += 11;
    doc.text("Employee's Other Names", leftMargin, y);
    y += 14;

    // ── Monthly Table (KRA P9) ──
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
        if (i >= 5 && i <= 7) {
            // E1, E2, E3 are intermediate - no Kshs label
        } else {
            doc.text('Kshs.', colXs[i] + 1, y + 1, { width: colWidth - 2, align: 'center' });
        }
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

        const netPay = grossPay - shaDed - nssfDed - ahl - payeTax - otherPension - postRetMedical;
        const monthNum = period ? parseInt(period.substring(0, 2)) : new Date().getMonth() + 1;
        generateP9WithPdfKit(res, {
            companyName, companyPin, client, employeeName, kraPin, idNo, nssfNo, shaNo, payrollNo,
            department, jobTitle, employmentType, grossPay, totalCashPay, carBenefit, meals, nonCash,
            housingBenefit, otherBenefits, shaDed, nssfDed, otherPension, postRetMedical, mortgage,
            ahl, taxablePay, personalRelief, insuranceRelief, payeTax, taxYear, periodLabel, netPay, monthNum,
        });
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
