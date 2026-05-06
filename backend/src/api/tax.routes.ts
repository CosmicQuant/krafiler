/**
 * tax.routes.ts
 *
 * POST /api/tax/file-return      — enqueue a new KRA filing job.
 * POST /api/tax/file-nil-return  — legacy alias for the same queueing route.
 * GET  /api/tax/filing-status/:jobId — poll the status of an existing job.
 */

import fs from 'fs/promises';
import { copyFileSync } from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { encrypt } from '../utils/encryption';
import { kraFilingQueue } from '../queues/kraFilingQueue';
import {
    FilingJob,
    FilingStepLog,
    FileNilReturnRequest,
    FileNilReturnResponse,
    TAX_OBLIGATION_TYPES,
    NilReturnPayload
} from '../types';
import { fileNssfReturn } from '../scripts/file-nssf-return';
import { packageToTZip } from '../scripts/kra-tot-generator';

const TMP_DIR = path.join(__dirname, '../../../tmp');

const ensureDir = async (dirPath: string) => {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
};

const router = Router();

const PERIOD_OPTIONAL_OBLIGATIONS = new Set(['monthly_rental_income', 'turnover_tax']);
const RENTAL_ANSWER_OPTIONAL_OBLIGATIONS = new Set([
    'monthly_rental_income', 
    'turnover_tax', 
    'vat', 
    'paye', 
    'income_tax_company', 
    'nssf'
]);

function getPreviousMonthIsoRange(referenceDate = new Date()): { periodFrom: string; periodTo: string } {
    const year = referenceDate.getUTCFullYear();
    const month = referenceDate.getUTCMonth();
    const previousMonthStart = new Date(Date.UTC(year, month - 1, 1));
    const previousMonthEnd = new Date(Date.UTC(year, month, 0));

    return {
        periodFrom: previousMonthStart.toISOString().slice(0, 10),
        periodTo: previousMonthEnd.toISOString().slice(0, 10),
    };
}

function parseFilingStepLog(rawEntry: string): FilingStepLog {
    try {
        const parsed = JSON.parse(rawEntry) as Partial<FilingStepLog>;
        return {
            timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString(),
            message: typeof parsed.message === 'string' ? parsed.message : rawEntry,
            progress: typeof parsed.progress === 'number' ? parsed.progress : null,
            level: parsed.level === 'error' ? 'error' : 'info',
        };
    } catch {
        return {
            timestamp: new Date().toISOString(),
            message: rawEntry,
            progress: null,
            level: 'info',
        };
    }
}

type PendingFilingState = 'waiting' | 'active' | 'delayed';

function hasCancellationRequest(jobData?: Partial<FilingJob> | null): boolean {
    return typeof jobData?.cancelRequestedAt === 'string' && jobData.cancelRequestedAt.trim().length > 0;
}

function createFilingStepLogEntry(
    message: string,
    progress?: number,
    level: FilingStepLog['level'] = 'info'
): string {
    return JSON.stringify({
        timestamp: new Date().toISOString(),
        message,
        progress: typeof progress === 'number' ? progress : null,
        level,
    });
}

function resolveApiJobState(
    queueState: string,
    jobData?: Partial<FilingJob> | null,
    failedReason?: string | null
): NonNullable<FileNilReturnResponse['jobState']> {
    if (hasCancellationRequest(jobData)) {
        if (queueState === 'active' || queueState === 'waiting' || queueState === 'delayed') {
            return 'cancelling';
        }

        if (
            queueState === 'failed' ||
            typeof jobData?.cancelledAt === 'string' ||
            /job cancelled by user/i.test(failedReason ?? '')
        ) {
            return 'cancelled';
        }
    }

    if (
        queueState === 'waiting' ||
        queueState === 'active' ||
        queueState === 'delayed' ||
        queueState === 'completed' ||
        queueState === 'failed'
    ) {
        return queueState;
    }

    return 'unknown';
}

