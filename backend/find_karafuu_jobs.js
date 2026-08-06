const { adminDb } = require('./src/lib/firebaseAdmin');

(async () => {
  const snap = await adminDb.collection('jobs')
    .where('clientId', '==', '2')
    .limit(60)
    .get();

  const ts = (v) => (v && v.toDate) ? v.toDate().toISOString() : (v || null);
  const all = snap.docs.map((doc) => {
    const d = doc.data();
    const p = d.payload?.payload || {};
    const pr = d.result?.prnResults || [];
    const artifacts = d.artifacts || {};
    return {
      id: doc.id,
      createdAt: d.createdAt?.toDate?.() ? d.createdAt.toDate().getTime() : (d.createdAt ? new Date(d.createdAt).getTime() : 0),
      d, p, pr, artifacts,
    };
  });
  all.sort((a, b) => b.createdAt - a.createdAt);

  const jobs = all.slice(0, 6).map(({ id, d, p, pr }) => ({
    jobId: id,
    createdAt: ts(d.createdAt),
    completedAt: ts(d.completedAt),
    type: p.taxObligationType,
    printPrnOnly: p.printPrnOnly,
    periodFrom: p.periodFrom,
    periodTo: p.periodTo,
    nitaAmount: p.nitaAmount,
    housingLevyAmount: p.housingLevyAmount,
    status: d.status,
    prnResults: pr.map((r) => ({ taxType: r.taxType, prnGcsPath: r.prnGcsPath, prnPath: r.prnPath, prnNumber: r.prnNumber })),
  }));
  console.log('=== LATEST JOBS ===');
  console.log(JSON.stringify(jobs, null, 2));

  const c = await adminDb.collection('clients').doc('2').get();
  const cd = c.data() || {};
  console.log('=== client.payePrnResults (merged) ===');
  console.log(JSON.stringify(cd.payePrnResults || [], null, 2));
  console.log('payePeriodMonth/Year:', cd.payePeriodMonth, cd.payePeriodYear);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });