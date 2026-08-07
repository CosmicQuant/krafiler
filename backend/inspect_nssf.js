const { adminDb } = require('./src/lib/firebaseAdmin');

(async () => {
  const ts = (v) => (v && v.toDate) ? v.toDate().toISOString() : (v || null);
  // fetch the specific Aug job the user mentioned + any nssf jobs in that time window
  const target = 'e3cfd814-510a-4c24-a3c7-a5cdf58f7a0b';
  const t = await adminDb.collection('jobs').doc(target).get();
  console.log('=== target Aug NSSF job', target, 'exists?', t.exists, '===');
  if (t.exists) {
    const d = t.data();
    console.log(JSON.stringify({
      id: target,
      status: d.status,
      createdAt: ts(d.createdAt),
      completedAt: ts(d.completedAt),
      type: d.payload?.payload?.taxObligationType,
      nssfPeriod: d.payload?.payload?.nssfPeriod,
      periodFrom: d.payload?.payload?.periodFrom,
      result: d.result,
      artifacts: d.artifacts,
    }, null, 2));
  }

  // scan all nssf jobs for the client by date window (Aug) via collectionGroup-free approach: get all then filter
  const all = await adminDb.collection('jobs').where('clientId', '==', '2').get();
  const ns = all.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter(({ data }) => (data.payload?.payload?.taxObligationType) === 'nssf')
    .map(({ id, data }) => ({
      id,
      createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().getTime() : 0,
      completedAt: ts(data.completedAt),
      status: data.status,
      nssfPeriod: data.payload?.payload?.nssfPeriod,
      periodFrom: data.payload?.payload?.periodFrom,
      receiptGcsPath: data.artifacts?.receiptGcsPath || data.artifacts?.nssfReceiptGcsPath,
      resultReceipt: data.result?.receiptPath,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 12);
  console.log('=== recent NSSF jobs (newest first) ===');
  console.log(JSON.stringify(ns, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });