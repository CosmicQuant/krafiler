/**
 * reassignMigrationOwner.ts
 *
 * One-off script to reassign all 'SYSTEM_MIGRATION' ownerUid docs
 * to the real Firebase user UID.
 *
 * Run: npx ts-node --transpile-only src/scripts/reassignMigrationOwner.ts
 */

import { adminDb } from '../lib/firebaseAdmin';
import { logger } from '../logger';

const OLD_UID = 'SYSTEM_MIGRATION';
const NEW_UID = 'l7xzLPqfR1bQcBRVZWVzjv61kqL2';

const COLLECTIONS = [
    'clients',
    'employees',
    'payrollRuns',
    'payrollEntries',
    'loans',
    'loanTransactions',
    'attendanceRecords',
    'overtimeRecords',
    'leaveTypes',
    'leaveRequests',
    'workSchedules',
    'holidays',
    'departments',
    'documents',
    'emailHistory',
    'auditLog',
    'payrollAdjustments',
    'attendancePayrollApprovals',
];

async function reassignCollection(name: string) {
    logger.info(`Reassigning ${name}...`);
    const snapshot = await adminDb.collection(name).where('ownerUid', '==', OLD_UID).get();
    if (snapshot.empty) {
        logger.info(`  No docs with ownerUid='${OLD_UID}' in ${name}`);
        return { reassigned: 0, skipped: 0 };
    }

    const batch = adminDb.batch();
    let count = 0;
    for (const doc of snapshot.docs) {
        batch.update(doc.ref, { ownerUid: NEW_UID });
        count++;
    }
    await batch.commit();
    logger.info(`  Reassigned ${count} docs in ${name}`);
    return { reassigned: count, skipped: 0 };
}

async function main() {
    logger.info(`Reassigning all SYSTEM_MIGRATION docs to ${NEW_UID}...`);
    let totalReassigned = 0;

    for (const name of COLLECTIONS) {
        const result = await reassignCollection(name);
        totalReassigned += result.reassigned;
    }

    logger.info(`Total reassigned: ${totalReassigned}`);
    process.exit(0);
}

main().catch((err) => {
    logger.error({ err }, 'Reassignment failed');
    process.exit(1);
});
