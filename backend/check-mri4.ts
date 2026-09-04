/* eslint-disable no-console */
import { adminDb } from './src/lib/firebaseAdmin';
import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';

const storage = new Storage();
const BUCKET = process.env.CLOUD_STORAGE_BUCKET || 'taxpulse';

async function main(): Promise<void> {
    const jobId = '8de654db-944d-44fd-9530-27c4b3b081b7';
    const doc = await adminDb.collection('jobs').doc(jobId).get();
    const data: any = doc.data();
    console.log('artifacts:', JSON.stringify(data?.artifacts ?? null));
    console.log('result:', JSON.stringify(data?.result ?? null).slice(0, 500));

    // 1. Download receipt if it exists
    const gcsPath = data?.artifacts?.receiptGcsPath;
    if (gcsPath) {
        const localReceipt = `tmp-mri-receipt.pdf`;
        try {
            await storage.bucket(BUCKET).file(gcsPath).download({ destination: localReceipt });
            console.log(`Receipt downloaded to ${localReceipt} (${fs.statSync(localReceipt).size} bytes)`);
        } catch (e: any) {
            console.log('Receipt download failed:', e.message);
        }
    }

    // 2. List captures for this job
    const [files] = await storage.bucket(BUCKET).getFiles({ prefix: `captures/${jobId}/` });
    console.log(`\nCapture files (${files.length}):`);
    for (const f of files) console.log('  ', f.name, f.metadata.size);

    // 3. Save manifest + any DWR-looking captures locally
    for (const f of files) {
        const name = f.name.split('/').pop() || '';
        if (name === 'manifest.json' || /dwr|mri|fetch/i.test(name)) {
            try {
                await f.download({ destination: `tmp-cap-${name}` });
                console.log(`  saved tmp-cap-${name}`);
            } catch (e: any) { console.log(`  dl fail ${name}: ${e.message}`); }
        }
    }
    process.exit(0);
}

main().catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
});
