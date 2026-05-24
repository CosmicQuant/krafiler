import { Router } from 'express';
import { db } from '../db/kysely';
import { computePayrollEntry, getScheduledWorkDays } from '../services/payrollEngine';
import { generateComplianceFromPayrollRun } from '../services/complianceFileGenerator';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

const router = Router();

// ─── Shared generate logic ────────────────────────────────────────────────

async function generateEntriesForRun(runId: number, clientId: number, prorate: boolean): Promise<{ entries: any[]; run: any }> {
    const run = await db
        .selectFrom('payroll_runs')
        .selectAll()
        .where('id', '=', runId)
        .where('clientId', '=', clientId)
        .executeTakeFirst();

    if (!run) throw new Error('Payroll run not found');

    const client = await db
        .selectFrom('clients')
        .selectAll()
        .where('id', '=', clientId)
        .executeTakeFirst();

    const payStructure = (client?.payStructure as 'fixed' | 'prorated') || 'fixed';

    const employees = await db
        .selectFrom('employees')
        .selectAll()
        .where('clientId', '=', clientId)
        .where('employmentStatus', '=', 'Active')
        .execute();

    if (employees.length === 0) throw new Error('No active employees found');

    const now = new Date().toISOString();
    const [periodYear, periodMonth] = run.period.split('-');

    // Fetch work schedules and holidays for this client
    const workSchedules = await db
        .selectFrom('work_schedules')
        .selectAll()
        .where('clientId', '=', clientId)
        .execute();
    const scheduleMap = new Map<number, any>();
    for (const ws of workSchedules) {
        scheduleMap.set(ws.id, ws);
    }

    const [yearStr, monthStr] = run.period.split('-');
    const holidays = await db
        .selectFrom('holidays')
        .selectAll()
        .where('clientId', '=', clientId)
        .where((eb) => eb.or([
            eb('date', 'like', `${yearStr}-%`),
            eb('isRecurring', '=', 1),
        ]))
        .execute();

    // Fetch active loans
    const allLoans = await db
        .selectFrom('loans')
        .selectAll()
        .where('clientId', '=', clientId)
        .where('remainingInstallments', '>', 0)
        .execute();
    const loanMap = new Map<number, number>();
    for (const ln of allLoans) {
        loanMap.set(ln.employeeId, (loanMap.get(ln.employeeId) || 0) + ln.monthlyDeduction);
    }

    // Fetch approved unpaid leave
    const leaveRecords = await db
        .selectFrom('leave_requests')
        .selectAll()
        .where('clientId', '=', clientId)
        .where('status', '=', 'Approved')
        .execute();
    const leaveMap = new Map<number, number>();
    for (const lv of leaveRecords) {
        const isUnpaid = lv.isPaid === 0 || lv.leaveType.toLowerCase().includes('unpaid');
        if (!isUnpaid) continue;
        const lvStartStr = lv.startDate || '';
        const lvEndStr = lv.endDate || '';
        if (!lvStartStr) continue;
        const lvStart = new Date(lvStartStr);
        const lvEnd = lvEndStr ? new Date(lvEndStr) : new Date(lvStartStr);
        const periodStart = new Date(parseInt(periodYear, 10), parseInt(periodMonth, 10) - 1, 1);
        const periodEnd = new Date(parseInt(periodYear, 10), parseInt(periodMonth, 10), 0);
        const overlapStart = lvStart > periodStart ? lvStart : periodStart;
        const overlapEnd = lvEnd < periodEnd ? lvEnd : periodEnd;
        if (overlapStart > overlapEnd) continue;
        const overlapDays = Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        leaveMap.set(lv.employeeId, (leaveMap.get(lv.employeeId) || 0) + overlapDays);
    }

    // Fetch attendance records for the period
    const periodStartStr = `${run.period}-01`;
    const periodEndStr = `${run.period}-${new Date(parseInt(periodYear, 10), parseInt(periodMonth, 10), 0).getDate()}`;
    const attendanceRecords = await db
        .selectFrom('attendance_records')
        .selectAll()
        .where('clientId', '=', clientId)
        .where('date', '>=', periodStartStr)
        .where('date', '<=', periodEndStr)
        .execute();

    const absentMap = new Map<number, number>();
    const lateHoursMap = new Map<number, number>();
    for (const ar of attendanceRecords) {
        if (ar.status === 'Absent') {
            absentMap.set(ar.employeeId, (absentMap.get(ar.employeeId) || 0) + 1);
        } else if (ar.status === 'Half-Day') {
            absentMap.set(ar.employeeId, (absentMap.get(ar.employeeId) || 0) + 0.5);
        } else if (ar.status === 'Late') {
            const emp = employees.find(e => e.id === ar.employeeId);
            const checkIn = ar.checkIn || '';
            const standardIn = emp?.standardCheckIn || '08:00';
            const [cH, cM] = checkIn.split(':').map(Number);
            const [sH, sM] = standardIn.split(':').map(Number);
            if (!isNaN(cH) && !isNaN(sH)) {
                const lateMins = (cH * 60 + (cM || 0)) - (sH * 60 + (sM || 0));
                if (lateMins > 0) {
                    const lateHours = lateMins / 60;
                    lateHoursMap.set(ar.employeeId, (lateHoursMap.get(ar.employeeId) || 0) + lateHours);
                }
            }
        }
    }

    // Exclude approved leave days from absent counts
    const leaveDateMap = new Map<number, Set<string>>();
    for (const lv of leaveRecords) {
        if (lv.status !== 'Approved') continue;
        const lvStartStr = lv.startDate || '';
        const lvEndStr = lv.endDate || '';
        if (!lvStartStr) continue;
        const lvStart = new Date(lvStartStr);
        const lvEnd = lvEndStr ? new Date(lvEndStr) : new Date(lvStartStr);
        const periodStart = new Date(parseInt(periodYear, 10), parseInt(periodMonth, 10) - 1, 1);
        const periodEnd = new Date(parseInt(periodYear, 10), parseInt(periodMonth, 10), 0);
        const overlapStart = lvStart > periodStart ? lvStart : periodStart;
        const overlapEnd = lvEnd < periodEnd ? lvEnd : periodEnd;
        if (overlapStart > overlapEnd) continue;
        if (!leaveDateMap.has(lv.employeeId)) leaveDateMap.set(lv.employeeId, new Set());
        const current = new Date(overlapStart);
        while (current <= overlapEnd) {
            leaveDateMap.get(lv.employeeId)!.add(current.toISOString().slice(0, 10));
            current.setDate(current.getDate() + 1);
        }
    }
    for (const ar of attendanceRecords) {
        if (ar.status !== 'Absent') continue;
        const leaveDates = leaveDateMap.get(ar.employeeId);
        if (leaveDates && leaveDates.has(ar.date)) {
            const prev = absentMap.get(ar.employeeId) || 0;
            if (prev > 0) absentMap.set(ar.employeeId, prev - 1);
        }
    }

    // Fetch overtime records for the period
    const overtimeRecords = await db
        .selectFrom('overtime_records')
        .selectAll()
        .where('clientId', '=', clientId)
        .where('period', '=', run.period)
        .execute();
    const overtimeMap = new Map<number, number>();
    for (const ot of overtimeRecords) {
        overtimeMap.set(ot.employeeId, (overtimeMap.get(ot.employeeId) || 0) + ot.amount);
    }

    // Check for approved attendance payroll data (workflow step)
    const approvedAttendances = await db
        .selectFrom('attendance_payroll_approvals')
        .selectAll()
        .where('clientId', '=', clientId)
        .where('period', '=', run.period)
        .where('approvedAt', 'is not', null)
        .execute();

    if (approvedAttendances.length > 0) {
        for (const aa of approvedAttendances) {
            absentMap.set(aa.employeeId, aa.absentDays);
            lateHoursMap.set(aa.employeeId, aa.lateHours);
            overtimeMap.set(aa.employeeId, aa.overtimeAmount);
        }
    }

    // Delete existing entries
    await db.deleteFrom('payroll_entries').where('payrollRunId', '=', runId).execute();

    // Load dynamic adjustments for this run
    const adjustments = await db
        .selectFrom('payroll_adjustments')
        .selectAll()
        .where('payrollRunId', '=', runId)
        .execute();
    const adjustmentsByEmployee = new Map<number, { type: 'allowance' | 'deduction'; amount: number; isStatutory: boolean }[]>();
    for (const adj of adjustments) {
        const list = adjustmentsByEmployee.get(adj.employeeId) || [];
        list.push({ type: adj.type as 'allowance' | 'deduction', amount: adj.amount, isStatutory: !!adj.isStatutory });
        adjustmentsByEmployee.set(adj.employeeId, list);
    }

    // Compute entries
    const entries = employees.map(emp => {
        const payStructure = (emp.payStructure || (client?.payStructure as string) || 'fixed') as 'fixed' | 'prorated';
        // Determine work schedule for this employee
        const scheduleId = emp.workScheduleId || null;
        const schedule = scheduleId ? scheduleMap.get(scheduleId) : null;
        const scheduleConfig = schedule ? JSON.parse(schedule.config) : null;
        const scheduledDays = getScheduledWorkDays(scheduleConfig, run.period, holidays);

        // Compute attendance-adjusted basic pay
        const absentCount = absentMap.get(emp.id) || 0;
        const lateHrs = lateHoursMap.get(emp.id) || 0;
        const otAmount = overtimeMap.get(emp.id) || 0;
        const presentDays = Math.max(0, scheduledDays - absentCount);
        const dailyRate = (emp.basicPay || 0) / Math.max(1, scheduledDays);
        const [siH, siM] = (emp.standardCheckIn || '08:00').split(':').map(Number);
        const [soH, soM] = (emp.standardCheckOut || '17:00').split(':').map(Number);
        const stdWorkingMins = (soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0));
        const stdWorkingHours = Math.max(1, stdWorkingMins / 60);
        const lateDeduction = dailyRate * (lateHrs / stdWorkingHours);
        const adjustedBasicPay = Math.max(0, presentDays * dailyRate - lateDeduction + otAmount);

        return computePayrollEntry(
            {
                employeeId: emp.id,
                employeeName: emp.employeeName,
                kraPin: emp.kraPin,
                payrollNumber: emp.payrollNumber,
                basicPay: emp.basicPay,
                basicPayOverride: adjustedBasicPay,
                // Individual benefits from employee master record (not prorated — fixed monthly values)
                carBenefit: emp.carBenefit || 0,
                mealsBenefit: emp.mealsBenefit || 0,
                nonCashBenefits: emp.nonCashBenefits || 0,
                housingBenefit: emp.housingBenefit || 0,
                otherBenefits: emp.otherBenefits || 0,
                dateJoined: emp.dateJoined,
                dateLeft: emp.dateLeft,
                employmentStatus: emp.employmentStatus,
                loanDeduction: loanMap.get(emp.id) || 0,
                unpaidLeaveDays: leaveMap.get(emp.id) || 0,
                payStructure,
                overtimePay: 0,
                attendanceAbsentDays: 0,
                attendanceLateDays: 0,
                pwd: emp.pwd || 'No',
                otherPension: emp.otherPension || 0,
                postRetMedical: emp.postRetMedical || 0,
                mortgageInterest: emp.mortgageInterest || 0,
                insuranceRelief: emp.insuranceRelief || 0,
                bonusPay: emp.bonusPay || 0,
                standardCheckIn: emp.standardCheckIn || '08:00',
                standardCheckOut: emp.standardCheckOut || '17:00',
            },
            run.period,
            prorate,
            scheduleConfig,
            holidays,
            adjustmentsByEmployee.get(emp.id) || [],
        );
    });

    // Insert entries
    for (const entry of entries) {
        await db
            .insertInto('payroll_entries')
            .values({
                payrollRunId: runId,
                clientId,
                employeeId: entry.employeeId,
                employeeName: entry.employeeName,
                kraPin: entry.kraPin,
                payrollNumber: entry.payrollNumber,
                basicPay: entry.basicPay,
                benefits: entry.benefits,
                carBenefit: entry.carBenefit,
                mealsBenefit: entry.mealsBenefit,
                nonCashBenefits: entry.nonCashBenefits,
                housingBenefit: entry.housingBenefit,
                otherBenefits: entry.otherBenefits,
                grossPay: entry.grossPay,
                shaDeduction: entry.shaDeduction,
                nssfDeduction: entry.nssfDeduction,
                ahlDeduction: entry.ahlDeduction,
                otherDeductions: entry.otherDeductions,
                totalDeductions: entry.totalDeductions,
                taxablePay: entry.taxablePay,
                payeTax: entry.payeTax,
                netPay: entry.netPay,
                daysWorked: entry.daysWorked,
                unpaidLeaveDays: entry.unpaidLeaveDays,
                loanDeduction: entry.loanDeduction,
                overtimePay: entry.overtimePay,
                absentDays: entry.absentDays,
                lateDays: entry.lateDays,
                bonusPay: entry.bonusPay || 0,
                taxableBonus: entry.taxableBonus || 0,
                nonTaxableBonus: entry.nonTaxableBonus || 0,
                status: 'active',
                lockedAt: null,
                createdAt: now,
                updatedAt: now,
            })
            .execute();
    }

    // Update run totals
    const totalGross = entries.reduce((s, e) => s + e.grossPay, 0);
    const totalDeductions = entries.reduce((s, e) => s + e.totalDeductions, 0);
    const totalNet = entries.reduce((s, e) => s + e.netPay, 0);

    await db
        .updateTable('payroll_runs')
        .set({
            totalEmployees: entries.length,
            totalGross: roundMoney(totalGross),
            totalDeductions: roundMoney(totalDeductions),
            totalNet: roundMoney(totalNet),
            status: 'completed',
            updatedAt: now,
        })
        .where('id', '=', runId)
        .execute();

    const updatedRun = await db
        .selectFrom('payroll_runs')
        .selectAll()
        .where('id', '=', runId)
        .executeTakeFirst();

    return { entries, run: updatedRun! };
}

