import { adminDb } from '../lib/firebaseAdmin';

async function main() {
  const clientId = '95';
  const jobsSnap = await adminDb.collection('jobs').where('clientId', '==', clientId).get();
  const vatJobs = jobsSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as any }))
    .filter((j) => j.data.payload?.payload?.taxObligationType === 'vat')
    .sort((a, b) => (a.data.createdAt?._seconds || 0) - (b.data.createdAt?._seconds || 0));

  for (const j of vatJobs) {
    const p = j.data.payload?.payload || {};
    let type = 'prepare/file';
    if (p.isNil) type = 'nil';
    else if (p.vatCurrentMonthDownload) type = 'current-month';
    else if (p.vatZipUrl) type = 'vat-upload';
    else if (p.payeZipUrl) type = 'paye-upload';
    console.log(`${j.id} | ${j.data.status} | ${p.periodFrom} to ${p.periodTo} | ${type} | msg: ${j.data.message}`);
    if (j.data.result) {
      console.log('  result.receiptPath:', j.data.result.receiptPath ? 'yes' : 'no');
      console.log('  result.generatedZipUrl:', j.data.result.generatedZipUrl ? 'yes' : 'no');
      console.log('  result.prnPath:', j.data.result.prnPath ? 'yes' : 'no');
    }
    if (j.data.error) {
      console.log('  error:', j.data.error.message);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