type FilingGuardInput = {
    userId: string;
    kraPin: string;
    periodFrom: string;
    periodTo: string;
    taxObligationType: FileNilReturnRequest['taxObligationType'];
    ownsRentalProperty: boolean;
    rentalIncomeAmount?: number;
    totYear?: number;
    totMonth?: number;
    totTurnover?: number;
    payeZipUrl?: string;
    printPrnOnly?: boolean;
};

function normaliseOptionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildPendingFilingKey(input: FilingGuardInput): string {
    return JSON.stringify({
        userId: input.userId.trim(),
        kraPin: input.kraPin.trim().toUpperCase(),
        periodFrom: input.periodFrom.trim(),
        periodTo: input.periodTo.trim(),
        taxObligationType: input.taxObligationType,
        ownsRentalProperty: Boolean(input.ownsRentalProperty),
        rentalIncomeAmount: normaliseOptionalNumber(input.rentalIncomeAmount),
        totYear: normaliseOptionalNumber(input.totYear),
        totMonth: normaliseOptionalNumber(input.totMonth),
        totTurnover: normaliseOptionalNumber(input.totTurnover),
        payeZipUrl: input.payeZipUrl?.trim() ?? '',
        printPrnOnly: Boolean(input.printPrnOnly),
    });
}

async function findDuplicatePendingFiling(input: FilingGuardInput): Promise<{ jobId: string; state: PendingFilingState } | null> {
    const requestedKey = buildPendingFilingKey(input);
    const pendingJobs = await kraFilingQueue.getJobs(['waiting', 'active', 'delayed'], 0, 199, true);

    for (const pendingJob of pendingJobs) {
        const pendingJobData = pendingJob.data as FilingJob;
        if (!pendingJobData?.payload) {
            continue;
        }

        const pendingKey = buildPendingFilingKey({
            userId: pendingJobData.userId,
            kraPin: pendingJobData.payload.kraPin,
            periodFrom: pendingJobData.payload.periodFrom,
            periodTo: pendingJobData.payload.periodTo,
            taxObligationType: pendingJobData.payload.taxObligationType,
            ownsRentalProperty: pendingJobData.payload.ownsRentalProperty,
            rentalIncomeAmount: pendingJobData.payload.rentalIncomeAmount,
            totYear: pendingJobData.payload.totYear,
            totMonth: pendingJobData.payload.totMonth,
            totTurnover: pendingJobData.payload.totTurnover,
            payeZipUrl: pendingJobData.payload.payeZipUrl,
            printPrnOnly: pendingJobData.payload.printPrnOnly,
        });

        if (pendingKey !== requestedKey) {
            continue;
        }

        const state = await pendingJob.getState();
        if (state === 'waiting' || state === 'active' || state === 'delayed') {
            return {
                jobId: String(pendingJob.id ?? pendingJobData.jobId),
                state,
            };
        }
    }

    return null;
}

// ─── Input Validation Middleware ─────────────────────────────────────────────

