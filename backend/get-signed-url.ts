import 'dotenv/config';
import { getSignedDownloadUrl } from './src/lib/cloudStorage';

async function main() {
    const gcsPath = 'users/l7xzLPqfR1bQcBRVZWVzjv61kqL2/clients/2/receipts/local-test-1780856040362/nssf-payment-order-1780855922606.pdf';
    try {
        const url = await getSignedDownloadUrl(gcsPath, 60);
        console.log('Signed URL:', url);
    } catch (err: any) {
        console.error('Failed:', err.message);
    }
}

main();
