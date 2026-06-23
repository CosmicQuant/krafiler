import { Router, Response } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { computePayrollEntry, getScheduledWorkDays, getScheduledDaysIncludingHolidays, getTotalScheduledHours } from '../services/payrollEngine';

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

// ─── Shared generate logic ────────────────────────────────────────────────

async function generateEntriesForRun(
    runId: string,
    clientId: string,
    prorate: boolean,
    uid: string
): Promise<{ entries: any[]; run: any }> {
    const runDoc = await adminDb.collection('payrollRuns').doc(runId).get();
    if (!runDoc.exists || runDoc.data()?.ownerUid !== uid || runDoc.data()?.clientId !== clientId) {
        throw new Error('Payroll run not found');
    }
    const run = { id: runDoc.id, ...runDoc.data() };

    const clientDoc = await adminDb.collection('clients').doc(clientId).get();
    const client = clientDoc.exists ? { id: clientDoc.id, ...clientDoc.data() } as any : null;

    const payStructure = (client?.payStructure as 'fixed' | 'prorated') || 'fixed';

    const employeesSnapshot = await adminDb
        .collection('employees')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .where('employmentStatus', '==', 'Active')
        .get();

    const employees = employeesSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })) as any[];

    if (employees.length === 0) throw new Error('No active employees found');

    const now = Timestamp.now();
    const nowIso = new Date().toISOString();
    const [periodYear, periodMonth] = (run as any).period.split('-');

    // Fetch work schedules and holidays for this client
    const workSchedulesSnapshot = await adminDb
        .collection('workSchedules')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .get();
    const scheduleMap = new Map<string, any>();
    for (const d of workSchedulesSnapshot.docs) {
        scheduleMap.set(d.id, { id: d.id, ...d.data() });
    }

    const [yearStr] = (run as any).period.split('-');
    const holidaysSnapshot = await adminDb
        .collection('holidays')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .get();
    const holidays = holidaysSnapshot.docs
        .map((d: any) => ({ id: d.id, ...d.data() }))
        .filter((h: any) => h.date?.startsWith(`${yearStr}-`) || h.isRecurring) as any[];

    // Fetch active loans (filter remainingInstallments in memory to avoid composite index)
    const loansSnapshot = await adminDb
        .collection('loans')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .get();
    const loanMap = new Map<string, number>();
    const loanTypeMap = new Map<string, string>();
    for (const d of loansSnapshot.docs) {
        const ln = d.data() as any;
        if ((ln.remainingInstallments || 0) <= 0) continue;
        const empId = String(ln.employeeId);
        if (!empId) continue;
        loanMap.set(empId, (loanMap.get(empId) || 0) + (ln.monthlyDeduction || 0));
        if (!loanTypeMap.has(empId)) {
            loanTypeMap.set(empId, ln.loanType || 'Loan');
        }
    }

    // Fetch approved unpaid leave
    const leaveSnapshot = await adminDb
        .collection('leaveRequests')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .where('status', '==', 'Approved')
        .get();
    const leaveMap = new Map<string, number>();
    for (const d of leaveSnapshot.docs) {
        const lv = d.data() as any;
        const isUnpaid = lv.isPaid === false || lv.isPaid === 0 || (lv.leaveType || '').toLowerCase().includes('unpaid');
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
        leaveMap.set(String(lv.employeeId), (leaveMap.get(String(lv.employeeId)) || 0) + overlapDays);
    }

    // Fetch attendance records for the period
    const periodStartStr = `${(run as any).period}-01`;
    const periodEndStr = `${(run as any).period}-${new Date(parseInt(periodYear, 10), parseInt(periodMonth, 10), 0).getDate()}`;
    const attendanceSnapshot = await adminDb
        .collection('attendanceRecords')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .where('date', '>=', periodStartStr)
        .where('date', '<=', periodEndStr)
        .get();
    const attendanceRecords = attendanceSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    // Fetch approved attendance payroll values computed by the attendance calendar.
    // These values are the source of truth for the pay register and payslip.
    const approvalsSnapshot = await adminDb
        .collection('attendancePayrollApprovals')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .where('period', '==', (run as any).period)
        .get();
    const approvalMap = new Map<string, any>();
    for (const d of approvalsSnapshot.docs) {
        const data = d.data();
        approvalMap.set(String(data.employeeId), data);
    }

    // Deduplicate attendance records by employee+date, keeping the most severe status.
    // Severity order: Absent > Half-Day > Late > Present/On Leave/Off Day
    const severityOrder: Record<string, number> = { Absent: 4, 'Half-Day': 3, Late: 2, Present: 1, 'On Leave': 1, 'Off Day': 0 };
    const dedupMap = new Map<string, any>();
    for (const ar of attendanceRecords) {
        const arData = ar as any;
        const key = `${arData.employeeId}-${arData.date}`;
        const existing = dedupMap.get(key);
        const currentSeverity = severityOrder[arData.status] ?? 0;
        const existingSeverity = existing ? (severityOrder[existing.status] ?? 0) : -1;
        if (currentSeverity > existingSeverity) {
            dedupMap.set(key, arData);
        }
    }
    const dedupedAttendanceRecords = Array.from(dedupMap.values());

    // Compute attendance-adjusted pay using actual hours worked (matches frontend grid)
    const totalStdHoursMap = new Map<string, number>();
    const otHoursMap = new Map<string, number>();
    const lateHoursMap = new Map<string, number>();
    const lateCountMap = new Map<string, number>();
    const presentCountMap = new Map<string, number>();
    const halfCountMap = new Map<string, number>();
    const absentCountMap = new Map<string, number>();
    const leaveCountMap = new Map<string, number>();
    const offCountMap = new Map<string, number>();
    const paidLeaveHoursMap = new Map<string, number>();

    for (const ar of dedupedAttendanceRecords) {
        const arData = ar as any;
        const emp = employees.find((e: any) => e.id === arData.employeeId);
        if (!emp) continue;

        const standardIn = emp.standardCheckIn || '08:00';
        const standardOut = emp.standardCheckOut || '17:00';
        const [siH, siM] = standardIn.split(':').map(Number);
        const [soH, soM] = standardOut.split(':').map(Number);
        const dailyHours = Math.max(1, ((soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0))) / 60);

        if (arData.status === 'Absent') {
            absentCountMap.set(arData.employeeId, (absentCountMap.get(arData.employeeId) || 0) + 1);
            continue;
        }
        if (arData.status === 'Off Day') {
            offCountMap.set(arData.employeeId, (offCountMap.get(arData.employeeId) || 0) + 1);
            continue;
        }
        if (arData.status === 'On Leave') {
            leaveCountMap.set(arData.employeeId, (leaveCountMap.get(arData.employeeId) || 0) + 1);
            const leaveInfo = (leaveSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })) as any[])
                .find((lr: any) => lr.employeeId === arData.employeeId && lr.status === 'Approved' && arData.date >= lr.startDate && arData.date <= lr.endDate);
            if (leaveInfo && (leaveInfo.isPaid === true || leaveInfo.isPaid === 1)) {
                paidLeaveHoursMap.set(arData.employeeId, (paidLeaveHoursMap.get(arData.employeeId) || 0) + (leaveInfo.hours || dailyHours));
            }
            continue;
        }

        const [ciH, ciM] = (arData.checkIn || standardIn).split(':').map(Number);
        const [coH, coM] = (arData.checkOut || standardOut).split(':').map(Number);
        const actualMins = Math.max(0, (coH * 60 + (coM || 0)) - (ciH * 60 + (ciM || 0)));
        const actualHours = actualMins / 60;

        if (!isNaN(ciH) && !isNaN(siH)) {
            const lateMins = Math.max(0, (ciH * 60 + (ciM || 0)) - (siH * 60 + (siM || 0)));
            if (lateMins > 0) {
                lateHoursMap.set(arData.employeeId, (lateHoursMap.get(arData.employeeId) || 0) + lateMins / 60);
            }
        }

        if (arData.status === 'Half-Day') {
            halfCountMap.set(arData.employeeId, (halfCountMap.get(arData.employeeId) || 0) + 1);
            totalStdHoursMap.set(arData.employeeId, (totalStdHoursMap.get(arData.employeeId) || 0) + Math.min(actualHours, dailyHours * 0.5));
        } else if (arData.status === 'Late') {
            lateCountMap.set(arData.employeeId, (lateCountMap.get(arData.employeeId) || 0) + 1);
            totalStdHoursMap.set(arData.employeeId, (totalStdHoursMap.get(arData.employeeId) || 0) + Math.min(actualHours, dailyHours));
            otHoursMap.set(arData.employeeId, (otHoursMap.get(arData.employeeId) || 0) + Math.max(0, actualHours - dailyHours));
        } else if (arData.status === 'Present') {
            presentCountMap.set(arData.employeeId, (presentCountMap.get(arData.employeeId) || 0) + 1);
            totalStdHoursMap.set(arData.employeeId, (totalStdHoursMap.get(arData.employeeId) || 0) + Math.min(actualHours, dailyHours));
            otHoursMap.set(arData.employeeId, (otHoursMap.get(arData.employeeId) || 0) + Math.max(0, actualHours - dailyHours));
        }
    }

    // Add paid leave hours for approved leave without attendance records
    for (const lv of leaveSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }))) {
        const lvData = lv as any;
        if (lvData.status !== 'Approved') continue;
        const isUnpaid = lvData.isPaid === false || lvData.isPaid === 0 || (lvData.leaveType || '').toLowerCase().includes('unpaid');
        if (isUnpaid) continue;
        const lvStartStr = lvData.startDate || '';
        const lvEndStr = lvData.endDate || '';
        if (!lvStartStr) continue;
        const lvStart = new Date(lvStartStr);
        const lvEnd = lvEndStr ? new Date(lvEndStr) : new Date(lvStartStr);
        const periodStart = new Date(parseInt(periodYear, 10), parseInt(periodMonth, 10) - 1, 1);
        const periodEnd = new Date(parseInt(periodYear, 10), parseInt(periodMonth, 10), 0);
        const overlapStart = lvStart > periodStart ? lvStart : periodStart;
        const overlapEnd = lvEnd < periodEnd ? lvEnd : periodEnd;
        if (overlapStart > overlapEnd) continue;

        const emp = employees.find((e: any) => e.id === lvData.employeeId);
        const [siH, siM] = (emp?.standardCheckIn || '08:00').split(':').map(Number);
        const [soH, soM] = (emp?.standardCheckOut || '17:00').split(':').map(Number);
        const dailyHours = Math.max(1, ((soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0))) / 60);

        const current = new Date(overlapStart);
        while (current <= overlapEnd) {
            const dateStr = current.toISOString().slice(0, 10);
            const hasRecord = dedupedAttendanceRecords.some((ar: any) => ar.employeeId === lvData.employeeId && ar.date === dateStr);
            if (!hasRecord) {
                paidLeaveHoursMap.set(lvData.employeeId, (paidLeaveHoursMap.get(lvData.employeeId) || 0) + (lvData.hours || dailyHours));
            }
            current.setDate(current.getDate() + 1);
        }
    }

    // Load existing entries so user overrides are preserved across regenerate.
    const existingEntriesSnapshot = await adminDb
        .collection('payrollEntries')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .where('payrollRunId', '==', runId)
        .get();
    const overridesByEmployee = new Map<string, Record<string, number>>();
    for (const d of existingEntriesSnapshot.docs) {
        const e = d.data() as any;
        if (e.overrides) {
            try {
                overridesByEmployee.set(String(e.employeeId), JSON.parse(e.overrides));
            } catch { /* ignore */ }
        }
    }

    // Delete existing entries for this run (batched, 500 limit)
    const DELETE_BATCH_SIZE = 500;
    for (let i = 0; i < existingEntriesSnapshot.docs.length; i += DELETE_BATCH_SIZE) {
        const deleteBatch = adminDb.batch();
        for (const d of existingEntriesSnapshot.docs.slice(i, i + DELETE_BATCH_SIZE)) {
            deleteBatch.delete(d.ref);
        }
        await deleteBatch.commit();
    }

    // Load dynamic adjustments for this run
    const adjustmentsSnapshot = await adminDb
        .collection('payrollAdjustments')
        .where('payrollRunId', '==', runId)
        .get();
    const adjustmentsByEmployee = new Map<string, { type: 'allowance' | 'deduction'; amount: number; isStatutory: boolean }[]>();
    for (const d of adjustmentsSnapshot.docs) {
        const adj = d.data() as any;
        const list = adjustmentsByEmployee.get(String(adj.employeeId)) || [];
        list.push({ type: adj.type as 'allowance' | 'deduction', amount: adj.amount, isStatutory: !!adj.isStatutory });
        adjustmentsByEmployee.set(String(adj.employeeId), list);
    }

    // Compute entries
    const entries = employees.map((emp: any) => {
        const empPayStructure = (emp.payStructure || client?.payStructure || 'fixed') as 'fixed' | 'prorated';
        const scheduleId = emp.workScheduleId || null;
        const schedule = scheduleId ? scheduleMap.get(String(scheduleId)) : null;
        const scheduleConfig = schedule && schedule.config ? (typeof schedule.config === 'string' ? JSON.parse(schedule.config) : schedule.config) : null;
        const scheduledDays = getScheduledWorkDays(scheduleConfig, (run as any).period, holidays);
        const scheduledDaysIncludingHolidays = getScheduledDaysIncludingHolidays(scheduleConfig, (run as any).period);

        const approval = approvalMap.get(String(emp.id));
        const overrides = overridesByEmployee.get(emp.id) || {};

        const totalStdHours = approval?.totalStdHours ?? (totalStdHoursMap.get(emp.id) || 0);
        const otHours = approval?.overtimeHours ?? (otHoursMap.get(emp.id) || 0);
        const paidLeaveHours = paidLeaveHoursMap.get(emp.id) || 0;
        const lateHrs = approval?.lateHours ?? (lateHoursMap.get(emp.id) || 0);
        const absentCount = approval?.absentDays ?? (absentCountMap.get(emp.id) || 0);
        const [siH, siM] = (emp.standardCheckIn || '08:00').split(':').map(Number);
        const [soH, soM] = (emp.standardCheckOut || '17:00').split(':').map(Number);
        const dailyHours = Math.max(1, ((soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0))) / 60);
        const totalScheduledHours = approval?.totalScheduledHours ?? getTotalScheduledHours(scheduleConfig, (run as any).period);
        const hourlyRate = approval?.hourlyRate ?? ((emp.hourlyRate || (Math.round((emp.basicPay / Math.max(1, totalScheduledHours)) * 100000000) / 100000000)) || 0);
        const otRate = Math.round(hourlyRate * 1.5 * 100) / 100;
        const paidLeaveAmount = Math.round(paidLeaveHours * hourlyRate * 100) / 100;
        const overtimePay = approval?.overtimeAmount ?? (Math.round(otHours * otRate * 100) / 100);

        const [runYear, runMonth] = (run as any).period.split('-').map(Number);
        const daysInPeriod = new Date(runYear, runMonth, 0).getDate();
        let holidayHours = 0;
        for (let d = 1; d <= daysInPeriod; d++) {
            const date = new Date(runYear, runMonth - 1, d);
            const dateStr = `${runYear}-${String(runMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const monthDay = `${String(runMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            let isRealHoliday = false;
            for (const h of holidays) {
                const hData = h as any;
                if (hData.date === dateStr) { isRealHoliday = true; break; }
                if (hData.isRecurring && hData.date?.substring(5) === monthDay) { isRealHoliday = true; break; }
            }
            if (isRealHoliday) {
                const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
                holidayHours += scheduleConfig ? (scheduleConfig[dayName] || 0) : dailyHours;
            }
        }

        const computedBasicPayFromApproval = approval?.computedBasicPay;
        const adjustedBasicPay = overrides.basicPay !== undefined
            ? roundMoney(overrides.basicPay)
            : (computedBasicPayFromApproval !== undefined && computedBasicPayFromApproval !== null
                ? roundMoney(computedBasicPayFromApproval)
                : (empPayStructure === 'prorated'
                    ? Math.round((totalStdHours + holidayHours + paidLeaveHours) * hourlyRate * 100) / 100
                    : undefined));

        const entry: any = computePayrollEntry(
            {
                employeeId: emp.id,
                employeeName: emp.employeeName,
                kraPin: emp.kraPin,
                payrollNumber: emp.payrollNumber,
                basicPay: emp.basicPay,
                basicPayOverride: adjustedBasicPay,
                carBenefit: overrides.carBenefit !== undefined ? overrides.carBenefit : (emp.carBenefit || 0),
                mealsBenefit: overrides.mealsBenefit !== undefined ? overrides.mealsBenefit : (emp.mealsBenefit || 0),
                nonCashBenefits: overrides.nonCashBenefits !== undefined ? overrides.nonCashBenefits : (emp.nonCashBenefits || 0),
                housingBenefit: overrides.housingBenefit !== undefined ? overrides.housingBenefit : (emp.housingBenefit || 0),
                otherBenefits: overrides.otherBenefits !== undefined ? overrides.otherBenefits : (emp.otherBenefits || 0),
                dateJoined: emp.dateJoined,
                dateLeft: emp.dateLeft,
                employmentStatus: emp.employmentStatus,
                loanDeduction: overrides.loanDeduction !== undefined ? overrides.loanDeduction : (loanMap.get(emp.id) || 0),
                unpaidLeaveDays: empPayStructure === 'fixed' ? (leaveMap.get(emp.id) || 0) : 0,
                payStructure: empPayStructure,
                overtimePay: overrides.overtimePay !== undefined ? overrides.overtimePay : (empPayStructure === 'fixed' ? overtimePay : 0),
                attendanceAbsentDays: empPayStructure === 'fixed' ? (overrides.absentDays !== undefined ? overrides.absentDays : absentCount) : 0,
                attendanceLateDays: empPayStructure === 'fixed' ? (overrides.lateHours !== undefined ? overrides.lateHours : lateHrs) : 0,
                pwd: emp.pwd || 'No',
                otherPension: overrides.otherPension !== undefined ? overrides.otherPension : (emp.otherPension || 0),
                postRetMedical: overrides.postRetMedical !== undefined ? overrides.postRetMedical : (emp.postRetMedical || 0),
                mortgageInterest: overrides.mortgageInterest !== undefined ? overrides.mortgageInterest : (emp.mortgageInterest || 0),
                insuranceRelief: overrides.insuranceRelief !== undefined ? overrides.insuranceRelief : (emp.insuranceRelief || 0),
                bonusPay: overrides.bonusPay !== undefined ? overrides.bonusPay : (emp.bonusPay || 0),
                standardCheckIn: emp.standardCheckIn || '08:00',
                standardCheckOut: emp.standardCheckOut || '17:00',
            },
            (run as any).period,
            prorate,
            scheduleConfig,
            holidays as any,
            [
                ...(adjustmentsByEmployee.get(emp.id) || []),
                ...(overrides.otherDeductions !== undefined && overrides.otherDeductions > 0
                    ? [{ type: 'deduction' as const, amount: overrides.otherDeductions, isStatutory: false }]
                    : []),
            ],
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
        entry.period = (run as any).period;
        entry.scheduledWorkDays = scheduledDaysIncludingHolidays;
        entry.totalScheduledHours = totalScheduledHours;
        entry.hourlyRate = hourlyRate;

        let absentHours = approval?.absentHours ?? 0;
        if (!approval?.absentHours && absentHours === 0) {
    for (const ar of dedupedAttendanceRecords) {
                const arData = ar as any;
                if (arData.employeeId !== emp.id) continue;
                if (arData.status !== 'Absent') continue;
                const d = parseInt(arData.date.split('-')[2], 10);
                const date = new Date(runYear, runMonth - 1, d);
                const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
                absentHours += scheduleConfig ? (scheduleConfig[dayName] || 0) : dailyHours;
            }
        }

        let unpaidLeaveHours = approval?.unpaidLeaveHours ?? 0;
        if (!approval?.unpaidLeaveHours && unpaidLeaveHours === 0) {
            for (const lv of leaveSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }))) {
                const lvData = lv as any;
                if (lvData.employeeId !== emp.id) continue;
                if (lvData.status !== 'Approved') continue;
                const isUnpaid = lvData.isPaid === false || lvData.isPaid === 0 || (lvData.leaveType || '').toLowerCase().includes('unpaid');
                if (!isUnpaid) continue;
                const lvStart = new Date(lvData.startDate);
                const lvEnd = lvData.endDate ? new Date(lvData.endDate) : new Date(lvData.startDate);
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
        }

        const hasAttendanceDeductions = absentHours > 0 || lateHrs > 0 || unpaidLeaveHours > 0;
        entry.stdPayAmount = (empPayStructure === 'fixed' && !hasAttendanceDeductions)
            ? entry.basicPay
            : Math.round(totalStdHours * hourlyRate * 100) / 100;
        entry.holidayPayAmount = Math.round(holidayHours * hourlyRate * 100) / 100;
        entry.paidLeavePayAmount = Math.round(paidLeaveHours * hourlyRate * 100) / 100;
        entry.absentHours = Math.round(absentHours * 100) / 100;
        entry.absentDedAmount = approval?.absentDedAmount ?? (Math.round(absentHours * hourlyRate * 100) / 100);
        entry.lateHours = Math.round(lateHrs * 100) / 100;
        entry.lateDedAmount = approval?.lateDedAmount ?? (Math.round(lateHrs * hourlyRate * 100) / 100);
        entry.unpaidLeaveHours = Math.round(unpaidLeaveHours * 100) / 100;
        entry.unpaidLeaveDedAmount = approval?.unpaidLeaveDedAmount ?? (Math.round(unpaidLeaveHours * hourlyRate * 100) / 100);
        // Persist any user overrides so they survive future regenerations.
        const empOverrides = overridesByEmployee.get(emp.id);
        entry.overrides = empOverrides ? JSON.stringify(empOverrides) : null;
        return entry;
    });

    // Insert entries (batched, 500 limit)
    const BATCH_SIZE = 500;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = adminDb.batch();
        const chunk = entries.slice(i, i + BATCH_SIZE);
        for (const entry of chunk) {
            const docRef = adminDb.collection('payrollEntries').doc();
            batch.set(docRef, {
                ownerUid: uid,
                clientId,
                payrollRunId: runId,
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
                overrides: entry.overrides || null,
                status: 'active',
                lockedAt: null,
                createdAt: now,
                updatedAt: now,
            });
        }
        await batch.commit();
    }

    // Update run totals
    const totalGross = entries.reduce((s: number, e: any) => s + e.grossPay, 0);
    const totalDeductions = entries.reduce((s: number, e: any) => s + e.totalDeductions, 0);
    const totalNet = entries.reduce((s: number, e: any) => s + e.netPay, 0);

    await adminDb.collection('payrollRuns').doc(runId).update({
        totalEmployees: entries.length,
        totalGross: roundMoney(totalGross),
        totalDeductions: roundMoney(totalDeductions),
        totalNet: roundMoney(totalNet),
        status: 'completed',
        updatedAt: now,
    });

    const updatedRunDoc = await adminDb.collection('payrollRuns').doc(runId).get();
    const updatedRun = { id: updatedRunDoc.id, ...updatedRunDoc.data() };

    return { entries, run: updatedRun };
}