const validateFilingRequest = [
    body('kraPin')
        .trim()
        .toUpperCase()
        .matches(/^[A-Z0-9]{11}$/)
        .withMessage('kraPin must be exactly 11 alphanumeric characters'),

    body('kraPassword')
        .isString()
        .notEmpty()
        .withMessage('kraPassword is required'),

    body('periodFrom')
        .custom((value: string, { req }) => {
            if (!value && PERIOD_OPTIONAL_OBLIGATIONS.has(req.body.taxObligationType as string)) {
                return true;
            }

            if (!value) {
                throw new Error('periodFrom must be a valid ISO 8601 date (YYYY-MM-DD)');
            }

            if (Number.isNaN(Date.parse(value))) {
                throw new Error('periodFrom must be a valid ISO 8601 date (YYYY-MM-DD)');
            }

            return true;
        }),

    body('periodTo')
        .custom((value: string, { req }) => {
            if (!value && PERIOD_OPTIONAL_OBLIGATIONS.has(req.body.taxObligationType as string)) {
                return true;
            }

            if (!value || Number.isNaN(Date.parse(value))) {
                throw new Error('periodTo must be a valid ISO 8601 date (YYYY-MM-DD)');
            }

            if (req.body.periodFrom && new Date(value) < new Date(req.body.periodFrom as string)) {
                throw new Error('periodTo must be on or after periodFrom');
            }
            return true;
        }),

    body('taxObligationType')
        .isString()
        .isIn([...TAX_OBLIGATION_TYPES])
        .withMessage('taxObligationType must be one of the supported filing obligations'),

    body('ownsRentalProperty')
        .custom((value: unknown, { req }) => {
            console.log(`[Validation] ownsRentalProperty input:`, value, `type:`, typeof value);
            if ((value === undefined || value === null || value === '') && RENTAL_ANSWER_OPTIONAL_OBLIGATIONS.has(req.body.taxObligationType as string)) {
                return true;
            }

            if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
                throw new Error('ownsRentalProperty must be a boolean');
            }

            return true;
        }),

    body('rentalIncomeAmount')
        .custom((value: unknown, { req }) => {
            if (req.body.printPrnOnly) {
                return true;
            }

            if (req.body.isNil) {
                return true; // Nil returns don't need an amount
            }

            if (req.body.taxObligationType !== 'monthly_rental_income' && (value === undefined || value === null || value === '')) {
                return true;
            }

            if (req.body.taxObligationType === 'monthly_rental_income' && (value === undefined || value === null || value === '')) {
                throw new Error('rentalIncomeAmount is required for monthly rental income returns');
            }

            const numericValue = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(numericValue) || numericValue <= 0) {
                throw new Error('rentalIncomeAmount must be a positive number');
            }

            return true;
        }),

    body('totYear')
        .custom((value: unknown, { req }) => {
            if (req.body.printPrnOnly) return true; // PRN only generates for the active period, bypass strict payload
            if (req.body.taxObligationType !== 'turnover_tax') return true;
            if (!value || typeof value !== 'number') throw new Error('TOT Year is required and must be a number');
            return true;
        }),

    body('totMonth')
        .custom((value: unknown, { req }) => {
            if (req.body.printPrnOnly) return true;
            if (req.body.taxObligationType !== 'turnover_tax') return true;
            if (!value || typeof value !== 'number' || value < 1 || value > 12) throw new Error('TOT Month must be between 1 and 12');
            return true;
        }),

    body('totTurnover')
        .custom((value: unknown, { req }) => {
            if (req.body.printPrnOnly) return true;
            if (req.body.isNil) return true; // Nil returns don't need turnover
            if (req.body.taxObligationType !== 'turnover_tax') return true;
            if (value === undefined || value === null || value === '') throw new Error('TOT Turnover Amount is required');
            const numericValue = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(numericValue) || numericValue < 0) throw new Error('TOT Turnover must be a valid positive number');
            return true;
        }),

    body('otpCode')
        .optional({ values: 'falsy' })
        .isString()
        .withMessage('otpCode must be a string when provided'),
];

// ─── POST /api/tax/file-return (+ legacy alias) ─────────────────────────────

