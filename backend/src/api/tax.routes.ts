/**
 * tax.routes.ts
 *
 * POST /api/tax/file-return      — enqueue a new KRA filing job.
 * POST /api/tax/file-nil-return  — legacy alias for the same queueing route.
 * GET  /api/tax/filing-status/:jobId — poll the status of an existing job.
 */

import fs from 'fs/promises';
import { tmpdir } from 'os';

import path from 'path';
import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
// Encryption disabled for testing — passwords flow plaintext through the queue
// import { encrypt } from '../utils/encryption';
import {
    FilingJob,
    FileNilReturnRequest,
    FileNilReturnResponse,
    TAX_OBLIGATION_TYPES,
    NilReturnPayload
} from '../types';
import {
    findDuplicatePendingFiling,
    queueFilingJob,
    queueNssfJob,
    cancelFilingJob,
    getFilingJobStatus,
} from '../services/filingQueue';
import { fileNssfReturn } from '../scripts/file-nssf-return';
import { packageToTZip } from '../scripts/kra-tot-generator';
import { adminDb } from '../lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

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

// ─── Input Validation Middleware ─────────────────────────────────────────────

const validateFilingRequest = [
    body('kraPin')
        .trim()
        .toUpperCase()
        .matches(/^[A-Z0-9]{11}$/)
        .withMessage('kraPin must be exactly 11 alphanumeric characters'),

    body('kraPassword')
        .optional({ checkFalsy: true })
        .isString()
        .notEmpty()
        .withMessage('kraPassword cannot be empty if provided'),

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

    body('clientName')
        .optional({ values: 'falsy' })
        .isString()
        .withMessage('clientName must be a string when provided'),

    body('vatZipUrl')
        .custom((value: unknown, { req }) => {
            if (value === undefined || value === null || value === '') {
                return true;
            }

            if (typeof value !== 'string') {
                throw new Error('vatZipUrl must be a string when provided');
            }

            if (req.body.taxObligationType !== 'vat') {
                throw new Error('vatZipUrl is only supported for VAT filings');
            }

            return true;
        }),

    body('prepareVatOnly')
        .custom((value: unknown, { req }) => {
            if (value === undefined || value === null || value === '') {
                return true;
            }

            if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
                throw new Error('prepareVatOnly must be a boolean when provided');
            }

            if (`${value}` === 'true' && req.body.taxObligationType !== 'vat') {
                throw new Error('prepareVatOnly is only supported for VAT filings');
            }

            return true;
        }),

    body('vatPreviousCredit')
        .custom((value: unknown, { req }) => {
            if (value === undefined || value === null || value === '') {
                return true;
            }

            if (req.body.taxObligationType !== 'vat') {
                throw new Error('vatPreviousCredit is only supported for VAT filings');
            }

            const numericValue = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(numericValue) || numericValue < 0) {
                throw new Error('vatPreviousCredit must be a non-negative number');
            }

            return true;
        }),

    body('sectionBWithoutPinSales')
        .custom((value: unknown, { req }) => {
            if (value === undefined || value === null || value === '') {
                return true;
            }

            if (req.body.taxObligationType !== 'vat') {
                throw new Error('sectionBWithoutPinSales is only supported for VAT filings');
            }

            const numericValue = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(numericValue) || numericValue < 0) {
                throw new Error('sectionBWithoutPinSales must be a non-negative number');
            }

            return true;
        }),
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

        const { kraPin, clientId, clientName, kraPassword, periodFrom, periodTo, taxObligationType, ownsRentalProperty, rentalIncomeAmount, totYear, totMonth, totTurnover, otpCode, payeZipUrl, vatZipUrl, prepareVatOnly, vatPreviousCredit, sectionBWithoutPinSales, printPrnOnly } =
            req.body as any;

        const effectivePeriod = taxObligationType === 'monthly_rental_income' && (!periodFrom || !periodTo)
            ? getPreviousMonthIsoRange()
            : { periodFrom: periodFrom ?? '', periodTo: periodTo ?? '' };

        try {
            // In a real application, extract userId from the verified JWT / session.
            // req.user would be populated by an auth middleware.
            const userId =
                (req as Request & { user?: { uid: string } }).user?.uid ?? 'anonymous';

            const duplicatePendingJob = await findDuplicatePendingFiling({
                userId,
                kraPin,
                clientName: typeof clientName === 'string' ? clientName : undefined,
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
                vatZipUrl: typeof vatZipUrl === 'string' ? vatZipUrl : undefined,
                prepareVatOnly: prepareVatOnly === true,
                vatPreviousCredit: typeof vatPreviousCredit === 'number'
                    ? vatPreviousCredit
                    : vatPreviousCredit !== undefined && vatPreviousCredit !== null && vatPreviousCredit !== ''
                        ? Number(vatPreviousCredit)
                        : undefined,
                sectionBWithoutPinSales: typeof sectionBWithoutPinSales === 'number'
                    ? sectionBWithoutPinSales
                    : sectionBWithoutPinSales !== undefined && sectionBWithoutPinSales !== null && sectionBWithoutPinSales !== ''
                        ? Number(sectionBWithoutPinSales)
                        : undefined,
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

            const jobId = uuidv4();

            // Passwords flow plaintext through the queue (encryption disabled for testing).
            let activePassword = kraPassword;
            if (!activePassword && typeof clientId === 'string' && clientId.trim().length > 0) {
                try {
                    const clientDoc = await adminDb.collection('clients').doc(clientId.trim()).get();
                    if (clientDoc.exists) {
                        const cd = clientDoc.data() as any;
                        activePassword = cd.credentials?.kraPassword || cd.password || cd.iTaxPassword || null;
                    }
                } catch (err) {
                    console.error('[API] Failed to fetch client stored password:', err);
                }
            }

            if (!activePassword || typeof activePassword !== 'string' || activePassword.trim().length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'kraPassword is required and no stored password was found for this client.',
                });
                return;
            }

            const filingJob: FilingJob = {
                jobId,
                userId,
                payload: {
                    kraPin,
                    kraPassword: activePassword,
                    clientId: typeof clientId === 'string' && clientId.trim().length > 0 ? clientId.trim() : undefined,
                    clientName: typeof clientName === 'string' && clientName.trim().length > 0
                        ? clientName.trim()
                        : undefined,
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
                    ...(vatZipUrl && { vatZipUrl }),
                    ...(prepareVatOnly === true && { prepareVatOnly: true }),
                    ...(vatPreviousCredit !== undefined && vatPreviousCredit !== null && vatPreviousCredit !== ''
                        ? { vatPreviousCredit: Number(vatPreviousCredit) }
                        : {}),
                    ...(sectionBWithoutPinSales !== undefined && sectionBWithoutPinSales !== null && sectionBWithoutPinSales !== ''
                        ? { sectionBWithoutPinSales: Number(sectionBWithoutPinSales) }
                        : {}),
                },
                createdAt: new Date().toISOString(),
            };

            await queueFilingJob(filingJob, userId);

            // Increment filing counter for subscription limits
            try {
                await adminDb.collection('users').doc(userId).update({
                    filingsThisMonth: FieldValue.increment(1),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } catch (e) {
                console.error('[API] Failed to increment filingsThisMonth:', e);
            }

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
            const result = await cancelFilingJob(jobId);

            if (result.state === 'not_found') {
                res.status(404).json({
                    success: false,
                    message: result.message,
                });
                return;
            }

            const statusCode = result.state === 'cancelled' ? 202 : result.state === 'completed' ? 409 : 202;
            res.status(statusCode).json({
                success: result.success,
                message: result.message,
                jobId,
                jobState: result.state as any,
                cancelRequested: result.state === 'cancelled' || result.state === 'cancelling',
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
            const status = await getFilingJobStatus(jobId);

            if (!status) {
                res.status(404).json({ message: `No job found with ID: ${jobId}` });
                return;
            }

            res.status(200).json({
                jobId: status.jobId,
                state: status.state,
                progress: status.progress,
                attemptsMade: status.attemptsMade,
                failedReason: status.failedReason,
                stepLogs: status.stepLogs,
                lastStep: status.lastStep,
                credentialUpdate: status.credentialUpdate,
                result: status.result,
                processedOn: status.processedOn,
                finishedOn: status.finishedOn,
            });
        } catch (err) {
            console.error('[API] Failed to fetch job status:', err);
            res.status(500).json({ message: 'Failed to fetch job status.' });
        }
    }
);

async function resolveFileFromUrl(fileUrl: string): Promise<string> {
    if (path.isAbsolute(fileUrl) && !fileUrl.startsWith('http')) {
        return fileUrl;
    }

    const url = fileUrl.startsWith('http') ? fileUrl : `http://localhost:3000${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    let ext = '.xlsx';
    try {
        ext = path.extname(new URL(fileUrl).pathname) || '.xlsx';
    } catch {
        ext = path.extname(fileUrl.split('?')[0]) || '.xlsx';
    }
    const tmpPath = path.join(tmpdir(), `krafiler-${Date.now()}${ext}`);
    await fs.writeFile(tmpPath, buffer);
    return tmpPath;
}

// ─── POST /api/tax/file-nssf-return ─────────────────────────────
router.post('/file-nssf-return', async (req: Request, res: Response): Promise<void> => {
    try {
        const { nssfFileUrl, masterFileUrl, period, clientId } = req.body;
        if (!nssfFileUrl) {
            res.status(400).json({ success: false, message: 'Missing NSSF file URL.' });
            return;
        }

        const localNssfPath = await resolveFileFromUrl(nssfFileUrl);

        // ── Resolve NSSF credentials ──────────────────────────────────
        // Primary source: client record in Firestore. Fallback: legacy Master CSV parsing.
        let nssfUsername = '';
        let nssfPassword = '';

        if (clientId) {
            const clientDoc = await adminDb.collection('clients').doc(String(clientId).trim()).get();
            if (clientDoc.exists) {
                const clientData = clientDoc.data() as any;
                nssfUsername = clientData.nssfNo?.trim() || '';
                nssfPassword = clientData.nssfPassword?.trim() || '';
            }
        }

        // Fallback to Master CSV only if Firestore credentials are missing
        if ((!nssfUsername || !nssfPassword) && masterFileUrl) {
            const localMasterPath = await resolveFileFromUrl(masterFileUrl);
            const csvParser = require('csv-parser');
            await new Promise((resolve, reject) => {
                let rowCount = 0;
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
        }

        if (!nssfUsername || !nssfPassword) {
            res.status(400).json({ success: false, message: 'NSSF Username (nssfNo) or Password not found. Please ensure they are saved in the client settings.' });
            return;
        }

        const jobId = uuidv4();

        const effectivePeriod = typeof period === 'string' ? period : (() => {
            const now = new Date();
            const year = now.getFullYear();
            let month = now.getMonth() + 1;
            if (now.getDate() <= 9) { month = month - 1; if (month === 0) month = 12; }
            return `${String(month).padStart(2, '0')}/${year}`;
        })();

        // NSSF credentials flow plaintext (encryption disabled for testing).
        const payload: NilReturnPayload = {
            kraPin: nssfUsername,
            kraPassword: nssfPassword,
            periodFrom: new Date().toISOString(),
            periodTo: new Date().toISOString(),
            taxObligationType: 'nssf',
            ownsRentalProperty: false,
            nssfFileUrl: localNssfPath,
            nssfPeriod: effectivePeriod,
        } as any;

        const filingJob: FilingJob = {
            jobId,
            userId: 'dev-user',
            payload,
            createdAt: new Date().toISOString(),
        };

        const { messageId } = await queueNssfJob(filingJob, 'dev-user');

        res.json({
            success: true,
            jobId,
            message: 'NSSF filing job queued.',
            messageId: messageId || undefined,
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
        const safeClientName = (req.body.clientName || 'Generated_Client').replace(/[<>:"\/\\|?*\x00-\x1F]/g, '').trim();

        // Upload to Cloud Storage so the file is accessible in production
        const { uploadFile, getSignedDownloadUrl } = await import('../lib/cloudStorage');
        const uid = (req as any).user?.uid || 'unknown';
        const gcsPath = `users/${uid}/clients/tot/${friendlyName}`;
        await uploadFile(zipFile, gcsPath, { contentType: 'application/zip' });
        const signedUrl = await getSignedDownloadUrl(gcsPath, 60);

        res.json({
            success: true,
            totInfo: {
                url: signedUrl,
                label: friendlyName
            }
        });
    } catch (err: any) {
        console.error('Error generating TOT zip:', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to generate zip' });
    }
});

export default router;
