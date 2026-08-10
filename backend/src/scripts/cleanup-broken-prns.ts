import { adminDb } from '../lib/firebaseAdmin';

async function main() {
    const snap = await adminDb.collection('clients').get();
    let cleanedClients = 0;
    let removedEntries = 0;
    const dryRun = process.env.DRY_RUN !== 'false';

    for (const doc of snap.docs) {
        const data: any = doc.data();
        const results: any[] = Array.isArray(data.payePrnResults) ? data.payePrnResults : null;
        if (!results || results.length === 0) continue;

        const fixed = results.filter((r: any) => {
            const hasUrl = (typeof r.prnGcsPath === 'string' && r.prnGcsPath) || (typeof r.prnPath === 'string' && r.prnPath);
            return hasUrl;
        });

        if (fixed.length === results.length) continue;

        removedEntries += results.length - fixed.length;
        cleanedClients += 1;
        console.log(`[cleanup] client ${doc.id}: ${results.length} -> ${fixed.length} (removed ${results.length - fixed.length} orphaned PRN entry/entries)`);

        if (!dryRun) {
            if (fixed.length === 0) {
                await adminDb.collection('clients').doc(doc.id).update({ payePrnResults: [] });
            } else {
                await adminDb.collection('clients').doc(doc.id).update({ payePrnResults: fixed });
            }
        }
    }

    console.log(`\n[cleanup] ${dryRun ? 'DRY RUN' : 'APPLIED'} — clients affected: ${cleanedClients}, orphaned entries removed: ${removedEntries}`);
    process.exit(0);
}

main().catch((e: any) => { console.error('ERR', e.message); process.exit(1); });