function roundMoney(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

// ─── Payroll Runs CRUD ────────────────────────────────────────────────────────

// GET /api/clients/:clientId/payroll-runs
router.get('/:clientId/payroll-runs', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;

        const snapshot = await adminDb
            .collection('payrollRuns')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();

        const runs = snapshot.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .sort((a: any, b: any) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        res.json(runs);
    } catch (err) {
        console.error('Error fetching payroll runs from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/payroll-runs — create and auto-generate entries
router.post('/:clientId/payroll-runs', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { period, notes, prorate } = req.body;
        if (!period) return res.status(400).json({ message: 'Period is required (YYYY-MM)' });

        // Check for duplicate period
        const existingSnapshot = await adminDb
            .collection('payrollRuns')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('period', '==', period)
            .limit(1)
            .get();

        if (!existingSnapshot.empty) {
            const existing = { id: existingSnapshot.docs[0].id, ...existingSnapshot.docs[0].data() };
            return res.status(409).json({ message: 'A payroll run already exists for this period', existingRunId: existing.id });
        }

        const [year, month] = period.split('-');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const periodLabel = `${months[parseInt(month, 10) - 1]} ${year}`;

        const now = Timestamp.now();
        const docRef = await adminDb.collection('payrollRuns').add({
            ownerUid: uid,
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
        });

        const runId = docRef.id;

        // Auto-generate entries
        const shouldProrate = prorate !== false;
        const { run, entries } = await generateEntriesForRun(runId, clientId, shouldProrate, uid);

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
        console.error('Error creating payroll run in Firestore:', err);
        if (err.message === 'No active employees found') {
            res.status(400).json({ message: err.message });
        } else {
            res.status(500).json({ message: 'Internal server error' });
        }
    }
});

// GET /api/clients/:clientId/payroll-runs/debug
router.get('/:clientId/payroll-runs/debug', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;

        const snapshot = await adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employmentStatus', '==', 'Active')
            .get();

        const raw = snapshot.docs.map((d: any) => {
            const e = d.data() as any;
            return {
                id: d.id,
                name: e.employeeName,
                kraPin: e.kraPin,
                basicPay: e.basicPay,
                basicPayType: typeof e.basicPay,
                employmentStatus: e.employmentStatus,
                dateJoined: e.dateJoined,
                dateLeft: e.dateLeft,
            };
        });

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

// POST /api/clients/:clientId/payroll-runs/:id/generate
router.post('/:clientId/payroll-runs/:id/generate', async (req: AuthenticatedRequest, res) => {
    try {
        const id = req.params.id;
        const clientId = req.params.clientId;
        const uid = req.user!.uid;

        const prorate = req.body.prorate !== false;
        const { run, entries } = await generateEntriesForRun(id, clientId, prorate, uid);

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
                employeesWithZeroBasicPay: entries.filter((e: any) => e.basicPay === 0).length,
                sampleEntry,
            },
        });
    } catch (err: any) {
        console.error('Error generating payroll entries in Firestore:', err);
        if (err.message === 'No active employees found') {
            res.status(400).json({ message: err.message });
        } else {
            res.status(500).json({ message: 'Internal server error', detail: err?.message || String(err), stack: err?.stack });
        }
    }
});

