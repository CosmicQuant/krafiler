import { fileNssfReturn } from './file-nssf-return';

async function test() {
    console.log('=== NSSF Filing Test (Clean-Page PDF Capture) ===');
    try {
        const result = await fileNssfReturn(
            null, // job
            '24041742', // username
            '24041742', // password
            '', // filePath - will skip upload and just test receipt capture
            '05/2026' // period
        );
        console.log('Result:', result);
    } catch (e: any) {
        console.error('Test failed:', e.message);
    }
    process.exit(0);
}

test();
