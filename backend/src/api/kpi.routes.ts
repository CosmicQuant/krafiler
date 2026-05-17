import { Router } from 'express';
import { db } from '../db/kysely';

const router = Router();

router.get('/:clientId/kpi', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });
        const employeeCount = await db.selectFrom('employees').select(db.fn.countAll<number>().as('cnt')).where('clientId', '=', clientId).executeTakeFirst();
        const activeEmployees = await db.selectFrom('employees').select(db.fn.countAll<number>().as('cnt')).where('clientId', '=', clientId).where('employmentStatus', '=', 'Active').executeTakeFirst();
        const deptCount = await db.selectFrom('departments').select(db.fn.countAll<number>().as('cnt')).where('clientId', '=', clientId).executeTakeFirst();
        const loanTotal = await db.selectFrom('loans').select(db.fn.sum<number>('monthlyDeduction').as('total')).where('clientId', '=', clientId).executeTakeFirst();
        const pendingLeave = await db.selectFrom('leave_requests').select(db.fn.countAll<number>().as('cnt')).where('clientId', '=', clientId).where('status', '=', 'Pending').executeTakeFirst();
        const approvedLeave = await db.selectFrom('leave_requests').select(db.fn.countAll<number>().as('cnt')).where('clientId', '=', clientId).where('status', '=', 'Approved').executeTakeFirst();
        const runCount = await db.selectFrom('payroll_runs').select(db.fn.countAll<number>().as('cnt')).where('clientId', '=', clientId).executeTakeFirst();
        const latestRun = await db.selectFrom('payroll_runs').selectAll().where('clientId', '=', clientId).orderBy('createdAt', 'desc').limit(1).executeTakeFirst();
        const totalPayroll = await db.selectFrom('payroll_runs').select(db.fn.sum<number>('totalGross').as('total')).where('clientId', '=', clientId).executeTakeFirst();
        const recentRuns = await db.selectFrom('payroll_runs').select(['period', 'totalGross', 'totalNet', 'totalEmployees']).where('clientId', '=', clientId).where('status', '=', 'completed').orderBy('period', 'asc').limit(12).execute();
        const docCount = await db.selectFrom('documents').select(db.fn.countAll<number>().as('cnt')).where('clientId', '=', clientId).executeTakeFirst();
        res.json({
            employeeCount: Number(employeeCount?.cnt || 0),
            activeEmployees: Number(activeEmployees?.cnt || 0),
            departmentCount: Number(deptCount?.cnt || 0),
            totalMonthlyLoanDeductions: Number(loanTotal?.total || 0),
            pendingLeaveRequests: Number(pendingLeave?.cnt || 0),
            approvedLeaveThisMonth: Number(approvedLeave?.cnt || 0),
            payrollRunCount: Number(runCount?.cnt || 0),
            latestRunPeriod: latestRun?.period || null,
            totalPayrollGross: Number(totalPayroll?.total || 0),
            documentCount: Number(docCount?.cnt || 0),
            recentRunData: recentRuns,
        });
    } catch (err) {
        console.error('Error fetching KPI data:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
