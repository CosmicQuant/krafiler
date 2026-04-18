/**
 * tax.routes.ts
 *
 * POST /api/tax/file-nil-return  — enqueue a new KRA nil return filing job.
 * GET  /api/tax/filing-status/:jobId — poll the status of an existing job.
 */

import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { encrypt } from '../utils/encryption';
import { kraFilingQueue } from '../queues/kraFilingQueue';
import {
    FilingJob,
    FileNilReturnRequest,
    FileNilReturnResponse,
    TAX_OBLIGATION_TYPES,
} from '../types';

const router = Router();

// ─── Input Validation Middleware ─────────────────────────────────────────────

const validateNilReturn = [
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
        .isISO8601()
        .withMessage('periodFrom must be a valid ISO 8601 date (YYYY-MM-DD)'),

    body('periodTo')
        .isISO8601()
        .withMessage('periodTo must be a valid ISO 8601 date (YYYY-MM-DD)')
        .custom((value: string, { req }) => {
            if (new Date(value) < new Date(req.body.periodFrom as string)) {
                throw new Error('periodTo must be on or after periodFrom');
            }
            return true;
        }),

    body('taxObligationType')
        .isString()
        .isIn([...TAX_OBLIGATION_TYPES])
        .withMessage('taxObligationType must be one of the supported nil return obligations'),

    body('ownsRentalProperty')
        .isBoolean()
        .withMessage('ownsRentalProperty must be a boolean'),
];

// ─── POST /api/tax/file-nil-return ───────────────────────────────────────────

router.post(
    '/file-nil-return',
    validateNilReturn,
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

        const { kraPin, kraPassword, periodFrom, periodTo, taxObligationType, ownsRentalProperty } =
            req.body;

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
                    periodFrom,
                    periodTo,
                    taxObligationType,
                    ownsRentalProperty: Boolean(ownsRentalProperty),
                },
                createdAt: new Date().toISOString(),
            };

            await kraFilingQueue.add('file-nil-return', filingJob, { jobId });

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

            res.status(200).json({
                jobId,
                state,
                progress: job.progress,
                attemptsMade: job.attemptsMade,
                failedReason: job.failedReason ?? null,
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
