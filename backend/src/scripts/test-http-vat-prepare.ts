import 'dotenv/config';
import { KraHttpSession } from '../workers/http/session/KraHttpSession';
import { HttpLoginService } from '../workers/http/navigation/HttpLoginService';
import { ReturnsNavigator } from '../workers/http/navigation/ReturnsNavigator';
import { VatPrepareService } from '../workers/http/filing/VatPrepareService';
import { CaptureContext, CaptureUploader } from '../workers/http/capture';
import type { JobContext } from '../types';

async function main() {
    const kraPin = process.argv[2] ?? process.env.TEST_KRA_PIN ?? 'P052400880Z';
    const kraPassword = process.argv[3] ?? process.env.TEST_KRA_PASSWORD ?? '';
    const periodFrom = process.argv[4] ?? '2026-06-01';
    const periodTo = process.argv[5] ?? '2026-06-30';
    const previousCredit = Number(process.argv[6] ?? '0');
    const clientName = process.argv[7] ?? 'GREBEN';
    const isCurrentMonth = process.argv[8] === 'current-month';

    if (!kraPin || !kraPassword) {
        console.error('Usage: npx ts-node src/scripts/test-http-vat-prepare.ts <pin> <password> [periodFrom] [periodTo] [previousCredit] [clientName] [current-month]');
        console.error('       Set TEST_KRA_PASSWORD env var or pass as 2nd arg.');
        process.exit(1);
    }

    const jobId = `test-http-vat-${Date.now()}`;
    const captureContext: any = undefined;

    const job = {
        id: jobId,
        data: {
            jobId,
            userId: 'test-user',
            payload: {
                kraPin,
                taxObligationType: 'vat',
                periodFrom,
                periodTo,
                prepareVatOnly: true,
                clientName,
                vatPreviousCredit: previousCredit,
                clientId: 'test-client',
            },
        },
        progress: 0,
        log: async (entry: string) => console.log('[job log]', entry),
        updateProgress: async (p: number) => { console.log('[progress]', p); },
        updateMessage: async (m: string) => { console.log('[message]', m); },
        updateData: async () => {},
        refresh: async () => {},
    } as unknown as JobContext;

    const session = new KraHttpSession({
        timeout: 60_000,
        captureContext,
    });

    try {
        // Step 1: Login
        console.log('--- Step 1: Login ---');
        const loginService = new HttpLoginService(session, job);
        const loginResult = await loginService.execute(kraPin, kraPassword);
        console.log('Login result:', { passwordExpired: loginResult.passwordExpired, mobileVerificationRequired: loginResult.mobileVerificationRequired });

        // For current-month download, VatPrepareService handles its own navigation.
        // For prepareVatOnly, we navigate to returns first (but VatPrepareService also
        // re-navigates after credit extraction, so this is redundant but harmless).
        if (!isCurrentMonth) {
            console.log('--- Step 2: Navigate to returns ---');
            const navigator = new ReturnsNavigator(session, job);
            await navigator.navigateToReturns(false);
            await navigator.selectReturnObligation('vat', kraPin);
        }

        // Step 3: Download VAT ZIP and generate return package
        console.log('--- Step 3: Download VAT return ---');
        const vatPrepareService = new VatPrepareService(session, job);
        const result = await vatPrepareService.execute({
            kraPin,
            clientName,
            periodFrom,
            periodTo,
            vatPreviousCredit: previousCredit,
            currentMonthDownload: isCurrentMonth,
        });

        console.log('\n=== VAT Prepare Result ===');
        console.log('Generated ZIP URL:', result.generatedZipUrl);
        console.log('Generated ZIP Label:', result.generatedZipLabel);
        console.log('Source Package URL:', result.sourcePackageUrl);
        console.log('Source Package Label:', result.sourcePackageLabel);
        console.log('Source Package GCS Path:', result.sourcePackageGcsPath);
        console.log('Generated ZIP GCS Path:', result.generatedZipGcsPath);
        console.log('Auto-population succeeded:', result.autoPopulationSucceeded);
        console.log('VAT Summary:', JSON.stringify(result.vatSummary, null, 2));
    } catch (err: any) {
        console.error('VAT prepare failed:', err.message);
        if (err.context) {
            console.error('Context:', JSON.stringify(err.context, null, 2));
        }
        if (err.rawResponse) {
            console.error('Raw response snippet:', err.rawResponse.slice(0, 500));
        }
        process.exit(1);
    } finally {
        if (captureContext) await captureContext.finalize('failure').catch(() => {});
    }
}

main();
