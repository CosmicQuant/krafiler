import { Router } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { AuthenticatedRequest } from '../middleware/verifyAuth';

const router = Router();

router.get('/:clientId/kpi', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;

        // Count employees
        const employeesSnapshot = await adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();
        const employeeCount = employeesSnapshot.size;
        const activeEmployees = employeesSnapshot.docs.filter((d: any) => (d.data() as any).employmentStatus === 'Active').length;

        // Count departments
        const deptsSnapshot = await adminDb
            .collection('departments')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();
        const departmentCount = deptsSnapshot.size;

        // Sum loan monthly deductions
        const loansSnapshot = await adminDb
            .collection('loans')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();
        let totalMonthlyLoanDeductions = 0;
        for (const d of loansSnapshot.docs) {
            totalMonthlyLoanDeductions += (d.data() as any).monthlyDeduction || 0;
        }

        // Leave counts
        const leaveSnapshot = await adminDb
            .collection('leaveRequests')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();
        const pendingLeaveRequests = leaveSnapshot.docs.filter((d: any) => (d.data() as any).status === 'Pending').length;
        const approvedLeaveThisMonth = leaveSnapshot.docs.filter((d: any) => (d.data() as any).status === 'Approved').length;

        // Payroll runs
        const runsSnapshot = await adminDb
            .collection('payrollRuns')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();
        const payrollRunCount = runsSnapshot.size;
        const latestRunDoc = runsSnapshot.docs
            .sort((a: any, b: any) => ((b.data() as any).createdAt?.toMillis?.() || 0) - ((a.data() as any).createdAt?.toMillis?.() || 0))[0];
        const latestRunPeriod = latestRunDoc ? (latestRunDoc.data() as any).period || null : null;

        let totalPayrollGross = 0;
        const recentRunData: any[] = [];
        for (const d of runsSnapshot.docs) {
            const r = d.data() as any;
            totalPayrollGross += r.totalGross || 0;
            if (r.status === 'completed') {
                recentRunData.push({ period: r.period, totalGross: r.totalGross, totalNet: r.totalNet, totalEmployees: r.totalEmployees });
            }
        }
        recentRunData.sort((a, b) => (a.period || '').localeCompare(b.period || ''));
        const slicedRecentRuns = recentRunData.slice(-12);

        // Documents count
        const docsSnapshot = await adminDb
            .collection('documents')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();
        const documentCount = docsSnapshot.size;

        res.json({
            employeeCount,
            activeEmployees,
            departmentCount,
            totalMonthlyLoanDeductions,
            pendingLeaveRequests,
            approvedLeaveThisMonth,
            payrollRunCount,
            latestRunPeriod,
            totalPayrollGross,
            documentCount,
            recentRunData: slicedRecentRuns,
        });
    } catch (err) {
        console.error('Error fetching KPI data from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
