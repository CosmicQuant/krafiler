/* eslint-disable no-console */
import { adminDb } from './src/lib/firebaseAdmin';

async function main(): Promise<void> {
    // Print ALL logs for the Richard Ouyo job — no filter
    const jobId = 'd8156512-2baf-4e9b-8851-1e115d187574';
    const logsSnap = await adminDb.collection('jobs').doc(jobId).collection('logs')
        .orderBy('createdAt', 'asc').limit(200).get();
    const logs = logsSnap.docs.map((l) => l.data());
    console.log(`Total logs: ${logs.length}`);
    for (const l of logs) {
        console.log(`  [${String(l.progress ?? '')}] ${String(l.message ?? '').slice(0, 220)}`);
    }
    // Also check the client doc for stored amounts
    const clientDoc = await adminDb.collection('clients').doc('7').get();
    const cd: any = clientDoc.data();
    console.log('════ Client 7 ════');
    console.log('  name:', cd?.name);
    console.log('  mri status:', cd?.mri, cd?.status?.monthly_rental_income);
    console.log('  amounts:', JSON.stringify(cd?.amounts ?? null));
    console.log('  mriPeriod:', cd?.mriPeriod, 'mriPeriodMonth:', cd?.mriPeriodMonth, 'mriPeriodYear:', cd?.mriPeriodYear);
    console.log('  filedPeriods:', JSON.stringify(cd?.filedPeriods ?? null));
    process.exit(0);
}

main().catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
});
