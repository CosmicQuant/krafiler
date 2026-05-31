import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { logAudit } from '../services/auditService';
import { verifyAuth, AuthenticatedRequest } from '../middleware/verifyAuth';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

const router = Router();

const EMPLOYEES_COLLECTION = 'employees';
const PAYROLL_RUNS_COLLECTION = 'payrollRuns';
const PAYROLL_ENTRIES_COLLECTION = 'payrollEntries';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMoney(n: number): string {
    return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Employees CRUD ──────────────────────────────────────────────────────────

// GET /api/clients/:clientId/employees
router.get('/:clientId/employees', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;

        const snapshot = await adminDb
            .collection(EMPLOYEES_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .orderBy('employeeName', 'asc')
            .get();

        const employees = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        res.json(employees);
    } catch (err) {
        console.error('Error fetching employees from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/employees
router.post('/:clientId/employees', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;

        const {
            payrollNumber, employeeName, idNumber, kraPin, nssfNo, shaNo, phone, email,
            bankName, bankAccount, bankCode, department, departmentId, jobTitle,
            employmentType, employmentStatus, dateJoined, dateLeft, basicPay, role,
            standardCheckOut, standardCheckIn, identityType, residentialStatus,
            typeOfEmployee, pwd, exemptionCert, carBenefit, mealsBenefit, nonCashBenefits,
            typeOfHousing, housingBenefit, otherBenefits, otherPension, postRetMedical,
            mortgageInterest, insuranceRelief, payStructure, bonusPay, workScheduleId,
            offDay, hourlyRate,
        } = req.body;

        const now = Timestamp.now();
        const newEmployee: any = {
            ownerUid: uid,
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
        };

        const docRef = await adminDb.collection(EMPLOYEES_COLLECTION).add(newEmployee);
        const employee = { id: docRef.id, ...newEmployee };

        logAudit({
            clientId: clientId as any,
            action: 'CREATE',
            entityType: 'employee',
            entityId: docRef.id as any,
            newValues: employee,
            performedBy: 'admin',
        } as any);

        res.status(201).json(employee);
    } catch (err) {
        console.error('Error creating employee in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/employees/:id
router.put('/:clientId/employees/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;

        const docRef = adminDb.collection(EMPLOYEES_COLLECTION).doc(id);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        const existing = doc.data()!;
        const {
            payrollNumber, employeeName, idNumber, kraPin, nssfNo, shaNo, phone, email,
            bankName, bankAccount, bankCode, department, jobTitle, employmentType,
            employmentStatus, dateJoined, dateLeft, basicPay, role, departmentId,
            standardCheckOut, standardCheckIn, identityType, residentialStatus,
            typeOfEmployee, pwd, exemptionCert, carBenefit, mealsBenefit, nonCashBenefits,
            typeOfHousing, housingBenefit, otherBenefits, otherPension, postRetMedical,
            mortgageInterest, insuranceRelief, payStructure, bonusPay, workScheduleId,
            offDay, hourlyRate,
        } = req.body;

        const updateData: any = { updatedAt: Timestamp.now() };

        if (payrollNumber !== undefined) updateData.payrollNumber = payrollNumber;
        if (employeeName !== undefined) updateData.employeeName = employeeName;
        if (idNumber !== undefined) updateData.idNumber = idNumber;
        if (kraPin !== undefined) updateData.kraPin = kraPin;
        if (nssfNo !== undefined) updateData.nssfNo = nssfNo;
        if (shaNo !== undefined) updateData.shaNo = shaNo;
        if (phone !== undefined) updateData.phone = phone;
        if (email !== undefined) updateData.email = email;
        if (bankName !== undefined) updateData.bankName = bankName;
        if (bankAccount !== undefined) updateData.bankAccount = bankAccount;
        if (bankCode !== undefined) updateData.bankCode = bankCode;
        if (department !== undefined) updateData.department = department;
        if (departmentId !== undefined) updateData.departmentId = departmentId;
        if (jobTitle !== undefined) updateData.jobTitle = jobTitle;
        if (employmentType !== undefined) updateData.employmentType = employmentType;
        if (employmentStatus !== undefined) updateData.employmentStatus = employmentStatus;
        if (dateJoined !== undefined) updateData.dateJoined = dateJoined;
        if (dateLeft !== undefined) updateData.dateLeft = dateLeft || null;
        if (basicPay !== undefined) updateData.basicPay = basicPay;
        if (role !== undefined) updateData.role = role;
        if (standardCheckOut !== undefined) updateData.standardCheckOut = standardCheckOut || '17:00';
        if (standardCheckIn !== undefined) updateData.standardCheckIn = standardCheckIn || '08:00';
        if (identityType !== undefined) updateData.identityType = identityType;
        if (residentialStatus !== undefined) updateData.residentialStatus = residentialStatus;
        if (typeOfEmployee !== undefined) updateData.typeOfEmployee = typeOfEmployee;
        if (pwd !== undefined) updateData.pwd = pwd;
        if (exemptionCert !== undefined) updateData.exemptionCert = exemptionCert;
        if (carBenefit !== undefined) updateData.carBenefit = carBenefit;
        if (mealsBenefit !== undefined) updateData.mealsBenefit = mealsBenefit;
        if (nonCashBenefits !== undefined) updateData.nonCashBenefits = nonCashBenefits;
        if (typeOfHousing !== undefined) updateData.typeOfHousing = typeOfHousing;
        if (housingBenefit !== undefined) updateData.housingBenefit = housingBenefit;
        if (otherBenefits !== undefined) updateData.otherBenefits = otherBenefits;
        if (otherPension !== undefined) updateData.otherPension = otherPension;
        if (postRetMedical !== undefined) updateData.postRetMedical = postRetMedical;
        if (mortgageInterest !== undefined) updateData.mortgageInterest = mortgageInterest;
        if (insuranceRelief !== undefined) updateData.insuranceRelief = insuranceRelief;
        if (payStructure !== undefined) updateData.payStructure = payStructure;
        if (bonusPay !== undefined) updateData.bonusPay = bonusPay;
        if (workScheduleId !== undefined) updateData.workScheduleId = workScheduleId ? String(workScheduleId) : null;
        if (offDay !== undefined) updateData.offDay = offDay || null;
        if (hourlyRate !== undefined) updateData.hourlyRate = hourlyRate;

        await docRef.update(updateData);
        const updated = await docRef.get();
        const updatedData = { id: updated.id, ...updated.data() };

        logAudit({
            clientId: clientId as any,
            employeeId: id as any,
            action: 'UPDATE',
            entityType: 'employee',
            entityId: id as any,
            oldValues: existing,
            newValues: updatedData,
            performedBy: 'admin',
        } as any);

        res.json(updatedData);
    } catch (err) {
        console.error('Error updating employee in Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/employees/:id
router.delete('/:clientId/employees/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;

        const docRef = adminDb.collection(EMPLOYEES_COLLECTION).doc(id);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        const existing = doc.data()!;
        await docRef.delete();

        logAudit({
            clientId: clientId as any,
            employeeId: id as any,
            action: 'DELETE',
            entityType: 'employee',
            entityId: id as any,
            oldValues: existing,
            performedBy: 'admin',
        } as any);

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting employee from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/employees/import — import from master CSV payroll data
router.post('/:clientId/employees/import', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;

        // Verify client ownership
        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        if (!clientDoc.exists || clientDoc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const clientData = clientDoc.data()!;

        // Fetch payroll data via internal API (routes through current database mode)
        const payrollRes = await fetch(`${req.protocol}://${req.get('host')}/api/clients/${clientId}/payroll-data`);
        const payrollData = await payrollRes.json();

        if (!payrollData.hasData || !payrollData.employees?.length) {
            return res.status(400).json({ message: 'No payroll data found for this client. Upload a master CSV first.' });
        }

        let defaultSchedule: any = null;
        if (clientData.defaultWorkScheduleId) {
            const scheduleDoc = await adminDb.collection('workSchedules').doc(String(clientData.defaultWorkScheduleId)).get();
            if (scheduleDoc.exists) {
                defaultSchedule = scheduleDoc.data();
            }
        }

        let imported = 0;
        for (const emp of payrollData.employees) {
            const kraPin = String(emp['PIN of Employee'] ?? '');
            if (!kraPin) continue;

            // Check for duplicate
            const existingSnapshot = await adminDb
                .collection(EMPLOYEES_COLLECTION)
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .where('kraPin', '==', kraPin)
                .limit(1)
                .get();

            if (!existingSnapshot.empty) continue;

            const payrollNumber = String(emp['Payroll Number'] ?? '');
            const employeeName = String(emp['Name of Employee'] ?? '');
            const idNumber = String(emp['ID Number'] ?? '');
            const nssfNo = String(emp['NSSF No'] ?? '');
            const shaNo = String(emp['SHA No'] ?? '');
            const residentialStatus = String(emp['Residential Status'] ?? '');
            const typeOfEmployee = String(emp['Type of Employee'] ?? '');

            const now = Timestamp.now();
            await adminDb.collection(EMPLOYEES_COLLECTION).add({
                ownerUid: uid,
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
            });

            imported++;
        }

        const totalSnapshot = await adminDb
            .collection(EMPLOYEES_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();

        res.json({ imported, total: totalSnapshot.size });
    } catch (err) {
        console.error('Error importing employees to Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── Payslip Generation ──────────────────────────────────────────────────────

// GET /api/clients/:clientId/payslip/:employeeKraPin?period=MMYYYY
router.get('/:clientId/payslip/:employeeKraPin', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const employeeKraPin = req.params.employeeKraPin;

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        if (!clientDoc.exists || clientDoc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }
        const client = { id: clientDoc.id, ...clientDoc.data() };

        const period = (req.query.period as string) || '';
        const periodLabel = period ? `${period.substring(0, 2)}/${period.substring(2)}` : new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

        // Fetch payroll data via internal API
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

        const companyName = payrollData.preamble?.companyName || (client as any).name;
        const companyPin = payrollData.preamble?.companyPin || (client as any).pin;
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

        // Resolve logo (GCS or local)
        const { resolveLogoPath } = await import('../lib/cloudStorage');
        const logoLocalPath = await resolveLogoPath(client as any, uid);

        // Generate PDF
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Payslip_${employeeName.replace(/\s+/g, '_')}_${periodLabel.replace(/\//g, '_')}.pdf"`);
        doc.pipe(res);

        const pageWidth = doc.page.width - 80;
        const leftMargin = 40;
        let y = leftMargin;

        // ── Logo ──
        if (logoLocalPath) {
            try {
                doc.image(logoLocalPath, leftMargin, y, { width: 70 });
                y += 80;
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

// ─── P9 Generation (Annual Tax Deduction Card) ───────────────────────────────

interface P9MonthData {
    monthIndex: number;
    basicPay: number;
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    housingBenefit: number;
    grossPay: number;
    ahlDeduction: number;
    shaDeduction: number;
    nssfDeduction: number;
    totalDeductions: number;
    taxablePay: number;
    payeTax: number;
    otherPension: number;
    postRetMedical: number;
    mortgageInterest: number;
    insuranceRelief: number;
}

function computeMonthP9Values(m: P9MonthData): number[] {
    const a = m.basicPay || 0;
    const b = (m.carBenefit || 0) + (m.mealsBenefit || 0) + (m.nonCashBenefits || 0);
    const c = m.housingBenefit || 0;
    const d = m.grossPay || 0;
    const e1 = a * 0.30;
    const e2 = (m.nssfDeduction || 0) + (m.otherPension || 0);
    const e3 = Math.min(e1, e2);
    const f = m.ahlDeduction || 0;
    const g = m.shaDeduction || 0;
    const h = m.postRetMedical || 0;
    const i = m.mortgageInterest || 0;
    const j = m.totalDeductions || 0;
    const k = m.taxablePay || 0;
    const mRelief = 2400;
    const n = m.insuranceRelief || 0;
    const l = (m.payeTax || 0) + mRelief + n;
    const o = m.payeTax || 0;
    return [a, b, c, d, e1, e2, e3, f, g, h, i, j, k, l, mRelief, n, o];
}

function generateP9WithPdfKit(res: any, data: any) {
    const {
        companyName, companyPin, client, employeeName, kraPin, idNo, nssfNo, shaNo, payrollNo,
        department, jobTitle, employmentType, taxYear, monthlyData, logoPath: companyLogoPath,
    } = data;

    const doc = new PDFDocument({ margin: 25, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="P9_${employeeName.replace(/\s+/g, '_')}_${taxYear}.pdf"`);
    doc.pipe(res);

    const pageWidth = doc.page.width - 50;
    const leftMargin = 25;
    let y = leftMargin;

    // ── Logos Row (Company + KRA) ──
    if (companyLogoPath) {
        try {
            doc.image(companyLogoPath, leftMargin, y, { width: 50 });
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
router.get('/:clientId/p9/:employeeKraPin', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const employeeKraPin = req.params.employeeKraPin;

        const taxYear = (req.query.year as string) || new Date().getFullYear().toString();
        const yearPrefix = taxYear;

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        if (!clientDoc.exists || clientDoc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }
        const client = { id: clientDoc.id, ...clientDoc.data() };

        const employeeSnapshot = await adminDb
            .collection(EMPLOYEES_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('kraPin', '==', employeeKraPin)
            .limit(1)
            .get();

        if (employeeSnapshot.empty) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        const employeeRecord = { id: employeeSnapshot.docs[0].id, ...employeeSnapshot.docs[0].data() };

        // Fetch all payroll runs for this client in the tax year
        const runsSnapshot = await adminDb
            .collection(PAYROLL_RUNS_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('period', '>=', `${yearPrefix}-01`)
            .where('period', '<=', `${yearPrefix}-12`)
            .get();

        const runs = runsSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Build month-indexed data
        const monthlyData: P9MonthData[] = [];

        for (const run of runs) {
            const [, monthStr] = (run as any).period.split('-');
            const monthIndex = parseInt(monthStr, 10) - 1;
            if (monthIndex < 0 || monthIndex > 11) continue;

            const entriesSnapshot = await adminDb
                .collection(PAYROLL_ENTRIES_COLLECTION)
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .where('payrollRunId', '==', run.id)
                .where('employeeId', '==', employeeRecord.id)
                .limit(1)
                .get();

            if (entriesSnapshot.empty) continue;
            const entry = entriesSnapshot.docs[0].data() as any;

            const existing = monthlyData.find((m) => m.monthIndex === monthIndex);
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
                    otherPension: (employeeRecord as any).otherPension || 0,
                    postRetMedical: (employeeRecord as any).postRetMedical || 0,
                    mortgageInterest: (employeeRecord as any).mortgageInterest || 0,
                    insuranceRelief: (employeeRecord as any).insuranceRelief || 0,
                });
            }
        }

        const { resolveLogoPath } = await import('../lib/cloudStorage');
        const p9LogoPath = await resolveLogoPath(client as any, uid);

        generateP9WithPdfKit(res, {
            companyName: (client as any).name,
            companyPin: (client as any).pin,
            client,
            employeeName: (employeeRecord as any).employeeName,
            kraPin: (employeeRecord as any).kraPin,
            idNo: (employeeRecord as any).idNumber,
            nssfNo: (employeeRecord as any).nssfNo,
            shaNo: (employeeRecord as any).shaNo,
            payrollNo: (employeeRecord as any).payrollNumber,
            department: (employeeRecord as any).department || '',
            jobTitle: (employeeRecord as any).jobTitle || '',
            employmentType: (employeeRecord as any).employmentType || '',
            taxYear,
            monthlyData,
            logoPath: p9LogoPath,
        });
    } catch (err) {
        console.error('Error generating P9:', err);
        res.status(500).json({ message: 'Failed to generate P9 PDF' });
    }
});

// POST /api/clients/:clientId/employees/sync-by-pin — upsert by KRA PIN
router.post('/:clientId/employees/sync-by-pin', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { kraPin } = req.body;
        if (!kraPin) return res.status(400).json({ message: 'kraPin is required' });

        const snapshot = await adminDb
            .collection(EMPLOYEES_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('kraPin', '==', kraPin)
            .limit(1)
            .get();

        const now = Timestamp.now();
        const fields = { ...req.body, clientId, updatedAt: now } as any;

        if (!snapshot.empty) {
            const docRef = snapshot.docs[0].ref;
            await docRef.update(fields);
            const updated = await docRef.get();
            res.json({ synced: true, id: updated.id, action: 'updated' });
        } else {
            const docRef = await adminDb.collection(EMPLOYEES_COLLECTION).add({
                ...fields,
                ownerUid: uid,
                createdAt: now,
            });
            res.status(201).json({ synced: true, id: docRef.id, action: 'created' });
        }
    } catch (err) {
        console.error('Error syncing employee in Firestore:', err);
        res.status(500).json({ message: 'Failed to sync employee' });
    }
});

export default router;
