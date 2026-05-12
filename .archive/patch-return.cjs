const fs = require('fs');
let code = fs.readFileSync('backend/src/workers/kraFilingWorker.ts', 'utf-8');

// 1. Update signature
code = code.replace(
  'async function processFilingJob(job: Job<FilingJob>): Promise<{ receiptPath: string; receiptNumber: string | null; credentialUpdate: CredentialUpdate | null }>',
  'async function processFilingJob(job: Job<FilingJob>): Promise<{ receiptPath: string; receiptNumber: string | null; credentialUpdate: CredentialUpdate | null; prnPath?: string }>'
);

// 2. Update return block inside the function
// Find `receiptNumber,\n            credentialUpdate,\n        };`
const returnSearch = '        return {\n            receiptPath: storedReceiptPath,\n            receiptNumber,\n            credentialUpdate,\n        };';
const returnReplacement = '        return {\n            receiptPath: storedReceiptPath,\n            receiptNumber,\n            credentialUpdate,\n            prnPath: storedPrnPath || undefined,\n        };';

code = code.replace(returnSearch, returnReplacement);

fs.writeFileSync('backend/src/workers/kraFilingWorker.ts', code);
console.log('Fixed returns!');
