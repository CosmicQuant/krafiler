/* eslint-disable no-console */
import { adminDb } from './src/lib/firebaseAdmin';

async function main(): Promise<void> {
    for (const jobId of ['d8156512-2baf-4e9b-8851-1e115d187574', 'e755355a-68df-44ec-8edd-516237aaa06e', '49076c2c-3286-4358-8f04-db816b1deb22']) {
        const doc = await adminDb.collection('jobs').doc(jobId).get();
        const data: any = doc.data();
        const p = data?.payload?.payload ?? {};
        console.log('════════════════════════════════════════');
        console.log(`Job ${jobId}`);
        console.log(`  status:   ${data?.status}`);
        console.log(`  isNil:    ${p.isNil}`);
        console.log(`  amount:   ${JSON.stringify(p.rentalIncomeAmount)}`);
        console.log(`  client:   ${p.clientName} (${p.clientId})`);
        console.log(`  FULL PAYLOAD KEYS: ${Object.keys(p).join(', ')}`);
        const logsSnap = await adminDb.collection('jobs').doc(jobId).collection('logs')
            .orderBy('createdAt', 'asc').limit(200).get();
        const logs = logsSnap.docs.map((l) => l.data());
        const interesting = logs.filter((l: any) =>
            /rental income|mriRent|totRentalInc|Submitting MRI|MRI return|property|taxOnRent|hidProperty|DWR|fallback|amount/i.test(String(l.message ?? '')));
        for (const l of interesting.slice(0, 25)) {
            console.log(`    [${String(l.message ?? '').slice(0, 300)}]`);
        }
    }
    process.exit(0);
}

main().catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
});
