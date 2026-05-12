const fs = require('fs');
let code = fs.readFileSync('backend/src/workers/kraFilingWorker.ts', 'utf8');

const targetStr = "const isPayeUpload = taxObligationType === 'paye' && !!(payload as any).payeZipUrl;";

const index = code.indexOf(targetStr);
if (index > -1) {
    const before = code.substring(0, index + targetStr.length);
    let after = code.substring(index + targetStr.length);
    
    // We want to replace everything from the console log to the fs.mkdir line
    const regex = /console\.log\(\`\[Worker\] Starting job \$\{jobId\} for PIN \$\{kraPin\}\`\);\s+await appendJobLog\(job, 'Job accepted by worker'\);[\s\S]+?let credentialUpdate: CredentialUpdate \| null = job\.data\.credentialUpdate \?\? null;\s+await fs\.mkdir\(TMP_DIR, \{ recursive: true \}\);/;
    
    after = after.replace(regex, 
`\n    const isNssfReturn = taxObligationType === 'nssf';

    console.log(\`[Worker] Starting job \${jobId} for identifier \${kraPin}\`);
    await appendJobLog(job, 'Job accepted by worker');

    let activePassword = decrypt(encryptedPassword, iv, authTag);
    let credentialUpdate: CredentialUpdate | null = job.data.credentialUpdate ?? null;

    if (isNssfReturn) {
        const nssfFileUrl = (payload as any).nssfFileUrl;
        if (!nssfFileUrl) throw new Error("Missing NSSF File URL in payload.");
        await fileNssfReturn(job, kraPin, activePassword, nssfFileUrl, '04/2026');
        return { receiptPath: '', receiptNumber: null, credentialUpdate };
    }

    await fs.mkdir(TMP_DIR, { recursive: true });`);
    
    fs.writeFileSync('backend/src/workers/kraFilingWorker.ts', before + after);
    console.log('Patched correctly');
} else {
    console.log('Could not find anchor');
}
