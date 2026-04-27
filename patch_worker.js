const fs = require('fs');
let code = fs.readFileSync('backend/src/workers/kraFilingWorker.ts', 'utf8');

code = code.replace(
    /const isMriReturn = taxObligationType === 'monthly_rental_income';\s*const isTotReturn = taxObligationType === 'turnover_tax';/,
    `const isMriReturn = taxObligationType === 'monthly_rental_income';
    const isTotReturn = taxObligationType === 'turnover_tax';
    const isPayeUpload = taxObligationType === 'paye' && !!(payload as any).payeZipUrl;`
);

code = code.replace(
    /const filingLinkSelector = isMriReturn \|\| isTotReturn\s*\? 'a\[href\*="eReturns"\],[^']*'\s*: 'a\[href\*="nilReturn"\],[^']*';/,
    `const filingLinkSelector = isMriReturn || isTotReturn || isPayeUpload
        ? 'a[href*="eReturns"], a:has-text("File Return")'
        : 'a[href*="nilReturn"], a[href*="NilReturn"], a[href*="nil-return"], a:has-text("Nil Return")';`
);

code = code.replace(
    /await waitForPortalReadyWithReload\(page, job, \{\s*description: isTotReturn \? 'ToT return obligation page' : isMriReturn \? 'MRI return obligation page' : 'Nil return obligation page',/,
    `await waitForPortalReadyWithReload(page, job, {
        description: isTotReturn ? 'ToT return obligation page' : isMriReturn ? 'MRI return obligation page' : isPayeUpload ? 'PAYE return obligation page' : 'Nil return obligation page',`
);

code = code.replace(
    /await setJobStep\(job, 60, isTotReturn \? 'Selecting ToT return type and tax obligation' : isMriReturn \? 'Selecting MRI return type and tax obligation' : 'Selecting nil return type and tax obligation'\);/,
    `await setJobStep(job, 60, isTotReturn ? 'Selecting ToT return type and tax obligation' : isMriReturn ? 'Selecting MRI return type and tax obligation' : isPayeUpload ? 'Selecting PAYE return type and preparing upload' : 'Selecting nil return type and tax obligation');`
);

code = code.replace(
    /await setJobStep\(job, 70, isTotReturn \? 'Uploading the ToT ZIP file and accepting the declaration' : isMriReturn \? 'Confirming the MRI period and entering monthly rental income' : 'Confirming the return period and rental-property answer'\);\s*if \(isTotReturn\) \{\s*await uploadTurnoverTaxZip\(page, job\);\s*\} else \{/g,
    `await setJobStep(job, 70, isTotReturn ? 'Uploading the ToT ZIP file and accepting the declaration' : isPayeUpload ? 'Uploading the PAYE ZIP file and accepting the declaration' : isMriReturn ? 'Confirming the MRI period and entering monthly rental income' : 'Confirming the return period and rental-property answer');

    if (isTotReturn) {
        await uploadTurnoverTaxZip(page, job);
    } else if (isPayeUpload) {
        await uploadPayeTaxZip(page, job);
    } else {`
);

const newFunc = `async function uploadPayeTaxZip(page: any, job: any): Promise<void> {
    const payload = job.data.payload;
    if (!payload.payeZipUrl) {
        throw new Error('PAYE Upload filing requires payeZipUrl in the queued job payload');
    }
    await appendJobLog(job, \`Downloading PAYE ZIP file from \${payload.payeZipUrl}\`, { progress: 68 });
    const res = await fetch(payload.payeZipUrl);
    if (!res.ok) throw new Error(\`Failed to fetch PAYE ZIP: \${res.statusText}\`);
    const zipPath = require('path').join(TMP_DIR, \`paye-\${job.data.jobId}.zip\`);
    await require('fs').promises.writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ timeout: 20_000 });
    await fileInput.setInputFiles(zipPath);
    const termsCheckbox = page.locator('input[type="checkbox"]:near(:text("Terms and Conditions")), input[type="checkbox"][name*="agree" i], input[type="checkbox"][id*="agree" i], input[type="checkbox"]').first();
    await termsCheckbox.check();
    await appendJobLog(job, \`Uploaded PAYE ZIP file and accepted the declaration\`, { progress: 70 });
}
`;

if (!code.includes('async function uploadPayeTaxZip')) {
    code = code.replace('async function uploadTurnoverTaxZip', newFunc + '\nasync function uploadTurnoverTaxZip');
}

fs.writeFileSync('backend/src/workers/kraFilingWorker.ts', code);
console.log('Worker patched!');