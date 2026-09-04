/* eslint-disable no-console */
import { adminDb } from './src/lib/firebaseAdmin';

async function main(): Promise<void> {
    // Recent MRI jobs (any state)
    const snap = await adminDb.collection('jobs')
        .orderBy('createdAt', 'desc')
        .limit(1500)
        .get();

    const mriJobs = snap.docs
        .map((d) => ({ id: d.id, data: d.data() as any }))
        .filter((j) => {
            const t = j.data?.payload?.payload?.taxObligationType || j.data?.payload?.taxObligationType;
            return t === 'monthly_rental_income' && j.data?.payload?.payload?.isNil !== true;
        })
        .slice(0, 6);

    if (mriJobs.length === 0) {
        console.log('No MRI jobs found in the last 400 jobs.');
    }

    for (const j of mriJobs) {
        const p = j.data?.payload?.payload ?? j.data?.payload ?? {};
        const created = j.data?.createdAt?.toDate?.().toISOString?.() ?? String(j.data?.createdAt ?? '');
        console.log('════════════════════════════════════════');
        console.log(`Job ${j.id}`);
        console.log(`  created:  ${created}`);
        console.log(`  status:   ${j.data?.status}`);
        console.log(`  isNil:    ${p.isNil}`);
        console.log(`  amount:   ${JSON.stringify(p.rentalIncomeAmount)}`);
        console.log(`  period:   ${p.periodFrom} → ${p.periodTo}`);
        console.log(`  client:   ${p.clientName} (${p.clientId})`);
        const err = j.data?.status === 'failed' ? String(j.data?.error ?? j.data?.errorMessage ?? '').slice(0, 200) : '';
        if (err) console.log(`  error:    ${err}`);

        const logsSnap = await adminDb.collection('jobs').doc(j.id).collection('logs')
            .orderBy('createdAt', 'asc').limit(200).get();
        const logs = logsSnap.docs.map((l) => l.data());
        // Show logs around the MRI submit + any that mention amount/rent
        const interesting = logs.filter((l: any) =>
            /rental income|mriRent|totRentalInc|amount|Submitting MRI|MRI return|property|taxOnRent|hidProperty|DWR/i.test(String(l.message ?? '')));
        for (const l of interesting.slice(0, 25)) {
            console.log(`    [${String(l.message ?? '').slice(0, 260)}]`);
        }
    }
    process.exit(0);
}

main().catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
});
