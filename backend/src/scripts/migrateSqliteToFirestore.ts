/**
 * migrateSqliteToFirestore.ts
 *
 * One-off script to migrate existing SQLite data into Firestore.
 *
 * Run: npx ts-node --transpile-only src/scripts/migrateSqliteToFirestore.ts
 *
 * Safety:
 *   - SQLite is READ-ONLY during migration.
 *   - Migration is additive — Firestore docs are created; SQLite is untouched.
 *   - Each collection tracks its own migration timestamp.
 */

import { openDb } from '../db/database';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../logger';

const BATCH_SIZE = 500;
const OWNER_UID = 'l7xzLPqfR1bQcBRVZWVzjv61kqL2';

async function migrateUsers() {
    logger.info('Users: skipped (Firebase Auth is source of truth)');
}

async function migrateClients() {
    const sqlite = await openDb();
    const clients = await sqlite.all('SELECT * FROM clients');
    logger.info(`Migrating ${clients.length} clients...`);

    const collection = adminDb.collection('clients');
    let migrated = 0;

    for (const client of clients) {
        const docRef = collection.doc(String(client.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        await docRef.set({
            ownerUid: OWNER_UID,
            name: client.name,
            pin: client.pin,
            email: client.email || null,
            phone: client.phone || null,
            sector: client.sector || null,
            obligations: client.obligations?.split(',').map((s: string) => s.trim()).filter(Boolean) || [],
            status: {
                paye: client.paye || 'na',
                nssf: client.nssf || 'na',
                sha: client.sha || 'na',
                vat: client.vat || 'na',
                tot: client.tot || 'na',
                mri: client.mri || 'na',
                dst: client.dst || 'na',
                eLevy: client.eLevy || 'na',
                income_tax_resident_individual: client.incomeTaxResidentIndividual || 'na',
                income_tax_non_resident_individual: client.incomeTaxNonResidentIndividual || 'na',
                income_tax_company: client.incomeTaxCompany || 'na',
                excise_duty: client.exciseDuty || 'na',
            },
            amounts: {
                payeAmount: client.payeAmount || 0,
                nitaAmount: client.nitaAmount || 0,
                housingLevyAmount: client.housingLevyAmount || 0,
                nssfAmount: client.nssfAmount || 0,
                shaAmount: client.shaAmount || 0,
            },
            lastFiled: {},
            generatedFiles: {},
            credentials: {
                kraPassword: client.password || null,
                nssfLogin: client.nssfLogin || null,
                nssfPassword: client.nssfPassword || null,
                shaLogin: client.shaLogin || null,
                shaPassword: client.shaPassword || null,
            },
            masterFile: client.masterFileUrl
                ? { url: client.masterFileUrl, uploadedAt: Timestamp.now(), label: client.masterFileLabel || 'Master CSV' }
                : null,
            payStructure: client.payStructure || 'fixed',
            defaultWorkScheduleId: client.defaultWorkScheduleId || null,
            createdAt: client.createdAt ? Timestamp.fromDate(new Date(client.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });

        migrated++;
    }

    logger.info(`Migrated ${migrated} clients to Firestore`);
}

async function migrateEmployees() {
    const sqlite = await openDb();
    const employees = await sqlite.all('SELECT * FROM employees');
    logger.info(`Migrating ${employees.length} employees...`);

    const collection = adminDb.collection('employees');
    let migrated = 0;

    for (const emp of employees) {
        const docRef = collection.doc(String(emp.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        await docRef.set({
            clientId: String(emp.clientId),
            ownerUid: OWNER_UID,
            employeeName: emp.employeeName,
            kraPin: emp.kraPin,
            idNumber: emp.idNumber,
            nssfNo: emp.nssfNo,
            shaNo: emp.shaNo,
            department: emp.department || null,
            departmentId: emp.departmentId || null,
            jobTitle: emp.jobTitle || null,
            employmentType: emp.employmentType,
            employmentStatus: emp.employmentStatus || 'Active',
            dateJoined: emp.dateJoined,
            dateLeft: emp.dateLeft || null,
            basicPay: emp.basicPay || 0,
            carBenefit: emp.carBenefit || 0,
            mealsBenefit: emp.mealsBenefit || 0,
            nonCashBenefits: emp.nonCashBenefits || 0,
            housingBenefit: emp.housingBenefit || 0,
            otherBenefits: emp.otherBenefits || 0,
            otherPension: emp.otherPension || 0,
            postRetMedical: emp.postRetMedical || 0,
            mortgageInterest: emp.mortgageInterest || 0,
            insuranceRelief: emp.insuranceRelief || 0,
            bonusPay: emp.bonusPay || 0,
            pwd: emp.pwd || 'No',
            standardCheckIn: emp.standardCheckIn || '08:00',
            standardCheckOut: emp.standardCheckOut || '17:00',
            workScheduleId: emp.workScheduleId || null,
            offDay: emp.offDay || null,
            hourlyRate: emp.hourlyRate || 0,
            createdAt: emp.createdAt ? Timestamp.fromDate(new Date(emp.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });

        migrated++;
    }

    logger.info(`Migrated ${migrated} employees to Firestore`);
}

async function migratePayrollRuns() {
    const sqlite = await openDb();
    const runs = await sqlite.all('SELECT * FROM payroll_runs');
    logger.info(`Migrating ${runs.length} payroll runs...`);

    const collection = adminDb.collection('payrollRuns');
    let migrated = 0;

    for (const run of runs) {
        const docRef = collection.doc(String(run.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        await docRef.set({
            clientId: String(run.clientId),
            ownerUid: OWNER_UID,
            period: run.period,
            periodLabel: run.periodLabel || run.period,
            status: run.status || 'draft',
            totalEmployees: run.totalEmployees || 0,
            totalGross: run.totalGross || 0,
            totalDeductions: run.totalDeductions || 0,
            totalNet: run.totalNet || 0,
            lockedAt: run.lockedAt ? Timestamp.fromDate(new Date(run.lockedAt)) : null,
            notes: run.notes || null,
            createdAt: run.createdAt ? Timestamp.fromDate(new Date(run.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });

        const entries = await sqlite.all('SELECT * FROM payroll_entries WHERE payrollRunId = ?', run.id);
        const entriesBatch = adminDb.batch();
        for (const entry of entries) {
            const entryRef = docRef.collection('entries').doc(String(entry.id));
            entriesBatch.set(entryRef, {
                employeeId: String(entry.employeeId),
                basicPay: entry.basicPay || 0,
                benefits: entry.benefits || 0,
                carBenefit: entry.carBenefit || 0,
                mealsBenefit: entry.mealsBenefit || 0,
                nonCashBenefits: entry.nonCashBenefits || 0,
                housingBenefit: entry.housingBenefit || 0,
                otherBenefits: entry.otherBenefits || 0,
                grossPay: entry.grossPay || 0,
                shaDeduction: entry.shaDeduction || 0,
                nssfDeduction: entry.nssfDeduction || 0,
                ahlDeduction: entry.ahlDeduction || 0,
                otherDeductions: entry.otherDeductions || 0,
                totalDeductions: entry.totalDeductions || 0,
                taxablePay: entry.taxablePay || 0,
                payeTax: entry.payeTax || 0,
                netPay: entry.netPay || 0,
                daysWorked: entry.daysWorked || 0,
                totalStdHours: entry.totalStdHours || 0,
                unpaidLeaveDays: entry.unpaidLeaveDays || 0,
                absentDays: entry.absentDays || 0,
                lateDays: entry.lateDays || 0,
                overtimePay: entry.overtimePay || 0,
                attendanceDeduction: entry.attendanceDeduction || 0,
                hourlyRate: entry.hourlyRate || 0,
                stdPayAmount: entry.stdPayAmount || 0,
                holidayHours: entry.holidayHours || 0,
                holidayPayAmount: entry.holidayPayAmount || 0,
                paidLeaveHours: entry.paidLeaveHours || 0,
                paidLeavePayAmount: entry.paidLeavePayAmount || 0,
                absentHours: entry.absentHours || 0,
                absentDedAmount: entry.absentDedAmount || 0,
                lateHours: entry.lateHours || 0,
                lateDedAmount: entry.lateDedAmount || 0,
                unpaidLeaveHours: entry.unpaidLeaveHours || 0,
                unpaidLeaveDedAmount: entry.unpaidLeaveDedAmount || 0,
                bonusPay: entry.bonusPay || 0,
                taxableBonus: entry.taxableBonus || 0,
                nonTaxableBonus: entry.nonTaxableBonus || 0,
                loanDeduction: entry.loanDeduction || 0,
                status: entry.status || 'draft',
                lockedAt: entry.lockedAt ? Timestamp.fromDate(new Date(entry.lockedAt)) : null,
                createdAt: entry.createdAt ? Timestamp.fromDate(new Date(entry.createdAt)) : Timestamp.now(),
                updatedAt: Timestamp.now(),
            });
        }
        await entriesBatch.commit();

        migrated++;
    }

    logger.info(`Migrated ${migrated} payroll runs (with entries) to Firestore`);
}

async function migrateLoans() {
    const sqlite = await openDb();
    const loans = await sqlite.all('SELECT * FROM loans');
    logger.info(`Migrating ${loans.length} loans...`);

    const collection = adminDb.collection('loans');
    let migrated = 0;

    for (const loan of loans) {
        const docRef = collection.doc(String(loan.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        await docRef.set({
            clientId: String(loan.clientId),
            ownerUid: OWNER_UID,
            employeeId: String(loan.employeeId),
            loanType: loan.loanType,
            principal: loan.principal,
            interestRate: loan.interestRate,
            totalRepayable: loan.totalRepayable,
            installmentAmount: loan.installmentAmount,
            remainingInstallments: loan.remainingInstallments,
            startDate: loan.startDate,
            endDate: loan.endDate,
            status: loan.status,
            createdAt: loan.createdAt ? Timestamp.fromDate(new Date(loan.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });

        migrated++;
    }

    logger.info(`Migrated ${migrated} loans to Firestore`);
}

async function migrateAttendance() {
    logger.info('Attendance: skipped (user opted to skip historical attendance records)');
}

async function migrateLeave() {
    const sqlite = await openDb();
    const requests = await sqlite.all('SELECT * FROM leave_requests');
    logger.info(`Migrating ${requests.length} leave requests...`);

    const collection = adminDb.collection('leaveRequests');
    let migrated = 0;
    let batch = adminDb.batch();
    let batchCount = 0;

    for (const req of requests) {
        const docRef = collection.doc(String(req.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        batch.set(docRef, {
            clientId: String(req.clientId),
            employeeId: String(req.employeeId),
            leaveType: req.leaveType,
            startDate: req.startDate,
            endDate: req.endDate,
            days: req.days,
            status: req.status,
            approvedBy: req.approvedBy || null,
            approvedAt: req.approvedAt ? Timestamp.fromDate(new Date(req.approvedAt)) : null,
            createdAt: req.createdAt ? Timestamp.fromDate(new Date(req.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        batchCount++;
        migrated++;

        if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = adminDb.batch();
            batchCount = 0;
        }
    }

    if (batchCount > 0) await batch.commit();
    logger.info(`Migrated ${migrated} leave requests to Firestore`);
}

async function migrateLeaveTypes() {
    const sqlite = await openDb();
    const rows = await sqlite.all('SELECT * FROM leave_types');
    logger.info(`Migrating ${rows.length} leave types...`);

    const collection = adminDb.collection('leaveTypes');
    let migrated = 0;

    for (const row of rows) {
        const docRef = collection.doc(String(row.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        await docRef.set({
            clientId: String(row.clientId),
            ownerUid: OWNER_UID,
            name: row.name,
            daysAllowed: row.daysAllowed || 0,
            isPaid: row.isPaid || 0,
            createdAt: row.createdAt ? Timestamp.fromDate(new Date(row.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        migrated++;
    }

    logger.info(`Migrated ${migrated} leave types to Firestore`);
}

async function migrateWorkSchedules() {
    const sqlite = await openDb();
    const rows = await sqlite.all('SELECT * FROM work_schedules');
    logger.info(`Migrating ${rows.length} work schedules...`);

    const collection = adminDb.collection('workSchedules');
    let migrated = 0;

    for (const row of rows) {
        const docRef = collection.doc(String(row.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        let config = row.config;
        if (typeof config === 'string') {
            try { config = JSON.parse(config); } catch { /* keep as string */ }
        }

        await docRef.set({
            clientId: String(row.clientId),
            ownerUid: OWNER_UID,
            name: row.name || 'Default',
            config: config || {},
            createdAt: row.createdAt ? Timestamp.fromDate(new Date(row.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        migrated++;
    }

    logger.info(`Migrated ${migrated} work schedules to Firestore`);
}

async function migrateHolidays() {
    const sqlite = await openDb();
    const rows = await sqlite.all('SELECT * FROM holidays');
    logger.info(`Migrating ${rows.length} holidays...`);

    const collection = adminDb.collection('holidays');
    let migrated = 0;

    for (const row of rows) {
        const docRef = collection.doc(String(row.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        await docRef.set({
            clientId: String(row.clientId),
            ownerUid: OWNER_UID,
            date: row.date,
            name: row.name,
            isRecurring: row.isRecurring || 0,
            holidayType: row.holidayType || 'public',
            createdAt: row.createdAt ? Timestamp.fromDate(new Date(row.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        migrated++;
    }

    logger.info(`Migrated ${migrated} holidays to Firestore`);
}

async function migrateDepartments() {
    const sqlite = await openDb();
    const rows = await sqlite.all('SELECT * FROM departments');
    logger.info(`Migrating ${rows.length} departments...`);

    const collection = adminDb.collection('departments');
    let migrated = 0;

    for (const row of rows) {
        const docRef = collection.doc(String(row.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        await docRef.set({
            clientId: String(row.clientId),
            ownerUid: OWNER_UID,
            name: row.name,
            code: row.code || null,
            createdAt: row.createdAt ? Timestamp.fromDate(new Date(row.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        migrated++;
    }

    logger.info(`Migrated ${migrated} departments to Firestore`);
}

async function migrateDocuments() {
    const sqlite = await openDb();
    const rows = await sqlite.all('SELECT * FROM documents');
    logger.info(`Migrating ${rows.length} documents...`);

    const collection = adminDb.collection('documents');
    let migrated = 0;

    for (const row of rows) {
        const docRef = collection.doc(String(row.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        await docRef.set({
            clientId: String(row.clientId),
            ownerUid: OWNER_UID,
            employeeId: row.employeeId ? String(row.employeeId) : null,
            fileName: row.fileName,
            filePath: row.filePath || null,
            mimeType: row.mimeType || 'application/octet-stream',
            category: row.category || null,
            uploadedAt: row.uploadedAt ? Timestamp.fromDate(new Date(row.uploadedAt)) : Timestamp.now(),
            createdAt: row.createdAt ? Timestamp.fromDate(new Date(row.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        migrated++;
    }

    logger.info(`Migrated ${migrated} documents to Firestore`);
}

async function migrateAttendancePayrollApprovals() {
    const sqlite = await openDb();
    const rows = await sqlite.all('SELECT * FROM attendance_payroll_approvals');
    logger.info(`Migrating ${rows.length} attendance payroll approvals...`);

    const collection = adminDb.collection('attendancePayrollApprovals');
    let migrated = 0;
    let batch = adminDb.batch();
    let batchCount = 0;

    for (const row of rows) {
        const docRef = collection.doc(String(row.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        batch.set(docRef, {
            clientId: String(row.clientId),
            ownerUid: OWNER_UID,
            period: row.period,
            employeeId: String(row.employeeId),
            employeeName: row.employeeName || '',
            absentDays: row.absentDays || 0,
            lateHours: row.lateHours || 0,
            overtimeHours: row.overtimeHours || 0,
            overtimeRate: row.overtimeRate || 0,
            overtimeMultiplier: row.overtimeMultiplier || 1.5,
            overtimeAmount: row.overtimeAmount || 0,
            approvedBy: row.approvedBy || null,
            approvedAt: row.approvedAt ? Timestamp.fromDate(new Date(row.approvedAt)) : null,
            createdAt: row.createdAt ? Timestamp.fromDate(new Date(row.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        batchCount++;
        migrated++;

        if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = adminDb.batch();
            batchCount = 0;
        }
    }

    if (batchCount > 0) await batch.commit();
    logger.info(`Migrated ${migrated} attendance payroll approvals to Firestore`);
}

async function migratePayrollAdjustments() {
    const sqlite = await openDb();
    const rows = await sqlite.all('SELECT * FROM payroll_adjustments');
    logger.info(`Migrating ${rows.length} payroll adjustments...`);

    const collection = adminDb.collection('payrollAdjustments');
    let migrated = 0;
    let batch = adminDb.batch();
    let batchCount = 0;

    for (const row of rows) {
        const docRef = collection.doc(String(row.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        batch.set(docRef, {
            payrollRunId: String(row.payrollRunId),
            employeeId: row.employeeId ? String(row.employeeId) : null,
            payrollEntryId: row.payrollEntryId ? String(row.payrollEntryId) : null,
            type: row.type,
            label: row.label,
            amount: row.amount || 0,
            isStatutory: row.isStatutory || 0,
            createdAt: row.createdAt ? Timestamp.fromDate(new Date(row.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        batchCount++;
        migrated++;

        if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = adminDb.batch();
            batchCount = 0;
        }
    }

    if (batchCount > 0) await batch.commit();
    logger.info(`Migrated ${migrated} payroll adjustments to Firestore`);
}

async function migrateLoanTransactions() {
    const sqlite = await openDb();
    const rows = await sqlite.all('SELECT * FROM loan_transactions');
    logger.info(`Migrating ${rows.length} loan transactions...`);

    const collection = adminDb.collection('loanTransactions');
    let migrated = 0;
    let batch = adminDb.batch();
    let batchCount = 0;

    for (const row of rows) {
        const docRef = collection.doc(String(row.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        batch.set(docRef, {
            clientId: String(row.clientId),
            ownerUid: OWNER_UID,
            employeeId: String(row.employeeId),
            payrollRunId: String(row.payrollRunId),
            loanId: String(row.loanId),
            amount: row.amount || 0,
            type: row.type || 'deduction',
            createdAt: row.createdAt ? Timestamp.fromDate(new Date(row.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        batchCount++;
        migrated++;

        if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = adminDb.batch();
            batchCount = 0;
        }
    }

    if (batchCount > 0) await batch.commit();
    logger.info(`Migrated ${migrated} loan transactions to Firestore`);
}

async function migrateOvertimeRecords() {
    const sqlite = await openDb();
    const rows = await sqlite.all('SELECT * FROM overtime_records');
    logger.info(`Migrating ${rows.length} overtime records...`);

    const collection = adminDb.collection('overtimeRecords');
    let migrated = 0;
    let batch = adminDb.batch();
    let batchCount = 0;

    for (const row of rows) {
        const docRef = collection.doc(String(row.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        batch.set(docRef, {
            clientId: String(row.clientId),
            ownerUid: OWNER_UID,
            employeeId: String(row.employeeId),
            period: row.period,
            hours: row.hours || 0,
            rate: row.rate || 0,
            multiplier: row.multiplier || 1.5,
            amount: row.amount || 0,
            description: row.description || null,
            createdAt: row.createdAt ? Timestamp.fromDate(new Date(row.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        batchCount++;
        migrated++;

        if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = adminDb.batch();
            batchCount = 0;
        }
    }

    if (batchCount > 0) await batch.commit();
    logger.info(`Migrated ${migrated} overtime records to Firestore`);
}

async function migrateAuditLog() {
    const sqlite = await openDb();
    const rows = await sqlite.all('SELECT * FROM audit_log');
    logger.info(`Migrating ${rows.length} audit log entries...`);

    const collection = adminDb.collection('auditLog');
    let migrated = 0;
    let batch = adminDb.batch();
    let batchCount = 0;

    for (const row of rows) {
        const docRef = collection.doc(String(row.id));
        const doc = await docRef.get();
        if (doc.exists) continue;

        batch.set(docRef, {
            clientId: row.clientId ? String(row.clientId) : null,
            ownerUid: OWNER_UID,
            action: row.action,
            entityType: row.entityType || null,
            entityId: row.entityId ? String(row.entityId) : null,
            details: row.details || null,
            performedBy: row.performedBy || null,
            createdAt: row.createdAt ? Timestamp.fromDate(new Date(row.createdAt)) : Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        batchCount++;
        migrated++;

        if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = adminDb.batch();
            batchCount = 0;
            logger.info(`  Committed ${migrated} audit log entries so far...`);
        }
    }

    if (batchCount > 0) await batch.commit();
    logger.info(`Migrated ${migrated} audit log entries to Firestore`);
}

async function main() {
    logger.info('Starting SQLite → Firestore migration...');

    await migrateUsers();
    await migrateClients();
    await migrateEmployees();
    await migratePayrollRuns();
    await migrateLoans();
    await migrateAttendance();
    await migrateLeave();
    await migrateLeaveTypes();
    await migrateWorkSchedules();
    await migrateHolidays();
    await migrateDepartments();
    await migrateDocuments();
    await migrateAttendancePayrollApprovals();
    await migratePayrollAdjustments();
    await migrateLoanTransactions();
    await migrateOvertimeRecords();
    logger.info('Audit log: skipped (not needed for Firestore)');

    logger.info('Migration complete!');
    process.exit(0);
}

main().catch((err) => {
    logger.error({ err }, 'Migration failed');
    process.exit(1);
});
