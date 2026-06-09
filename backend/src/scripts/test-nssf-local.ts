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
import 'dotenv/config';

import { adminDb } from '../lib/firebaseAdmin';
import { uploadBuffer, receiptPath as gcsReceiptPath } from '../lib/cloudStorage';
import { fileNssfReturn as originalFileNssfReturn } from './file-nssf-return';

const NSSF_USERNAME = '22918019';
const NSSF_PASSWORD = '22918019';
const SUBMISSION_PERIOD = '05/2026';
const LOCAL_NSSF_FILE = 'C:\\Users\\ADMIN\\Downloads\\SF2420260522918019_updated.xls';
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

function classifyError(err: any): { type: string; message: string; userMessage: string } {
    const msg = err?.message || String(err);
    if (msg.includes('Timeout') || msg.includes('timeout')) {
        if (msg.includes('502') || msg.includes('504') || msg.includes('Gateway')) {
            return {
                type: 'SITE_DOWN',
                message: msg,
                userMessage: 'NSSF portal is currently unavailable (502/504 Gateway Error). Please try again later.'
            };
        }
        return {
            type: 'TIMEOUT',
            message: msg,
            userMessage: 'NSSF portal is taking too long to respond. The site may be slow or temporarily down. Please try again.'
        };
    }
    if (msg.includes('502') || msg.includes('504') || msg.includes('Bad Gateway') || msg.includes('Gateway Timeout')) {
        return {
            type: 'SITE_DOWN',
            message: msg,
            userMessage: 'NSSF portal is currently unavailable (502/504 Gateway Error). Please try again later.'
        };
    }
    if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET')) {
        return {
            type: 'NETWORK_ERROR',
            message: msg,
            userMessage: 'Cannot connect to NSSF portal. Please check your internet connection and try again.'
        };
    }
    if (msg.includes('404')) {
        return {
            type: 'NOT_FOUND',
            message: msg,
            userMessage: 'NSSF portal page not found. The site may be undergoing maintenance.'
        };
    }
    return {
        type: 'UNKNOWN',
        message: msg,
        userMessage: 'An unexpected error occurred during NSSF filing. Please try again or contact support.'
    };
}

async function reportErrorToFirestore(jobId: string, error: any, clientId?: string) {
    const classified = classifyError(error);
    const errorData = {
        status: 'failed',
        error: classified.type,
        errorMessage: classified.message,
        userMessage: classified.userMessage,
        updatedAt: new Date().toISOString(),
    };
    try {
        await adminDb.collection('jobs').doc(jobId).update(errorData);
        console.log(`  Reported error to Firestore job ${jobId}: ${classified.type}`);
    } catch (e) {
        console.log('  Failed to report error to Firestore:', e);
    }
    if (clientId) {
        try {
            await adminDb.collection('clients').doc(clientId).update({
                nssfStatus: 'failed',
                nssfError: classified.userMessage,
                nssfErrorType: classified.type,
                nssfLastErrorAt: new Date().toISOString(),
            });
            console.log(`  Reported error to client ${clientId}`);
        } catch (e) {
            console.log('  Failed to report error to client doc:', e);
        }
    }
}

async function main() {
    process.env.PLAYWRIGHT_HEADLESS = 'false';
    console.log('\n========== NSSF Filing Test ==========');
    console.log(`Period   : ${SUBMISSION_PERIOD}`);
    console.log(`Username : ${NSSF_USERNAME}`);
    console.log('======================================\n');

    const jobId = `local-test-${Date.now()}`;
    let clientId: string | undefined;

    try {
        console.log('Using local NSSF file:', LOCAL_NSSF_FILE);
        const result = await originalFileNssfReturn(null, NSSF_USERNAME, NSSF_PASSWORD, LOCAL_NSSF_FILE, SUBMISSION_PERIOD);

        if (result.paymentOrderPath) {
            console.log('\n✅ NSSF filing completed!');
            console.log(`   Receipt saved to: ${result.paymentOrderPath}`);
        } else {
            console.log('\n⚠️  NSSF filing finished but no payment order PDF was captured.');
        }
    } catch (err: any) {
        const classified = classifyError(err);
        console.error('\n❌ NSSF filing failed:', classified.type);
        console.error('   User message:', classified.userMessage);
        console.error('   Technical details:', classified.message);
        console.error(err.stack || '');

        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
