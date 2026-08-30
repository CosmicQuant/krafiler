/* eslint-disable no-console */
import { adminDb } from './src/lib/firebaseAdmin';

async function main(): Promise<void> {
    const snap = await adminDb.collection('jobs')
        .where('createdAt', '>=', new Date('2026-08-30T11:00:00Z'))
        .orderBy('createdAt', 'desc')
        .limit(15)
        .get();
    if (snap.empty) {
        console.log('No jobs since 11:00 UTC.');
    }
    for (const doc of snap.docs) {
        const j: any = doc.data();
        const created = j.createdAt?.toDate?.().toISOString() ?? '';
        const p = j?.data?.payload?.payload ?? j?.payload?.payload ?? {};
        const mode = p.prepareVatOnly ? 'prepare' : (p.vatZipUrl ? 'upload' : (p.vatCurrentMonthDownload ? 'currentMonth' : 'file'));
        const err = j.status === 'failed' ? String(j.error ?? '').slice(0, 160) : '';
        console.log(`${created} | ${String(p.clientName ?? '?').slice(0, 24).padEnd(24)} | ${mode.padEnd(12)} | ${j.status.padEnd(9)} | ${err}`);
        if (j.status === 'failed' || j.status === 'active') {
            const logsSnap = await doc.ref.collection('logs').orderBy('timestamp', 'asc').get();
            const logs = logsSnap.docs.map((l: any) => l.data());
            for (const l of logs.slice(-6)) {
                console.log(`    ${String(l.message ?? '').slice(0, 180)}`);
            }
        }
    }
    process.exit(0);
}

main().catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
});
