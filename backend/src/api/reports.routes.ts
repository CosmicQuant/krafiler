import { Router } from 'express';
import { db } from '../db/kysely';
import PDFDocument from 'pdfkit';

const router = Router();

async function generateReportData(clientId: number) {
    const employeeStats = await db
        .selectFrom('employees')
        .selectAll()
        .where('clientId', '=', clientId)
        .execute();

    const totalEmployees = employeeStats.length;
    const activeEmployees = employeeStats.filter(e => e.employmentStatus === 'Active').length;
    const totalBasicPay = employeeStats.reduce((sum, e) => sum + Number(e.basicPay || 0), 0);
    const avgBasicPay = totalEmployees > 0 ? totalBasicPay / totalEmployees : 0;

    const deptMap = new Map<string, { count: number; totalPay: number }>();
    employeeStats.forEach(e => {
        const dept = e.department || 'Unassigned';
        const existing = deptMap.get(dept) || { count: 0, totalPay: 0 };
        existing.count++;
        existing.totalPay += Number(e.basicPay || 0);
        deptMap.set(dept, existing);
    });
    const departmentBreakdown = Array.from(deptMap.entries()).map(([department, data]) => ({
        department, count: data.count, totalPay: data.totalPay,
    }));

    const leaveStats = await db.selectFrom('leave_requests').selectAll().where('clientId', '=', clientId).execute();
    const leaveByStatus = new Map<string, number>();
    const leaveByType = new Map<string, number>();
    leaveStats.forEach(l => {
        leaveByStatus.set(l.status, (leaveByStatus.get(l.status) || 0) + 1);
        leaveByType.set(l.leaveType, (leaveByType.get(l.leaveType) || 0) + 1);
    });

    const loanStats = await db.selectFrom('loans').selectAll().where('clientId', '=', clientId).execute();
    let totalLoansActive = 0, totalLoansPaid = 0;
    let totalPrincipal = 0, totalAmountPaid = 0;
    loanStats.forEach(l => {
        totalPrincipal += Number(l.principal || 0);
        totalAmountPaid += Number(l.amountPaid || 0);
        if (l.status === 'Active' || l.status === 'Approved') totalLoansActive++;
        if (l.status === 'Paid') totalLoansPaid++;
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];
    const attendanceStats = await db.selectFrom('attendance_records').selectAll().where('clientId', '=', clientId).where('date', '>=', dateStr).execute();
    const attendanceByStatus = new Map<string, number>();
    attendanceStats.forEach(a => {
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

router.get('/:clientId/reports/summary', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });
        const data = await generateReportData(clientId);
        res.json(data);
    } catch (err) {
        console.error('Error generating report:', err);
        res.status(500).json({ message: 'Failed to generate report' });
    }
});

