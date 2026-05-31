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

        const { payrollNumber, employeeName, idNumber, kraPin, nssfNo, shaNo, phone, email, bankName, bankAccount, bankCode, department, departmentId, jobTitle, employmentType, employmentStatus, dateJoined, dateLeft, basicPay, role, standardCheckOut, standardCheckIn, identityType, residentialStatus, typeOfEmployee, pwd, exemptionCert, carBenefit, mealsBenefit, nonCashBenefits, typeOfHousing, housingBenefit, otherBenefits, otherPension, postRetMedical, mortgageInterest, insuranceRelief, payStructure, bonusPay, workScheduleId, offDay, hourlyRate } = req.body;

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
                hourlyRate: hourlyRate ?? 0,
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

        const { payrollNumber, employeeName, idNumber, kraPin, nssfNo, shaNo, phone, email, bankName, bankAccount, bankCode, department, jobTitle, employmentType, employmentStatus, dateJoined, dateLeft, basicPay, role, departmentId, standardCheckOut, standardCheckIn, identityType, residentialStatus, typeOfEmployee, pwd, exemptionCert, carBenefit, mealsBenefit, nonCashBenefits, typeOfHousing, housingBenefit, otherBenefits, otherPension, postRetMedical, mortgageInterest, insuranceRelief, payStructure, bonusPay, workScheduleId, offDay, hourlyRate } = req.body;

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
                hourlyRate: hourlyRate !== undefined ? hourlyRate : existing.hourlyRate,
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

        // Fetch default work schedule for this client, if set
        let defaultSchedule: { id: number; standardCheckIn: string; standardCheckOut: string } | null = null;
        if (client.defaultWorkScheduleId) {
            defaultSchedule = await db
                .selectFrom('work_schedules')
                .select(['id', 'standardCheckIn', 'standardCheckOut'])
                .where('id', '=', client.defaultWorkScheduleId)
                .where('clientId', '=', clientId)
                .executeTakeFirst() || null;
        }

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
                    standardCheckOut: defaultSchedule?.standardCheckOut || '17:00',
                    standardCheckIn: defaultSchedule?.standardCheckIn || '08:00',
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
                    workScheduleId: defaultSchedule?.id || null,
                    hourlyRate: 0,
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

interface P9MonthData {
    monthIndex: number; // 0-11
    // These map directly from payroll_entries (source of truth)
    basicPay: number; // A
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    housingBenefit: number; // C
    grossPay: number; // D
    ahlDeduction: number; // F
    shaDeduction: number; // G
    nssfDeduction: number;
    totalDeductions: number; // J
    taxablePay: number; // K
    payeTax: number; // O
    // These come from employee record (static per employee)
    otherPension: number; // used in E2
    postRetMedical: number; // H
    mortgageInterest: number; // I
    insuranceRelief: number; // N
}

function computeMonthP9Values(m: P9MonthData): number[] {
    // A — Basic Salary (direct from payroll entry, already computed by engine)
    const a = m.basicPay || 0;
    // B — Benefits-NonCash (sum of stored individual benefits)
    const b = (m.carBenefit || 0) + (m.mealsBenefit || 0) + (m.nonCashBenefits || 0);
    // C — Value of Quarters (direct)
    const c = m.housingBenefit || 0;
    // D — Total Gross Pay (direct from entry)
    const d = m.grossPay || 0;
    // E1, E2, E3 — Pension contribution limits (only derived values)
    const e1 = a * 0.30;
    const e2 = (m.nssfDeduction || 0) + (m.otherPension || 0);
    const e3 = Math.min(e1, e2);
    // F — AHL (direct)
    const f = m.ahlDeduction || 0;
    // G — SHIF (direct)
    const g = m.shaDeduction || 0;
    // H — PRMF / Post-Retirement Medical (from employee record)
    const h = m.postRetMedical || 0;
    // I — Owner-Occupied / Mortgage Interest (from employee record)
    const i = m.mortgageInterest || 0;
    // J — Total Deductions (direct from entry, already computed by engine)
    const j = m.totalDeductions || 0;
    // K — Chargeable Pay (direct from entry)
    const k = m.taxablePay || 0;
    // M — Personal Relief (fixed statutory)
    const mRelief = 2400;
    // N — Insurance Relief (from employee record)
    const n = m.insuranceRelief || 0;
    // L — Tax Charged (derived: PAYE + relief + insurance relief)
    const l = (m.payeTax || 0) + mRelief + n;
    // O — PAYE Tax (direct from entry)
    const o = m.payeTax || 0;
    return [a, b, c, d, e1, e2, e3, f, g, h, i, j, k, l, mRelief, n, o];
}

