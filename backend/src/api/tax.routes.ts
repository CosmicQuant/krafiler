/**
 * tax.routes.ts
 *
 * POST /api/tax/file-return      — enqueue a new KRA filing job.
 * POST /api/tax/file-nil-return  — legacy alias for the same queueing route.
 * GET  /api/tax/filing-status/:jobId — poll the status of an existing job.
 */

import fs from 'fs/promises';
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
} from '../types';

const router = Router();

const PERIOD_OPTIONAL_OBLIGATIONS = new Set(['monthly_rental_income', 'turnover_tax']);
const RENTAL_ANSWER_OPTIONAL_OBLIGATIONS = new Set(['monthly_rental_income', 'turnover_tax']);

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
            if ((value === undefined || value === null || value === '') && RENTAL_ANSWER_OPTIONAL_OBLIGATIONS.has(req.body.taxObligationType as string)) {
                return true;
            }

            if (typeof value !== 'boolean') {
                throw new Error('ownsRentalProperty must be a boolean');
            }

            return true;
        }),

    body('rentalIncomeAmount')
        .custom((value: unknown, { req }) => {
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

    body('zipFilePath')
        .custom(async (value: unknown, { req }) => {
            if (req.body.taxObligationType !== 'turnover_tax' && (value === undefined || value === null || value === '')) {
                return true;
            }

            if (req.body.taxObligationType === 'turnover_tax' && (typeof value !== 'string' || !value.trim())) {
                throw new Error('zipFilePath is required for turnover tax returns');
            }

            if (typeof value !== 'string' || !value.trim()) {
                throw new Error('zipFilePath must be a valid file path');
            }

            const resolvedPath = path.resolve(value.trim());
            const stats = await fs.stat(resolvedPath).catch(() => null);
            if (!stats?.isFile()) {
                throw new Error(`zipFilePath does not exist: ${resolvedPath}`);
            }

            if (path.extname(resolvedPath).toLowerCase() !== '.zip') {
                throw new Error('zipFilePath must point to a .zip file');
            }

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

        const { kraPin, kraPassword, periodFrom, periodTo, taxObligationType, ownsRentalProperty, rentalIncomeAmount, zipFilePath, otpCode } =
            req.body;

        const effectivePeriod = taxObligationType === 'monthly_rental_income' && (!periodFrom || !periodTo)
            ? getPreviousMonthIsoRange()
            : { periodFrom: periodFrom ?? '', periodTo: periodTo ?? '' };

        try {
            // Encrypt password immediately — plaintext must not leave this scope
            const { encryptedData, iv, authTag } = encrypt(kraPassword);

            const jobId = uuidv4();

            // In a real application, extract userId from the verified JWT / session.
            // req.user would be populated by an auth middleware.
            const userId =
                (req as Request & { user?: { id: string } }).user?.id ?? 'anonymous';

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
                    zipFilePath: typeof zipFilePath === 'string' && zipFilePath.trim()
                        ? path.resolve(zipFilePath.trim())
                        : undefined,
                    otpCode: typeof otpCode === 'string' && otpCode.trim()
                        ? otpCode.trim()
                        : undefined,
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

            const state = await job.getState();
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

export default router;
