import 'dotenv/config';
import { HttpPrnService } from '../workers/http/prn/HttpPrnService';
import { CaptureContext, CaptureUploader } from '../workers/http/capture';
import type { JobContext } from '../types';

async function main() {
    const kraPin = process.argv[2] ?? process.env.TEST_KRA_PIN;
    const kraPassword = process.argv[3] ?? process.env.TEST_KRA_PASSWORD;
    const taxObligationType = process.argv[4] ?? 'turnover_tax';
    const periodFrom = process.argv[5] ?? '2026-06-01';
    const periodTo = process.argv[6] ?? '2026-06-30';

    if (!kraPin || !kraPassword) {
        console.error('Usage: npx ts-node src/scripts/test-http-prn.ts <pin> <password> [taxType] [periodFrom] [periodTo]');
        process.exit(1);
    }

    const jobId = `test-http-prn-${Date.now()}`;
    const captureContext = new CaptureContext({
        jobId,
        userId: 'test-user',
        clientId: 'test-client',
        taxObligationType,
        isNil: false,
        kraPin,
        options: { enabled: true, screenshots: false },
        uploader: new CaptureUploader(),
    });

    const job = {
        id: jobId,
        data: {
            jobId,
            userId: 'test-user',
            payload: {
                kraPin,
                taxObligationType,
                periodFrom,
                periodTo,
                printPrnOnly: true,
            },
        },
        progress: 0,
        log: async (entry: string) => console.log('[job log]', entry),
        updateProgress: async (p: number) => { console.log('[progress]', p); },
        updateMessage: async (m: string) => { console.log('[message]', m); },
        updateData: async () => {},
        refresh: async () => {},
    } as unknown as JobContext;

    const service = new HttpPrnService({ job });

    try {
        const result = await service.execute({
            kraPin,
            kraPassword,
            taxObligationType,
            periodFrom,
            periodTo,
            userId: 'test-user',
            jobId,
        });
        console.log('PRN generated:', result);
    } catch (err: any) {
        console.error('PRN generation failed:', err.message);
        if (err.context) {
            console.error('Context:', JSON.stringify(err.context, null, 2));
        }
        if (err.rawResponse) {
            console.error('Raw response snippet:', err.rawResponse.slice(0, 500));
        }
        process.exit(1);
    } finally {
        await captureContext.finalize('failure').catch(() => {});
    }
}

main();
