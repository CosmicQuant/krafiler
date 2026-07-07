import admin from 'firebase-admin';

const jobId = process.argv[2];
if (!jobId) {
    console.error('Usage: npx ts-node src/scripts/cancel-job.ts <jobId>');
    process.exit(1);
}

admin.initializeApp({ projectId: 'taxpulse-498006' });

async function main() {
    const ref = admin.firestore().collection('jobs').doc(jobId);
    const doc = await ref.get();
    if (!doc.exists) {
        console.error('Job not found:', jobId);
        process.exit(1);
    }
    await ref.update({
        status: 'failed',
        message: 'Cancelled by admin: PRN generation hung due to broken menu navigation',
        error: {
            code: 'FILING_ERROR',
            message: 'Cancelled by admin: PRN generation hung due to broken menu navigation',
            retryable: false,
            failedAt: new Date().toISOString(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('Job cancelled:', jobId);
}

main().catch((err) => {
    console.error('Failed to cancel job:', err);
    process.exit(1);
});