router.post(
    ['/file-return', '/file-nil-return'],
    validateFilingRequest,
    async (
        req: Request<object, FileNilReturnResponse, FileNilReturnRequest>,
        res: Response<FileNilReturnResponse>
    ): Promise<void> => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({
                success: false,
                message: errors
                    .array()
                    .map((e) => e.msg)
                    .join('; '),
            });
            return;
        }

        const { kraPin, kraPassword, periodFrom, periodTo, taxObligationType, ownsRentalProperty, rentalIncomeAmount, totYear, totMonth, totTurnover, otpCode, payeZipUrl, printPrnOnly } =
            req.body as any;

        const effectivePeriod = taxObligationType === 'monthly_rental_income' && (!periodFrom || !periodTo)
            ? getPreviousMonthIsoRange()
            : { periodFrom: periodFrom ?? '', periodTo: periodTo ?? '' };

        try {
            // In a real application, extract userId from the verified JWT / session.
            // req.user would be populated by an auth middleware.
            const userId =
                (req as Request & { user?: { id: string } }).user?.id ?? 'anonymous';

            const duplicatePendingJob = await findDuplicatePendingFiling({
                userId,
                kraPin,
                periodFrom: effectivePeriod.periodFrom,
                periodTo: effectivePeriod.periodTo,
                taxObligationType,
                ownsRentalProperty: Boolean(ownsRentalProperty),
                rentalIncomeAmount: typeof rentalIncomeAmount === 'number'
                    ? rentalIncomeAmount
                    : rentalIncomeAmount
                        ? Number(rentalIncomeAmount)
                        : undefined,
                totYear: typeof totYear === 'number' ? totYear : undefined,
                totMonth: typeof totMonth === 'number' ? totMonth : undefined,
                totTurnover: typeof totTurnover === 'number' ? totTurnover : undefined,
                payeZipUrl: typeof payeZipUrl === 'string' ? payeZipUrl : undefined,
                printPrnOnly: Boolean(req.body.printPrnOnly),
            });

            if (duplicatePendingJob) {
                res.status(409).json({
                    success: false,
                    duplicate: true,
                    message: `A matching filing is already ${duplicatePendingJob.state}.`,
                    jobId: duplicatePendingJob.jobId,
                    jobState: duplicatePendingJob.state,
                });
                return;
            }

            // Encrypt password immediately — plaintext must not leave this scope
            const { encryptedData, iv, authTag } = encrypt(kraPassword);

            const jobId = uuidv4();

            const filingJob: FilingJob = {
                jobId,
                userId,
                payload: {
                    kraPin,
                    encryptedPassword: encryptedData,
                    iv,
                    authTag,
                    periodFrom: effectivePeriod.periodFrom,
                    periodTo: effectivePeriod.periodTo,
                    taxObligationType,
                    ownsRentalProperty: Boolean(ownsRentalProperty),
                    rentalIncomeAmount: typeof rentalIncomeAmount === 'number'
                        ? rentalIncomeAmount
                        : rentalIncomeAmount
                            ? Number(rentalIncomeAmount)
                            : undefined,
                    totYear: typeof totYear === 'number' ? totYear : undefined,
                    totMonth: typeof totMonth === 'number' ? totMonth : undefined,
                    totTurnover: typeof totTurnover === 'number' ? totTurnover : undefined,
                    otpCode: typeof otpCode === 'string' && otpCode.trim()
                        ? otpCode.trim()
                        : undefined,
                    isNil: (req.body as any).isNil === true,
                    printPrnOnly: printPrnOnly === true,
                    ...(payeZipUrl && { payeZipUrl }),
                },
                createdAt: new Date().toISOString(),
            };

            await kraFilingQueue.add('file-return', filingJob, { jobId });

            console.log(`[API] Queued job ${jobId} for KRA PIN ${kraPin}`);

            res.status(202).json({
                success: true,
                message:
                    'Return queued successfully. You will be notified once the receipt is ready.',
                jobId,
                jobState: 'waiting',
            });
        } catch (err) {
            console.error('[API] Failed to queue filing job:', err);
            res.status(500).json({
                success: false,
                message: 'Failed to queue filing job. Please try again later.',
            });
        }
    }
);