// ─── Payroll Runs CRUD ────────────────────────────────────────────────────────

// GET /api/clients/:clientId/payroll-runs
router.get('/:clientId/payroll-runs', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const runs = await db
            .selectFrom('payroll_runs')
            .selectAll()
            .where('clientId', '=', clientId)
            .orderBy('createdAt', 'desc')
            .execute();

        res.json(runs);
    } catch (err) {
        console.error('Error fetching payroll runs:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/payroll-runs — create and auto-generate entries
router.post('/:clientId/payroll-runs', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { period, notes, prorate } = req.body;
        if (!period) return res.status(400).json({ message: 'Period is required (YYYY-MM)' });

        // Check for duplicate period
        const existing = await db
            .selectFrom('payroll_runs')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('period', '=', period)
            .executeTakeFirst();

        if (existing) return res.status(409).json({ message: 'A payroll run already exists for this period', existingRunId: existing.id });

        const [year, month] = period.split('-');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const periodLabel = `${months[parseInt(month, 10) - 1]} ${year}`;

        const now = new Date().toISOString();
        const result = await db
            .insertInto('payroll_runs')
            .values({
                clientId,
                period,
                periodLabel,
                status: 'draft',
                totalEmployees: 0,
                totalGross: 0,
                totalDeductions: 0,
                totalNet: 0,
                notes: notes || null,
                createdAt: now,
                updatedAt: now,
            })
            .executeTakeFirst();

        const id = Number(result.insertId || 0);

        // Auto-generate entries
        const shouldProrate = prorate !== false;
        const { run, entries } = await generateEntriesForRun(id, clientId, shouldProrate);

        const sampleEntry = entries.length > 0 ? {
            employeeName: entries[0].employeeName,
            basicPay: entries[0].basicPay,
            grossPay: entries[0].grossPay,
            netPay: entries[0].netPay,
            daysWorked: entries[0].daysWorked,
        } : null;

        res.status(201).json({
            run,
            entriesGenerated: entries.length,
            diagnostic: {
                employeesFound: entries.length,
                employeesWithZeroBasicPay: entries.filter((e: any) => e.basicPay === 0).length,
                sampleEntry,
            },
        });
    } catch (err: any) {
        console.error('Error creating payroll run:', err);
        if (err.message === 'No active employees found') {
            res.status(400).json({ message: err.message });
        } else {
            res.status(500).json({ message: 'Internal server error' });
        }
    }
});

// GET /api/clients/:clientId/payroll-runs/debug — preview what generate would compute (no writes)
router.get('/:clientId/payroll-runs/debug', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const employees = await db
            .selectFrom('employees')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('employmentStatus', '=', 'Active')
            .execute();

        const raw = employees.map(e => ({
            id: e.id,
            name: e.employeeName,
            kraPin: e.kraPin,
            basicPay: e.basicPay,
            basicPayType: typeof e.basicPay,
            employmentStatus: e.employmentStatus,
            dateJoined: e.dateJoined,
            dateLeft: e.dateLeft,
        }));

        res.json({
            activeEmployees: raw.length,
            employees: raw,
            sample: raw[0] || null,
        });
    } catch (err) {
        console.error('Debug error:', err);
        res.status(500).json({ message: 'Debug error' });
    }
});

