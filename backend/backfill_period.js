const { adminDb } = require('./src/lib/firebaseAdmin');

(async () => {
  const ref = adminDb.collection('clients').doc('2');
  const snap = await ref.get();
  const before = { payePeriodMonth: snap.data()?.payePeriodMonth, payePeriodYear: snap.data()?.payePeriodYear, payePeriod: snap.data()?.payePeriod, lastFiled: snap.data()?.lastFiled?.paye };
  console.log('BEFORE:', JSON.stringify(before));

  await ref.update({
    payePeriodMonth: 8,
    payePeriodYear: 2026,
    payePeriod: '2026-08',
  });

  const after = await ref.get();
  console.log('AFTER:', JSON.stringify({
    payePeriodMonth: after.data()?.payePeriodMonth,
    payePeriodYear: after.data()?.payePeriodYear,
    payePeriod: after.data()?.payePeriod,
  }));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });