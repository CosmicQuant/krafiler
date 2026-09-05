/**
 * payrollLevyAmounts.ts
 *
 * Computes statutory payroll levy amounts directly from a client's payroll
 * run for a period. This is the authoritative source for PRN generation —
 * client-doc `amounts` and frontend payload values can be stale (e.g. stored
 * before the full-statutory AHL change).
 */

import { adminDb } from '../lib/firebaseAdmin';

function periodKeyFromIso(periodFrom: string): string | undefined {
    const d = new Date(periodFrom);
    if (Number.isNaN(d.getTime())) return undefined;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Full statutory Affordable Housing Levy remittance for the client's payroll
 * period: 3% of gross pay (1.5% employee deduction + 1.5% employer), i.e. the
 * sum of the run's per-employee `ahlDeduction` values doubled — matching the
 * totalHousingContribution declared in the P10 XML.
 *
 * Returns undefined when the client has no payroll run (with entries) for the
 * period, so callers can fall back to stored amounts.
 */
export async function computeFullHousingLevyForPeriod(
    clientId: string | undefined,
    periodFrom: string | undefined
): Promise<number | undefined> {
    if (!clientId || !periodFrom) return undefined;
    const period = periodKeyFromIso(periodFrom);
    if (!period) return undefined;

    // Single-field query (automatic index); filter period in memory to avoid
    // requiring a composite index on (clientId, period).
    const runsSnap = await adminDb.collection('payrollRuns')
        .where('clientId', '==', clientId)
        .get();
    if (runsSnap.empty) return undefined;

    const runsForPeriod = runsSnap.docs
        .filter((doc) => (doc.data() as any)?.period === period)
        .sort((a, b) => {
            const ca = (a.data() as any)?.createdAt?.toMillis?.() ?? 0;
            const cb = (b.data() as any)?.createdAt?.toMillis?.() ?? 0;
            return cb - ca;
        });

    for (const run of runsForPeriod) {
        const entriesSnap = await adminDb.collection('payrollEntries')
            .where('payrollRunId', '==', run.id)
            .get();
        if (entriesSnap.empty) continue;

        const totalEmployeeAhl = entriesSnap.docs.reduce(
            (sum, doc) => sum + (Number((doc.data() as any).ahlDeduction) || 0),
            0
        );
        if (totalEmployeeAhl > 0) {
            return Math.round(totalEmployeeAhl * 2 * 100) / 100;
        }
    }

    return undefined;
}

/**
 * NITA levy for the client's payroll period: KES 50 per employee per month,
 * matching the P10 XML declaration (employees.length * 50).
 */
export async function computeNitaLevyForPeriod(
    clientId: string | undefined,
    periodFrom: string | undefined
): Promise<number | undefined> {
    if (!clientId || !periodFrom) return undefined;
    const period = periodKeyFromIso(periodFrom);
    if (!period) return undefined;

    const runsSnap = await adminDb.collection('payrollRuns')
        .where('clientId', '==', clientId)
        .get();
    if (runsSnap.empty) return undefined;

    const runsForPeriod = runsSnap.docs
        .filter((doc) => (doc.data() as any)?.period === period)
        .sort((a, b) => {
            const ca = (a.data() as any)?.createdAt?.toMillis?.() ?? 0;
            const cb = (b.data() as any)?.createdAt?.toMillis?.() ?? 0;
            return cb - ca;
        });

    for (const run of runsForPeriod) {
        const entriesSnap = await adminDb.collection('payrollEntries')
            .where('payrollRunId', '==', run.id)
            .get();
        if (entriesSnap.empty) continue;
        if (entriesSnap.size > 0) {
            return entriesSnap.size * 50;
        }
    }

    return undefined;
}
