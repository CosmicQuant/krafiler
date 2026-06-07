import 'dotenv/config';
import { adminDb } from './src/lib/firebaseAdmin';
import { uploadBuffer } from './src/lib/cloudStorage';
import * as fs from 'fs/promises';
import * as path from 'path';

const LOCAL_PDF_PATH = 'C:\\Users\\ADMIN\\AppData\\Local\\Temp\\nssf-payment-order-1780855922606.pdf';
const CLIENT_ID = '2';
const TEST_USER_ID = 'l7xzLPqfR1bQcBRVZWVzjv61kqL2';

async function main() {
    try {
        const buf = await fs.readFile(LOCAL_PDF_PATH);
        const fileName = path.basename(LOCAL_PDF_PATH);
        const jobId = `local-test-${Date.now()}`;
        const gcsPath = `users/${TEST_USER_ID}/clients/${CLIENT_ID}/receipts/${jobId}/${fileName}`;
        
        console.log(`Uploading ${buf.length} bytes to gs://taxpulse/${gcsPath}`);
        await uploadBuffer(buf, gcsPath, { contentType: 'application/pdf' });
        console.log('Upload successful');

        const nssfReceiptUrl = `/api/clients/${CLIENT_ID}/receipts/nssf`;
        await adminDb.collection('clients').doc(CLIENT_ID).update({
            'lastFiled.nssf': new Date().toISOString(),
            'status.nssf': 'filed',
            nssf: 'filed',
            nssfLastFiledDate: new Date().toISOString(),
            nssfReceiptUrl,
        });
        console.log(`Updated client doc: nssfReceiptUrl=${nssfReceiptUrl}`);
        console.log('\n✅ Retry upload completed successfully!');
    } catch (err: any) {
        console.error('Upload failed:', err.message);
        process.exit(1);
    }
}

main();
