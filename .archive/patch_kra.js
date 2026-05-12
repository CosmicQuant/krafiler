const fs = require('fs');
let code = fs.readFileSync('backend/src/workers/kraFilingWorker.ts', 'utf8');

const search = `    const isPayeUpload = taxObligationType === 'paye' && !!(payload as any).payeZipUrl;

    console.log(\`[Worker] Starting job \${jobId} for PIN \${kraPin}\`);
    await appendJobLog(job, 'Job accepted by worker');`;

const r2 = `    // The plaintext password exists only in this local scope and is GC'd after
    // the browser session closes.
    let activePassword = decrypt(encryptedPassword, iv, authTag);
    let credentialUpdate: CredentialUpdate | null = job.data.credentialUpdate ?? null;

    await fs.mkdir(TMP_DIR, { recursive: true });`;

let i1 = code.indexOf(search);
let i2 = code.indexOf(r2);

if(i1 !== -1 && i2 !== -1) {
  const replaceStr = `    const isPayeUpload = taxObligationType === 'paye' && !!(payload as any).payeZipUrl;
    const isNssfReturn = taxObligationType === 'nssf';

    console.log(\`[Worker] Starting job \${jobId} for identifier \${kraPin}\`);
    await appendJobLog(job, 'Job accepted by worker');

    // The plaintext password exists only in this local scope and is GC'd after
    // the browser session closes.
    let activePassword = decrypt(encryptedPassword, iv, authTag);
    let credentialUpdate: CredentialUpdate | null = job.data.credentialUpdate ?? null;

    if (isNssfReturn) {
        const nssfFileUrl = (payload as any).nssfFileUrl;
        if (!nssfFileUrl) throw new Error("Missing NSSF File URL in payload.");
        await fileNssfReturn(job, kraPin, activePassword, nssfFileUrl, '04/2026');
        return { receiptPath: '', receiptNumber: null, credentialUpdate };
    }

    await fs.mkdir(TMP_DIR, { recursive: true });`;

   code = code.substring(0, i1) + replaceStr + code.substring(i2 + r2.length);
   fs.writeFileSync('backend/src/workers/kraFilingWorker.ts', code);
   console.log('patched');
} else {
   console.log('not found', !!i1, !!i2);
}
