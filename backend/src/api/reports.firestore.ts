import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import PDFDocument from 'pdfkit';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

async function generateReportData(clientId: string, uid: string) {
    const employeeSnapshot = await adminDb
        .collection('employees')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .get();

    const employeeStats = employeeSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    const totalEmployees = employeeStats.length;
    const activeEmployees = employeeStats.filter((e: any) => e.employmentStatus === 'Active').length;
    const totalBasicPay = employeeStats.reduce((sum: any, e: any) => sum + Number(e.basicPay || 0), 0);
    const avgBasicPay = totalEmployees > 0 ? totalBasicPay / totalEmployees : 0;

    const deptMap = new Map<string, { count: number; totalPay: number }>();
    employeeStats.forEach((e: any) => {
        const dept = e.department || 'Unassigned';
        const existing = deptMap.get(dept) || { count: 0, totalPay: 0 };
        existing.count++;
        existing.totalPay += Number(e.basicPay || 0);
        deptMap.set(dept, existing);
    });
    const departmentBreakdown = Array.from(deptMap.entries()).map(([department, data]) => ({
        department, count: data.count, totalPay: data.totalPay,
    }));

    const leaveSnapshot = await adminDb
        .collection('leaveRequests')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .get();
    const leaveStats = leaveSnapshot.docs.map((d: any) => d.data());
    const leaveByStatus = new Map<string, number>();
    const leaveByType = new Map<string, number>();
    leaveStats.forEach((l: any) => {
        leaveByStatus.set(l.status, (leaveByStatus.get(l.status) || 0) + 1);
        leaveByType.set(l.leaveType, (leaveByType.get(l.leaveType) || 0) + 1);
    });

    const loanSnapshot = await adminDb
        .collection('loans')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .get();
    const loanStats = loanSnapshot.docs.map((d: any) => d.data());
    let totalLoansActive = 0, totalLoansPaid = 0;
    let totalPrincipal = 0, totalAmountPaid = 0;
    loanStats.forEach((l: any) => {
        totalPrincipal += Number(l.principal || 0);
        totalAmountPaid += Number(l.amountPaid || 0);
        if (l.status === 'Active' || l.status === 'Approved') totalLoansActive++;
        if (l.status === 'Paid') totalLoansPaid++;
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

    const attendanceSnapshot = await adminDb
        .collection('attendanceRecords')
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .where('date', '>=', dateStr)
        .get();
    const attendanceStats = attendanceSnapshot.docs.map((d: any) => d.data());
    const attendanceByStatus = new Map<string, number>();
    attendanceStats.forEach((a: any) => {
        attendanceByStatus.set(a.status, (attendanceByStatus.get(a.status) || 0) + 1);
    });

    return {
        employeeSummary: { totalEmployees, activeEmployees, totalBasicPay, avgBasicPay },
        departmentBreakdown,
        leaveSummary: { byStatus: Object.fromEntries(leaveByStatus), byType: Object.fromEntries(leaveByType), total: leaveStats.length },
        loanSummary: { totalLoans: loanStats.length, activeLoans: totalLoansActive, paidLoans: totalLoansPaid, totalPrincipal, totalAmountPaid, outstandingBalance: totalPrincipal - totalAmountPaid },
        attendanceSummary: { ...Object.fromEntries(attendanceByStatus), total: attendanceStats.length },
    };
}

router.get('/:clientId/reports/summary', async (req: AuthenticatedRequest, res) => {
    try {
        const clientId = req.params.clientId;
        const uid = req.user!.uid;
        const data = await generateReportData(clientId, uid);
        res.json(data);
    } catch (err) {
        console.error('Error generating report:', err);
        res.status(500).json({ message: 'Failed to generate report' });
    }
});

router.get('/:clientId/reports/summary/pdf', async (req: AuthenticatedRequest, res) => {
    try {
        const clientId = req.params.clientId;
        const uid = req.user!.uid;
        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        if (!clientDoc.exists || clientDoc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }
        const client = { id: clientDoc.id, ...clientDoc.data() };
        const data = await generateReportData(clientId, uid);

        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Report_${(client as any).name || 'Client'}.pdf`);
        doc.pipe(res);

        doc.fontSize(14).font('Helvetica-Bold').text('HR & PAYROLL REPORT', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica').text((client as any).name || 'Client', { align: 'center' });
        doc.text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(0.8);

        doc.fontSize(10).font('Helvetica-Bold').text('Employee Summary');
        doc.fontSize(8).font('Helvetica');
        doc.text(`Total Employees: ${data.employeeSummary.totalEmployees}`);
        doc.text(`Active: ${data.employeeSummary.activeEmployees}`);
        doc.text(`Total Basic Pay: KES ${data.employeeSummary.totalBasicPay.toLocaleString()}`);
        doc.text(`Average Basic Pay: KES ${data.employeeSummary.avgBasicPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        doc.moveDown(0.5);

        doc.fontSize(10).font('Helvetica-Bold').text('Department Breakdown');
        doc.fontSize(7).font('Helvetica');
        for (const d of data.departmentBreakdown) {
            doc.text(`  ${d.department}: ${d.count} employees, KES ${d.totalPay.toLocaleString()}`);
        }
        doc.moveDown(0.5);

        doc.fontSize(10).font('Helvetica-Bold').text('Leave Summary');
        doc.fontSize(7).font('Helvetica');
        doc.text(`  Total Requests: ${data.leaveSummary.total}`);
        for (const [k, v] of Object.entries(data.leaveSummary.byStatus)) doc.text(`  ${k}: ${v}`);
        for (const [k, v] of Object.entries(data.leaveSummary.byType)) doc.text(`  ${k}: ${v}`);
        doc.moveDown(0.5);

        doc.fontSize(10).font('Helvetica-Bold').text('Loan Summary');
        doc.fontSize(7).font('Helvetica');
        doc.text(`  Total Loans: ${data.loanSummary.totalLoans} (Active: ${data.loanSummary.activeLoans}, Paid: ${data.loanSummary.paidLoans})`);
        doc.text(`  Total Principal: KES ${data.loanSummary.totalPrincipal.toLocaleString()}`);
        doc.text(`  Outstanding: KES ${data.loanSummary.outstandingBalance.toLocaleString()}`);
        doc.moveDown(0.5);

        doc.fontSize(10).font('Helvetica-Bold').text('Attendance Summary (Last 30 Days)');
        doc.fontSize(7).font('Helvetica');
        doc.text(`  Total Records: ${data.attendanceSummary.total}`);
        for (const [k, v] of Object.entries(data.attendanceSummary)) if (k !== 'total') doc.text(`  ${k}: ${v}`);

        doc.end();
    } catch (err) {
        console.error('Error generating PDF report:', err);
        res.status(500).json({ message: 'Failed to generate PDF report' });
    }
});

router.get('/:clientId/reports/custom', async (req: AuthenticatedRequest, res) => {
    try {
        const clientId = req.params.clientId;
        const uid = req.user!.uid;

        const periodFrom = (req.query.periodFrom as string) || '';
        const periodTo = (req.query.periodTo as string) || '';
        const department = (req.query.department as string) || '';
        const reportType = (req.query.reportType as string) || 'payroll-summary';

        const employeeSnapshot = await adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();
        let employees = employeeSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        if (department) employees = employees.filter((e: any) => e.department === department);
        const employeeIds = employees.map((e: any) => e.id);

        let result: any = { reportType, periodFrom, periodTo, department };

        if (reportType === 'payroll-summary' || reportType === 'gross-to-net') {
            let entriesSnapshot = await adminDb
                .collection('payrollEntries')
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .get();
            let entries = entriesSnapshot.docs.map((d: any) => d.data());

            if (periodFrom) {
                const runsSnapshot = await adminDb
                    .collection('payrollRuns')
                    .where('ownerUid', '==', uid)
                    .where('clientId', '==', clientId)
                    .where('period', '>=', periodFrom)
                    .where('period', '<=', periodTo || periodFrom)
                    .get();
                const runIds = runsSnapshot.docs.map((d: any) => d.id);
                if (runIds.length > 0) {
                    entries = entries.filter((e: any) => runIds.includes(e.payrollRunId));
                } else {
                    result.rows = [];
                    return res.json(result);
                }
            }
            const filtered = department ? entries.filter((e: any) => employeeIds.includes(e.employeeId)) : entries;
            result.rows = filtered.map((e: any) => ({
                employeeName: e.employeeName, kraPin: e.kraPin, period: '',
                basicPay: e.basicPay, overtimePay: e.overtimePay || 0, grossPay: e.grossPay,
                payeTax: e.payeTax, shaDeduction: e.shaDeduction, nssfDeduction: e.nssfDeduction,
                ahlDeduction: e.ahlDeduction, loanDeduction: e.loanDeduction || 0,
                absentDays: e.absentDays || 0, lateDays: e.lateDays || 0, netPay: e.netPay,
            }));
            result.totals = {
                totalGross: filtered.reduce((s: number, e: any) => s + e.grossPay, 0),
                totalNet: filtered.reduce((s: number, e: any) => s + e.netPay, 0),
                totalPaye: filtered.reduce((s: number, e: any) => s + e.payeTax, 0),
            };
        } else if (reportType === 'overtime') {
            let otSnapshot = await adminDb
                .collection('overtimeRecords')
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .get();
            let records = otSnapshot.docs.map((d: any) => d.data());
            if (periodFrom) {
                records = records.filter((r: any) => r.period >= periodFrom && r.period <= (periodTo || periodFrom));
            }
            const filtered = department ? records.filter((r: any) => employeeIds.includes(r.employeeId)) : records;
            result.rows = filtered.map((r: any) => ({ employeeId: r.employeeId, period: r.period, hours: r.hours, rate: r.rate, multiplier: r.multiplier, amount: r.amount }));
            result.totals = { totalHours: filtered.reduce((s: number, r: any) => s + r.hours, 0), totalAmount: filtered.reduce((s: number, r: any) => s + r.amount, 0) };
        } else if (reportType === 'loans') {
            const loansSnapshot = await adminDb
                .collection('loans')
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .get();
            const records = loansSnapshot.docs.map((d: any) => d.data());
            const filtered = department ? records.filter((l: any) => employeeIds.includes(l.employeeId)) : records;
            result.rows = filtered;
            result.totals = {
                totalPrincipal: filtered.reduce((s: number, l: any) => s + (l.principal || 0), 0),
                totalOutstanding: filtered.reduce((s: number, l: any) => s + (l.totalRepayable || 0) - (l.amountPaid || 0), 0),
            };
        } else if (reportType === 'leave') {
            let lvSnapshot = await adminDb
                .collection('leaveRequests')
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .get();
            let records = lvSnapshot.docs.map((d: any) => d.data());
            if (periodFrom) {
                records = records.filter((l: any) => l.startDate >= periodFrom && l.startDate <= (periodTo || periodFrom));
            }
            const filtered = department ? records.filter((l: any) => employeeIds.includes(l.employeeId)) : records;
            result.rows = filtered;
            result.totals = { total: filtered.length, approved: filtered.filter((l: any) => l.status === 'Approved').length, pending: filtered.filter((l: any) => l.status === 'Pending').length };
        } else if (reportType === 'attendance') {
            let attSnapshot = await adminDb
                .collection('attendanceRecords')
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .get();
            let records = attSnapshot.docs.map((d: any) => d.data());
            if (periodFrom) {
                records = records.filter((a: any) => a.date >= periodFrom && a.date <= (periodTo || periodFrom));
            }
            const filtered = department ? records.filter((a: any) => employeeIds.includes(a.employeeId)) : records;
            result.rows = filtered;
            const byStatus: Record<string, number> = {}; filtered.forEach((a: any) => { byStatus[a.status] = (byStatus[a.status] || 0) + 1; });
            result.totals = { total: filtered.length, ...byStatus };
        } else if (reportType === 'lateness') {
            let attSnapshot = await adminDb
                .collection('attendanceRecords')
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .get();
            let records = attSnapshot.docs.map((d: any) => d.data()).filter((a: any) => a.status === 'Late');
            if (periodFrom) {
                records = records.filter((r: any) => r.date >= periodFrom && r.date <= (periodTo || periodFrom));
            }
            const allEmployees = employees;
            const empMap = new Map(allEmployees.map((e: any) => [e.id, e]));
            const rows = records.map((r: any) => {
                const emp: any = empMap.get(r.employeeId);
                const standardIn = emp?.standardCheckIn || '08:00';
                const [cH, cM] = (r.checkIn || '').split(':').map(Number);
                const [sH, sM] = standardIn.split(':').map(Number);
                let lateMinutes = 0;
                if (!isNaN(cH) && !isNaN(sH)) {
                    lateMinutes = Math.max(0, (cH * 60 + (cM || 0)) - (sH * 60 + (sM || 0)));
                }
                const lateHours = Math.round((lateMinutes / 60) * 100) / 100;
                const basicPay = emp?.basicPay || 0;
                const daysInMonth = new Date(parseInt(r.date.split('-')[0], 10), parseInt(r.date.split('-')[1], 10), 0).getDate();
                const dailyRate = basicPay / Math.max(1, daysInMonth);
                const deduction = Math.round(dailyRate * (lateHours / 8) * 100) / 100;
                return {
                    employeeName: emp?.employeeName || r.employeeName || '',
                    date: r.date,
                    checkIn: r.checkIn,
                    standardCheckIn: standardIn,
                    lateMinutes,
                    lateHours,
                    dailyRate: Math.round(dailyRate * 100) / 100,
                    deductionKES: deduction,
                };
            });
            const filtered = department ? rows.filter((r: any) => {
                const emp = allEmployees.find((e: any) => e.employeeName === r.employeeName);
                return emp && employeeIds.includes(emp.id);
            }) : rows;
            result.rows = filtered;
            result.totals = {
                totalLateMinutes: filtered.reduce((s: number, r: any) => s + r.lateMinutes, 0),
                totalLateHours: Math.round(filtered.reduce((s: number, r: any) => s + r.lateHours, 0) * 100) / 100,
                totalDeduction: Math.round(filtered.reduce((s: number, r: any) => s + r.deductionKES, 0) * 100) / 100,
            };
        } else if (reportType === 'statutory') {
            let entriesSnapshot = await adminDb
                .collection('payrollEntries')
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .get();
            let entries = entriesSnapshot.docs.map((d: any) => d.data());

            if (periodFrom) {
                const runsSnapshot = await adminDb
                    .collection('payrollRuns')
                    .where('ownerUid', '==', uid)
                    .where('clientId', '==', clientId)
                    .where('period', '>=', periodFrom)
                    .where('period', '<=', periodTo || periodFrom)
                    .get();
                const runIds = runsSnapshot.docs.map((d: any) => d.id);
                if (runIds.length > 0) {
                    entries = entries.filter((e: any) => runIds.includes(e.payrollRunId));
                } else {
                    result.totals = { paye: 0, sha: 0, nssf: 0, ahl: 0, nita: 0 };
                    return res.json(result);
                }
            }
            const filtered = department ? entries.filter((e: any) => employeeIds.includes(e.employeeId)) : entries;
            result.totals = {
                paye: filtered.reduce((s: number, e: any) => s + e.payeTax, 0),
                sha: filtered.reduce((s: number, e: any) => s + e.shaDeduction, 0),
                nssf: filtered.reduce((s: number, e: any) => s + e.nssfDeduction, 0),
                ahl: filtered.reduce((s: number, e: any) => s + e.ahlDeduction, 0),
                nita: filtered.length * 50,
            };
        }

        res.json(result);
    } catch (err) {
        console.error('Error generating custom report:', err);
        res.status(500).json({ message: 'Failed to generate custom report' });
    }
});

export default router;
