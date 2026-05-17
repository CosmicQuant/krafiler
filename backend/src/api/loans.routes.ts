import { Router } from 'express';
import { db } from '../db/kysely';

const router = Router();

// GET /api/clients/:clientId/loans
router.get('/:clientId/loans', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const records = await db
            .selectFrom('loans')
            .selectAll()
            .where('clientId', '=', clientId)
            .orderBy('createdAt', 'desc')
            .execute();

        res.json(records);
    } catch (err) {
        console.error('Error fetching loans:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:clientId/loans
router.post('/:clientId/loans', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const { employeeId, employeeName, kraPin, loanType, principal, monthlyDeduction, installments, remainingInstallments, interestRate, totalInterest, totalRepayable, amountPaid, status, disbursedAt, notes } = req.body;

        const now = new Date().toISOString();
        const result = await db
            .insertInto('loans')
            .values({
                clientId,
                employeeId: employeeId || 0,
                employeeName: employeeName || '',
                kraPin: kraPin || '',
                loanType: loanType || 'Salary Advance',
                principal: principal || 0,
                monthlyDeduction: monthlyDeduction || 0,
                installments: installments || 1,
                remainingInstallments: remainingInstallments || 1,
                interestRate: interestRate || 0,
                totalInterest: totalInterest || 0,
                totalRepayable: totalRepayable || 0,
                amountPaid: amountPaid || 0,
                status: status || 'Approved',
                disbursedAt: disbursedAt || null,
                notes: notes || '',
                createdAt: now,
                updatedAt: now,
            })
            .executeTakeFirst();

        const id = Number(result.insertId || 0);
        const record = await db
            .selectFrom('loans')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        res.status(201).json(record);
    } catch (err) {
        console.error('Error creating loan:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:clientId/loans/:id
router.put('/:clientId/loans/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        const existing = await db
            .selectFrom('loans')
            .selectAll()
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .executeTakeFirst();

        if (!existing) return res.status(404).json({ message: 'Loan not found' });

        const { employeeId, employeeName, kraPin, loanType, principal, monthlyDeduction, installments, remainingInstallments, interestRate, totalInterest, totalRepayable, amountPaid, status, disbursedAt, notes } = req.body;

        await db
            .updateTable('loans')
            .set({
                employeeId: employeeId !== undefined ? employeeId : existing.employeeId,
                employeeName: employeeName !== undefined ? employeeName : existing.employeeName,
                kraPin: kraPin !== undefined ? kraPin : existing.kraPin,
                loanType: loanType !== undefined ? loanType : existing.loanType,
                principal: principal !== undefined ? principal : existing.principal,
                monthlyDeduction: monthlyDeduction !== undefined ? monthlyDeduction : existing.monthlyDeduction,
                installments: installments !== undefined ? installments : existing.installments,
                remainingInstallments: remainingInstallments !== undefined ? remainingInstallments : existing.remainingInstallments,
                interestRate: interestRate !== undefined ? interestRate : existing.interestRate,
                totalInterest: totalInterest !== undefined ? totalInterest : existing.totalInterest,
                totalRepayable: totalRepayable !== undefined ? totalRepayable : existing.totalRepayable,
                amountPaid: amountPaid !== undefined ? amountPaid : existing.amountPaid,
                status: status !== undefined ? status : existing.status,
                disbursedAt: disbursedAt !== undefined ? disbursedAt : existing.disbursedAt,
                notes: notes !== undefined ? notes : existing.notes,
                updatedAt: new Date().toISOString(),
            })
            .where('id', '=', id)
            .execute();

        const updated = await db
            .selectFrom('loans')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        res.json(updated);
    } catch (err) {
        console.error('Error updating loan:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/clients/:clientId/loans/:id
router.delete('/:clientId/loans/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });

        await db
            .deleteFrom('loans')
            .where('id', '=', id)
            .where('clientId', '=', clientId)
            .execute();

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting loan:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
