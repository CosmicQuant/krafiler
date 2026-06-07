/**
 * file-nssf-return.ts
 *
 * Production-grade NSSF (National Social Security Fund) SF24 filing automation.
 *
 * State machine:  scan table → create period if missing → upload → Check Submission
 * → Progress Update → Submission → Payment Order → Receipt capture.
 *
 * Uses full-page DOM scan, captureResponse, and standard Playwright page.pdf() with
 * print media emulation to avoid the double-rasterization that CDP printToPDF gives
 * when Chrome's PDF viewer is open.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import 'dotenv/config';

import { adminDb } from '../lib/firebaseAdmin';
import { uploadBuffer, receiptPath as gcsReceiptPath } from '../lib/cloudStorage';
import { fileNssfReturn as originalFileNssfReturn } from './file-nssf-return';

const NSSF_USERNAME = '21888523';
const NSSF_PASSWORD = '21888523';
const SUBMISSION_PERIOD = '05/2026';
const TEST_USER_ID = process.env.TEST_USER_ID || 'l7xzLPqfR1bQcBRVZWVzjv61kqL2';

async function discoverNssfFileUrl(): Promise<{ clientId: string; clientName: string; nssfFileUrl: string }> {
    console.log('Querying Firestore for client with NSSF number:', NSSF_USERNAME);
    const clientsCol = adminDb.collection('clients');
    const snap = await clientsCol.where('nssfNo', '==', NSSF_USERNAME).limit(1).get();
    let clientDoc = snap.empty ? null : snap.docs[0];
    if (!clientDoc) {
        const snap2 = await clientsCol.where('nssfLogin', '==', NSSF_USERNAME).limit(1).get();
        clientDoc = snap2.empty ? null : snap2.docs[0];
    }
    if (!clientDoc) {
        throw new Error(`No client found with nssfNo or nssfLogin = ${NSSF_USERNAME}`);
    }
    const clientData = clientDoc.data();
    const clientName = clientData.name || clientData.displayName || clientDoc.id;
    console.log(`Found client: ${clientName} (id=${clientDoc.id})`);
    const nssfFileUrl = clientData.generatedFiles?.nssfFileUrl;
    if (!nssfFileUrl) {
        throw new Error(
            `Client ${clientName} has no generatedFiles.nssfFileUrl. ` +
            'Generate compliance files from the Compliance Tab first.'
        );
    }
    console.log(`Found NSSF file URL: ${nssfFileUrl.substring(0, 120)}...`);
    return { clientId: clientDoc.id, clientName, nssfFileUrl };
}

async function uploadAndPersistReceipt(clientId: string, localPdfPath: string): Promise<string> {
    console.log('\nUploading receipt to Cloud Storage and updating Firestore...');
    const buf = await fs.readFile(localPdfPath);
    const fileName = path.basename(localPdfPath);
    const jobId = `local-test-${Date.now()}`;
    const gcsPath = gcsReceiptPath(TEST_USER_ID, clientId, jobId, fileName);
    await uploadBuffer(buf, gcsPath, { contentType: 'application/pdf' });
    console.log(`  Uploaded to gs://taxpulse/${gcsPath} (${buf.length} bytes)`);

    const nssfReceiptUrl = `/api/clients/${clientId}/receipts/nssf`;
    await adminDb.collection('clients').doc(clientId).update({
        'lastFiled.nssf': new Date().toISOString(),
        'status.nssf': 'filed',
        nssf: 'filed',
        nssfLastFiledDate: new Date().toISOString(),
        nssfReceiptUrl,
    });
    console.log(`  Updated client doc: nssfReceiptUrl=${nssfReceiptUrl}`);

    await fs.unlink(localPdfPath).catch(() => {});
    return nssfReceiptUrl;
}

async function main() {
    process.env.PLAYWRIGHT_HEADLESS = 'false';
    console.log('\n========== NSSF Filing Test ==========');
    console.log(`Period   : ${SUBMISSION_PERIOD}`);
    console.log(`Username : ${NSSF_USERNAME}`);
    console.log('======================================\n');

    try {
        const { clientId, clientName, nssfFileUrl } = await discoverNssfFileUrl();
        const result = await originalFileNssfReturn(null, NSSF_USERNAME, NSSF_PASSWORD, nssfFileUrl, SUBMISSION_PERIOD);

        if (result.paymentOrderPath) {
            await uploadAndPersistReceipt(clientId, result.paymentOrderPath);
            console.log(`\n✅ NSSF filing completed for ${clientName}!`);
            console.log(`   Receipt is now in Cloud Storage and the UI Download Receipt button should appear.`);
        } else {
            console.log('\n⚠️  NSSF filing finished but no payment order PDF was captured.');
        }
    } catch (err: any) {
        console.error('\n❌ NSSF filing failed:', err.message);
        console.error(err.stack || '');
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
