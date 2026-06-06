const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({ projectId: 'taxpulse-498006' });
const db = getFirestore();

const clientId = '158';
const receiptGcsPath = 'users/l7xzLPqfR1bQcBRVZWVzjv61kqL2/clients/158/receipts/f68eebac-1d45-477c-a1cd-e078a67bd413/2026-06_P052063835W_paye_Receipt.pdf';
const receiptUrl = '/api/receipts/' + receiptGcsPath;

db.collection('clients').doc(clientId).update({
  paye: 'filed',
  payeReceiptUrl: receiptUrl,
  payeLastFiledDate: '2026-06-06T08:03:31.000Z',
  payePeriod: '2026-05',
}).then(() => {
  console.log('Client document updated successfully');
  process.exit(0);
}).catch((err: any) => {
  console.error('Failed to update client:', err);
  process.exit(1);
});
