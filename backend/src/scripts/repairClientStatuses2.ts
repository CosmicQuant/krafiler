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

const STATUS_TO_OBLIGATION: Record<string, string> = {
    paye: 'paye',
    nssf: 'nssf',
    sha: 'sha',
    vat: 'vat',
    tot: 'tot',
    mri: 'mri',
    dst: 'dst',
    eLevy: 'eLevy',
    incomeTaxResidentIndividual: 'income_tax_resident_individual',
    incomeTaxNonResidentIndividual: 'income_tax_non_resident_individual',
    incomeTaxCompany: 'income_tax_company',
    exciseDuty: 'excise_duty',
};

async function main() {
    const snapshot = await adminDb.collection('clients').get();
    let updatedCount = 0;
    let skippedCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const rawObligations: string[] = Array.isArray(data.obligations) ? data.obligations : [];
        const normalizedObligations = new Set(
            rawObligations.map((s) => normalizeObligationToken(s)).filter(Boolean)
        );

        // Add obligations implied by non-'na' top-level status fields
        for (const [field, ob] of Object.entries(STATUS_TO_OBLIGATION)) {
            const value = data[field];
            if (value && value !== 'na') {
                normalizedObligations.add(ob);
            }
        }

        // Add obligations implied by non-'na' nested status fields
        const status: Record<string, string> = data.status || {};
        for (const ob of ALL_OBLIGATIONS) {
            if (status[ob] && status[ob] !== 'na') {
                normalizedObligations.add(ob);
            }
        }

        const finalObligations = [...normalizedObligations].filter((ob) => ALL_OBLIGATIONS.includes(ob));
        const nextStatus: Record<string, string> = {};
        let changed = false;

        for (const ob of ALL_OBLIGATIONS) {
            const hasOb = finalObligations.includes(ob);
            // Prefer the top-level field (e.g. client.vat) because it is written by the worker
            // and is authoritative when the nested status object has been corrupted.
            const topLevelKey = ob === 'income_tax_resident_individual' ? 'incomeTaxResidentIndividual' :
                ob === 'income_tax_non_resident_individual' ? 'incomeTaxNonResidentIndividual' :
                ob === 'income_tax_company' ? 'incomeTaxCompany' :
                ob === 'excise_duty' ? 'exciseDuty' : ob;
            const topLevelValue = data[topLevelKey];
            const nestedValue = status[ob];
            const current = (topLevelValue && topLevelValue !== 'na')
                ? topLevelValue
                : (nestedValue && nestedValue !== 'na')
                    ? nestedValue
                    : 'na';
            const target = hasOb
                ? (current !== 'na' ? current : 'due')
                : 'na';
            nextStatus[ob] = target;
            if ((status[ob] ?? 'na') !== target) {
                changed = true;
            }
        }

        const obligationsChanged = finalObligations.length !== rawObligations.length ||
            finalObligations.some((ob, idx) => ob !== rawObligations[idx]);

        if (!changed && !obligationsChanged) {
            skippedCount++;
            continue;
        }

        const update: any = {
            status: nextStatus,
            updatedAt: Timestamp.now(),
        };
        if (obligationsChanged) {
            update.obligations = finalObligations;
        }

        await doc.ref.update(update);
        updatedCount++;
        console.log(`Updated ${doc.id} (${data.name}): obligations=[${finalObligations.join(', ')}], status=${JSON.stringify(nextStatus)}`);
    }

    console.log(`\nDone. Updated ${updatedCount} clients, skipped ${skippedCount}.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
