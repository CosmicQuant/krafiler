const fs = require('fs');
let code = fs.readFileSync('backend/src/workers/kraFilingWorker.ts', 'utf-8');
const searchStart = '// -- Step 13: Generate Payment Slip (PRN)';
const searchStartFallback = 'Step 13: Generate Payment Slip';
let startIndex = code.indexOf(searchStart);
if (startIndex === -1) {
    startIndex = code.indexOf(searchStartFallback);
}
// Find the exact line start if fallback used
while (startIndex > 0 && code[startIndex - 1] !== '\n') {
    startIndex--;
}

const searchEnd = '        // Clean up browser resources before network I/O';
const endIndex = code.indexOf(searchEnd);

if (startIndex === -1 || endIndex === -1) {
  console.log('Not found!');
  process.exit(1);
}

const replacement = `        // -- Step 13: Generate Payment Slip (PRN) ----------------------------------
        let storedPrnPath: string | null = null;
        
        // Determine PRN requirement: If MRI/TOT has liability, or if VAT/PAYE
        const needsPrn = 
            (isMriReturn && rentalIncomeAmount && rentalIncomeAmount > 0) ||
            (taxObligationType === 'turnover_tax' && totTurnover && totTurnover > 0) ||
            (taxObligationType === 'paye') || 
            (taxObligationType === 'vat');

        if (needsPrn) {
            await setJobStep(job, 93, \`Generating Payment Slip (PRN) for \${taxObligationType}\`);
            try {
                const pDate = new Date(); // It is usually the filing date period. Let's use today or periodTo if defined
                
                const prnConfig: PrnConfig = {
                    taxType: taxObligationType,
                    periodYear: pDate.getFullYear().toString(),
                    periodMonth: pDate.toLocaleString('default', { month: 'long' })
                };

                const prnFileName = \`kra-\${taxObligationType}-prn-\${jobId}-\${Date.now()}.pdf\`;
                const tempPrnPath = path.join(TMP_DIR, prnFileName);

                const prnResult = await generatePRNSlip(page, prnConfig, tempPrnPath);
                
                if (prnResult.success && prnResult.filePath) {
                    storedPrnPath = prnResult.filePath;
                    console.log(\`[Worker][\${jobId}] PRN saved to: \${storedPrnPath}\`);
                    await appendJobLog(job, 'Successfully generated and downloaded PRN', { progress: 95 });
                } else {
                    console.log(\`[Worker][\${jobId}] PRN generation returned false.\`);
                    await appendJobLog(job, \`PRN generation skipped/failed. Receipt logic continues.\`, { progress: 95, level: 'info' });
                }
            } catch (err: any) {
                console.error(\`[Worker][\${jobId}] Could not generate PRN slip:\`, err.message);
                await appendJobLog(job, \`Failed to generate PRN: \${err.message}. Receipt logic continues.\`, { progress: 95, level: 'info' });
            }
        }

`;

fs.writeFileSync('backend/src/workers/kraFilingWorker.ts', code.substring(0, startIndex) + replacement + code.substring(endIndex));
console.log('Fixed!');