router.get('/:clientId/reports/summary/pdf', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });
        const client = await db.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();
        const data = await generateReportData(clientId);

        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Report_${client?.name || 'Client'}.pdf`);
        doc.pipe(res);

        doc.fontSize(14).font('Helvetica-Bold').text('HR & PAYROLL REPORT', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica').text(client?.name || 'Client', { align: 'center' });
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

// GET /api/clients/:clientId/reports/custom — custom report builder
router.get('/:clientId/reports/custom', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const periodFrom = (req.query.periodFrom as string) || '';
        const periodTo = (req.query.periodTo as string) || '';
        const department = (req.query.department as string) || '';
        const reportType = (req.query.reportType as string) || 'payroll-summary';

        let employees = await db.selectFrom('employees').selectAll().where('clientId', '=', clientId).execute();
        if (department) employees = employees.filter(e => e.department === department);

        const employeeIds = employees.map(e => e.id);

        let result: any = { reportType, periodFrom, periodTo, department };

        if (reportType === 'payroll-summary' || reportType === 'gross-to-net') {
            let entriesQuery = db.selectFrom('payroll_entries').selectAll().where('clientId', '=', clientId);
            if (periodFrom) {
                const runsForPeriod = await db.selectFrom('payroll_runs').select('id').where('clientId', '=', clientId).where('period', '>=', periodFrom).where('period', '<=', periodTo || periodFrom).execute();
                const runIds = runsForPeriod.map(r => r.id);
                if (runIds.length > 0) entriesQuery = entriesQuery.where('payrollRunId', 'in', runIds as any);
                else { result.rows = []; return res.json(result); }
            }
            const entries = await entriesQuery.execute();
            const filtered = department ? entries.filter(e => employeeIds.includes(e.employeeId)) : entries;
            result.rows = filtered.map(e => ({
                employeeName: e.employeeName, kraPin: e.kraPin, period: '',
                basicPay: e.basicPay, overtimePay: e.overtimePay || 0, grossPay: e.grossPay,
                payeTax: e.payeTax, shaDeduction: e.shaDeduction, nssfDeduction: e.nssfDeduction,
                ahlDeduction: e.ahlDeduction, loanDeduction: e.loanDeduction || 0,
                absentDays: e.absentDays || 0, lateDays: e.lateDays || 0, netPay: e.netPay,
            }));
            result.totals = { totalGross: filtered.reduce((s, e) => s + e.grossPay, 0), totalNet: filtered.reduce((s, e) => s + e.netPay, 0), totalPaye: filtered.reduce((s, e) => s + e.payeTax, 0) };
        } else if (reportType === 'overtime') {
            let otQuery = db.selectFrom('overtime_records').selectAll().where('clientId', '=', clientId);
            if (periodFrom) otQuery = otQuery.where('period', '>=', periodFrom).where('period', '<=', periodTo || periodFrom);
            const records = await otQuery.execute();
            const filtered = department ? records.filter(r => employeeIds.includes(r.employeeId)) : records;
            result.rows = filtered.map(r => ({ employeeId: r.employeeId, period: r.period, hours: r.hours, rate: r.rate, multiplier: r.multiplier, amount: r.amount }));
            result.totals = { totalHours: filtered.reduce((s, r) => s + r.hours, 0), totalAmount: filtered.reduce((s, r) => s + r.amount, 0) };
        } else if (reportType === 'loans') {
            const loans = await db.selectFrom('loans').selectAll().where('clientId', '=', clientId).execute();
            const filtered = department ? loans.filter(l => employeeIds.includes(l.employeeId)) : loans;
            result.rows = filtered;
            result.totals = { totalPrincipal: filtered.reduce((s, l) => s + (l.principal || 0), 0), totalOutstanding: filtered.reduce((s, l) => s + (l.totalRepayable || 0) - (l.amountPaid || 0), 0) };
        } else if (reportType === 'leave') {
            let lvQuery = db.selectFrom('leave_requests').selectAll().where('clientId', '=', clientId);
            if (periodFrom) lvQuery = lvQuery.where('startDate', '>=', periodFrom).where('startDate', '<=', periodTo || periodFrom);
            const records = await lvQuery.execute();
            const filtered = department ? records.filter(l => employeeIds.includes(l.employeeId)) : records;
            result.rows = filtered;
            result.totals = { total: filtered.length, approved: filtered.filter(l => l.status === 'Approved').length, pending: filtered.filter(l => l.status === 'Pending').length };
        } else if (reportType === 'attendance') {
            let attQuery = db.selectFrom('attendance_records').selectAll().where('clientId', '=', clientId);
            if (periodFrom) attQuery = attQuery.where('date', '>=', periodFrom).where('date', '<=', periodTo || periodFrom);
            const records = await attQuery.execute();
            const filtered = department ? records.filter(a => employeeIds.includes(a.employeeId)) : records;
            result.rows = filtered;
            const byStatus: Record<string, number> = {}; filtered.forEach(a => { byStatus[a.status] = (byStatus[a.status] || 0) + 1; });
            result.totals = { total: filtered.length, ...byStatus };
        } else if (reportType === 'lateness') {
            let attQuery = db.selectFrom('attendance_records').selectAll().where('clientId', '=', clientId).where('status', '=', 'Late');
            if (periodFrom) attQuery = attQuery.where('date', '>=', periodFrom).where('date', '<=', periodTo || periodFrom);
            const records = await attQuery.execute();
            const allEmployees = await db.selectFrom('employees').selectAll().where('clientId', '=', clientId).execute();
            const empMap = new Map(allEmployees.map(e => [e.id, e]));
            const rows = records.map(r => {
                const emp = empMap.get(r.employeeId);
                const standardIn = emp?.standardCheckIn || '08:00';
                const [cH, cM] = r.checkIn.split(':').map(Number);
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
            const filtered = department ? rows.filter(r => {
                const emp = allEmployees.find(e => e.employeeName === r.employeeName);
                return emp && employeeIds.includes(emp.id);
            }) : rows;
            result.rows = filtered;
            result.totals = {
                totalLateMinutes: filtered.reduce((s, r) => s + r.lateMinutes, 0),
                totalLateHours: Math.round(filtered.reduce((s, r) => s + r.lateHours, 0) * 100) / 100,
                totalDeduction: Math.round(filtered.reduce((s, r) => s + r.deductionKES, 0) * 100) / 100,
            };
        } else if (reportType === 'statutory') {
            let entriesQuery = db.selectFrom('payroll_entries').selectAll().where('clientId', '=', clientId);
            if (periodFrom) {
                const runsForPeriod = await db.selectFrom('payroll_runs').select('id').where('clientId', '=', clientId).where('period', '>=', periodFrom).where('period', '<=', periodTo || periodFrom).execute();
                const runIds = runsForPeriod.map(r => r.id);
                if (runIds.length > 0) entriesQuery = entriesQuery.where('payrollRunId', 'in', runIds as any);
                else { result.totals = { paye: 0, sha: 0, nssf: 0, ahl: 0, nita: 0 }; return res.json(result); }
            }
            const entries = await entriesQuery.execute();
            const filtered = department ? entries.filter(e => employeeIds.includes(e.employeeId)) : entries;
            result.totals = {
                paye: filtered.reduce((s, e) => s + e.payeTax, 0), sha: filtered.reduce((s, e) => s + e.shaDeduction, 0),
                nssf: filtered.reduce((s, e) => s + e.nssfDeduction, 0), ahl: filtered.reduce((s, e) => s + e.ahlDeduction, 0),
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
