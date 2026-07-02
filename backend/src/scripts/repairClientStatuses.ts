/**
 * One-off repair script: ensure every client's `status` object reflects its
 * `obligations` array. Obligations in the array become 'due' (unless already
 * set to a non-'na' value), and obligations not in the array become 'na'.
 * Also deduplicates the obligations array.
 */

import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';

function normalizeObligationToken(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return normalized;
    if (normalized === 'monthly_rental_income' || normalized === 'monthly rental income' || normalized === 'mri') return 'mri';
    if (normalized === 'turnover_tax' || normalized === 'turnover tax' || normalized === 'tot') return 'tot';
    if (normalized === 'elevy' || normalized === 'e-levy') return 'eLevy';
    if (normalized === 'income_tax_resident_individual' || normalized === 'income tax resident individual' || normalized === 'incometaxresidentindividual') return 'income_tax_resident_individual';
    if (normalized === 'income_tax_non_resident_individual' || normalized === 'income tax non-resident individual' || normalized === 'incometaxnonresidentindividual') return 'income_tax_non_resident_individual';
    if (normalized === 'income_tax_company' || normalized === 'income tax company' || normalized === 'incometaxcompany') return 'income_tax_company';
    if (normalized === 'excise_duty' || normalized === 'excise duty' || normalized === 'exciseduty') return 'excise_duty';
    return normalized;
}

const ALL_OBLIGATIONS = [
    'paye', 'nssf', 'sha', 'vat', 'tot', 'mri', 'dst', 'eLevy',
    'income_tax_resident_individual', 'income_tax_non_resident_individual',
    'income_tax_company', 'excise_duty',
];

async function main() {
    const snapshot = await adminDb.collection('clients').get();
    let updatedCount = 0;
    let skippedCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const rawObligations: string[] = Array.isArray(data.obligations) ? data.obligations : [];
        const normalizedObligations = [...new Set(
            rawObligations.map((s) => normalizeObligationToken(s)).filter(Boolean)
        )];
        const status: Record<string, string> = data.status || {};

        const nextStatus: Record<string, string> = {};
        let changed = false;

        for (const ob of ALL_OBLIGATIONS) {
            const hasOb = normalizedObligations.includes(ob);
            const current = status[ob] ?? 'na';
            const target = hasOb
                ? (current !== 'na' ? current : 'due')
                : 'na';
            nextStatus[ob] = target;
            if (current !== target) {
                changed = true;
            }
        }

        const obligationsChanged = normalizedObligations.length !== rawObligations.length ||
            normalizedObligations.some((ob, idx) => ob !== rawObligations[idx]);

        if (!changed && !obligationsChanged) {
            skippedCount++;
            continue;
        }

        const update: any = {
            status: nextStatus,
            updatedAt: Timestamp.now(),
        };
        if (obligationsChanged) {
            update.obligations = normalizedObligations;
        }

        await doc.ref.update(update);
        updatedCount++;
        console.log(`Updated ${doc.id} (${data.name}): obligations=[${normalizedObligations.join(', ')}], status=${JSON.stringify(nextStatus)}`);
    }

    console.log(`\nDone. Updated ${updatedCount} clients, skipped ${skippedCount}.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
