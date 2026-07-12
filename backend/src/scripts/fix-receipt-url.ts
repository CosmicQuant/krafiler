import { adminDb } from './lib/firebaseAdmin';
import { Storage } from '@google-cloud/storage';

async function main() {
    const gcsPath = 'users/l7xzLPqfR1bQcBRVZWVzjv61kqL2/clients/158/receipts/3be3f3e3-cf94-46c1-8448-2b6fb83bceec/2026-07_P052063835W_paye_Receipt.pdf';
    const storage = new Storage();
    const bucket = storage.bucket('taxpulse');
    const file = bucket.file(gcsPath);

    // Make it temporarily public so the frontend can download it.
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/taxpulse/${gcsPath}`;
    console.log('Public URL:', publicUrl);

    // Update the client doc.
    await adminDb.collection('clients').doc('158').update({ payeReceiptUrl: publicUrl });
    console.log('Updated client 158 payeReceiptUrl');

    process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
