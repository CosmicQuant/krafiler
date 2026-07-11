import 'dotenv/config';
import { KraHttpSession } from '../workers/http/session/KraHttpSession';
import { HttpLoginService } from '../workers/http/navigation/HttpLoginService';
import { ReturnsNavigator } from '../workers/http/navigation/ReturnsNavigator';
import { MriReturnSubmitter } from '../workers/http/filing/MriReturnSubmitter';
import type { JobContext } from '../types';

async function main() {
    const kraPin = process.argv[2] ?? '';
    const kraPassword = process.argv[3] ?? '';
    const periodFrom = process.argv[4] ?? '2026-06-01';
    const periodTo = process.argv[5] ?? '2026-06-30';
    const rentalIncomeAmount = Number(process.argv[6] ?? '90000');

    if (!kraPin || !kraPassword) {
        console.error('Usage: npx ts-node src/scripts/test-http-mri-file.ts <pin> <password> [periodFrom] [periodTo] [rentalIncomeAmount]');
        process.exit(1);
    }

    const jobId = `test-http-mri-${Date.now()}`;
    const job = {
        id: jobId,
        data: { jobId, userId: 'test-user', payload: { kraPin, taxObligationType: 'monthly_rental_income', periodFrom, periodTo, rentalIncomeAmount, clientId: 'test-client' } },
        progress: 0,
        log: async (entry: string) => console.log('[job log]', entry.substring(0, 150)),
        updateProgress: async (p: number) => { console.log('[progress]', p); },
        updateMessage: async (m: string) => { console.log('[message]', m); },
        updateData: async () => {},
        refresh: async () => {},
    } as unknown as JobContext;

    const session = new KraHttpSession({ timeout: 60_000 });

    try {
        console.log('--- Step 1: Login ---');
        const loginService = new HttpLoginService(session, job);
        await loginService.execute(kraPin, kraPassword);
        console.log('Login OK');

        console.log('--- Step 2: Navigate to returns ---');
        const navigator = new ReturnsNavigator(session, job);
        await navigator.navigateToReturns(false);
        await navigator.selectReturnObligation('monthly_rental_income', kraPin);

        console.log('--- Step 3: File MRI return ---');
        const submitter = new MriReturnSubmitter(session, job);
        const result = await submitter.execute({ kraPin, periodFrom, periodTo, rentalIncomeAmount });

        console.log('\n=== MRI Filing Result ===');
        console.log('Receipt Number:', result.receiptNumber);
        console.log('Receipt Path:', result.receiptPath);
    } catch (err: any) {
        console.error('MRI filing failed:', err.message);
        if (err.rawResponse) {
            console.error('Raw response snippet:', err.rawResponse.slice(0, 500));
        }
        process.exit(1);
    }
}

main();