router.post(
    '/filing-status/:jobId/cancel',
    [
        param('jobId')
            .isUUID(4)
            .withMessage('jobId must be a valid UUID v4'),
    ],
    async (
        req: Request<{ jobId: string }, FileNilReturnResponse>,
        res: Response<FileNilReturnResponse>
    ): Promise<void> => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({
                success: false,
                message: errors
                    .array()
                    .map((error) => error.msg)
                    .join('; '),
            });
            return;
        }

        const { jobId } = req.params;

        try {
            const job = await kraFilingQueue.getJob(jobId);

            if (!job) {
                res.status(404).json({
                    success: false,
                    message: `No job found with ID: ${jobId}`,
                });
                return;
            }

            const queueState = await job.getState();
            const currentProgress = typeof job.progress === 'number' ? job.progress : undefined;
            const currentData = job.data as FilingJob;

            if (queueState === 'completed') {
                res.status(409).json({
                    success: false,
                    message: 'This job has already completed and can no longer be cancelled.',
                    jobId,
                    jobState: 'completed',
                });
                return;
            }

            if (queueState === 'failed') {
                const resolvedFailedState = resolveApiJobState(queueState, currentData, job.failedReason ?? null);
                const alreadyCancelled = resolvedFailedState === 'cancelled';

                res.status(alreadyCancelled ? 200 : 409).json({
                    success: alreadyCancelled,
                    message: alreadyCancelled
                        ? 'This job was already cancelled.'
                        : 'This job has already failed and can no longer be cancelled.',
                    jobId,
                    jobState: resolvedFailedState,
                    cancelRequested: alreadyCancelled,
                });
                return;
            }

            if (queueState === 'waiting' || queueState === 'delayed') {
                const removed = await kraFilingQueue.remove(jobId, { removeChildren: true });

                if (removed === 1) {
                    res.status(202).json({
                        success: true,
                        message: 'Job cancelled before processing started.',
                        jobId,
                        jobState: 'cancelled',
                        cancelRequested: true,
                    });
                    return;
                }
            }

            if (!hasCancellationRequest(currentData)) {
                await job.updateData({
                    ...currentData,
                    cancelRequestedAt: new Date().toISOString(),
                });
                await job.log(
                    createFilingStepLogEntry(
                        'Cancellation requested by operator. The worker will stop at the next safe checkpoint.',
                        currentProgress
                    )
                );
            }

            res.status(202).json({
                success: true,
                message: 'Cancellation requested. The active filing will stop at the next safe checkpoint.',
                jobId,
                jobState: 'cancelling',
                cancelRequested: true,
            });
        } catch (err) {
            console.error('[API] Failed to cancel filing job:', err);
            res.status(500).json({
                success: false,
                message: 'Failed to cancel filing job.',
            });
        }
    }
);

// ─── GET /api/tax/filing-status/:jobId ───────────────────────────────────────

router.get(
    '/filing-status/:jobId',
    [
        param('jobId')
            .isUUID(4)
            .withMessage('jobId must be a valid UUID v4'),
    ],
    async (req: Request, res: Response): Promise<void> => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const { jobId } = req.params;

        try {
            const job = await kraFilingQueue.getJob(jobId);

            if (!job) {
                res.status(404).json({ message: `No job found with ID: ${jobId}` });
                return;
            }

            const queueState = await job.getState();
            const state = resolveApiJobState(queueState, job.data as FilingJob, job.failedReason ?? null);
            const jobLogsResult = await kraFilingQueue.getJobLogs(jobId, 0, 199, true);
            const stepLogs = jobLogsResult.logs.map(parseFilingStepLog);
            const lastStep = stepLogs.length > 0 ? stepLogs[stepLogs.length - 1] : null;

            res.status(200).json({
                jobId,
                state,
                progress: job.progress,
                attemptsMade: job.attemptsMade,
                failedReason: job.failedReason ?? null,
                stepLogs,
                lastStep,
                credentialUpdate: job.data.credentialUpdate ?? null,
                result: job.returnvalue ?? null,
                processedOn: job.processedOn
                    ? new Date(job.processedOn).toISOString()
                    : null,
                finishedOn: job.finishedOn
                    ? new Date(job.finishedOn).toISOString()
                    : null,
            });
        } catch (err) {
            console.error('[API] Failed to fetch job status:', err);
            res.status(500).json({ message: 'Failed to fetch job status.' });
        }
    }
);