function generateP9WithPdfKit(res: any, data: any) {
    const {
        companyName, companyPin, client, employeeName, kraPin, idNo, nssfNo, shaNo, payrollNo,
        department, jobTitle, employmentType, taxYear, monthlyData,
    } = data;

    const doc = new PDFDocument({ margin: 25, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="P9_${employeeName.replace(/\s+/g, '_')}_${taxYear}.pdf"`);
    doc.pipe(res);

    const pageWidth = doc.page.width - 50;
    const leftMargin = 25;
    let y = leftMargin;

    // ── Logos Row (Company + KRA) ──
    if (client?.logoUrl) {
        try {
            const companyLogoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', client.logoUrl.replace(/^\//, ''));
            if (fs.existsSync(companyLogoPath)) {
                doc.image(companyLogoPath, leftMargin, y, { width: 50 });
            }
        } catch { /* ignore */ }
    }
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

    const monthLabels = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    // Build month map from monthlyData
    const monthMap = new Map<number, number[]>();
    const annualTotals = new Array(17).fill(0);

    for (const m of monthlyData) {
        const vals = computeMonthP9Values(m);
        monthMap.set(m.monthIndex, vals);
        vals.forEach((v, i) => { annualTotals[i] += v; });
    }

    let rowY = y;
    monthLabels.forEach((ml: string, mi: number) => {
        const vals = monthMap.get(mi);
        const bg = mi % 2 === 0 ? '#f8fafc' : '#ffffff';
        doc.rect(leftMargin, rowY, pageWidth, 12).fill(bg);

        doc.fontSize(4.5).font('Helvetica-Bold').fillColor('#000');
        doc.text(ml, colXs[0] + 2, rowY + 2, { width: colWidth - 2 });

        if (vals) {
            doc.fontSize(4.5).font('Helvetica').fillColor('#000');
            vals.forEach((val, vi) => {
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
    annualTotals.forEach((val, vi) => {
        doc.text(formatMoney(val), colXs[vi + 1] + 1, rowY + 2, { width: colWidth - 2, align: 'right' });
    });
    rowY += 16;

    // ── Bottom Section ──
    const annualTaxablePay = annualTotals[12]; // K
    const annualPayeTax = annualTotals[16]; // O

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#000');
    doc.text('TOTAL CHARGEABLE PAY (COL. K) Kshs.', leftMargin, rowY);
    doc.text(formatMoney(annualTaxablePay), leftMargin + 180, rowY, { width: 100, align: 'right' });
    rowY += 14;
    doc.text('TOTAL TAX (C ........................................................................)', leftMargin, rowY);
    doc.text(formatMoney(annualPayeTax), leftMargin + 180, rowY, { width: 100, align: 'right' });
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

// GET /api/clients/:clientId/p9/:employeeKraPin?year=YYYY
router.get('/:clientId/p9/:employeeKraPin', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const employeeKraPin = req.params.employeeKraPin;
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const taxYear = (req.query.year as string) || new Date().getFullYear().toString();
        const yearPrefix = taxYear;

        const client = await db.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();
        if (!client) return res.status(404).json({ message: 'Client not found' });

        const employeeRecord = await db
            .selectFrom('employees')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('kraPin', '=', employeeKraPin)
            .executeTakeFirst();

        if (!employeeRecord) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        // Fetch all payroll runs for this client in the tax year
        const runs = await db
            .selectFrom('payroll_runs')
            .select(['id', 'period'])
            .where('clientId', '=', clientId)
            .where('period', 'like', `${yearPrefix}-%`)
            .execute();

        // Build month-indexed data
        const monthlyData: P9MonthData[] = [];

        for (const run of runs) {
            const [, monthStr] = run.period.split('-');
            const monthIndex = parseInt(monthStr, 10) - 1; // 0-based
            if (monthIndex < 0 || monthIndex > 11) continue;

            const entry = await db
                .selectFrom('payroll_entries')
                .selectAll()
                .where('payrollRunId', '=', run.id)
                .where('clientId', '=', clientId)
                .where('employeeId', '=', employeeRecord.id)
                .executeTakeFirst();

            if (!entry) continue;

            // Use existing month data if already set (shouldn't happen, but just in case)
            const existing = monthlyData.find(m => m.monthIndex === monthIndex);
            if (existing) {
                existing.basicPay += entry.basicPay || 0;
                existing.grossPay += entry.grossPay || 0;
                existing.payeTax += entry.payeTax || 0;
                existing.taxablePay += entry.taxablePay || 0;
                existing.nssfDeduction += entry.nssfDeduction || 0;
                existing.shaDeduction += entry.shaDeduction || 0;
                existing.ahlDeduction += entry.ahlDeduction || 0;
                existing.totalDeductions += entry.totalDeductions || 0;
                existing.carBenefit += entry.carBenefit || 0;
                existing.mealsBenefit += entry.mealsBenefit || 0;
                existing.nonCashBenefits += entry.nonCashBenefits || 0;
                existing.housingBenefit += entry.housingBenefit || 0;
            } else {
                monthlyData.push({
                    monthIndex,
                    basicPay: entry.basicPay || 0,
                    carBenefit: entry.carBenefit || 0,
                    mealsBenefit: entry.mealsBenefit || 0,
                    nonCashBenefits: entry.nonCashBenefits || 0,
                    housingBenefit: entry.housingBenefit || 0,
                    grossPay: entry.grossPay || 0,
                    ahlDeduction: entry.ahlDeduction || 0,
                    shaDeduction: entry.shaDeduction || 0,
                    nssfDeduction: entry.nssfDeduction || 0,
                    totalDeductions: entry.totalDeductions || 0,
                    taxablePay: entry.taxablePay || 0,
                    payeTax: entry.payeTax || 0,
                    otherPension: employeeRecord.otherPension || 0,
                    postRetMedical: employeeRecord.postRetMedical || 0,
                    mortgageInterest: employeeRecord.mortgageInterest || 0,
                    insuranceRelief: employeeRecord.insuranceRelief || 0,
                });
            }
        }

        generateP9WithPdfKit(res, {
            companyName: client.name,
            companyPin: client.pin,
            client,
            employeeName: employeeRecord.employeeName,
            kraPin: employeeRecord.kraPin,
            idNo: employeeRecord.idNumber,
            nssfNo: employeeRecord.nssfNo,
            shaNo: employeeRecord.shaNo,
            payrollNo: employeeRecord.payrollNumber,
            department: employeeRecord.department || '',
            jobTitle: employeeRecord.jobTitle || '',
            employmentType: employeeRecord.employmentType || '',
            taxYear,
            monthlyData,
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