// POST /api/clients/:clientId/payroll-runs/:id/generate — re-generate entries (overwrites existing)
router.post('/:clientId/payroll-runs/:id/generate', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const prorate = req.body.prorate !== false;
        const { run, entries } = await generateEntriesForRun(id, clientId, prorate);

        const sampleEntry = entries.length > 0 ? {
            employeeName: entries[0].employeeName,
            basicPay: entries[0].basicPay,
            grossPay: entries[0].grossPay,
            netPay: entries[0].netPay,
            daysWorked: entries[0].daysWorked,
            unpaidLeaveDays: entries[0].unpaidLeaveDays,
            unpaidLeaveDeduction: entries[0].unpaidLeaveDeduction,
            loanDeduction: entries[0].loanDeduction,
            overtimePay: entries[0].overtimePay,
            absentDays: entries[0].absentDays,
            lateDays: entries[0].lateDays,
        } : null;

        res.json({
            run,
            entriesGenerated: entries.length,
            diagnostic: {
                employeesFound: entries.length,
                employeesWithZeroBasicPay: entries.filter(e => e.basicPay === 0).length,
                sampleEntry,
            },
        });
    } catch (err: any) {
        console.error('Error generating payroll entries:', err);
        if (err.message === 'No active employees found') {
            res.status(400).json({ message: err.message });
        } else {
            res.status(500).json({ message: 'Internal server error' });
        }
    }
});

