Plan to run the test and identify the PDF capture difference:

Update credentials in backend/src/scripts/test-nssf-local.ts:
Change NSSF_USERNAME from '21888523' to 'NSSF2330247X'
Change NSSF_PASSWORD from '21888523' to '2330247X'
Run the test script locally:
cd backend
npx ts-node src/scripts/test-nssf-local.ts
This will run with PLAYWRIGHT_HEADLESS=false (visible browser) so we can see what's happening.

Observe the logs to see exactly how the PDF is captured:
Does waitForResponse catch a real PDF response?
Does the browser fetch return HTML or PDF?
Does printToPDF produce a clean PDF or a distorted one?
What are the exact byte sizes and content types?
Compare with production:
The production code in file-nssf-return.ts is the same function that the test script calls
The difference might be in how the browser is launched (local Chrome vs Cloud Run Chromium)
Or the difference might be in the playwright-extra vs playwright import
Identify the fix:
If the test script produces a clean PDF, I'll identify what the production code does differently
If the test script also produces a distorted PDF, I'll know the issue is in the file-nssf-return.ts logic itself
Apply the fix to the production code.