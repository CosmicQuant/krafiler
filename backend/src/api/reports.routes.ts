import { Router } from 'express';
import { db } from '../db/kysely';

const router = Router();

router.get('/:clientId/reports/summary', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

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

        const typeMap = new Map<string, number>();
        employeeStats.forEach(e => {
            typeMap.set(e.employmentType, (typeMap.get(e.employmentType) || 0) + 1);
        });
        const employmentTypeBreakdown = Array.from(typeMap.entries()).map(([type, count]) => ({ type, count }));

        const leaveStats = await db
            .selectFrom('leave_requests')
            .selectAll()
            .where('clientId', '=', clientId)
            .execute();

        const leaveByStatus = new Map<string, number>();
        const leaveByType = new Map<string, number>();
        leaveStats.forEach(l => {
            leaveByStatus.set(l.status, (leaveByStatus.get(l.status) || 0) + 1);
            leaveByType.set(l.leaveType, (leaveByType.get(l.leaveType) || 0) + 1);
        });

        const loanStats = await db
            .selectFrom('loans')
            .selectAll()
            .where('clientId', '=', clientId)
            .execute();

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

        const attendanceStats = await db
            .selectFrom('attendance_records')
            .selectAll()
            .where('clientId', '=', clientId)
            .where('date', '>=', dateStr)
            .execute();

        const attendanceByStatus = new Map<string, number>();
        attendanceStats.forEach(a => {
            attendanceByStatus.set(a.status, (attendanceByStatus.get(a.status) || 0) + 1);
        });

        res.json({
            employeeSummary: { totalEmployees, activeEmployees, totalBasicPay, avgBasicPay },
            departmentBreakdown,
            employmentTypeBreakdown,
            leaveSummary: {
                byStatus: Object.fromEntries(leaveByStatus),
                byType: Object.fromEntries(leaveByType),
                total: leaveStats.length,
            },
            loanSummary: {
                totalLoans: loanStats.length,
                activeLoans: totalLoansActive,
                paidLoans: totalLoansPaid,
                totalPrincipal,
                totalAmountPaid,
                outstandingBalance: totalPrincipal - totalAmountPaid,
            },
            attendanceSummary: {
                ...Object.fromEntries(attendanceByStatus),
                total: attendanceStats.length,
            },
        });
    } catch (err) {
        console.error('Error generating report:', err);
        res.status(500).json({ message: 'Failed to generate report' });
    }
});

export default router;