// ─── POST /api/tax/file-nssf-return ─────────────────────────────
router.post('/file-nssf-return', async (req: Request, res: Response): Promise<void> => {
    try {
        const { nssfFileUrl, masterFileUrl, period } = req.body;
        if (!nssfFileUrl || !masterFileUrl) {
            res.status(400).json({ success: false, message: 'Missing NSSF file URL or Master CSV URL.' });
            return;
        }

        const relativeNssfPath = typeof nssfFileUrl === 'string' ? decodeURIComponent(nssfFileUrl).replace(/^\/?clients\//, 'clients/') : '';
        const localNssfPath = path.join(__dirname, '../../../frontend/public', relativeNssfPath);
        
        try {
            await fs.access(localNssfPath);
        } catch {
            res.status(404).json({ success: false, message: 'NSSF Excel file not found on disk: ' + localNssfPath });
            return;
        }

        const relativeMasterPath = typeof masterFileUrl === 'string' ? decodeURIComponent(masterFileUrl).replace(/^\/?clients\//, 'clients/') : '';
        const localMasterPath = path.join(__dirname, '../../../frontend/public', relativeMasterPath);

        try {
            await fs.access(localMasterPath);
        } catch {
            res.status(404).json({ success: false, message: 'Master CSV file not found on disk: ' + localMasterPath });
            return;
        }

        let nssfUsername = '';
        let nssfPassword = '';
        
        const csvParser = require('csv-parser');
        await new Promise((resolve, reject) => {
            let rowCount = 0;
            // Since we imported `fs from 'fs/promises'`, we need normal `fs` for streams, so use `require('fs')` here.
            require('fs').createReadStream(localMasterPath)
                .pipe(csvParser({ headers: false, skipLines: 0 }))
                .on('data', (row: any) => {
                    const values = Object.values(row);
                    if (rowCount === 2) nssfUsername = values[1] ? String(values[1]).replace(/^\uFEFF/, '').replace(/\u0000/g, '').replace(/^'/, '').trim() : '';
                    if (rowCount === 3) nssfPassword = values[1] ? String(values[1]).replace(/^\uFEFF/, '').replace(/\u0000/g, '').replace(/^'/, '').trim() : '';
                    rowCount++;
                })
                .on('end', resolve)
                .on('error', reject);
        });

        if (!nssfUsername || !nssfPassword) {
            res.status(400).json({ success: false, message: 'Could not extract NSSF Username or Password from the Master CSV. Please ensure they are on rows 3 and 4.' });
            return;
        }

        const { encryptedData, iv, authTag } = encrypt(nssfPassword);
        const jobId = uuidv4();
        
        const payload: NilReturnPayload = {
            kraPin: nssfUsername,
            encryptedPassword: encryptedData,
            iv,
            authTag,
            periodFrom: new Date().toISOString(), // Mock periods for compatibility
            periodTo: new Date().toISOString(),
            taxObligationType: 'nssf',
            ownsRentalProperty: false,
            nssfFileUrl: localNssfPath,
            masterFileUrl: localMasterPath
        };

        const job = await kraFilingQueue.add(
            'nssf-return',
            { jobId, userId: 'dev-user', payload, createdAt: new Date().toISOString() },
            { jobId }
        );

        res.json({
            success: true,
            jobId,
            message: 'NSSF filing job queued.',
            job: job.toJSON()
        });
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message || 'Error occurred during NSSF filing.' });
    }
});

router.post('/generate-tot-zip', async (req: Request, res: Response): Promise<void> => {
    try {
        const { kraPin, year, month, turnover, returnType } = req.body;
        
        if (!kraPin || !year || !month || turnover === undefined) {
             res.status(400).json({ success: false, error: 'Missing req fields: kraPin, year, month, turnover' });
             return;
        }

        await ensureDir(path.join(TMP_DIR, 'generated-zips'));
        const outputDir = path.join(TMP_DIR, 'generated-zips');
        
        const zipFile = await packageToTZip({
            taxPayerPin: kraPin.toUpperCase(),
            returnPeriod: { year: parseInt(year), month: parseInt(month) },
            turnover: parseFloat(turnover),
            returnType: returnType || 'Original'
        }, outputDir);
        
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const friendlyName = `${dd}-${mm}-${yyyy}_${hh}-${min}-${ss}_${kraPin.toUpperCase()}_TOT.zip`;
        const safeClientName = (req.body.clientName || 'Generated_Client').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
        const clientWorkspaceDir = path.join(__dirname, '../../../frontend/public/clients', safeClientName);
        await ensureDir(clientWorkspaceDir);
        const destPath = path.join(clientWorkspaceDir, friendlyName);
        copyFileSync(zipFile, destPath);
        
        res.json({
            success: true,
            totInfo: {
                url: `/clients/${encodeURIComponent(safeClientName)}/${friendlyName}`,
                label: friendlyName
            }
        });
    } catch (err: any) {
        console.error('Error generating TOT zip:', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to generate zip' });
    }
});

export default router;