// GET /api/clients/:clientId/payroll-runs/:id/entries — fetch entries for a run
router.get('/:clientId/payroll-runs/:id/entries', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const entries = await db
            .selectFrom('payroll_entries')
            .selectAll()
            .where('payrollRunId', '=', id)
            .where('clientId', '=', clientId)
            .orderBy('employeeName', 'asc')
            .execute();

        // Parse and merge overrides into each entry for frontend consumption
        const entriesWithOverrides = entries.map((entry: any) => {
            const merged = { ...entry };
            if (entry.overrides) {
                try {
                    const overrides = JSON.parse(entry.overrides);
                    // Mark which fields have overrides
                    merged._overrideKeys = Object.keys(overrides);
                    // Merge override values
                    Object.assign(merged, overrides);
                } catch {
                    merged._overrideKeys = [];
                }
            } else {
                merged._overrideKeys = [];
            }
            return merged;
        });

        res.json(entriesWithOverrides);
    } catch (err) {
        console.error('Error fetching payroll entries:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/payroll-runs/:id/update-entry — persist per-run input overrides
router.post('/:clientId/payroll-runs/:id/update-entry', async (req, res) => {
    try {
        const runId = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(runId) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const { employeeId } = req.body;
        if (!employeeId) return res.status(400).json({ message: 'employeeId is required' });

        // Build override object from allowed input fields
        const allowedOverrides = [
            'basicPay', 'carBenefit', 'mealsBenefit', 'nonCashBenefits',
            'housingBenefit', 'otherBenefits', 'bonusPay', 'insuranceRelief',
            'absentDays', 'lateHours', 'overtimePay',
        ];

        const overridePayload: Record<string, number> = {};
        for (const key of allowedOverrides) {
            if (req.body[key] !== undefined) {
                const val = parseFloat(String(req.body[key]));
                if (!isNaN(val)) overridePayload[key] = val;
            }
        }

        // Find the existing entry
        const entry = await db
            .selectFrom('payroll_entries')
            .selectAll()
            .where('payrollRunId', '=', runId)
            .where('clientId', '=', clientId)
            .where('employeeId', '=', employeeId)
            .executeTakeFirst();

        if (!entry) return res.status(404).json({ message: 'Payroll entry not found' });

        // Merge with existing overrides
        let existingOverrides: Record<string, number> = {};
        if (entry.overrides) {
            try {
                existingOverrides = JSON.parse(entry.overrides);
            } catch { /* ignore parse errors */ }
        }

        const mergedOverrides = { ...existingOverrides, ...overridePayload };

        await db
            .updateTable('payroll_entries')
            .set({ overrides: JSON.stringify(mergedOverrides) })
            .where('id', '=', entry.id)
            .execute();

        res.json({ success: true, overrides: mergedOverrides });
    } catch (err) {
        console.error('Error updating payroll entry override:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/payroll-runs/:id
router.delete('/:clientId/payroll-runs/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        await db.deleteFrom('payroll_runs').where('id', '=', id).where('clientId', '=', clientId).execute();
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting payroll run:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── Bulk Payslip PDF ─────────────────────────────────────────────────────────

// GET /api/clients/:clientId/payroll-runs/:id/payslips — download all payslips as ZIP
router.get('/:clientId/payroll-runs/:id/payslips', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const entries = await db
            .selectFrom('payroll_entries')
            .selectAll()
            .where('payrollRunId', '=', id)
            .where('clientId', '=', clientId)
            .orderBy('employeeName', 'asc')
            .execute();

        if (entries.length === 0) return res.status(404).json({ message: 'No entries found' });

        const run = await db.selectFrom('payroll_runs').selectAll().where('id', '=', id).executeTakeFirst();

        const client = await db.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();

        // Use archiver to create ZIP of all PDFs
        const archiver = require('archiver');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=Payslips_${run?.period || id}.zip`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        for (const entry of entries) {
            const doc = new PDFDocument({ size: 'A4', margin: 40 });
            const chunks: Buffer[] = [];
            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(chunks);
                archive.append(pdfBuffer, { name: `Payslip_${entry.kraPin}_${run?.period || ''}.pdf` });
            });

            generatePayslipPDF(doc, entry, client);
        }

        archive.finalize();
    } catch (err) {
        console.error('Error generating bulk payslips:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/payroll-runs/:id/payslip/:employeeId — single payslip
router.get('/:clientId/payroll-runs/:id/payslip/:employeeId', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const employeeId = parseInt(req.params.employeeId, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(employeeId) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const entry = await db
            .selectFrom('payroll_entries')
            .selectAll()
            .where('payrollRunId', '=', id)
            .where('employeeId', '=', employeeId)
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        if (!entry) return res.status(404).json({ message: 'Entry not found' });

        const client = await db.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();
        const run = await db.selectFrom('payroll_runs').selectAll().where('id', '=', id).executeTakeFirst();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Payslip_${entry.kraPin}_${run?.period || ''}.pdf`);

        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        doc.pipe(res);
        generatePayslipPDF(doc, entry, client);
        doc.end();
    } catch (err) {
        console.error('Error generating payslip:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

function generatePayslipPDF(doc: any, entry: any, client: any): void {
    const leftX = 40;
    const rightX = 310;
    const earningsAmountX = 240;
    const deductionsAmountX = 550;
    let y = 40;

    // ── Company Logo ──
    if (client?.logoUrl) {
        try {
            const logoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', client.logoUrl.replace(/^\//, ''));
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, leftX, y, { width: 60 });
                y = 110;
            }
        } catch { /* ignore */ }
    }

    // ── Header ──
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000');
    doc.text(client?.name || 'Company', leftX, y, { align: 'center', width: 510 });
    y += 18;
    doc.fontSize(8).font('Helvetica').fillColor('#666');
    doc.text(`KRA PIN: ${client?.pin || ''}`, leftX, y, { align: 'center', width: 510 });
    y += 14;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000');
    doc.text('PAYSLIP', leftX, y, { align: 'center', width: 510 });
    y += 20;
    doc.fontSize(8).font('Helvetica');
    doc.text(`Employee: ${entry.employeeName || ''}`, leftX, y);
    doc.text(`KRA PIN: ${entry.kraPin || ''}`, rightX, y);
    y += 14;
    doc.text(`Payroll No: ${entry.payrollNumber || ''}`, leftX, y);
    doc.text(`Days Worked: ${entry.daysWorked || 0}`, rightX, y);
    y += 14;

    const rowH = 13;

    // ── Column Headers ──
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000');
    doc.text('EARNINGS', leftX, y);
    doc.text('Amount (KES)', earningsAmountX, y);
    doc.text('DEDUCTIONS', rightX, y);
    doc.text('Amount (KES)', deductionsAmountX, y);
    y += rowH;

    // Track separately
    let earnY = y;
    let dedY = y;

    // ── EARNINGS ──
    doc.fontSize(8).font('Helvetica').fillColor('#333');
    doc.text('Basic Pay', leftX, earnY); doc.text(entry.basicPay.toFixed(2), earningsAmountX, earnY);
    earnY += rowH;

    if (entry.benefits > 0) {
        doc.text('Benefits', leftX, earnY); doc.text(entry.benefits.toFixed(2), earningsAmountX, earnY);
        earnY += rowH;
    }

    if ((entry.overtimePay || 0) > 0) {
        doc.text('Overtime Pay', leftX, earnY); doc.text(entry.overtimePay.toFixed(2), earningsAmountX, earnY);
        earnY += rowH;
    }

    const totalBonus = (entry.bonusPay || 0) + (entry.nonTaxableBonus || 0);
    if (totalBonus > 0) {
        doc.text('Bonus Pay', leftX, earnY); doc.text(totalBonus.toFixed(2), earningsAmountX, earnY);
        earnY += rowH;
    }

    // Gross separator + total
    earnY += 4;
    doc.rect(leftX, earnY, 200, 1).fill('#ddd');
    earnY += 8;
    doc.font('Helvetica-Bold').fillColor('#000');
    doc.text('Gross Pay', leftX, earnY);
    doc.text(entry.grossPay.toFixed(2), earningsAmountX, earnY);
    earnY += rowH;

    // ── DEDUCTIONS ──
    dedY = y;  // reset to match earnings starting position

    doc.font('Helvetica').fillColor('#333');
    doc.text('PAYE Tax', rightX, dedY); doc.text(entry.payeTax.toFixed(2), deductionsAmountX, dedY);
    dedY += rowH;

    doc.text('SHA', rightX, dedY); doc.text(entry.shaDeduction.toFixed(2), deductionsAmountX, dedY);
    dedY += rowH;

    doc.text('NSSF', rightX, dedY); doc.text(entry.nssfDeduction.toFixed(2), deductionsAmountX, dedY);
    dedY += rowH;

    doc.text('AHL', rightX, dedY); doc.text(entry.ahlDeduction.toFixed(2), deductionsAmountX, dedY);
    dedY += rowH;

    if ((entry.unpaidLeaveDays || 0) > 0) {
        const unpaidAmt = (entry.unpaidLeaveDeduction || 0) || (entry.basicPay / 30) * entry.unpaidLeaveDays;
        doc.text(`Unpaid Leave (${entry.unpaidLeaveDays} days)`, rightX, dedY);
        doc.text(unpaidAmt.toFixed(2), deductionsAmountX, dedY);
        dedY += rowH;
    }

    if ((entry.absentDays || 0) > 0) {
        const dailyRate = entry.basicPay / 30;
        const absentDeduction = entry.absentDays * dailyRate;
        doc.text(`Absenteeism (${entry.absentDays} days)`, rightX, dedY);
        doc.text(absentDeduction.toFixed(2), deductionsAmountX, dedY);
        dedY += rowH;
    }

    if ((entry.lateDays || 0) > 0) {
        const dailyRate = entry.basicPay / 30;
        const hourlyRate = dailyRate / 8;
        const lateDeduction = entry.lateDays * hourlyRate;
        doc.text(`Lateness (${entry.lateDays} hrs)`, rightX, dedY);
        doc.text(lateDeduction.toFixed(2), deductionsAmountX, dedY);
        dedY += rowH;
    }

    if ((entry.loanDeduction || 0) > 0) {
        doc.text('Loan', rightX, dedY); doc.text(entry.loanDeduction.toFixed(2), deductionsAmountX, dedY);
        dedY += rowH;
    }

    if (entry.otherDeductions > 0) {
        doc.text('Other', rightX, dedY); doc.text(entry.otherDeductions.toFixed(2), deductionsAmountX, dedY);
        dedY += rowH;
    }

    // Total Deductions separator
    dedY += 4;
    doc.rect(rightX, dedY, 200, 1).fill('#ddd');
    dedY += 8;
    doc.font('Helvetica-Bold').fillColor('#000');
    doc.text('Total Deductions', rightX, dedY);
    doc.text(entry.totalDeductions.toFixed(2), deductionsAmountX, dedY);
    dedY += rowH;

    // ── Net Pay ──
    const finalY = Math.max(earnY, dedY) + 16;
    doc.rect(leftX, finalY, 510, 24).fill('#1e293b');
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('NET PAY', leftX + 8, finalY + 6);
    doc.text(`KES ${entry.netPay.toFixed(2)}`, deductionsAmountX - 30, finalY + 6);
    doc.fillColor('#000');

    y = finalY + 28;
    doc.fontSize(7).font('Helvetica').fillColor('#999');
    doc.text(`Generated on ${new Date().toLocaleDateString()}`, leftX, y, { align: 'center', width: 510 });
}

// ─── Overtime Routes ──────────────────────────────────────────────────────────

// POST /api/clients/:clientId/employees/:employeeId/overtime — save overtime record
router.post('/:clientId/employees/:employeeId/overtime', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const employeeId = parseInt(req.params.employeeId, 10);
        if (isNaN(clientId) || isNaN(employeeId)) return res.status(400).json({ message: 'Invalid ID' });

        const { period, hours, rate, multiplier, amount } = req.body;
        if (!period) return res.status(400).json({ message: 'Period is required' });

        const now = new Date().toISOString();

        // Upsert: delete existing for this employee/period, then insert
        await db
            .deleteFrom('overtime_records')
            .where('clientId', '=', clientId)
            .where('employeeId', '=', employeeId)
            .where('period', '=', period)
            .execute();

        if (hours > 0) {
            await db
                .insertInto('overtime_records')
                .values({
                    clientId,
                    employeeId,
                    period,
                    hours: hours || 0,
                    rate: rate || 0,
                    multiplier: multiplier || 1,
                    amount: amount || 0,
                    description: '',
                    createdAt: now,
                })
                .execute();
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error saving overtime:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/employees/:employeeId/overtime?period=YYYY-MM
router.delete('/:clientId/employees/:employeeId/overtime', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const employeeId = parseInt(req.params.employeeId, 10);
        if (isNaN(clientId) || isNaN(employeeId)) return res.status(400).json({ message: 'Invalid ID' });

        const period = req.query.period as string;
        if (!period) return res.status(400).json({ message: 'period query parameter is required' });

        await db
            .deleteFrom('overtime_records')
            .where('clientId', '=', clientId)
            .where('employeeId', '=', employeeId)
            .where('period', '=', period)
            .execute();

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting overtime:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/payroll-runs/:id/overtime — fetch overtime records for a run's period
router.get('/:clientId/payroll-runs/:id/overtime', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const run = await db
            .selectFrom('payroll_runs')
            .select('period')
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        if (!run) return res.status(404).json({ message: 'Run not found' });

        const records = await db
            .selectFrom('overtime_records')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('period', '=', run.period)
            .execute();

        res.json(records);
    } catch (err) {
        console.error('Error fetching overtime:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/overtime-by-period?period=YYYY-MM — overtime by period (no run needed)
router.get('/:clientId/overtime-by-period', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const period = req.query.period as string;
        if (!period) return res.status(400).json({ message: 'period query parameter is required (YYYY-MM)' });

        const records = await db
            .selectFrom('overtime_records')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('period', '=', period)
            .execute();

        res.json(records);
    } catch (err) {
        console.error('Error fetching overtime:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── P10/P11 Reports ──────────────────────────────────────────────────────────

// GET /api/clients/:clientId/p10 — annual PAYE reconciliation for a given year
router.get('/:clientId/p10', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const year = req.query.year || new Date().getFullYear().toString();
        const client = await db.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();

        // Fetch all payroll runs for the given year
        const runs = await db
            .selectFrom('payroll_runs')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('period', '>=', `${year}-01`)
            .where('period', '<=', `${year}-12`)
            .where('status', '=', 'completed')
            .orderBy('period', 'asc')
            .execute();

        // Fetch all entries for those runs
        const runIds = runs.map(r => r.id);
        let entries: any[] = [];
        if (runIds.length > 0) {
            entries = await db
                .selectFrom('payroll_entries')
                .selectAll()
                .where('payrollRunId', 'in', runIds)
                .orderBy('employeeName', 'asc')
                .execute();
        }

        // Aggregate by employee
        const employeeMap = new Map<string, any>();
        for (const e of entries) {
            const key = e.kraPin;
            if (!employeeMap.has(key)) {
                employeeMap.set(key, {
                    kraPin: e.kraPin,
                    employeeName: e.employeeName,
                    monthsWorked: 0,
                    totalGross: 0,
                    totalPaye: 0,
                    totalSha: 0,
                    totalNssf: 0,
                    totalAhl: 0,
                    totalNet: 0,
                });
            }
            const rec = employeeMap.get(key)!;
            rec.monthsWorked++;
            rec.totalGross += e.grossPay;
            rec.totalPaye += e.payeTax;
            rec.totalSha += e.shaDeduction;
            rec.totalNssf += e.nssfDeduction;
            rec.totalAhl += e.ahlDeduction;
            rec.totalNet += e.netPay;
        }

        const employees = Array.from(employeeMap.values()).map(e => ({
            ...e,
            totalGross: roundMoney(e.totalGross),
            totalPaye: roundMoney(e.totalPaye),
            totalSha: roundMoney(e.totalSha),
            totalNssf: roundMoney(e.totalNssf),
            totalAhl: roundMoney(e.totalAhl),
            totalNet: roundMoney(e.totalNet),
        }));

        res.json({
            year,
            clientName: client?.name || '',
            clientPin: client?.pin || '',
            totalEmployees: employees.length,
            totalPaye: roundMoney(employees.reduce((s, e) => s + e.totalPaye, 0)),
            totalGross: roundMoney(employees.reduce((s, e) => s + e.totalGross, 0)),
            employeeDetails: employees,
        });
    } catch (err) {
        console.error('Error generating P10 report:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/p11/:kraPin — individual employee annual deduction card
router.get('/:clientId/p11/:kraPin', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const { kraPin } = req.params;
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const year = req.query.year || new Date().getFullYear().toString();
        const client = await db.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();

        // Fetch all runs in the year
        const runs = await db
            .selectFrom('payroll_runs')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('period', '>=', `${year}-01`)
            .where('period', '<=', `${year}-12`)
            .where('status', '=', 'completed')
            .orderBy('period', 'asc')
            .execute();

        const runIds = runs.map(r => r.id);
        let entries: any[] = [];
        if (runIds.length > 0) {
            entries = await db
                .selectFrom('payroll_entries')
                .selectAll()
                .where('payrollRunId', 'in', runIds)
                .where('kraPin', '=', kraPin)
                .orderBy('payrollRunId', 'asc')
                .execute();
        }

        const monthly = runs.map(run => {
            const entry = entries.find(e => e.payrollRunId === run.id);
            return {
                period: run.period,
                periodLabel: run.periodLabel,
                grossPay: entry ? entry.grossPay : 0,
                payeTax: entry ? entry.payeTax : 0,
                shaDeduction: entry ? entry.shaDeduction : 0,
                nssfDeduction: entry ? entry.nssfDeduction : 0,
                ahlDeduction: entry ? entry.ahlDeduction : 0,
                netPay: entry ? entry.netPay : 0,
            };
        });

        const totals = {
            totalGross: roundMoney(monthly.reduce((s, m) => s + m.grossPay, 0)),
            totalPaye: roundMoney(monthly.reduce((s, m) => s + m.payeTax, 0)),
            totalSha: roundMoney(monthly.reduce((s, m) => s + m.shaDeduction, 0)),
            totalNssf: roundMoney(monthly.reduce((s, m) => s + m.nssfDeduction, 0)),
            totalAhl: roundMoney(monthly.reduce((s, m) => s + m.ahlDeduction, 0)),
            totalNet: roundMoney(monthly.reduce((s, m) => s + m.netPay, 0)),
        };

        const employeeName = entries.length > 0 ? entries[0].employeeName : kraPin;

        res.json({
            year,
            kraPin,
            employeeName,
            clientName: client?.name || '',
            clientPin: client?.pin || '',
            monthly,
            totals,
            monthsFiled: monthly.filter(m => m.grossPay > 0).length,
        });
    } catch (err) {
        console.error('Error generating P11 report:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/p10/pdf — download P10 as PDF
router.get('/:clientId/p10/pdf', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const year = req.query.year || new Date().getFullYear().toString();
        const client = await db.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();

        // Fetch data
        const runs = await db
            .selectFrom('payroll_runs')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('period', '>=', `${year}-01`)
            .where('period', '<=', `${year}-12`)
            .where('status', '=', 'completed')
            .orderBy('period', 'asc')
            .execute();

        const runIds = runs.map(r => r.id);
        let entries: any[] = [];
        if (runIds.length > 0) {
            entries = await db
                .selectFrom('payroll_entries')
                .selectAll()
                .where('payrollRunId', 'in', runIds)
                .orderBy('employeeName', 'asc')
                .execute();
        }

        // Aggregate
        const employeeMap = new Map<string, any>();
        for (const e of entries) {
            const key = e.kraPin;
            if (!employeeMap.has(key)) {
                employeeMap.set(key, { kraPin: e.kraPin, employeeName: e.employeeName, monthsWorked: 0, totalGross: 0, totalPaye: 0 });
            }
            const rec = employeeMap.get(key)!;
            rec.monthsWorked++;
            rec.totalGross += e.grossPay;
            rec.totalPaye += e.payeTax;
        }

        const employees = Array.from(employeeMap.values()).map(e => ({
            ...e,
            totalGross: roundMoney(e.totalGross),
            totalPaye: roundMoney(e.totalPaye),
        }));

        // Generate PDF
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=P10_${year}.pdf`);
        doc.pipe(res);

        doc.fontSize(14).font('Helvetica-Bold').text('P10 — ANNUAL PAYE RECONCILIATION', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica').text(`Year: ${year}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(8).font('Helvetica');
        doc.text(`Employer: ${client?.name || ''}`);
        doc.text(`KRA PIN: ${client?.pin || ''}`);
        doc.moveDown(0.5);

        // Summary
        doc.fontSize(9).font('Helvetica-Bold').text('Summary', 40, doc.y);
        doc.moveDown(0.3);
        doc.fontSize(8).font('Helvetica');
        doc.text(`Total Employees: ${employees.length}`, 40, doc.y);
        doc.text(`Total Gross Pay: KES ${roundMoney(employees.reduce((s, e) => s + e.totalGross, 0)).toLocaleString()}`, 40, doc.y);
        doc.text(`Total PAYE Deducted: KES ${roundMoney(employees.reduce((s, e) => s + e.totalPaye, 0)).toLocaleString()}`, 40, doc.y);
        doc.moveDown(0.5);

        // Table
        doc.fontSize(8).font('Helvetica-Bold');
        doc.text('Employee', 40, doc.y);
        doc.text('KRA PIN', 200, doc.y - 8);
        doc.text('Months', 310, doc.y - 8);
        doc.text('Gross Pay', 370, doc.y - 8);
        doc.text('PAYE', 460, doc.y - 8);
        doc.moveDown(0.3);

        doc.fontSize(7).font('Helvetica');
        employees.forEach(emp => {
            doc.text(emp.employeeName.substring(0, 25), 40, doc.y);
            doc.text(emp.kraPin, 200, doc.y - 8);
            doc.text(String(emp.monthsWorked), 310, doc.y - 8);
            doc.text(emp.totalGross.toLocaleString(), 370, doc.y - 8);
            doc.text(emp.totalPaye.toLocaleString(), 460, doc.y - 8);
        });

        doc.moveDown(1);
        doc.fontSize(7).text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.end();
    } catch (err) {
        console.error('Error generating P10 PDF:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/p11/:kraPin/pdf — download P11 as PDF
router.get('/:clientId/p11/:kraPin/pdf', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const { kraPin } = req.params;
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const year = req.query.year || new Date().getFullYear().toString();
        const client = await db.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();

        const runs = await db
            .selectFrom('payroll_runs')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('period', '>=', `${year}-01`)
            .where('period', '<=', `${year}-12`)
            .where('status', '=', 'completed')
            .orderBy('period', 'asc')
            .execute();

        const runIds = runs.map(r => r.id);
        let entries: any[] = [];
        if (runIds.length > 0) {
            entries = await db
                .selectFrom('payroll_entries')
                .selectAll()
                .where('payrollRunId', 'in', runIds)
                .where('kraPin', '=', kraPin)
                .orderBy('payrollRunId', 'asc')
                .execute();
        }

        const employeeName = entries.length > 0 ? entries[0].employeeName : kraPin;

        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=P11_${kraPin}_${year}.pdf`);
        doc.pipe(res);

        doc.fontSize(14).font('Helvetica-Bold').text('P11 — EMPLOYEE ANNUAL DEDUCTION CARD', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica').text(`Year: ${year}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(8).font('Helvetica');
        doc.text(`Employer: ${client?.name || ''}`);
        doc.text(`Employee: ${employeeName}`);
        doc.text(`KRA PIN: ${kraPin}`);
        doc.moveDown(0.5);

        // Monthly breakdown
        doc.fontSize(9).font('Helvetica-Bold').text('Monthly Breakdown', 40, doc.y);
        doc.moveDown(0.3);
        doc.fontSize(7).font('Helvetica-Bold');
        doc.text('Month', 40, doc.y);
        doc.text('Gross', 110, doc.y - 8);
        doc.text('PAYE', 170, doc.y - 8);
        doc.text('SHA', 220, doc.y - 8);
        doc.text('NSSF', 270, doc.y - 8);
        doc.text('AHL', 320, doc.y - 8);
        doc.text('Net', 370, doc.y - 8);
        doc.moveDown(0.3);

        doc.fontSize(7).font('Helvetica');
        let totalGross = 0, totalPaye = 0, totalSha = 0, totalNssf = 0, totalAhl = 0, totalNet = 0;

        runs.forEach(run => {
            const entry = entries.find(e => e.payrollRunId === run.id);
            const gross = entry ? entry.grossPay : 0;
            const paye = entry ? entry.payeTax : 0;
            const sha = entry ? entry.shaDeduction : 0;
            const nssf = entry ? entry.nssfDeduction : 0;
            const ahl = entry ? entry.ahlDeduction : 0;
            const net = entry ? entry.netPay : 0;

            totalGross += gross; totalPaye += paye; totalSha += sha;
            totalNssf += nssf; totalAhl += ahl; totalNet += net;

            doc.text(run.periodLabel || run.period, 40, doc.y);
            doc.text(gross.toFixed(2), 110, doc.y - 8);
            doc.text(paye.toFixed(2), 170, doc.y - 8);
            doc.text(sha.toFixed(2), 220, doc.y - 8);
            doc.text(nssf.toFixed(2), 270, doc.y - 8);
            doc.text(ahl.toFixed(2), 320, doc.y - 8);
            doc.text(net.toFixed(2), 370, doc.y - 8);
        });

        doc.moveDown(0.3);
        doc.fontSize(7).font('Helvetica-Bold');
        doc.text('TOTAL', 40, doc.y);
        doc.text(totalGross.toFixed(2), 110, doc.y - 8);
        doc.text(totalPaye.toFixed(2), 170, doc.y - 8);
        doc.text(totalSha.toFixed(2), 220, doc.y - 8);
        doc.text(totalNssf.toFixed(2), 270, doc.y - 8);
        doc.text(totalAhl.toFixed(2), 320, doc.y - 8);
        doc.text(totalNet.toFixed(2), 370, doc.y - 8);

        doc.moveDown(1);
        doc.fontSize(7).font('Helvetica').text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.end();
    } catch (err) {
        console.error('Error generating P11 PDF:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

function roundMoney(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

// ─── Compliance File Generation ─────────────────────────────────────────────

// POST /api/clients/:clientId/payroll-runs/:id/generate-compliance
router.post('/:clientId/payroll-runs/:id/generate-compliance', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const { generatePaye, generateNssf, generateSha } = req.body;

        const result = await generateComplianceFromPayrollRun(id, clientId, {
            generatePaye: generatePaye !== false,
            generateNssf: generateNssf !== false,
            generateSha: generateSha !== false,
        });

        // Update client table with generated file URLs and amounts
        const updates: Record<string, any> = {};
        if (result.payeZipUrl) {
            updates.payeZipUrl = result.payeZipUrl;
            updates.payeZipLabel = result.payeZipLabel;
        }
        if (result.nssfFileUrl) {
            updates.nssfFileUrl = result.nssfFileUrl;
            updates.nssfFileLabel = result.nssfFileLabel;
        }
        if (result.shaFileUrl) {
            updates.shaFileUrl = result.shaFileUrl;
            updates.shaFileLabel = result.shaFileLabel;
        }
        updates.payeAmount = result.summaryAmounts.payeAmount;
        updates.nitaAmount = result.summaryAmounts.nitaAmount;
        updates.housingLevyAmount = result.summaryAmounts.housingLevyAmount;
        updates.nssfAmount = result.summaryAmounts.nssfAmount;
        updates.shaAmount = result.summaryAmounts.shaAmount;

        await db.updateTable('clients').set(updates).where('id', '=', clientId).execute();

        res.json({
            payeZipUrl: result.payeZipUrl,
            payeZipLabel: result.payeZipLabel,
            nssfFileUrl: result.nssfFileUrl,
            nssfFileLabel: result.nssfFileLabel,
            shaFileUrl: result.shaFileUrl,
            shaFileLabel: result.shaFileLabel,
            summaryAmounts: result.summaryAmounts,
        });
    } catch (err: any) {
        console.error('Error generating compliance files:', err);
        if (err.message === 'Payroll run not found' || err.message === 'Client not found') {
            res.status(404).json({ message: err.message });
        } else if (err.message === 'No payroll entries found for this run') {
            res.status(400).json({ message: err.message });
        } else {
            res.status(500).json({ message: err.message || 'Failed to generate compliance files' });
        }
    }
});

// ─── Attendance Payroll Approval Workflow ─────────────────────────────────────

// POST /api/clients/:clientId/attendance-payroll-preview
router.post('/:clientId/attendance-payroll-preview', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const period = req.query.period as string;
        if (!period) return res.status(400).json({ message: 'period query parameter is required (YYYY-MM)' });

        const employees = await db.selectFrom('employees').selectAll().where('clientId', '=', clientId).where('employmentStatus', '=', 'Active').execute();
        const empMap = new Map(employees.map(e => [e.id, e]));

        // Check for existing approvals (used only for the approved flag)
        const existingApprovals = await db
            .selectFrom('attendance_payroll_approvals')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('period', '=', period)
            .execute();
        const approvalMap = new Map(existingApprovals.map(a => [a.employeeId, a]));

        // Always recalculate from live attendance records so new marks appear immediately
        const [yearStr, monthStr] = period.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const daysInMonth = new Date(year, month, 0).getDate();
        const periodStart = `${period}-01`;
        const periodEnd = `${period}-${String(daysInMonth).padStart(2, '0')}`;

        // Fetch attendance records, sorted by most recent first so we can deduplicate
        const attendanceRecords = await db
            .selectFrom('attendance_records')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('date', '>=', periodStart)
            .where('date', '<=', periodEnd)
            .orderBy('id', 'desc')
            .execute();

        // Deduplicate: keep only the most recent record per employee per day
        const latestAttByDay = new Map<string, typeof attendanceRecords[0]>();
        for (const ar of attendanceRecords) {
            const key = `${ar.employeeId}-${ar.date}`;
            if (!latestAttByDay.has(key)) {
                latestAttByDay.set(key, ar);
            }
        }

        const overtimeRecords = await db
            .selectFrom('overtime_records')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('period', '=', period)
            .execute();

        const absentMap = new Map<number, number>();
        const lateHoursMap = new Map<number, number>();
        const otMap = new Map<number, any>();

        for (const ar of latestAttByDay.values()) {
            if (ar.status === 'Absent') {
                absentMap.set(ar.employeeId, (absentMap.get(ar.employeeId) || 0) + 1);
            } else if (ar.status === 'Half-Day') {
                absentMap.set(ar.employeeId, (absentMap.get(ar.employeeId) || 0) + 0.5);
            } else if (ar.status === 'Late') {
                const emp = empMap.get(ar.employeeId);
                const checkIn = ar.checkIn || '';
                const standardIn = emp?.standardCheckIn || '08:00';
                const [cH, cM] = checkIn.split(':').map(Number);
                const [sH, sM] = standardIn.split(':').map(Number);
                if (!isNaN(cH) && !isNaN(sH)) {
                    const lateMins = Math.max(0, (cH * 60 + (cM || 0)) - (sH * 60 + (sM || 0)));
                    lateHoursMap.set(ar.employeeId, (lateHoursMap.get(ar.employeeId) || 0) + lateMins / 60);
                }
            }
        }

        for (const ot of overtimeRecords) {
            otMap.set(ot.employeeId, ot);
        }

        const result = employees.map(emp => {
            const ot = otMap.get(emp.id);
            const existingApproval = approvalMap.get(emp.id);
            return {
                employeeId: emp.id,
                employeeName: emp.employeeName,
                absentDays: absentMap.get(emp.id) || 0,
                lateHours: Math.round((lateHoursMap.get(emp.id) || 0) * 100) / 100,
                overtimeHours: ot?.hours || 0,
                overtimeRate: ot?.rate || Math.round((emp.basicPay || 0) / 240 * 100) / 100,
                overtimeMultiplier: ot?.multiplier || 1.5,
                overtimeAmount: ot?.amount || 0,
                approved: !!existingApproval?.approvedAt,
            };
        });

        res.json({ period, employees: result });
    } catch (err) {
        console.error('Error generating attendance preview:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/attendance-payroll-approve
router.post('/:clientId/attendance-payroll-approve', async (req, res) => {
    console.log('[approvals] START attendance-payroll-approve');
    console.time('approvals');
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { period, employees: employeeApprovals, approvedBy } = req.body;
        if (!period || !Array.isArray(employeeApprovals)) {
            return res.status(400).json({ message: 'period and employees array are required' });
        }

        const now = new Date().toISOString();
        const [periodYear, periodMonth] = period.split('-').map(Number);
        const daysInMonth = new Date(periodYear, periodMonth, 0).getDate();

        console.log(`[approvals] Processing ${employeeApprovals.length} employees for client ${clientId}, period ${period}...`);

        // Fetch employee + schedule info for per-day record creation
        const empIds = [...new Set(employeeApprovals.map((ea: any) => ea.employeeId))];
        console.log(`[approvals] Fetching ${empIds.length} employees...`);
        const employees = await db.selectFrom('employees').selectAll().where('id', 'in', empIds).where('clientId', '=', clientId).execute();
        const empMap2 = new Map(employees.map(e => [e.id, e]));
        console.log(`[approvals] Found ${employees.length} employees`);

        const schedules = await db.selectFrom('work_schedules').selectAll().where('clientId', '=', clientId).execute();
        const scheduleMap2 = new Map(schedules.map(s => [s.id, s]));
        console.log(`[approvals] Found ${schedules.length} schedules`);

        // Build a Set of all existing (clientId, employeeId, date) for O(1) lookups
        console.log('[approvals] Fetching existing attendance...');
        const allExisting = await db
            .selectFrom('attendance_records')
            .select(['id', 'employeeId', 'date'])
            .where('clientId', '=', clientId)
            .where('date', '>=', `${period}-01`)
            .where('date', '<=', `${period}-${String(daysInMonth).padStart(2, '0')}`)
            .execute();
        // Clean up old auto-generated attendance records for this period (from previous review runs)
        console.log('[approvals] Cleaning up old auto-generated attendance_records...');
        await db.deleteFrom('attendance_records')
            .where('clientId', '=', clientId)
            .where('date', '>=', `${period}-01`)
            .where('date', '<=', `${period}-${String(daysInMonth).padStart(2, '0')}`)
            .where('notes', 'like', '%review%')
            .execute();

        // Also delete ALL absent/half-day records for employees now approved with 0 absent days
        const zeroAbsentEmpIds = employeeApprovals
            .filter((ea: any) => !(ea.absentDays > 0))
            .map((ea: any) => ea.employeeId);
        if (zeroAbsentEmpIds.length > 0) {
            console.log(`[approvals] Deleting all absent records for ${zeroAbsentEmpIds.length} employees with 0 absent days...`);
            await db.deleteFrom('attendance_records')
                .where('clientId', '=', clientId)
                .where('date', '>=', `${period}-01`)
                .where('date', '<=', `${period}-${String(daysInMonth).padStart(2, '0')}`)
                .where('employeeId', 'in', zeroAbsentEmpIds)
                .where('status', 'in', ['Absent', 'Half-Day'])
                .execute();
        }

        // Refresh existing set after cleanup
        const allExistingAfterCleanup = await db
            .selectFrom('attendance_records')
            .select(['id', 'employeeId', 'date'])
            .where('clientId', '=', clientId)
            .where('date', '>=', `${period}-01`)
            .where('date', '<=', `${period}-${String(daysInMonth).padStart(2, '0')}`)
            .execute();
        const existingSetAfterCleanup = new Set(allExistingAfterCleanup.map(r => `${r.employeeId}-${r.date}`));
        const effectiveExistingSet = existingSetAfterCleanup;
        console.log(`[approvals] Found ${allExistingAfterCleanup.length} existing records after cleanup`);

        // Delete existing approvals for this period
        console.log('[approvals] Deleting old approvals...');
        await db
            .deleteFrom('attendance_payroll_approvals')
            .where('clientId', '=', clientId)
            .where('period', '=', period)
            .execute();
        console.log('[approvals] Old approvals deleted');

        // Insert new approvals (batch)
        if (employeeApprovals.length > 0) {
            console.log('[approvals] Inserting new approvals...');
            await db
                .insertInto('attendance_payroll_approvals')
                .values(employeeApprovals.map(ea => ({
                    clientId,
                    period,
                    employeeId: ea.employeeId,
                    employeeName: ea.employeeName || '',
                    absentDays: ea.absentDays || 0,
                    lateHours: ea.lateHours || 0,
                    overtimeHours: ea.overtimeHours || 0,
                    overtimeRate: ea.overtimeRate || 0,
                    overtimeMultiplier: ea.overtimeMultiplier || 1.5,
                    overtimeAmount: ea.overtimeAmount || 0,
                    approvedBy: approvedBy || null,
                    approvedAt: now,
                    createdAt: now,
                })))
                .execute();
            console.log('[approvals] New approvals inserted');
        }

        // Build absent records to insert (batch across all employees)
        const newRecords: any[] = [];
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        for (const ea of employeeApprovals) {
            const emp = empMap2.get(ea.employeeId);
            if (!emp) continue;

            const absentCount = (ea.absentDays || 0);
            if (absentCount <= 0) continue; // No absences → nothing to create

            // Get schedule config
            const ws = emp.workScheduleId ? scheduleMap2.get(emp.workScheduleId) : null;
            const scheduleConfig = ws && ws.config ? JSON.parse(ws.config) : null;

            // Find work days for this employee
            const workDays: string[] = [];
            for (let d = 1; d <= daysInMonth; d++) {
                const dt = new Date(periodYear, periodMonth - 1, d);
                const dayName = dayNames[dt.getDay()];
                const shortName = dayName.substring(0, 3);

                let isWorkDay = true;
                if (scheduleConfig) {
                    if (!scheduleConfig[shortName] || scheduleConfig[shortName] === 0) isWorkDay = false;
                } else if (dt.getDay() === 0 || dt.getDay() === 6) {
                    isWorkDay = false;
                }
                if (emp.offDay && emp.offDay === dayName) isWorkDay = false;
                if (isWorkDay) workDays.push(`${period}-${String(d).padStart(2, '0')}`);
            }

            // Last N work days → Absent (skip if already has a manual record)
            for (const dateStr of workDays.slice(-absentCount)) {
                if (effectiveExistingSet.has(`${emp.id}-${dateStr}`)) continue;
                newRecords.push({
                    clientId, employeeId: emp.id,
                    employeeName: emp.employeeName || '', kraPin: emp.kraPin || '',
                    date: dateStr, checkIn: '', checkOut: '',
                    status: 'Absent', notes: 'Marked absent from review',
                    createdAt: now, updatedAt: now,
                });
            }
        }

        // Single batch insert across ALL employees
        if (newRecords.length > 0) {
            console.log(`[approvals] Inserting ${newRecords.length} absent-day records...`);
            await db.insertInto('attendance_records').values(newRecords).execute();
            console.log('[approvals] Absent-day records inserted');
        } else {
            console.log('[approvals] No absent-day records to insert');
        }

        // Handle overtime
        const employeesWithOt = employeeApprovals.filter((ea: any) => (ea.overtimeHours || 0) > 0);
        if (employeesWithOt.length > 0) {
            const otEmpIds = employeesWithOt.map((ea: any) => ea.employeeId);
            await db
                .deleteFrom('overtime_records')
                .where('clientId', '=', clientId)
                .where('period', '=', period)
                .where('employeeId', 'in', otEmpIds)
                .execute();

            await db
                .insertInto('overtime_records')
                .values(employeesWithOt.map((ea: any) => ({
                    clientId,
                    employeeId: ea.employeeId,
                    period,
                    hours: ea.overtimeHours,
                    rate: ea.overtimeRate || 0,
                    multiplier: ea.overtimeMultiplier || 1.5,
                    amount: ea.overtimeAmount || 0,
                    description: 'Auto-generated from review',
                    createdAt: now,
                })))
                .execute();
            console.log(`[approvals] ${employeesWithOt.length} OT records inserted`);
        }

        console.timeEnd('approvals');
        console.log('[approvals] DONE');
        res.json({ success: true, approved: employeeApprovals.length });
    } catch (err) {
        console.log('[approvals] ERROR:', err);
        console.timeEnd('approvals');
        res.status(500).json({ message: 'Internal server error', error: err instanceof Error ? err.message : String(err) });
    }
});

// POST /:clientId/payroll-runs/:id/finalize — Create loan transactions, decrement remainingInstallments, lock void
router.post('/:clientId/payroll-runs/:id/finalize', async (req, res) => {
    try {
        const payrollRunId = parseInt(req.params.id, 10);
        const run = await db
            .selectFrom('payroll_runs')
            .selectAll()
            .where('id', '=', payrollRunId)
            .executeTakeFirst();
        if (!run) return res.status(404).json({ message: 'Payroll run not found' });
        if (run.lockedAt) return res.status(409).json({ message: 'This payroll run is already finalized.' });

        // Load entries
        const entries = await db
            .selectFrom('payroll_entries')
            .selectAll()
            .where('payrollRunId', '=', payrollRunId)
            .execute();

        const now = new Date().toISOString();
        const warnings: string[] = [];

        // 1/3 rule validation
        for (const e of entries) {
            // Minimum net = gross / 3
            if (e.netPay < e.grossPay / 3) {
                warnings.push(
                    `1/3 rule: ${e.employeeName} net pay KES ${Math.round(e.netPay).toLocaleString()} is below 1/3 of gross KES ${Math.round(e.grossPay / 3).toLocaleString()}`,
                );
            }
        }

        // Process loan deductions (ledger-based)
        for (const entry of entries) {
            if (entry.loanDeduction <= 0) continue;
            // Find active loan for this employee
            const loans = await db
                .selectFrom('loans')
                .selectAll()
                .where('clientId', '=', entry.clientId)
                .where('employeeId', '=', entry.employeeId)
                .where('remainingInstallments', '>', 0)
                .execute();
            const loan = loans[0];
            if (!loan) continue;

            await db
                .insertInto('loan_transactions')
                .values({
                    clientId: entry.clientId,
                    employeeId: entry.employeeId,
                    payrollRunId,
                    loanId: loan.id,
                    amount: entry.loanDeduction,
                    type: 'deduction',
                    createdAt: now,
                })
                .execute();
            await db
                .updateTable('loans')
                .set({
                    remainingInstallments: loan.remainingInstallments - 1,
                    updatedAt: now,
                })
                .where('id', '=', loan.id)
                .execute();
        }

        // Lock the run
        await db
            .updateTable('payroll_runs')
            .set({ lockedAt: now, updatedAt: now, status: 'closed' })
            .where('id', '=', payrollRunId)
            .execute();

        res.json({ success: true, finalizedAt: now, warnings, entryCount: entries.length });
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to finalize run', error: err.message });
    }
});

// POST /:clientId/payroll-runs/:id/rollback — Reverse loan transactions, restore balances, unlock void
router.post('/:clientId/payroll-runs/:id/rollback', async (req, res) => {
    try {
        const payrollRunId = parseInt(req.params.id, 10);
        const run = await db
            .selectFrom('payroll_runs')
            .selectAll()
            .where('id', '=', payrollRunId)
            .executeTakeFirst();
        if (!run) return res.status(404).json({ message: 'Payroll run not found' });
        if (!run.lockedAt) return res.status(409).json({ message: 'This payroll run is not finalized yet.' });

        const transactions = await db
            .selectFrom('loan_transactions')
            .selectAll()
            .where('payrollRunId', '=', payrollRunId)
            .execute();

        const now = new Date().toISOString();

        // Restore loan installments
        for (const tx of transactions) {
            const loan = await db
                .selectFrom('loans')
                .selectAll()
                .where('id', '=', tx.loanId)
                .executeTakeFirst();
            if (loan) {
                await db
                    .updateTable('loans')
                    .set({
                        remainingInstallments: loan.remainingInstallments + 1,
                        updatedAt: now,
                    })
                    .where('id', '=', loan.id)
                    .execute();
            }
        }

        // Delete loan transactions
        await db.deleteFrom('loan_transactions').where('payrollRunId', '=', payrollRunId).execute();

        // Delete any dynamic adjustments for this run
        await db.deleteFrom('payroll_adjustments').where('payrollRunId', '=', payrollRunId).execute();

        // Unlock run
        await db
            .updateTable('payroll_runs')
            .set({ lockedAt: null, updatedAt: now })
            .where('id', '=', payrollRunId)
            .execute();

        res.json({ success: true, restoredLoans: transactions.length });
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to rollback run', error: err.message });
    }
});

// GET /:clientId/payroll-runs/:id/adjustments — List dynamic adjustments for a run
router.get('/:clientId/payroll-runs/:id/adjustments', async (req, res) => {
    try {
        const payrollRunId = parseInt(req.params.id, 10);
        const adjustments = await db
            .selectFrom('payroll_adjustments')
            .selectAll()
            .where('payrollRunId', '=', payrollRunId)
            .execute();
        res.json(adjustments);
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to load adjustments', error: err.message });
    }
});

// POST /:clientId/payroll-runs/:id/adjustments — Create a dynamic adjustment
router.post('/:clientId/payroll-runs/:id/adjustments', async (req, res) => {
    try {
        const payrollRunId = parseInt(req.params.id, 10);
        const { employeeId, type, label, amount, isStatutory = false } = req.body;
        if (!employeeId || !type || !label || amount === undefined) {
            return res.status(400).json({ message: 'Missing required fields: employeeId, type, label, amount' });
        }
        const run = await db.selectFrom('payroll_runs').select('lockedAt').where('id', '=', payrollRunId).executeTakeFirst();
        if (run?.lockedAt) {
            return res.status(409).json({ message: 'Cannot modify adjustments on a finalized run.' });
        }
        const now = new Date().toISOString();
        const result = await db
            .insertInto('payroll_adjustments')
            .values({
                payrollRunId,
                employeeId: Number(employeeId),
                payrollEntryId: 0, // not used; employeeId is the stable key
                type,
                label,
                amount: Number(amount),
                isStatutory: isStatutory ? 1 : 0,
                createdAt: now,
            })
            .returningAll()
            .executeTakeFirst();
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to create adjustment', error: err.message });
    }
});

// PUT /:clientId/payroll-runs/:id/adjustments/:adjId — Update an adjustment
router.put('/:clientId/payroll-runs/:id/adjustments/:adjId', async (req, res) => {
    try {
        const payrollRunId = parseInt(req.params.id, 10);
        const adjId = parseInt(req.params.adjId, 10);
        const { type, label, amount, isStatutory } = req.body;
        const run = await db.selectFrom('payroll_runs').select('lockedAt').where('id', '=', payrollRunId).executeTakeFirst();
        if (run?.lockedAt) {
            return res.status(409).json({ message: 'Cannot modify adjustments on a finalized run.' });
        }
        const updateData: any = {};
        if (type !== undefined) updateData.type = type;
        if (label !== undefined) updateData.label = label;
        if (amount !== undefined) updateData.amount = Number(amount);
        if (isStatutory !== undefined) updateData.isStatutory = isStatutory ? 1 : 0;
        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }
        await db
            .updateTable('payroll_adjustments')
            .set(updateData)
            .where('id', '=', adjId)
            .where('payrollRunId', '=', payrollRunId)
            .execute();
        const adj = await db.selectFrom('payroll_adjustments').selectAll().where('id', '=', adjId).executeTakeFirst();
        res.json(adj);
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to update adjustment', error: err.message });
    }
});

// DELETE /:clientId/payroll-runs/:id/adjustments/:adjId — Delete an adjustment
router.delete('/:clientId/payroll-runs/:id/adjustments/:adjId', async (req, res) => {
    try {
        const payrollRunId = parseInt(req.params.id, 10);
        const adjId = parseInt(req.params.adjId, 10);
        const run = await db.selectFrom('payroll_runs').select('lockedAt').where('id', '=', payrollRunId).executeTakeFirst();
        if (run?.lockedAt) {
            return res.status(409).json({ message: 'Cannot delete adjustments on a finalized run.' });
        }
        await db
            .deleteFrom('payroll_adjustments')
            .where('id', '=', adjId)
            .where('payrollRunId', '=', payrollRunId)
            .execute();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to delete adjustment', error: err.message });
    }
});

export default router;