// GET /api/clients/:clientId/payroll-runs/:id/entries
router.get('/:clientId/payroll-runs/:id/entries', async (req: AuthenticatedRequest, res) => {
    try {
        const id = req.params.id;
        const clientId = req.params.clientId;
        const uid = req.user!.uid;

        const snapshot = await adminDb
            .collection('payrollEntries')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('payrollRunId', '==', id)
            .get();

        const entriesWithOverrides = snapshot.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .sort((a: any, b: any) => (a.employeeName || '').localeCompare(b.employeeName || ''))
            .map((entry: any) => {
            const merged = { ...entry };
            if (entry.overrides) {
                try {
                    const overrides = JSON.parse(entry.overrides);
                    merged._overrideKeys = Object.keys(overrides);
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
        console.error('Error fetching payroll entries from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/payroll-runs/:id/update-entry
router.post('/:clientId/payroll-runs/:id/update-entry', async (req: AuthenticatedRequest, res) => {
    try {
        const runId = req.params.id;
        const clientId = req.params.clientId;
        const uid = req.user!.uid;
        const { employeeId } = req.body;
        if (!employeeId) return res.status(400).json({ message: 'employeeId is required' });

        const allowedOverrides = [
            'basicPay', 'carBenefit', 'mealsBenefit', 'nonCashBenefits',
            'housingBenefit', 'otherBenefits', 'bonusPay', 'insuranceRelief',
            'absentDays', 'lateHours', 'overtimePay', 'otherDeductions', 'loanDeduction', 'hourlyRate',
        ];

        const overridePayload: Record<string, number> = {};
        for (const key of allowedOverrides) {
            if (req.body[key] !== undefined) {
                const val = parseFloat(String(req.body[key]));
                if (!isNaN(val)) overridePayload[key] = val;
            }
        }

        // Find existing entry
        const entrySnapshot = await adminDb
            .collection('payrollEntries')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('payrollRunId', '==', runId)
            .where('employeeId', '==', employeeId)
            .limit(1)
            .get();

        if (entrySnapshot.empty) return res.status(404).json({ message: 'Payroll entry not found' });
        const entryDoc = entrySnapshot.docs[0];
        const entry = { id: entryDoc.id, ...entryDoc.data() } as any;

        let existingOverrides: Record<string, number> = {};
        if (entry.overrides) {
            try {
                existingOverrides = JSON.parse(entry.overrides);
            } catch { /* ignore */ }
        }
        const mergedOverrides = { ...existingOverrides, ...overridePayload };

        // Recompute
        let computed: any = null;
        let totalScheduledHours = 0;
        const runDoc = await adminDb.collection('payrollRuns').doc(runId).get();
        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        const empDoc = await adminDb.collection('employees').doc(employeeId).get();

        if (runDoc.exists && clientDoc.exists && empDoc.exists) {
            const run = runDoc.data() as any;
            const client = clientDoc.data() as any;
            const emp = empDoc.data() as any;

            const schedule = emp.workScheduleId
                ? await adminDb.collection('workSchedules').doc(String(emp.workScheduleId)).get()
                : null;
            const scheduleConfig = schedule && schedule.exists && schedule.data()?.config ? (typeof schedule.data()!.config === 'string' ? JSON.parse(schedule.data()!.config) : schedule.data()!.config) : null;

            const [runYear] = run.period.split('-');
            const holidaysSnapshot = await adminDb
                .collection('holidays')
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .get();
            const holidays = holidaysSnapshot.docs
                .map((d: any) => d.data())
                .filter((h: any) => h.date?.startsWith(`${runYear}-`) || h.isRecurring) as any[];

            const adjustmentsSnapshot = await adminDb
                .collection('payrollAdjustments')
                .where('payrollRunId', '==', runId)
                .where('employeeId', '==', employeeId)
                .get();
            const adjList = adjustmentsSnapshot.docs.map((d: any) => {
                const a = d.data() as any;
                return { type: a.type as 'allowance' | 'deduction', amount: a.amount, isStatutory: !!a.isStatutory };
            });
            if (mergedOverrides.otherDeductions !== undefined && mergedOverrides.otherDeductions > 0) {
                adjList.push({ type: 'deduction', amount: mergedOverrides.otherDeductions, isStatutory: false });
            }

            const payStructure = (emp.payStructure || client?.payStructure || 'fixed') as 'fixed' | 'prorated';
            totalScheduledHours = getTotalScheduledHours(scheduleConfig, run.period);

            if (mergedOverrides.hourlyRate !== undefined && mergedOverrides.basicPay === undefined) {
                mergedOverrides.basicPay = Math.round(mergedOverrides.hourlyRate * totalScheduledHours * 100) / 100;
            }

            // The stored entry.basicPay is the attendance-adjusted (computed) pay.
            // Use originalBasicPay as the contractual master so attendance deductions
            // are not double-counted during recomputation.
            const masterBasicPay = entry.originalBasicPay || entry.basicPay || 0;
            const userEditedBasicPay = mergedOverrides.basicPay !== undefined ? mergedOverrides.basicPay : undefined;
            const computedBasicPayOverride = userEditedBasicPay !== undefined
                ? userEditedBasicPay
                : (entry.basicPay || masterBasicPay);

            const baseInput = {
                employeeId: empDoc.id,
                employeeName: emp.employeeName,
                kraPin: emp.kraPin,
                payrollNumber: emp.payrollNumber,
                basicPay: masterBasicPay,
                basicPayOverride: computedBasicPayOverride,
                carBenefit: mergedOverrides.carBenefit !== undefined ? mergedOverrides.carBenefit : entry.carBenefit,
                mealsBenefit: mergedOverrides.mealsBenefit !== undefined ? mergedOverrides.mealsBenefit : entry.mealsBenefit,
                nonCashBenefits: mergedOverrides.nonCashBenefits !== undefined ? mergedOverrides.nonCashBenefits : entry.nonCashBenefits,
                housingBenefit: mergedOverrides.housingBenefit !== undefined ? mergedOverrides.housingBenefit : entry.housingBenefit,
                otherBenefits: mergedOverrides.otherBenefits !== undefined ? mergedOverrides.otherBenefits : entry.otherBenefits,
                dateJoined: emp.dateJoined,
                dateLeft: emp.dateLeft,
                employmentStatus: emp.employmentStatus,
                loanDeduction: mergedOverrides.loanDeduction !== undefined ? mergedOverrides.loanDeduction : (entry.loanDeduction || 0),
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
                insuranceRelief: mergedOverrides.insuranceRelief !== undefined ? mergedOverrides.insuranceRelief : (entry.insuranceRelief || 0),
                bonusPay: mergedOverrides.bonusPay !== undefined ? mergedOverrides.bonusPay : entry.bonusPay,
                standardCheckIn: emp.standardCheckIn || '08:00',
                standardCheckOut: emp.standardCheckOut || '17:00',
            };

            computed = computePayrollEntry(baseInput as any, run.period, true, scheduleConfig, holidays, adjList);
            const computedScheduledDays = getScheduledDaysIncludingHolidays(scheduleConfig, run.period);
            computed.scheduledWorkDays = computedScheduledDays;
            computed.totalScheduledHours = totalScheduledHours;
        }

        const updateSet: any = { overrides: JSON.stringify(mergedOverrides), updatedAt: Timestamp.now() };
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
            updateSet.loanDeduction = computed.loanDeduction;
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
            // When basicPayOverride is used, attendance/unpaid-leave deductions are not
            // reflected in the computed output; preserve the original breakdown for the payslip.
            updateSet.absentHours = mergedOverrides.absentDays !== undefined ? undefined : (entry.absentHours || 0);
            updateSet.absentDedAmount = mergedOverrides.absentDays !== undefined ? undefined : (entry.absentDedAmount || 0);
            updateSet.lateHours = mergedOverrides.lateHours !== undefined ? undefined : (entry.lateHours || 0);
            updateSet.lateDedAmount = mergedOverrides.lateHours !== undefined ? undefined : (entry.lateDedAmount || 0);
            updateSet.unpaidLeaveHours = entry.unpaidLeaveHours || 0;
            updateSet.unpaidLeaveDedAmount = entry.unpaidLeaveDedAmount || 0;
            updateSet.scheduledWorkDays = computed.scheduledWorkDays || computed.daysWorked;
            updateSet.totalScheduledHours = computed.totalScheduledHours;
            updateSet.hourlyRate = mergedOverrides.hourlyRate !== undefined
                ? mergedOverrides.hourlyRate
                : (totalScheduledHours > 0 ? Math.round((computed.basicPay / totalScheduledHours) * 100000000) / 100000000 : 0);
        }

        await entryDoc.ref.update(updateSet);

        // Recalculate run totals from all entries
        const allEntriesSnapshot = await adminDb
            .collection('payrollEntries')
            .where('ownerUid', '==', uid)
            .where('payrollRunId', '==', runId)
            .get();
        let newTotalGross = 0;
        let newTotalDeductions = 0;
        let newTotalNet = 0;
        for (const d of allEntriesSnapshot.docs) {
            const e = d.data() as any;
            newTotalGross += e.grossPay || 0;
            newTotalDeductions += e.totalDeductions || 0;
            newTotalNet += e.netPay || 0;
        }
        await adminDb.collection('payrollRuns').doc(runId).update({
            totalGross: Math.round(newTotalGross * 100) / 100,
            totalDeductions: Math.round(newTotalDeductions * 100) / 100,
            totalNet: Math.round(newTotalNet * 100) / 100,
            updatedAt: Timestamp.now(),
        });

        res.json({ success: true, overrides: mergedOverrides, computed: computed || undefined });
    } catch (err: any) {
        console.error('Error updating payroll entry override in Firestore:', err);
        res.status(500).json({ message: 'Internal server error', detail: err?.message });
    }
});

// DELETE /api/clients/:clientId/payroll-runs/:id
router.delete('/:clientId/payroll-runs/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const id = req.params.id;
        const clientId = req.params.clientId;
        const uid = req.user!.uid;

        const docRef = adminDb.collection('payrollRuns').doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Payroll run not found' });
        }

        // Delete associated entries
        const entriesSnapshot = await adminDb
            .collection('payrollEntries')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('payrollRunId', '==', id)
            .get();
        const batch = adminDb.batch();
        for (const d of entriesSnapshot.docs) {
            batch.delete(d.ref);
        }
        await batch.commit();

        await docRef.delete();
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting payroll run from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── Payslip Routes ──────────────────────────────────────────────────────────

function generatePayslipPDF(doc: any, entry: any, client: any, logoPath?: string | null): void {
    const pageW = 595.28;
    const margin = 40;
    const leftX = margin;
    const contentW = pageW - margin * 2;
    const amtW = 100;
    const amtX = leftX + contentW - amtW;
    let y = margin;
    const rowH = 14;
    const isFixed = (entry.payStructure || 'fixed') === 'fixed';

    // ── Header row: company info left, logo right ──
    const headerY = y;
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e293b');
    doc.text(client?.name || 'Company', leftX, headerY, { align: 'left', width: contentW - 100 });
    doc.fontSize(8).font('Helvetica').fillColor('#64748b');
    doc.text(`KRA PIN: ${client?.pin || ''}`, leftX, headerY + 18, { align: 'left', width: contentW - 100 });
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a');
    doc.text('PAYSLIP', leftX, headerY + 34, { align: 'left', width: contentW - 100 });
    doc.fontSize(8).font('Helvetica').fillColor('#64748b');
    doc.text(`Period: ${entry.period || ''}`, leftX + 120, headerY + 36, { align: 'left', width: 150 });

    if (logoPath) {
        try {
            // Fill the available header height (60pt) with no top padding; maintain aspect ratio within the right-hand box.
            doc.image(logoPath, amtX - 20, headerY, { fit: [80, 60], align: 'right', valign: 'top' });
        } catch { /* ignore */ }
    }

    y = headerY + 60;

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

    // 1. CONTRACTUAL BASIC PAY
    sectionHeader('Contractual Basic Pay');
    lineItem('Basic Salary', entry.originalBasicPay || entry.basicPay || 0, { bold: true });

    // 2. EARNINGS FROM HOURS WORKED (prorated) / OVERTIME (fixed)
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

    // 3. ATTENDANCE DEDUCTIONS / SUMMARY (always shown, zero if none)
    const absentDays = entry.absentDays || 0;
    const absentDedAmount = entry.absentDedAmount || 0;
    const lateHours = entry.lateHours || 0;
    const lateDedAmount = entry.lateDedAmount || 0;
    const unpaidLeaveDays = entry.unpaidLeaveDays || 0;
    const unpaidLeaveDedAmount = entry.unpaidLeaveDedAmount || 0;
    sectionHeader(isFixed ? 'Attendance Deductions' : 'Attendance Summary');
    if (isFixed) {
        lineItem(`Absent Deduction (${absentDays} days)`, -absentDedAmount, { red: true });
        lineItem(`Late Deduction (${lateHours} hrs)`, -lateDedAmount, { red: true });
        lineItem(`Unpaid Leave Deduction (${unpaidLeaveDays} days)`, -unpaidLeaveDedAmount, { red: true });
    } else {
        lineItem('Absent Hours', absentDedAmount);
        lineItem('Late Hours', lateDedAmount);
        lineItem('Unpaid Leave Hours', unpaidLeaveDedAmount);
    }

    // BENEFITS & ALLOWANCES
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

    // STATUTORY DEDUCTIONS
    sectionHeader('Statutory Deductions');
    lineItem('PAYE Tax', entry.payeTax || 0);
    lineItem('SHA (Social Health Authority)', entry.shaDeduction || 0);
    lineItem('NSSF (National Social Security Fund)', entry.nssfDeduction || 0);
    lineItem('AHL (Affordable Housing Levy)', entry.ahlDeduction || 0);

    // OTHER DEDUCTIONS
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

    // NET PAY
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

// POST /api/clients/:clientId/employees/:employeeId/overtime
router.post('/:clientId/employees/:employeeId/overtime', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const employeeId = req.params.employeeId;
        const { period, hours, rate, multiplier, amount } = req.body;
        if (!period) return res.status(400).json({ message: 'Period is required' });

        // Delete existing
        const existingSnapshot = await adminDb
            .collection('overtimeRecords')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employeeId', '==', employeeId)
            .where('period', '==', period)
            .get();

        const batch = adminDb.batch();
        for (const d of existingSnapshot.docs) {
            batch.delete(d.ref);
        }
        await batch.commit();

        if (hours > 0) {
            await adminDb.collection('overtimeRecords').add({
                ownerUid: uid,
                clientId,
                employeeId,
                period,
                hours: hours || 0,
                rate: rate || 0,
                multiplier: multiplier || 1,
                amount: amount || 0,
                description: '',
                createdAt: Timestamp.now(),
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error saving overtime to Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/employees/:employeeId/overtime?period=YYYY-MM
router.delete('/:clientId/employees/:employeeId/overtime', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const employeeId = req.params.employeeId;
        const period = req.query.period as string;
        if (!period) return res.status(400).json({ message: 'period query parameter is required' });

        const snapshot = await adminDb
            .collection('overtimeRecords')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employeeId', '==', employeeId)
            .where('period', '==', period)
            .get();

        const batch = adminDb.batch();
        for (const d of snapshot.docs) {
            batch.delete(d.ref);
        }
        await batch.commit();

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting overtime from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/payroll-runs/:id/overtime
router.get('/:clientId/payroll-runs/:id/overtime', async (req: AuthenticatedRequest, res) => {
    try {
        const id = req.params.id;
        const clientId = req.params.clientId;
        const uid = req.user!.uid;

        const runDoc = await adminDb.collection('payrollRuns').doc(id).get();
        if (!runDoc.exists || runDoc.data()?.ownerUid !== uid || runDoc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Run not found' });
        }
        const period = (runDoc.data() as any).period;

        const snapshot = await adminDb
            .collection('overtimeRecords')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('period', '==', period)
            .get();

        res.json(snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching overtime from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/overtime-by-period
router.get('/:clientId/overtime-by-period', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const period = req.query.period as string;
        if (!period) return res.status(400).json({ message: 'period query parameter is required (YYYY-MM)' });

        const snapshot = await adminDb
            .collection('overtimeRecords')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('period', '==', period)
            .get();

        res.json(snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching overtime from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── P10/P11 Reports ──────────────────────────────────────────────────────────

// GET /api/clients/:clientId/p10
router.get('/:clientId/p10', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const year = req.query.year || new Date().getFullYear().toString();

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        const client = clientDoc.exists ? { id: clientDoc.id, ...clientDoc.data() } : null;

        const runsSnapshot = await adminDb
            .collection('payrollRuns')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('period', '>=', `${year}-01`)
            .where('period', '<=', `${year}-12`)
            .where('status', '==', 'completed')
            .get();

        const runs = runsSnapshot.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .sort((a: any, b: any) => (a.period || '').localeCompare(b.period || ''));
        const runIds = runs.map((r: any) => r.id);

        let entries: any[] = [];
        if (runIds.length > 0) {
            const chunkSize = 10;
            for (let i = 0; i < runIds.length; i += chunkSize) {
                const chunk = runIds.slice(i, i + chunkSize);
                const entriesSnapshot = await adminDb
                    .collection('payrollEntries')
                    .where('ownerUid', '==', uid)
                    .where('clientId', '==', clientId)
                    .where('payrollRunId', 'in', chunk)
                    .get();
                entries.push(...entriesSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
            }
        }

        const employeeMap = new Map<string, any>();
        for (const e of entries) {
            const key = (e as any).kraPin;
            if (!employeeMap.has(key)) {
                employeeMap.set(key, {
                    kraPin: key,
                    employeeName: (e as any).employeeName,
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
            rec.totalGross += (e as any).grossPay || 0;
            rec.totalPaye += (e as any).payeTax || 0;
            rec.totalSha += (e as any).shaDeduction || 0;
            rec.totalNssf += (e as any).nssfDeduction || 0;
            rec.totalAhl += (e as any).ahlDeduction || 0;
            rec.totalNet += (e as any).netPay || 0;
        }

        const employees = Array.from(employeeMap.values()).map((e: any) => ({
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
            clientName: (client as any)?.name || '',
            clientPin: (client as any)?.pin || '',
            totalEmployees: employees.length,
            totalPaye: roundMoney(employees.reduce((s: number, e: any) => s + e.totalPaye, 0)),
            totalGross: roundMoney(employees.reduce((s: number, e: any) => s + e.totalGross, 0)),
            employeeDetails: employees,
        });
    } catch (err) {
        console.error('Error generating P10 report from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/p11/:kraPin
router.get('/:clientId/p11/:kraPin', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { kraPin } = req.params;
        const year = req.query.year || new Date().getFullYear().toString();

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        const client = clientDoc.exists ? { id: clientDoc.id, ...clientDoc.data() } : null;

        const runsSnapshot = await adminDb
            .collection('payrollRuns')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('period', '>=', `${year}-01`)
            .where('period', '<=', `${year}-12`)
            .where('status', '==', 'completed')
            .get();

        const runs = runsSnapshot.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .sort((a: any, b: any) => (a.period || '').localeCompare(b.period || ''));
        const runIds = runs.map((r: any) => r.id);

        let entries: any[] = [];
        if (runIds.length > 0) {
            const chunkSize = 10;
            for (let i = 0; i < runIds.length; i += chunkSize) {
                const chunk = runIds.slice(i, i + chunkSize);
                const entriesSnapshot = await adminDb
                    .collection('payrollEntries')
                    .where('ownerUid', '==', uid)
                    .where('clientId', '==', clientId)
                    .where('payrollRunId', 'in', chunk)
                    .where('kraPin', '==', kraPin)
                    .get();
                entries.push(...entriesSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
            }
        }

        const monthly = runs.map((run: any) => {
            const entry = entries.find((e: any) => e.payrollRunId === run.id);
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
            totalGross: roundMoney(monthly.reduce((s: number, m: any) => s + m.grossPay, 0)),
            totalPaye: roundMoney(monthly.reduce((s: number, m: any) => s + m.payeTax, 0)),
            totalSha: roundMoney(monthly.reduce((s: number, m: any) => s + m.shaDeduction, 0)),
            totalNssf: roundMoney(monthly.reduce((s: number, m: any) => s + m.nssfDeduction, 0)),
            totalAhl: roundMoney(monthly.reduce((s: number, m: any) => s + m.ahlDeduction, 0)),
            totalNet: roundMoney(monthly.reduce((s: number, m: any) => s + m.netPay, 0)),
        };

        const employeeName = entries.length > 0 ? entries[0].employeeName : kraPin;

        res.json({
            year,
            kraPin,
            employeeName,
            clientName: (client as any)?.name || '',
            clientPin: (client as any)?.pin || '',
            monthly,
            totals,
            monthsFiled: monthly.filter((m: any) => m.grossPay > 0).length,
        });
    } catch (err) {
        console.error('Error generating P11 report from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/p10/pdf
router.get('/:clientId/p10/pdf', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const year = req.query.year || new Date().getFullYear().toString();

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        const client = clientDoc.exists ? { id: clientDoc.id, ...clientDoc.data() } : null;

        const runsSnapshot = await adminDb
            .collection('payrollRuns')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('period', '>=', `${year}-01`)
            .where('period', '<=', `${year}-12`)
            .where('status', '==', 'completed')
            .get();

        const runs = runsSnapshot.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .sort((a: any, b: any) => (a.period || '').localeCompare(b.period || ''));
        const runIds = runs.map((r: any) => r.id);

        let entries: any[] = [];
        if (runIds.length > 0) {
            const chunkSize = 10;
            for (let i = 0; i < runIds.length; i += chunkSize) {
                const chunk = runIds.slice(i, i + chunkSize);
                const entriesSnapshot = await adminDb
                    .collection('payrollEntries')
                    .where('ownerUid', '==', uid)
                    .where('clientId', '==', clientId)
                    .where('payrollRunId', 'in', chunk)
                    .get();
                entries.push(...entriesSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
            }
        }

        const employeeMap = new Map<string, any>();
        for (const e of entries) {
            const key = (e as any).kraPin;
            if (!employeeMap.has(key)) {
                employeeMap.set(key, { kraPin: key, employeeName: (e as any).employeeName, monthsWorked: 0, totalGross: 0, totalPaye: 0 });
            }
            const rec = employeeMap.get(key)!;
            rec.monthsWorked++;
            rec.totalGross += (e as any).grossPay || 0;
            rec.totalPaye += (e as any).payeTax || 0;
        }

        const employees = Array.from(employeeMap.values()).map((e: any) => ({
            ...e,
            totalGross: roundMoney(e.totalGross),
            totalPaye: roundMoney(e.totalPaye),
        }));

        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=P10_${year}.pdf`);
        doc.pipe(res);

        doc.fontSize(14).font('Helvetica-Bold').text('P10 — ANNUAL PAYE RECONCILIATION', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica').text(`Year: ${year}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(8).font('Helvetica');
        doc.text(`Employer: ${(client as any)?.name || ''}`);
        doc.text(`KRA PIN: ${(client as any)?.pin || ''}`);
        doc.moveDown(0.5);

        doc.fontSize(9).font('Helvetica-Bold').text('Summary', 40, doc.y);
        doc.moveDown(0.3);
        doc.fontSize(8).font('Helvetica');
        doc.text(`Total Employees: ${employees.length}`, 40, doc.y);
        doc.text(`Total Gross Pay: KES ${roundMoney(employees.reduce((s: number, e: any) => s + e.totalGross, 0)).toLocaleString()}`, 40, doc.y);
        doc.text(`Total PAYE Deducted: KES ${roundMoney(employees.reduce((s: number, e: any) => s + e.totalPaye, 0)).toLocaleString()}`, 40, doc.y);
        doc.moveDown(0.5);

        doc.fontSize(8).font('Helvetica-Bold');
        doc.text('Employee', 40, doc.y);
        doc.text('KRA PIN', 200, doc.y - 8);
        doc.text('Months', 310, doc.y - 8);
        doc.text('Gross Pay', 370, doc.y - 8);
        doc.text('PAYE', 460, doc.y - 8);
        doc.moveDown(0.3);

        doc.fontSize(7).font('Helvetica');
        employees.forEach((emp: any) => {
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
        console.error('Error generating P10 PDF from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:clientId/p11/:kraPin/pdf
router.get('/:clientId/p11/:kraPin/pdf', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { kraPin } = req.params;
        const year = req.query.year || new Date().getFullYear().toString();

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        const client = clientDoc.exists ? { id: clientDoc.id, ...clientDoc.data() } : null;

        const runsSnapshot = await adminDb
            .collection('payrollRuns')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('period', '>=', `${year}-01`)
            .where('period', '<=', `${year}-12`)
            .where('status', '==', 'completed')
            .get();

        const runs = runsSnapshot.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .sort((a: any, b: any) => (a.period || '').localeCompare(b.period || ''));
        const runIds = runs.map((r: any) => r.id);

        let entries: any[] = [];
        if (runIds.length > 0) {
            const chunkSize = 10;
            for (let i = 0; i < runIds.length; i += chunkSize) {
                const chunk = runIds.slice(i, i + chunkSize);
                const entriesSnapshot = await adminDb
                    .collection('payrollEntries')
                    .where('ownerUid', '==', uid)
                    .where('clientId', '==', clientId)
                    .where('payrollRunId', 'in', chunk)
                    .where('kraPin', '==', kraPin)
                    .get();
                entries.push(...entriesSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
            }
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
        doc.text(`Employer: ${(client as any)?.name || ''}`);
        doc.text(`Employee: ${employeeName}`);
        doc.text(`KRA PIN: ${kraPin}`);
        doc.moveDown(0.5);

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

        runs.forEach((run: any) => {
            const entry = entries.find((e: any) => e.payrollRunId === run.id);
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
        console.error('Error generating P11 PDF from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── Compliance File Generation ─────────────────────────────────────────────

// POST /api/clients/:clientId/payroll-runs/:id/generate-compliance
router.post('/:clientId/payroll-runs/:id/generate-compliance', async (req: AuthenticatedRequest, res) => {
    try {
        const id = req.params.id;
        const clientId = req.params.clientId;
        const uid = req.user!.uid;

        const runDoc = await adminDb.collection('payrollRuns').doc(id).get();
        if (!runDoc.exists || runDoc.data()?.ownerUid !== uid || runDoc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Payroll run not found' });
        }
        const run = runDoc.data() as any;

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        if (!clientDoc.exists || clientDoc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }
        const client = clientDoc.data() as any;

        const entriesSnapshot = await adminDb
            .collection('payrollEntries')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('payrollRunId', '==', id)
            .get();
        if (entriesSnapshot.empty) {
            return res.status(400).json({ message: 'No payroll entries found for this run' });
        }
        const entries = entriesSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

        const employeesSnapshot = await adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();
        const empMap = new Map(employeesSnapshot.docs.map((d: any) => [d.id, { id: d.id, ...d.data() }]));

        const { generateComplianceFiles } = await import('../scripts/axon-extraction-engine');
        const { uploadFile, getSignedDownloadUrl } = await import('../lib/cloudStorage');

        const workspaceDir = path.join(process.env.TEMP_DIR || '/tmp', 'compliance-gen', `${clientId}_${id}_${Date.now()}`);
        fs.mkdirSync(workspaceDir, { recursive: true });

        const [yearStr, monthStr] = run.period.split('-');
        const mm = String(parseInt(monthStr, 10)).padStart(2, '0');
        const yyyy = yearStr;
        const periodMMYYYY = `${mm}${yyyy}`;

        const headers = [
            'Payroll Number', 'PIN of Employee', 'ID Number', 'Identity Type', 'Name of Employee',
            'SHA No', 'NSSF No', 'Residential Status', 'Type of Employee', 'Persons with Disability(PWD)',
            'Exemption Certificate', 'Total Cash Pay (A)', 'Value of Car Benefit (B)', 'Value of Meals (C)',
            'Non Cash Benefits (D)', 'Type of Housing', 'Housing Benefit (F)', 'Other Benefits (G)',
            'Total Gross Pay (Ksh) (H)', 'Social Health Insurance Fund (I)', 'NSSF Contribution (J)',
            'Other Pension Contribution (K)', 'Post Retirement Medical Fund (L)', 'Mortgage Interest (M)',
            'Affordable Housing Levy (N)', 'Taxable Pay(Ksh) (O)', 'Monthly Personal Relief (Ksh) (P)',
            'Amount of Insurance Relief (Q)', 'PAYE Tax (Ksh) (R)', 'Self Assessed PAYE Tax (Ksh) (S)',
        ];

        const csvLines: string[] = [];
        csvLines.push(`COMPANY NAME:,${client.name || ''}`);
        csvLines.push(`COMPANY KRA PIN:,${client.pin || ''}`);
        csvLines.push(`COMPANY NSSF NO:,${client.nssfNo || ''}`);
        csvLines.push(`COMPANY NSSF PASSWORD:,${client.nssfPassword || ''}`);
        csvLines.push(`COMPANY SHA LOGIN:,${client.shaLogin || ''}`);
        csvLines.push(`COMPANY SHA PASSWORD:,${client.shaPassword || ''}`);
        csvLines.push('');
        csvLines.push(headers.join(','));

        for (let i = 0; i < entries.length; i++) {
            const e = entries[i] as any;
            const emp = empMap.get(String(e.employeeId)) as any;
            const row: (string | number)[] = [];
            row.push(e.payrollNumber || emp?.payrollNumber || String(i + 1));
            row.push(e.kraPin || emp?.kraPin || '');
            row.push(emp?.idNumber || '');
            row.push(emp?.identityType || 'National ID');
            row.push(e.employeeName || '');
            row.push(emp?.shaNo || '');
            row.push(emp?.nssfNo || '');
            row.push(emp?.residentialStatus || 'Resident');
            row.push(emp?.typeOfEmployee || 'Primary Employee');
            row.push(emp?.pwd || 'No');
            row.push(emp?.exemptionCert || '');
            row.push(e.basicPay || 0);
            row.push(emp?.carBenefit || 0);
            row.push(emp?.mealsBenefit || 0);
            row.push(emp?.nonCashBenefits || 0);
            row.push(emp?.typeOfHousing || 'Benefit not given');
            row.push(emp?.housingBenefit || 0);
            row.push(emp?.otherBenefits || 0);
            row.push(e.grossPay || 0);
            row.push(e.shaDeduction || 0);
            row.push(e.nssfDeduction || 0);
            row.push(emp?.otherPension || 0);
            row.push(emp?.postRetMedical || 0);
            row.push(emp?.mortgageInterest || 0);
            row.push(e.ahlDeduction || 0);
            row.push(e.taxablePay || 0);
            row.push(2400);
            row.push(emp?.insuranceRelief || 0);
            row.push(e.payeTax || 0);
            row.push(e.payeTax || 0);
            csvLines.push(row.map((v) => String(v ?? '')).join(','));
        }

        const csvPath = path.join(workspaceDir, 'payroll_entries.csv');
        fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf-8');

        const config = {
            employerPin: client.pin || 'P000000000A',
            nssfEmployerNo: client.nssfNo || 'N00000000',
            employerName: client.name || 'Generated Client',
            periodMMYYYY,
        };

        const { generatePaye, generateNssf, generateSha } = req.body;
        const options = {
            generatePaye: generatePaye !== false,
            generateNssf: generateNssf !== false,
            generateSha: generateSha !== false,
        };

        const outputPaths = await generateComplianceFiles(csvPath, config, options);

        const timestamp = Date.now();
        let payeZipUrl: string | null = null;
        let payeZipLabel: string | null = null;
        let nssfFileUrl: string | null = null;
        let nssfFileLabel: string | null = null;
        let shaFileUrl: string | null = null;
        let shaFileLabel: string | null = null;

        if (outputPaths.payeZipPath && fs.existsSync(outputPaths.payeZipPath)) {
            const label = path.basename(outputPaths.payeZipPath);
            const gcsPath = `users/${uid}/clients/${clientId}/generated/${label}`;
            await uploadFile(outputPaths.payeZipPath, gcsPath);
            payeZipUrl = await getSignedDownloadUrl(gcsPath, 60);
            payeZipLabel = label;
        }
        if (outputPaths.nssfFilePath && fs.existsSync(outputPaths.nssfFilePath)) {
            const label = path.basename(outputPaths.nssfFilePath);
            const gcsPath = `users/${uid}/clients/${clientId}/generated/${label}`;
            await uploadFile(outputPaths.nssfFilePath, gcsPath);
            nssfFileUrl = await getSignedDownloadUrl(gcsPath, 60);
            nssfFileLabel = label;
        }
        if (outputPaths.shaFilePath && fs.existsSync(outputPaths.shaFilePath)) {
            const label = path.basename(outputPaths.shaFilePath);
            const gcsPath = `users/${uid}/clients/${clientId}/generated/${label}`;
            await uploadFile(outputPaths.shaFilePath, gcsPath);
            shaFileUrl = await getSignedDownloadUrl(gcsPath, 60);
            shaFileLabel = label;
        }

        // Clean up temp workspace
        try {
            if (fs.existsSync(workspaceDir)) fs.rmSync(workspaceDir, { recursive: true, force: true });
        } catch { /* ignore */ }

        // Update client doc
        const updateData: any = { updatedAt: Timestamp.now() };
        if (payeZipUrl) {
            updateData['generatedFiles.payeZipUrl'] = payeZipUrl;
            updateData['generatedFiles.payeZipLabel'] = payeZipLabel;
            updateData['status.paye'] = 'generated';
        }
        if (nssfFileUrl) {
            updateData['generatedFiles.nssfFileUrl'] = nssfFileUrl;
            updateData['generatedFiles.nssfFileLabel'] = nssfFileLabel;
            updateData['status.nssf'] = 'generated';
        }
        if (shaFileUrl) {
            updateData['generatedFiles.shaFileUrl'] = shaFileUrl;
            updateData['generatedFiles.shaFileLabel'] = shaFileLabel;
            updateData['status.sha'] = 'generated';
        }
        if (outputPaths.summaryAmounts) {
            const sa = outputPaths.summaryAmounts;
            if (sa.payeAmount !== undefined) updateData['amounts.payeAmount'] = sa.payeAmount;
            if (sa.nitaAmount !== undefined) updateData['amounts.nitaAmount'] = sa.nitaAmount;
            if (sa.housingLevyAmount !== undefined) updateData['amounts.housingLevyAmount'] = sa.housingLevyAmount;
            if (sa.nssfAmount !== undefined) updateData['amounts.nssfAmount'] = sa.nssfAmount;
            if (sa.shaAmount !== undefined) updateData['amounts.shaAmount'] = sa.shaAmount;
        }
        await adminDb.collection('clients').doc(clientId).update(updateData);

        res.json({
            payeZipUrl,
            payeZipLabel,
            nssfFileUrl,
            nssfFileLabel,
            shaFileUrl,
            shaFileLabel,
            summaryAmounts: outputPaths.summaryAmounts || {},
        });
    } catch (err: any) {
        console.error('Error generating compliance files from Firestore:', err);
        if (err.message === 'Payroll run not found' || err.message === 'Client not found') {
            res.status(404).json({ message: err.message });
        } else if (err.message === 'No payroll entries found for this run') {
            res.status(400).json({ message: err.message });
        } else {
            res.status(500).json({ message: err.message || 'Failed to generate compliance files' });
        }
    }
});

// GET /api/clients/:clientId/payroll-runs/:id/compliance-status
router.get('/:clientId/payroll-runs/:id/compliance-status', async (req: AuthenticatedRequest, res) => {
    try {
        const id = req.params.id;
        const clientId = req.params.clientId;
        const uid = req.user!.uid;

        const runDoc = await adminDb.collection('payrollRuns').doc(id).get();
        if (!runDoc.exists || runDoc.data()?.ownerUid !== uid || runDoc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Payroll run not found' });
        }

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        if (!clientDoc.exists || clientDoc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }
        const client = clientDoc.data() as any;

        // Return persisted compliance file info from the client document
        res.json({
            payeZipUrl: client.generatedFiles?.payeZipUrl || null,
            payeZipLabel: client.generatedFiles?.payeZipLabel || null,
            nssfFileUrl: client.generatedFiles?.nssfFileUrl || null,
            nssfFileLabel: client.generatedFiles?.nssfFileLabel || null,
            shaFileUrl: client.generatedFiles?.shaFileUrl || null,
            shaFileLabel: client.generatedFiles?.shaFileLabel || null,
            statuses: {
                paye: client.status?.paye || 'na',
                nssf: client.status?.nssf || 'na',
                sha: client.status?.sha || 'na',
            },
            amounts: {
                payeAmount: client.amounts?.payeAmount || 0,
                nitaAmount: client.amounts?.nitaAmount || 0,
                housingLevyAmount: client.amounts?.housingLevyAmount || 0,
                nssfAmount: client.amounts?.nssfAmount || 0,
                shaAmount: client.amounts?.shaAmount || 0,
            },
            // Receipt URLs from filing jobs
            payeReceiptUrl: client.payeReceiptUrl || null,
            nssfReceiptUrl: client.nssfReceiptUrl || null,
            shaReceiptUrl: client.shaReceiptUrl || null,
        });
    } catch (err: any) {
        console.error('Error fetching compliance status:', err);
        res.status(500).json({ message: err.message || 'Failed to fetch compliance status' });
    }
});

// ─── Attendance Payroll Approval Workflow ─────────────────────────────────────

// POST /api/clients/:clientId/attendance-payroll-preview
router.post('/:clientId/attendance-payroll-preview', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const period = req.query.period as string;
        if (!period) return res.status(400).json({ message: 'period query parameter is required (YYYY-MM)' });

        const employeesSnapshot = await adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employmentStatus', '==', 'Active')
            .get();
        const empMap = new Map(employeesSnapshot.docs.map((d: any) => [d.id, { id: d.id, ...d.data() }]));

        const approvalsSnapshot = await adminDb
            .collection('attendancePayrollApprovals')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('period', '==', period)
            .get();
        const approvalMap = new Map(approvalsSnapshot.docs.map((d: any) => [(d.data() as any).employeeId, { id: d.id, ...d.data() }]));

        const [yearStr, monthStr] = period.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const daysInMonth = new Date(year, month, 0).getDate();
        const periodStart = `${period}-01`;
        const periodEnd = `${period}-${String(daysInMonth).padStart(2, '0')}`;

        const attendanceSnapshot = await adminDb
            .collection('attendanceRecords')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('date', '>=', periodStart)
            .where('date', '<=', periodEnd)
            .get();

        const latestAttByDay = new Map<string, any>();
        for (const d of attendanceSnapshot.docs) {
            const ar = d.data() as any;
            const key = `${ar.employeeId}-${ar.date}`;
            if (!latestAttByDay.has(key)) {
                latestAttByDay.set(key, { id: d.id, ...ar });
            }
        }

        const overtimeSnapshot = await adminDb
            .collection('overtimeRecords')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('period', '==', period)
            .get();

        const absentMap = new Map<string, number>();
        const lateHoursMap = new Map<string, number>();
        const otMap = new Map<string, any>();

        for (const ar of latestAttByDay.values()) {
            if (ar.status === 'Absent') {
                absentMap.set(ar.employeeId, (absentMap.get(ar.employeeId) || 0) + 1);
            } else if (ar.status === 'Half-Day') {
                absentMap.set(ar.employeeId, (absentMap.get(ar.employeeId) || 0) + 0.5);
            } else if (ar.status === 'Late') {
                const emp = empMap.get(ar.employeeId);
                const checkIn = ar.checkIn || '';
                const standardIn = (emp as any)?.standardCheckIn || '08:00';
                const [cH, cM] = checkIn.split(':').map(Number);
                const [sH, sM] = standardIn.split(':').map(Number);
                if (!isNaN(cH) && !isNaN(sH)) {
                    const lateMins = Math.max(0, (cH * 60 + (cM || 0)) - (sH * 60 + (sM || 0)));
                    lateHoursMap.set(ar.employeeId, (lateHoursMap.get(ar.employeeId) || 0) + lateMins / 60);
                }
            }
        }

        for (const d of overtimeSnapshot.docs) {
            const ot = d.data() as any;
            otMap.set(ot.employeeId, { id: d.id, ...ot });
        }

        const result = Array.from(empMap.values()).map((emp: any) => {
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
                approved: !!(existingApproval as any)?.approvedAt,
            };
        });

        res.json({ period, employees: result });
    } catch (err) {
        console.error('Error generating attendance preview from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/attendance-payroll-approve
router.post('/:clientId/attendance-payroll-approve', async (req: AuthenticatedRequest, res) => {
    console.log('[approvals] START attendance-payroll-approve');
    console.time('approvals');
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const { period, employees: employeeApprovals, approvedBy } = req.body;
        if (!period || !Array.isArray(employeeApprovals)) {
            return res.status(400).json({ message: 'period and employees array are required' });
        }

        const nowIso = new Date().toISOString();
        const [periodYear, periodMonth] = period.split('-').map(Number);
        const daysInMonth = new Date(periodYear, periodMonth, 0).getDate();

        console.log(`[approvals] Processing ${employeeApprovals.length} employees for client ${clientId}, period ${period}...`);

        const empIds = [...new Set(employeeApprovals.map((ea: any) => ea.employeeId))];
        const employeesSnapshot = await adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();
        const empMap2 = new Map(employeesSnapshot.docs.map((d: any) => [d.id, { id: d.id, ...d.data() }]));

        const schedulesSnapshot = await adminDb
            .collection('workSchedules')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();
        const scheduleMap2 = new Map(schedulesSnapshot.docs.map((d: any) => [d.id, { id: d.id, ...d.data() }]));

        // Clean up old auto-generated attendance records for this period
        const oldAutoGenSnapshot = await adminDb
            .collection('attendanceRecords')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('date', '>=', `${period}-01`)
            .where('date', '<=', `${period}-${String(daysInMonth).padStart(2, '0')}`)
            .get();
        const deleteBatch = adminDb.batch();
        for (const d of oldAutoGenSnapshot.docs) {
            const data = d.data() as any;
            if (data.notes && data.notes.includes('review')) {
                deleteBatch.delete(d.ref);
            }
        }
        await deleteBatch.commit();

        // Delete all absent/half-day records for employees being approved so stale
        // records do not inflate the absent count when payroll is regenerated.
        const approvedEmpIds = employeeApprovals.map((ea: any) => ea.employeeId);
        const absentHalfSnapshot = await adminDb
            .collection('attendanceRecords')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('date', '>=', `${period}-01`)
            .where('date', '<=', `${period}-${String(daysInMonth).padStart(2, '0')}`)
            .where('status', 'in', ['Absent', 'Half-Day'])
            .get();
        const cleanupBatch = adminDb.batch();
        for (const d of absentHalfSnapshot.docs) {
            if (approvedEmpIds.includes((d.data() as any).employeeId)) {
                cleanupBatch.delete(d.ref);
            }
        }
        await cleanupBatch.commit();

        // Refresh existing set after cleanup
        const existingAfterCleanup = await adminDb
            .collection('attendanceRecords')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('date', '>=', `${period}-01`)
            .where('date', '<=', `${period}-${String(daysInMonth).padStart(2, '0')}`)
            .get();
        const effectiveExistingSet = new Set(existingAfterCleanup.docs.map((d: any) => {
            const data = d.data() as any;
            return `${data.employeeId}-${data.date}`;
        }));
        console.log(`[approvals] Found ${existingAfterCleanup.size} existing records after cleanup`);

        // Delete old approvals for this period
        const oldApprovalsSnapshot = await adminDb
            .collection('attendancePayrollApprovals')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('period', '==', period)
            .get();
        const delApprovalBatch = adminDb.batch();
        for (const d of oldApprovalsSnapshot.docs) {
            delApprovalBatch.delete(d.ref);
        }
        await delApprovalBatch.commit();

        // Insert new approvals
        if (employeeApprovals.length > 0) {
            const approvalBatch = adminDb.batch();
            for (const ea of employeeApprovals) {
                const docRef = adminDb.collection('attendancePayrollApprovals').doc();
                approvalBatch.set(docRef, {
                    ownerUid: uid,
                    clientId,
                    period,
                    employeeId: ea.employeeId,
                    employeeName: ea.employeeName || '',
                    absentDays: ea.absentDays || 0,
                    absentDates: ea.absentDates || [],
                    absentHours: ea.absentHours || 0,
                    absentDedAmount: ea.absentDedAmount || 0,
                    lateHours: ea.lateHours || 0,
                    lateDedAmount: ea.lateDedAmount || 0,
                    unpaidLeaveDays: ea.unpaidLeaveDays || 0,
                    unpaidLeaveHours: ea.unpaidLeaveHours || 0,
                    unpaidLeaveDedAmount: ea.unpaidLeaveDedAmount || 0,
                    overtimeHours: ea.overtimeHours || 0,
                    overtimeRate: ea.overtimeRate || 0,
                    overtimeMultiplier: ea.overtimeMultiplier || 1.5,
                    overtimeAmount: ea.overtimeAmount || 0,
                    totalStdHours: ea.totalStdHours || 0,
                    totalScheduledHours: ea.totalScheduledHours || 0,
                    hourlyRate: ea.hourlyRate || 0,
                    computedBasicPay: ea.computedBasicPay || 0,
                    approvedBy: approvedBy || null,
                    approvedAt: nowIso,
                    createdAt: nowIso,
                });
            }
            await approvalBatch.commit();
            console.log('[approvals] New approvals inserted');
        }

        // Build absent records to insert
        const newRecords: any[] = [];
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        for (const ea of employeeApprovals) {
            const emp = empMap2.get(ea.employeeId);
            if (!emp) continue;

            const absentCount = (ea.absentDays || 0);
            if (absentCount <= 0) continue;

            const ws = (emp as any).workScheduleId ? scheduleMap2.get(String((emp as any).workScheduleId)) : null;
            const scheduleConfig = ws && (ws as any).config ? (typeof (ws as any).config === 'string' ? JSON.parse((ws as any).config) : (ws as any).config) : null;

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
                if ((emp as any).offDay && (emp as any).offDay === dayName) isWorkDay = false;
                if (isWorkDay) workDays.push(`${period}-${String(d).padStart(2, '0')}`);
            }

            // Use the exact absent dates from the calendar when provided; otherwise
            // fall back to the last N scheduled work days for backward compatibility.
            const absentDates: string[] = Array.isArray(ea.absentDates) && ea.absentDates.length > 0
                ? ea.absentDates
                : workDays.slice(-absentCount);

            for (const dateStr of absentDates) {
                if (effectiveExistingSet.has(`${(emp as any).id}-${dateStr}`)) continue;
                newRecords.push({
                    ownerUid: uid,
                    clientId,
                    employeeId: (emp as any).id,
                    employeeName: (emp as any).employeeName || '',
                    kraPin: (emp as any).kraPin || '',
                    date: dateStr,
                    checkIn: '',
                    checkOut: '',
                    status: 'Absent',
                    notes: 'Marked absent from review',
                    createdAt: nowIso,
                    updatedAt: nowIso,
                });
            }
        }

        if (newRecords.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < newRecords.length; i += BATCH_SIZE) {
                const chunk = newRecords.slice(i, i + BATCH_SIZE);
                const batch = adminDb.batch();
                for (const r of chunk) {
                    const docId = `${r.clientId}_${r.employeeId}_${r.date}`;
                    const docRef = adminDb.collection('attendanceRecords').doc(docId);
                    batch.set(docRef, { ...r, updatedAt: Timestamp.now() });
                }
                await batch.commit();
            }
            console.log(`[approvals] Inserted ${newRecords.length} absent-day records`);
        }

        // Handle overtime
        const employeesWithOt = employeeApprovals.filter((ea: any) => (ea.overtimeHours || 0) > 0);
        if (employeesWithOt.length > 0) {
            const otEmpIds = employeesWithOt.map((ea: any) => ea.employeeId);
            const oldOtSnapshot = await adminDb
                .collection('overtimeRecords')
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .where('period', '==', period)
                .where('employeeId', 'in', otEmpIds.slice(0, 10))
                .get();
            const delOtBatch = adminDb.batch();
            for (const d of oldOtSnapshot.docs) {
                delOtBatch.delete(d.ref);
            }
            await delOtBatch.commit();

            const otBatch = adminDb.batch();
            for (const ea of employeesWithOt) {
                const docRef = adminDb.collection('overtimeRecords').doc();
                otBatch.set(docRef, {
                    ownerUid: uid,
                    clientId,
                    employeeId: ea.employeeId,
                    period,
                    hours: ea.overtimeHours,
                    rate: ea.overtimeRate || 0,
                    multiplier: ea.overtimeMultiplier || 1.5,
                    amount: ea.overtimeAmount || 0,
                    description: 'Auto-generated from review',
                    createdAt: Timestamp.now(),
                });
            }
            await otBatch.commit();
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

// POST /:clientId/payroll-runs/:id/finalize
router.post('/:clientId/payroll-runs/:id/finalize', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const payrollRunId = req.params.id;
        const runDoc = await adminDb.collection('payrollRuns').doc(payrollRunId).get();
        if (!runDoc.exists || runDoc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Payroll run not found' });
        }
        if (runDoc.data()?.lockedAt) {
            return res.status(409).json({ message: 'This payroll run is already finalized.' });
        }

        const clientId = runDoc.data()?.clientId;
        const entriesSnapshot = await adminDb
            .collection('payrollEntries')
            .where('ownerUid', '==', uid)
            .where('payrollRunId', '==', payrollRunId)
            .get();

        const nowIso = new Date().toISOString();
        const warnings: string[] = [];

        for (const d of entriesSnapshot.docs) {
            const e = d.data() as any;
            if (e.netPay < e.grossPay / 3) {
                warnings.push(
                    `1/3 rule: ${e.employeeName} net pay KES ${Math.round(e.netPay).toLocaleString()} is below 1/3 of gross KES ${Math.round(e.grossPay / 3).toLocaleString()}`,
                );
            }
        }

        for (const d of entriesSnapshot.docs) {
            const entry = d.data() as any;
            if ((entry.loanDeduction || 0) <= 0) continue;

            const loansSnapshot = await adminDb
                .collection('loans')
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .where('employeeId', '==', entry.employeeId)
                .limit(1)
                .get();

            if (loansSnapshot.empty) continue;
            const loanDoc = loansSnapshot.docs[0];
            const loan = loanDoc.data() as any;
            if ((loan.remainingInstallments || 0) <= 0) continue;

            try {
                await adminDb.collection('loanTransactions').add({
                    ownerUid: uid,
                    clientId,
                    employeeId: entry.employeeId,
                    payrollRunId,
                    loanId: loanDoc.id,
                    amount: entry.loanDeduction,
                    type: 'deduction',
                    createdAt: Timestamp.now(),
                });
                await loanDoc.ref.update({
                    remainingInstallments: loan.remainingInstallments - 1,
                    updatedAt: Timestamp.now(),
                });
            } catch (loanErr: any) {
                console.error(`[FINALIZE] Loan transaction failed for employee ${entry.employeeId}:`, loanErr?.message || loanErr);
                warnings.push(`Loan deduction failed for ${entry.employeeName}: ${loanErr?.message || 'Unknown error'}`);
            }
        }

        await runDoc.ref.update({
            lockedAt: nowIso,
            updatedAt: Timestamp.now(),
            status: 'closed',
        });

        res.json({ success: true, finalizedAt: nowIso, warnings, entryCount: entriesSnapshot.size });
    } catch (err: any) {
        console.error('[FINALIZE] Unhandled error:', err);
        res.status(500).json({ message: 'Failed to finalize run', error: err?.message || String(err) });
    }
});

// POST /:clientId/payroll-runs/:id/rollback
router.post('/:clientId/payroll-runs/:id/rollback', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const payrollRunId = req.params.id;
        const runDoc = await adminDb.collection('payrollRuns').doc(payrollRunId).get();
        if (!runDoc.exists || runDoc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Payroll run not found' });
        }
        if (!runDoc.data()?.lockedAt) {
            return res.status(409).json({ message: 'This payroll run is not finalized yet.' });
        }

        const transactionsSnapshot = await adminDb
            .collection('loanTransactions')
            .where('ownerUid', '==', uid)
            .where('payrollRunId', '==', payrollRunId)
            .get();

        const nowIso = new Date().toISOString();

        for (const d of transactionsSnapshot.docs) {
            const tx = d.data() as any;
            const loanDoc = await adminDb.collection('loans').doc(tx.loanId).get();
            if (loanDoc.exists) {
                const loan = loanDoc.data() as any;
                await loanDoc.ref.update({
                    remainingInstallments: loan.remainingInstallments + 1,
                    updatedAt: Timestamp.now(),
                });
            }
        }

        // Delete loan transactions
        const delBatch = adminDb.batch();
        for (const d of transactionsSnapshot.docs) {
            delBatch.delete(d.ref);
        }
        await delBatch.commit();

        // Delete dynamic adjustments
        const adjustmentsSnapshot = await adminDb
            .collection('payrollAdjustments')
            .where('payrollRunId', '==', payrollRunId)
            .get();
        const adjBatch = adminDb.batch();
        for (const d of adjustmentsSnapshot.docs) {
            adjBatch.delete(d.ref);
        }
        await adjBatch.commit();

        await runDoc.ref.update({
            lockedAt: null,
            updatedAt: Timestamp.now(),
        });

        res.json({ success: true, restoredLoans: transactionsSnapshot.size });
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to rollback run', error: err.message });
    }
});

// GET /:clientId/payroll-runs/:id/adjustments
router.get('/:clientId/payroll-runs/:id/adjustments', async (req: AuthenticatedRequest, res) => {
    try {
        const payrollRunId = req.params.id;
        const snapshot = await adminDb
            .collection('payrollAdjustments')
            .where('payrollRunId', '==', payrollRunId)
            .get();
        res.json(snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to load adjustments', error: err.message });
    }
});

// POST /:clientId/payroll-runs/:id/adjustments
router.post('/:clientId/payroll-runs/:id/adjustments', async (req: AuthenticatedRequest, res) => {
    try {
        const payrollRunId = req.params.id;
        const { employeeId, type, label, amount, isStatutory = false } = req.body;
        if (!employeeId || !type || !label || amount === undefined) {
            return res.status(400).json({ message: 'Missing required fields: employeeId, type, label, amount' });
        }
        const runDoc = await adminDb.collection('payrollRuns').doc(payrollRunId).get();
        if (runDoc.data()?.lockedAt) {
            return res.status(409).json({ message: 'Cannot modify adjustments on a finalized run.' });
        }
        const docRef = await adminDb.collection('payrollAdjustments').add({
            payrollRunId,
            employeeId: String(employeeId),
            payrollEntryId: '',
            type,
            label,
            amount: Number(amount),
            isStatutory: isStatutory ? true : false,
            createdAt: Timestamp.now(),
        });
        const doc = await docRef.get();
        res.json({ id: doc.id, ...doc.data() });
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to create adjustment', error: err.message });
    }
});

// PUT /:clientId/payroll-runs/:id/adjustments/:adjId
router.put('/:clientId/payroll-runs/:id/adjustments/:adjId', async (req: AuthenticatedRequest, res) => {
    try {
        const payrollRunId = req.params.id;
        const adjId = req.params.adjId;
        const { type, label, amount, isStatutory } = req.body;
        const runDoc = await adminDb.collection('payrollRuns').doc(payrollRunId).get();
        if (runDoc.data()?.lockedAt) {
            return res.status(409).json({ message: 'Cannot modify adjustments on a finalized run.' });
        }
        const updateData: any = {};
        if (type !== undefined) updateData.type = type;
        if (label !== undefined) updateData.label = label;
        if (amount !== undefined) updateData.amount = Number(amount);
        if (isStatutory !== undefined) updateData.isStatutory = isStatutory ? true : false;
        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }
        const docRef = adminDb.collection('payrollAdjustments').doc(adjId);
        await docRef.update(updateData);
        const doc = await docRef.get();
        res.json({ id: doc.id, ...doc.data() });
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to update adjustment', error: err.message });
    }
});

// DELETE /:clientId/payroll-runs/:id/adjustments/:adjId
router.delete('/:clientId/payroll-runs/:id/adjustments/:adjId', async (req: AuthenticatedRequest, res) => {
    try {
        const payrollRunId = req.params.id;
        const adjId = req.params.adjId;
        const runDoc = await adminDb.collection('payrollRuns').doc(payrollRunId).get();
        if (runDoc.data()?.lockedAt) {
            return res.status(409).json({ message: 'Cannot delete adjustments on a finalized run.' });
        }
        await adminDb.collection('payrollAdjustments').doc(adjId).delete();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to delete adjustment', error: err.message });
    }
});

export default router;
