import 'dotenv/config';
import { adminDb } from './src/lib/firebaseAdmin';

async function checkJobStatus() {
    const jobId = 'b99fb53a-39df-4f05-8c33-12037aa98471';
    try {
        const doc = await adminDb.collection('jobs').doc(jobId).get();
        if (!doc.exists) {
            console.log('Job not found in jobs collection');
            return;
        }
        const data = doc.data();
        console.log('Job Status:', data?.status);
        console.log('Job Step:', data?.step);
        console.log('Job Progress:', data?.progress);
        console.log('Job Error:', data?.error);
        console.log('Job Message:', data?.message);
        console.log('Job Logs:', data?.stepLogs?.slice(-5));
    } catch (err) {
        console.error('Error:', err);
    }
}

checkJobStatus();
