const { adminDb } = require('./dist/lib/firebaseAdmin');

async function main() {
    const doc = await adminDb.collection('jobs').doc('24ce994e-e4e9-498d-9c53-02a252ed8778').get();
    if (!doc.exists) {
        console.log('Job not found');
        process.exit(0);
    }
    const data = doc.data();
    console.log(JSON.stringify({
        status: data.status,
        progress: data.progress,
        message: data.message,
        cloudTaskName: data.cloudTaskName,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
        startedAt: data.startedAt?.toDate?.()?.toISOString?.() || null,
        completedAt: data.completedAt?.toDate?.()?.toISOString?.() || null,
        error: data.error,
    }, null, 2));
    
    // Also get logs
    const logsSnap = await adminDb.collection('jobs').doc('24ce994e-e4e9-498d-9c53-02a252ed8778').collection('logs').orderBy('createdAt', 'asc').get();
    console.log('\nLogs:');
    logsSnap.docs.forEach(d => {
        const l = d.data();
        console.log(`[${l.createdAt?.toDate?.()?.toISOString?.() || '?'}] ${l.level || 'info'}: ${l.message} (${l.progress ?? 'no progress'})`);
    });
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
