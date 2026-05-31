import { Router } from 'express';
import { db } from '../db/kysely';
import { computePayrollEntry, getScheduledWorkDays, getScheduledDaysIncludingHolidays, getTotalScheduledHours } from '../services/payrollEngine';
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
    const loanTypeMap = new Map<number, string>();
    for (const ln of allLoans) {
        const empId = typeof ln.employeeId === 'string' ? parseInt(ln.employeeId, 10) : ln.employeeId;
        if (isNaN(empId)) continue;
        loanMap.set(empId, (loanMap.get(empId) || 0) + ln.monthlyDeduction);
        if (!loanTypeMap.has(empId)) {
            loanTypeMap.set(empId, ln.loanType || 'Loan');
        }
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

    // Compute attendance-adjusted pay using actual hours worked (matches frontend grid)
    const totalStdHoursMap = new Map<number, number>();
    const otHoursMap = new Map<number, number>();
    const lateHoursMap = new Map<number, number>();
    const lateCountMap = new Map<number, number>();
    const presentCountMap = new Map<number, number>();
    const halfCountMap = new Map<number, number>();
    const absentCountMap = new Map<number, number>();
    const leaveCountMap = new Map<number, number>();
    const offCountMap = new Map<number, number>();
    const paidLeaveHoursMap = new Map<number, number>();

    for (const ar of attendanceRecords) {
        const emp = employees.find(e => e.id === ar.employeeId);
        if (!emp) continue;

        const standardIn = emp.standardCheckIn || '08:00';
        const standardOut = emp.standardCheckOut || '17:00';
        const [siH, siM] = standardIn.split(':').map(Number);
        const [soH, soM] = standardOut.split(':').map(Number);
        const dailyHours = Math.max(1, ((soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0))) / 60);

        if (ar.status === 'Absent') {
            absentCountMap.set(ar.employeeId, (absentCountMap.get(ar.employeeId) || 0) + 1);
            continue;
        }
        if (ar.status === 'Off Day') {
            offCountMap.set(ar.employeeId, (offCountMap.get(ar.employeeId) || 0) + 1);
            continue;
        }
        if (ar.status === 'On Leave') {
            leaveCountMap.set(ar.employeeId, (leaveCountMap.get(ar.employeeId) || 0) + 1);
            // Paid leave hours tracked separately; NOT added to totalStdHours
            const leaveInfo = leaveRecords.find(lr => lr.employeeId === ar.employeeId && lr.status === 'Approved' && ar.date >= lr.startDate && ar.date <= lr.endDate);
            if (leaveInfo && leaveInfo.isPaid === 1) {
                paidLeaveHoursMap.set(ar.employeeId, (paidLeaveHoursMap.get(ar.employeeId) || 0) + (leaveInfo.hours || dailyHours));
            }
            continue;
        }

        const [ciH, ciM] = (ar.checkIn || standardIn).split(':').map(Number);
        const [coH, coM] = (ar.checkOut || standardOut).split(':').map(Number);
        const actualMins = Math.max(0, (coH * 60 + (coM || 0)) - (ciH * 60 + (ciM || 0)));
        const actualHours = actualMins / 60;

        // Late hours for ANY working day (not just status === 'Late')
        if (!isNaN(ciH) && !isNaN(siH)) {
            const lateMins = Math.max(0, (ciH * 60 + (ciM || 0)) - (siH * 60 + (siM || 0)));
            if (lateMins > 0) {
                lateHoursMap.set(ar.employeeId, (lateHoursMap.get(ar.employeeId) || 0) + lateMins / 60);
            }
        }

        if (ar.status === 'Half-Day') {
            halfCountMap.set(ar.employeeId, (halfCountMap.get(ar.employeeId) || 0) + 1);
            totalStdHoursMap.set(ar.employeeId, (totalStdHoursMap.get(ar.employeeId) || 0) + Math.min(actualHours, dailyHours * 0.5));
        } else if (ar.status === 'Late') {
            lateCountMap.set(ar.employeeId, (lateCountMap.get(ar.employeeId) || 0) + 1);
            totalStdHoursMap.set(ar.employeeId, (totalStdHoursMap.get(ar.employeeId) || 0) + Math.min(actualHours, dailyHours));
            otHoursMap.set(ar.employeeId, (otHoursMap.get(ar.employeeId) || 0) + Math.max(0, actualHours - dailyHours));
        } else if (ar.status === 'Present') {
            presentCountMap.set(ar.employeeId, (presentCountMap.get(ar.employeeId) || 0) + 1);
            totalStdHoursMap.set(ar.employeeId, (totalStdHoursMap.get(ar.employeeId) || 0) + Math.min(actualHours, dailyHours));
            otHoursMap.set(ar.employeeId, (otHoursMap.get(ar.employeeId) || 0) + Math.max(0, actualHours - dailyHours));
        }
    }

    // Add paid leave hours for approved leave without attendance records
    for (const lv of leaveRecords) {
        if (lv.status !== 'Approved') continue;
        const isUnpaid = lv.isPaid === 0 || lv.leaveType.toLowerCase().includes('unpaid');
        if (isUnpaid) continue;
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

        const emp = employees.find(e => e.id === lv.employeeId);
        const [siH, siM] = (emp?.standardCheckIn || '08:00').split(':').map(Number);
        const [soH, soM] = (emp?.standardCheckOut || '17:00').split(':').map(Number);
        const dailyHours = Math.max(1, ((soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0))) / 60);

        const current = new Date(overlapStart);
        while (current <= overlapEnd) {
            const dateStr = current.toISOString().slice(0, 10);
            const hasRecord = attendanceRecords.some(ar => ar.employeeId === lv.employeeId && ar.date === dateStr);
            if (!hasRecord) {
                paidLeaveHoursMap.set(lv.employeeId, (paidLeaveHoursMap.get(lv.employeeId) || 0) + (lv.hours || dailyHours));
            }
            current.setDate(current.getDate() + 1);
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
        const scheduleConfig = schedule && schedule.config ? JSON.parse(schedule.config) : null;
        const scheduledDays = getScheduledWorkDays(scheduleConfig, run.period, holidays);
        const scheduledDaysIncludingHolidays = getScheduledDaysIncludingHolidays(scheduleConfig, run.period);

        // Compute attendance-adjusted basic pay from actual hours worked (matches frontend)
        const totalStdHours = totalStdHoursMap.get(emp.id) || 0;
        const otHours = otHoursMap.get(emp.id) || 0;
        const paidLeaveHours = paidLeaveHoursMap.get(emp.id) || 0;
        const lateHrs = lateHoursMap.get(emp.id) || 0;
        const absentCount = absentCountMap.get(emp.id) || 0;
        const [siH, siM] = (emp.standardCheckIn || '08:00').split(':').map(Number);
        const [soH, soM] = (emp.standardCheckOut || '17:00').split(':').map(Number);
        const dailyHours = Math.max(1, ((soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0))) / 60);
        const totalScheduledHours = getTotalScheduledHours(scheduleConfig, run.period);
        const hourlyRate = (emp.hourlyRate || (Math.round((emp.basicPay / Math.max(1, totalScheduledHours)) * 100000000) / 100000000)) || 0;
        const otRate = Math.round(hourlyRate * 1.5 * 100) / 100;
        const paidLeaveAmount = Math.round(paidLeaveHours * hourlyRate * 100) / 100;
        const overtimePay = Math.round(otHours * otRate * 100) / 100;

        // Compute holiday hours (paid days off from the holidays table)
        const [runYear, runMonth] = run.period.split('-').map(Number);
        const daysInPeriod = new Date(runYear, runMonth, 0).getDate();
        let holidayHours = 0;
        for (let d = 1; d <= daysInPeriod; d++) {
            const date = new Date(runYear, runMonth - 1, d);
            const dateStr = `${runYear}-${String(runMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const monthDay = `${String(runMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            let isRealHoliday = false;
            for (const h of holidays) {
                if (h.date === dateStr) { isRealHoliday = true; break; }
                if (h.isRecurring === 1 && h.date.substring(5) === monthDay) { isRealHoliday = true; break; }
            }
            if (isRealHoliday) {
                const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
                holidayHours += scheduleConfig ? (scheduleConfig[dayName] || 0) : dailyHours;
            }
        }

        // For prorated: override basicPay with total paid standard hours × rate
        // Overtime is kept separate so it is NOT double-counted in grossPay
        const adjustedBasicPay = payStructure === 'prorated'
            ? Math.round((totalStdHours + holidayHours + paidLeaveHours) * hourlyRate * 100) / 100
            : undefined;

        const entry: any = computePayrollEntry(
            {
                employeeId: emp.id,
                employeeName: emp.employeeName,
                kraPin: emp.kraPin,
                payrollNumber: emp.payrollNumber,
                basicPay: emp.basicPay,
                basicPayOverride: adjustedBasicPay,
                carBenefit: emp.carBenefit || 0,
                mealsBenefit: emp.mealsBenefit || 0,
                nonCashBenefits: emp.nonCashBenefits || 0,
                housingBenefit: emp.housingBenefit || 0,
                otherBenefits: emp.otherBenefits || 0,
                dateJoined: emp.dateJoined,
                dateLeft: emp.dateLeft,
                employmentStatus: emp.employmentStatus,
                loanDeduction: loanMap.get(emp.id) || 0,
                // For prorated: unpaid leave is already excluded from basicPayOverride
                // (unpaid leave hours are NOT counted in totalStdHours). Passing unpaidLeaveDays
                // here would double-deduct them from grossPay.
                unpaidLeaveDays: payStructure === 'fixed' ? (leaveMap.get(emp.id) || 0) : 0,
                payStructure,
                overtimePay: payStructure === 'fixed' ? overtimePay : 0,
                attendanceAbsentDays: payStructure === 'fixed' ? absentCount : 0,
                attendanceLateDays: payStructure === 'fixed' ? lateHrs : 0,
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
        entry.totalStdHours = Math.round(totalStdHours * 100) / 100;
        entry.holidayHours = Math.round(holidayHours * 100) / 100;
        entry.paidLeaveHours = Math.round(paidLeaveHours * 100) / 100;
        entry.totalPaidStdHours = Math.round((totalStdHours + holidayHours + paidLeaveHours) * 100) / 100;
        entry.absentDays = absentCount;
        entry.lateDays = Math.round(lateHrs * 100) / 100;
        entry.nssfNo = emp.nssfNo || '';
        entry.shaNo = emp.shaNo || '';
        entry.loanType = loanTypeMap.get(emp.id) || 'Loan';
        entry.period = run.period;
        entry.scheduledWorkDays = scheduledDaysIncludingHolidays;
        entry.totalScheduledHours = totalScheduledHours;
        entry.hourlyRate = hourlyRate;

        // ═══════════════════════════════════════════════════════
        // Attendance pay breakdown — MUST match the grid exactly
        // ═══════════════════════════════════════════════════════
        // Compute absentHours and unpaidLeaveHours from work schedule config
        // (same logic as AttendanceCalendarGrid)
        let absentHours = 0;
        for (const ar of attendanceRecords) {
            if (ar.employeeId !== emp.id) continue;
            if (ar.status !== 'Absent') continue;
            const d = parseInt(ar.date.split('-')[2], 10);
            const date = new Date(runYear, runMonth - 1, d);
            const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
            absentHours += scheduleConfig ? (scheduleConfig[dayName] || 0) : dailyHours;
        }

        let unpaidLeaveHours = 0;
        for (const lv of leaveRecords) {
            if (lv.employeeId !== emp.id) continue;
            if (lv.status !== 'Approved') continue;
            const isUnpaid = lv.isPaid === 0 || lv.leaveType.toLowerCase().includes('unpaid');
            if (!isUnpaid) continue;
            const lvStart = new Date(lv.startDate);
            const lvEnd = lv.endDate ? new Date(lv.endDate) : new Date(lv.startDate);
            const periodStart = new Date(runYear, runMonth - 1, 1);
            const periodEnd = new Date(runYear, runMonth, 0);
            const overlapStart = lvStart > periodStart ? lvStart : periodStart;
            const overlapEnd = lvEnd < periodEnd ? lvEnd : periodEnd;
            if (overlapStart > overlapEnd) continue;
            const current = new Date(overlapStart);
            while (current <= overlapEnd) {
                const d = current.getDate();
                const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][current.getDay()];
                unpaidLeaveHours += scheduleConfig ? (scheduleConfig[dayName] || 0) : dailyHours;
                current.setDate(current.getDate() + 1);
            }
        }

        // For fixed employees with no deductions, stdPayAmount equals basicPay exactly
        const hasAttendanceDeductions = absentHours > 0 || lateHrs > 0 || unpaidLeaveHours > 0;
        entry.stdPayAmount = (payStructure === 'fixed' && !hasAttendanceDeductions)
            ? entry.basicPay
            : Math.round(totalStdHours * hourlyRate * 100) / 100;
        entry.holidayPayAmount = Math.round(holidayHours * hourlyRate * 100) / 100;
        entry.paidLeavePayAmount = Math.round(paidLeaveHours * hourlyRate * 100) / 100;
        // Store attendance breakdown for ALL employees (payslip display)
        // For FIXED: these are actual deductions subtracted by computePayrollEntry
        // For PRORATED: these are informational (already reflected in lower stdPayAmount)
        entry.absentHours = Math.round(absentHours * 100) / 100;
        entry.absentDedAmount = Math.round(absentHours * hourlyRate * 100) / 100;
        entry.lateHours = Math.round(lateHrs * 100) / 100;
        entry.lateDedAmount = Math.round(lateHrs * hourlyRate * 100) / 100;
        entry.unpaidLeaveHours = Math.round(unpaidLeaveHours * 100) / 100;
        entry.unpaidLeaveDedAmount = Math.round(unpaidLeaveHours * hourlyRate * 100) / 100;
        return entry;
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
                totalStdHours: entry.totalStdHours || 0,
                unpaidLeaveDays: entry.unpaidLeaveDays,
                loanDeduction: entry.loanDeduction,
                overtimePay: entry.overtimePay,
                absentDays: entry.absentDays,
                lateDays: entry.lateDays,
                bonusPay: entry.bonusPay || 0,
                taxableBonus: entry.taxableBonus || 0,
                nonTaxableBonus: entry.nonTaxableBonus || 0,
                attendanceDeduction: entry.attendanceDeduction || 0,
                originalBasicPay: entry.originalBasicPay || 0,
                scheduledWorkDays: entry.scheduledWorkDays || 0,
                totalScheduledHours: entry.totalScheduledHours || 0,
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
            res.status(500).json({ message: 'Internal server error', detail: err?.message || String(err), stack: err?.stack });
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

// POST /api/clients/:clientId/payroll-runs/:id/update-entry — persist per-run input overrides and recompute
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
            'absentDays', 'lateHours', 'overtimePay', 'otherDeductions', 'hourlyRate',
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

        // ── Recompute payroll with merged overrides ──
        const run = await db.selectFrom('payroll_runs').selectAll().where('id', '=', runId).executeTakeFirst();
        const client = await db.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();
        const emp = await db.selectFrom('employees').selectAll().where('id', '=', employeeId).where('clientId', '=', clientId).executeTakeFirst();

        let computed: any = null;
        let totalScheduledHours = 0;
        if (run && client && emp) {
            const schedule = emp.workScheduleId
                ? await db.selectFrom('work_schedules').selectAll().where('id', '=', emp.workScheduleId).executeTakeFirst()
                : null;
            const scheduleConfig = schedule && schedule.config ? JSON.parse(schedule.config) : null;

            const [yearStr] = run.period.split('-');
            const holidays = await db
                .selectFrom('holidays')
                .selectAll()
                .where('clientId', '=', clientId)
                .where((eb) => eb.or([
                    eb('date', 'like', `${yearStr}-%`),
                    eb('isRecurring', '=', 1),
                ]))
                .execute();

            const adjustments = await db
                .selectFrom('payroll_adjustments')
                .selectAll()
                .where('payrollRunId', '=', runId)
                .where('employeeId', '=', employeeId)
                .execute();
            const adjList = adjustments.map(a => ({
                type: a.type as 'allowance' | 'deduction',
                amount: a.amount,
                isStatutory: !!a.isStatutory,
            }));
            // Merge otherDeductions override into adjustments as a non-statutory deduction
            // Only use explicit user overrides; do not fallback to entry.otherDeductions
            // because that field may include computed loan amounts from old engine versions.
            if (mergedOverrides.otherDeductions !== undefined && mergedOverrides.otherDeductions > 0) {
                adjList.push({ type: 'deduction', amount: mergedOverrides.otherDeductions, isStatutory: false });
            }

            const payStructure = (emp.payStructure || (client?.payStructure as string) || 'fixed') as 'fixed' | 'prorated';

            // Compute totalScheduledHours early so we can bridge hourlyRate -> basicPay if needed
            totalScheduledHours = getTotalScheduledHours(scheduleConfig, run.period);

            // If hourlyRate override is provided but basicPay is not, bridge via workSchedule
            if (mergedOverrides.hourlyRate !== undefined && mergedOverrides.basicPay === undefined) {
                mergedOverrides.basicPay = Math.round(mergedOverrides.hourlyRate * totalScheduledHours * 100) / 100;
            }

            // Apply merged overrides on top of the original entry values
            const baseInput = {
                employeeId: emp.id,
                employeeName: emp.employeeName,
                kraPin: emp.kraPin,
                payrollNumber: emp.payrollNumber,
                basicPay: mergedOverrides.basicPay !== undefined ? mergedOverrides.basicPay : entry.basicPay,
                carBenefit: mergedOverrides.carBenefit !== undefined ? mergedOverrides.carBenefit : entry.carBenefit,
                mealsBenefit: mergedOverrides.mealsBenefit !== undefined ? mergedOverrides.mealsBenefit : entry.mealsBenefit,
                nonCashBenefits: mergedOverrides.nonCashBenefits !== undefined ? mergedOverrides.nonCashBenefits : entry.nonCashBenefits,
                housingBenefit: mergedOverrides.housingBenefit !== undefined ? mergedOverrides.housingBenefit : entry.housingBenefit,
                otherBenefits: mergedOverrides.otherBenefits !== undefined ? mergedOverrides.otherBenefits : entry.otherBenefits,
                dateJoined: emp.dateJoined,
                dateLeft: emp.dateLeft,
                employmentStatus: emp.employmentStatus,
                loanDeduction: entry.loanDeduction || 0,
                // For prorated: unpaid leave and attendance are already factored into basicPay
                unpaidLeaveDays: payStructure === 'fixed' ? (entry.unpaidLeaveDays || 0) : 0,
                payStructure,
                overtimePay: mergedOverrides.overtimePay !== undefined ? mergedOverrides.overtimePay : entry.overtimePay,
                attendanceAbsentDays: payStructure === 'fixed'
                    ? (mergedOverrides.absentDays !== undefined ? mergedOverrides.absentDays : entry.absentDays)
                    : 0,
                attendanceLateDays: payStructure === 'fixed'
                    ? (mergedOverrides.lateHours !== undefined ? mergedOverrides.lateHours : entry.lateDays)
                    : 0,
                pwd: emp.pwd || 'No',
                otherPension: emp.otherPension || 0,
                postRetMedical: emp.postRetMedical || 0,
                mortgageInterest: emp.mortgageInterest || 0,
                insuranceRelief: mergedOverrides.insuranceRelief !== undefined ? mergedOverrides.insuranceRelief : ((entry as any).insuranceRelief || 0),
                bonusPay: mergedOverrides.bonusPay !== undefined ? mergedOverrides.bonusPay : entry.bonusPay,
                standardCheckIn: emp.standardCheckIn || '08:00',
                standardCheckOut: emp.standardCheckOut || '17:00',
            };

            computed = computePayrollEntry(baseInput, run.period, true, scheduleConfig, holidays, adjList);
            const computedScheduledDays = getScheduledDaysIncludingHolidays(scheduleConfig, run.period);
            computed.scheduledWorkDays = computedScheduledDays;
            computed.totalScheduledHours = totalScheduledHours;
        }

        const updateSet: any = { overrides: JSON.stringify(mergedOverrides), updatedAt: new Date().toISOString() };
        if (computed) {
            updateSet.basicPay = computed.basicPay;
            updateSet.carBenefit = computed.carBenefit;
            updateSet.mealsBenefit = computed.mealsBenefit;
            updateSet.nonCashBenefits = computed.nonCashBenefits;
            updateSet.housingBenefit = computed.housingBenefit;
            updateSet.otherBenefits = computed.otherBenefits;
            updateSet.grossPay = computed.grossPay;
            updateSet.shaDeduction = computed.shaDeduction;
            updateSet.nssfDeduction = computed.nssfDeduction;
            updateSet.ahlDeduction = computed.ahlDeduction;
            updateSet.otherDeductions = computed.otherDeductions;
            updateSet.totalDeductions = computed.totalDeductions;
            updateSet.taxablePay = computed.taxablePay;
            updateSet.payeTax = computed.payeTax;
            updateSet.netPay = computed.netPay;
            updateSet.bonusPay = computed.bonusPay;
            updateSet.taxableBonus = computed.taxableBonus;
            updateSet.nonTaxableBonus = computed.nonTaxableBonus;
            updateSet.overtimePay = computed.overtimePay;
            updateSet.daysWorked = computed.daysWorked;
            updateSet.absentDays = computed.absentDays;
            updateSet.lateDays = computed.lateDays;
            updateSet.attendanceDeduction = computed.attendanceDeduction;
            updateSet.originalBasicPay = computed.originalBasicPay;
            updateSet.scheduledWorkDays = computed.scheduledWorkDays || computed.daysWorked;
            updateSet.totalScheduledHours = computed.totalScheduledHours;
            updateSet.hourlyRate = mergedOverrides.hourlyRate !== undefined
                ? mergedOverrides.hourlyRate
                : (totalScheduledHours > 0 ? Math.round((computed.basicPay / totalScheduledHours) * 100000000) / 100000000 : 0);
        }

        await db.updateTable('payroll_entries').set(updateSet).where('id', '=', entry.id).execute();

        // Recalculate run totals from all entries so dashboard stays in sync
        const allEntries = await db
            .selectFrom('payroll_entries')
            .selectAll()
            .where('payrollRunId', '=', runId)
            .execute();
        const newTotalGross = allEntries.reduce((s, e) => s + (e.grossPay || 0), 0);
        const newTotalDeductions = allEntries.reduce((s, e) => s + (e.totalDeductions || 0), 0);
        const newTotalNet = allEntries.reduce((s, e) => s + (e.netPay || 0), 0);
        await db
            .updateTable('payroll_runs')
            .set({
                totalGross: Math.round(newTotalGross * 100) / 100,
                totalDeductions: Math.round(newTotalDeductions * 100) / 100,
                totalNet: Math.round(newTotalNet * 100) / 100,
                updatedAt: new Date().toISOString(),
            })
            .where('id', '=', runId)
            .execute();

        res.json({ success: true, overrides: mergedOverrides, computed: computed || undefined });
    } catch (err: any) {
        console.error('Error updating payroll entry override:', err);
        res.status(500).json({ message: 'Internal server error', detail: err?.message });
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

        // Enrich entries with employee + loan data for payslip
        const empIds = entries.map(e => e.employeeId);
        const employees = await db.selectFrom('employees').selectAll().where('id', 'in', empIds).execute();
        const empMap = new Map(employees.map(e => [e.id, e]));
        const loans = await db.selectFrom('loans').selectAll().where('clientId', '=', clientId).where('remainingInstallments', '>', 0).execute();
        const loanTypeMap = new Map<number, string>();
        for (const ln of loans) {
            if (!loanTypeMap.has(ln.employeeId)) loanTypeMap.set(ln.employeeId, ln.loanType || 'Loan');
        }

        // Fetch work schedules for scheduled-day computation
        const workSchedules = await db.selectFrom('work_schedules').selectAll().where('clientId', '=', clientId).execute();
        const scheduleMap = new Map(workSchedules.map(s => [s.id, s]));
        const [runYear] = (run?.period || '').split('-');
        const holidays = await db.selectFrom('holidays').selectAll().where('clientId', '=', clientId).where((eb) => eb.or([eb('date', 'like', `${runYear}-%`), eb('isRecurring', '=', 1)])).execute();

        // Use archiver to create ZIP of all PDFs
        const archiver = require('archiver');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=Payslips_${run?.period || id}.zip`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        for (const entry of entries) {
            const emp = empMap.get(entry.employeeId);
            (entry as any).nssfNo = emp?.nssfNo || '';
            (entry as any).shaNo = emp?.shaNo || '';
            (entry as any).loanType = loanTypeMap.get(entry.employeeId) || 'Loan';
            (entry as any).period = run?.period || '';
            (entry as any).payStructure = emp?.payStructure || 'fixed';
            // Always use the employee record's contractual basicPay as the source of truth
            (entry as any).originalBasicPay = emp?.basicPay ?? entry.originalBasicPay ?? entry.basicPay ?? 0;
            // Compute totalScheduledHours from employee's actual work schedule + checkIn/checkOut
            if (emp) {
                const schedule = emp.workScheduleId ? scheduleMap.get(emp.workScheduleId) : null;
                const scheduleConfig = schedule && schedule.config ? JSON.parse(schedule.config) : null;
                const scheduledDaysIncludingHolidays = getScheduledDaysIncludingHolidays(scheduleConfig, run?.period || '');
                const totalScheduledHours = getTotalScheduledHours(scheduleConfig, run?.period || '');
                (entry as any).scheduledWorkDays = scheduledDaysIncludingHolidays;
                (entry as any).totalScheduledHours = totalScheduledHours;
                // If hourlyRate wasn't stored in DB, compute it from originalBasicPay / totalScheduledHours
                if (!(entry.hourlyRate > 0)) {
                    const computedRate = Math.round(((entry.originalBasicPay || entry.basicPay || 0) / Math.max(1, totalScheduledHours)) * 100000000) / 100000000;
                    (entry as any).hourlyRate = computedRate;
                }
            }
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

        // Enrich entry with employee + loan data
        const emp = await db.selectFrom('employees').selectAll().where('id', '=', employeeId).executeTakeFirst();
        const loans = await db.selectFrom('loans').selectAll().where('clientId', '=', clientId).where('employeeId', '=', employeeId).where('remainingInstallments', '>', 0).execute();
        (entry as any).nssfNo = emp?.nssfNo || '';
        (entry as any).shaNo = emp?.shaNo || '';
        (entry as any).loanType = loans[0]?.loanType || 'Loan';
        (entry as any).period = run?.period || '';
        (entry as any).payStructure = emp?.payStructure || 'fixed';
        // Always use the employee record's contractual basicPay as the source of truth
        (entry as any).originalBasicPay = emp?.basicPay ?? entry.originalBasicPay ?? entry.basicPay ?? 0;
        // Compute totalScheduledHours from employee's actual work schedule + checkIn/checkOut
        if (emp) {
            const schedule = emp.workScheduleId
                ? await db.selectFrom('work_schedules').selectAll().where('id', '=', emp.workScheduleId).executeTakeFirst()
                : null;
            const scheduleConfig = schedule && schedule.config ? JSON.parse(schedule.config) : null;
            const [runYear] = (run?.period || '').split('-');
            const holidays = await db.selectFrom('holidays').selectAll().where('clientId', '=', clientId).where((eb) => eb.or([eb('date', 'like', `${runYear}-%`), eb('isRecurring', '=', 1)])).execute();
            const scheduledDaysIncludingHolidays = getScheduledDaysIncludingHolidays(scheduleConfig, run?.period || '');
            const totalScheduledHours = getTotalScheduledHours(scheduleConfig, run?.period || '');
            (entry as any).scheduledWorkDays = scheduledDaysIncludingHolidays;
            (entry as any).totalScheduledHours = totalScheduledHours;
            // If hourlyRate wasn't stored in DB, compute it from originalBasicPay / totalScheduledHours
            if (!(entry.hourlyRate > 0)) {
                const computedRate = Math.round(((entry.originalBasicPay || entry.basicPay || 0) / Math.max(1, totalScheduledHours)) * 100000000) / 100000000;
                (entry as any).hourlyRate = computedRate;
            }
        }

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
    const pageW = 595.28;
    const margin = 40;
    const leftX = margin;
    const contentW = pageW - margin * 2;
    const amtW = 100;
    const amtX = leftX + contentW - amtW;
    let y = margin;
    const rowH = 14;
    const isFixed = (entry.payStructure || 'fixed') === 'fixed';

    // ── Company Logo ──
    if (client?.logoUrl) {
        try {
            const logoPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', client.logoUrl.replace(/^\//, ''));
            if (fs.existsSync(logoPath)) {
                const logoW = 120;
                const logoH = 80;
                const logoX = (pageW - logoW) / 2;
                doc.image(logoPath, logoX, y, { fit: [logoW, logoH], align: 'center', valign: 'center' });
                y += 100;
            }
        } catch { /* ignore */ }
    }

    // ── Header ──
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e293b');
    doc.text(client?.name || 'Company', leftX, y, { align: 'center', width: contentW });
    y += 24;
    doc.fontSize(9).font('Helvetica').fillColor('#64748b');
    doc.text(`KRA PIN: ${client?.pin || ''}`, leftX, y, { align: 'center', width: contentW });
    y += 14;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a');
    doc.text('PAYSLIP', leftX, y, { align: 'center', width: contentW });
    y += 20;

    // ── Employee Info ──
    const infoBoxH = 52;
    doc.rect(leftX, y, contentW, infoBoxH).stroke('#e2e8f0');
    doc.fontSize(9).font('Helvetica').fillColor('#334155');
    const midX = leftX + contentW / 2;
    doc.text(`Employee: ${entry.employeeName || ''}`, leftX + 10, y + 8);
    doc.text(`KRA PIN: ${entry.kraPin || 'N/A'}`, midX, y + 8);
    doc.text(`Payroll No: ${entry.payrollNumber || ''}`, leftX + 10, y + 22);
    doc.text(`NSSF No: ${entry.nssfNo || 'N/A'}`, midX, y + 22);
    doc.text(`SHA No: ${entry.shaNo || 'N/A'}`, leftX + 10, y + 36);
    doc.text(`Period: ${entry.period || ''}`, midX, y + 36);
    y += infoBoxH + 10;

    // ── Helpers ──
    const sectionHeader = (title: string) => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a');
        doc.text(title.toUpperCase(), leftX, y);
        y += rowH;
        doc.moveTo(leftX, y - 4).lineTo(leftX + contentW, y - 4).stroke('#cbd5e1');
    };

    const lineItem = (label: string, amount: number, opts?: { red?: boolean; bold?: boolean; note?: string }) => {
        const isRed = opts?.red;
        const isBold = opts?.bold;
        const note = opts?.note;
        doc.fontSize(8.5).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(isRed ? '#dc2626' : '#334155');
        const labelText = note ? `${label}  (${note})` : label;
        doc.text(labelText, leftX + 4, y);
        const amtText = amount < 0 ? `-${Math.abs(amount).toFixed(2)}` : amount.toFixed(2);
        doc.text(amtText, amtX, y, { width: amtW, align: 'right' });
        y += rowH;
    };

    const subTotal = (label: string, amount: number, opts?: { bold?: boolean; bg?: boolean }) => {
        const isBold = opts?.bold ?? true;
        y += 2;
        if (opts?.bg) {
            doc.rect(leftX, y, contentW, rowH + 4).fill('#f1f5f9');
            doc.fillColor('#000');
        }
        doc.moveTo(leftX, y).lineTo(leftX + contentW, y).stroke('#94a3b8');
        y += 5;
        doc.fontSize(9).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#0f172a');
        doc.text(label, leftX + 4, y);
        doc.text(amount.toFixed(2), amtX, y, { width: amtW, align: 'right' });
        y += rowH + 2;
    };

    // ═══════════════════════════════════════════════
    // 1. CONTRACTUAL BASIC PAY
    // ═══════════════════════════════════════════════
    sectionHeader('Contractual Basic Pay');
    lineItem('Basic Salary', entry.originalBasicPay || entry.basicPay || 0, { bold: true });

    // ═══════════════════════════════════════════════
    // 2. EARNINGS FROM HOURS WORKED (prorated) / OVERTIME (fixed)
    // ═══════════════════════════════════════════════
    if (!isFixed) {
        const hasStdPay = (entry.stdPayAmount || 0) > 0;
        const hasHolidayPay = (entry.holidayPayAmount || 0) > 0;
        const hasPaidLeavePay = (entry.paidLeavePayAmount || 0) > 0;
        const hasOtPay = (entry.overtimePay || 0) > 0;
        if (hasStdPay || hasHolidayPay || hasPaidLeavePay || hasOtPay) {
            sectionHeader('Earnings from Hours Worked');
            if (hasStdPay) lineItem('Standard Hours Pay', entry.stdPayAmount);
            if (hasHolidayPay) lineItem('Holiday Pay', entry.holidayPayAmount);
            if (hasPaidLeavePay) lineItem('Paid Leave Pay', entry.paidLeavePayAmount);
            if (hasOtPay) lineItem('Overtime Pay', entry.overtimePay || 0);
        }
    } else if ((entry.overtimePay || 0) > 0) {
        sectionHeader('Earnings');
        lineItem('Overtime Pay', entry.overtimePay || 0);
    }

    // ═══════════════════════════════════════════════
    // 3. ATTENDANCE DEDUCTIONS / SUMMARY
    // ═══════════════════════════════════════════════
    const hasAbsent = (entry.absentHours || 0) > 0;
    const hasLate = (entry.lateHours || 0) > 0;
    const hasUnpaidLeave = (entry.unpaidLeaveHours || 0) > 0;
    if (hasAbsent || hasLate || hasUnpaidLeave) {
        sectionHeader(isFixed ? 'Attendance Deductions' : 'Attendance Summary');
        if (hasAbsent) {
            if (isFixed) {
                lineItem('Absent Deduction', -entry.absentDedAmount, { red: true });
            } else {
                lineItem('Absent Hours', entry.absentDedAmount);
            }
        }
        if (hasLate) {
            if (isFixed) {
                lineItem('Late Deduction', -entry.lateDedAmount, { red: true });
            } else {
                lineItem('Late Hours', entry.lateDedAmount);
            }
        }
        if (hasUnpaidLeave) {
            if (isFixed) {
                lineItem('Unpaid Leave Deduction', -entry.unpaidLeaveDedAmount, { red: true });
            } else {
                lineItem('Unpaid Leave Hours', entry.unpaidLeaveDedAmount);
            }
        }
    }

    // ═══════════════════════════════════════════════
    // BENEFITS & ALLOWANCES
    // ═══════════════════════════════════════════════
    const hasCar = (entry.carBenefit || 0) > 0;
    const hasMeals = (entry.mealsBenefit || 0) > 0;
    const hasHousing = (entry.housingBenefit || 0) > 0;
    const hasNonCash = (entry.nonCashBenefits || 0) > 0;
    const hasOtherBenefits = (entry.otherBenefits || 0) > 0;
    const hasBonus = (entry.bonusPay || 0) > 0 || (entry.nonTaxableBonus || 0) > 0;
    if (hasCar || hasMeals || hasHousing || hasNonCash || hasOtherBenefits || hasBonus) {
        sectionHeader('Benefits & Allowances');
        if (hasCar) lineItem('Car / Transport Benefit', entry.carBenefit || 0);
        if (hasMeals) lineItem('Meals Benefit', entry.mealsBenefit || 0);
        if (hasHousing) lineItem('Housing Benefit', entry.housingBenefit || 0);
        if (hasNonCash) lineItem('Non-Cash Benefit', entry.nonCashBenefits || 0);
        if (hasOtherBenefits) lineItem('Other Benefits', entry.otherBenefits || 0);
        if ((entry.bonusPay || 0) > 0) lineItem('Bonus Pay', entry.bonusPay || 0);
        if ((entry.nonTaxableBonus || 0) > 0) lineItem('Non-Taxable Bonus', entry.nonTaxableBonus || 0);
    }

    subTotal('GROSS PAY', entry.grossPay || 0, { bold: true, bg: true });

    // ═══════════════════════════════════════════════
    // STATUTORY DEDUCTIONS
    // ═══════════════════════════════════════════════
    sectionHeader('Statutory Deductions');
    lineItem('PAYE Tax', entry.payeTax || 0);
    lineItem('SHA (Social Health Authority)', entry.shaDeduction || 0);
    lineItem('NSSF (National Social Security Fund)', entry.nssfDeduction || 0);
    lineItem('AHL (Affordable Housing Levy)', entry.ahlDeduction || 0);

    // ═══════════════════════════════════════════════
    // OTHER DEDUCTIONS
    // ═══════════════════════════════════════════════
    const hasLoan = (entry.loanDeduction || 0) > 0;
    const hasOtherDed = (entry.otherDeductions || 0) > 0;
    if (hasLoan || hasOtherDed) {
        sectionHeader('Other Deductions');
        if (hasLoan) {
            const loanLabel = entry.loanType ? `Loan Deduction — ${entry.loanType}` : 'Loan Deduction';
            lineItem(loanLabel, entry.loanDeduction || 0);
        }
        if (hasOtherDed) lineItem('Other Deductions', entry.otherDeductions || 0);
    }

    subTotal('TOTAL DEDUCTIONS', entry.totalDeductions || 0, { bg: false });

    // ═══════════════════════════════════════════════
    // NET PAY
    // ═══════════════════════════════════════════════
    y += 8;
    doc.rect(leftX, y, contentW, 38).fill('#0f172a');
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('NET PAY', leftX + 14, y + 11);
    doc.text(`KES ${(entry.netPay || 0).toFixed(2)}`, amtX - 10, y + 11, { width: amtW + 10, align: 'right' });
    doc.fillColor('#000');

    // ── Footer ──
    y += 50;
    doc.fontSize(8).font('Helvetica').fillColor('#94a3b8');
    doc.text(`Generated on ${new Date().toLocaleDateString()}  |  This is a computer-generated payslip and does not require a signature.`, leftX, y, { align: 'center', width: contentW });
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
            if ((entry.loanDeduction || 0) <= 0) continue;
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

            try {
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
            } catch (loanErr: any) {
                console.error(`[FINALIZE] Loan transaction failed for employee ${entry.employeeId}:`, loanErr?.message || loanErr);
                warnings.push(`Loan deduction failed for ${entry.employeeName}: ${loanErr?.message || 'Unknown error'}`);
            }
        }

        // Lock the run
        await db
            .updateTable('payroll_runs')
            .set({ lockedAt: now, updatedAt: now, status: 'closed' })
            .where('id', '=', payrollRunId)
            .execute();

        res.json({ success: true, finalizedAt: now, warnings, entryCount: entries.length });
    } catch (err: any) {
        console.error('[FINALIZE] Unhandled error:', err);
        res.status(500).json({ message: 'Failed to finalize run', error: err?.message || String(err) });
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
