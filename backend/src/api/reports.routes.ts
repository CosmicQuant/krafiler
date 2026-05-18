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

export default router;
