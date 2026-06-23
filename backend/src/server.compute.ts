/**
 * server.compute.ts
 *
 * Compute API for Cloud Run.
 * Mounts all Firestore-backed REST routes the frontend still calls,
 * plus compute-heavy endpoints (tax, payroll, auth) that need secrets.
 */

import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import path from 'path';

// Load env vars BEFORE any module that reads process.env at import time
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import 'express-async-errors';
import helmet from 'helmet';
import cors from 'cors';
import { logger } from './logger';

// ─── Crash Handlers ────────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled Promise Rejection — exiting');
    process.exit(1);
});

process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught Exception — exiting');
    process.exit(1);
});

process.on('SIGTERM', () => {
    logger.info('SIGTERM received — shutting down');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received — shutting down');
    process.exit(0);
});

import rateLimit from 'express-rate-limit';
import taxRoutes from './api/tax.routes';
import payrollFirestoreRoutes from './api/payroll.firestore';
import payrollRunsFirestoreRoutes from './api/payroll-runs.firestore';
import emailFirestoreRoutes from './api/email.firestore';
import authFirestoreRoutes from './api/auth.firestore';
import clientFirestoreRoutes from './api/clients.firestore';
import employeeFirestoreRoutes from './api/employees.firestore';
import leaveFirestoreRoutes from './api/leave.firestore';
import loansFirestoreRoutes from './api/loans.firestore';
import attendanceFirestoreRoutes from './api/attendance.firestore';
import reportsFirestoreRoutes from './api/reports.firestore';
import departmentsFirestoreRoutes from './api/departments.firestore';
import documentsFirestoreRoutes from './api/documents.firestore';
import auditFirestoreRoutes from './api/audit.firestore';
import kpiFirestoreRoutes from './api/kpi.firestore';
import workScheduleFirestoreRoutes from './api/work-schedules.firestore';
import holidaysFirestoreRoutes from './api/holidays.firestore';
import portalFirestoreRoutes from './api/portal.firestore';
import subscriptionRoutes from './api/subscriptions.firestore';
import webhooksRoutes from './api/webhooks.firestore';
import pinoHttp from 'pino-http';
import { verifyAuth } from './middleware/verifyAuth';
import { serveReceipt } from './middleware/receipts';
import { checkSubscriptionLimits } from './middleware/subscription';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// Trust proxy headers (required for Cloud Run / Firebase Hosting)
app.set('trust proxy', 1);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(pinoHttp({ logger }));
app.use(helmet({ crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } }));
app.use(
    cors({
        origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:3000',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    })
);

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const filingLimiter = rateLimit({
    windowMs: 15 * 60 * 1_000,
    max: 100,
    message: {
        success: false,
        message: 'Too many requests. Please wait 15 minutes before trying again.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
// ─── Public Webhooks ──────────────────────────────────────────────────────────
// These routes need the raw request body for signature verification, so they are
// mounted before the global JSON parser.

app.use(
    '/api/webhooks/resend',
    express.raw({
        type: 'application/json',
        limit: '1mb',
        verify: (req: Request, _res: Response, buf: Buffer) => {
            (req as any).rawBody = buf.toString('utf8');
        },
    }),
    webhooksRoutes
);

// ─── Body Parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '5mb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/tax/file-return', filingLimiter);
app.use('/api/tax/file-nil-return', filingLimiter);

// Public routes
app.use('/api/auth', authFirestoreRoutes);
app.use('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth-protected receipt serving
app.use('/api/receipts/*', verifyAuth, serveReceipt);

// Public Paystack webhook
app.use('/api/subscriptions/webhook', subscriptionRoutes);

// Protected API routes
app.use('/api/tax', verifyAuth, checkSubscriptionLimits, taxRoutes);
app.use('/api/payroll', verifyAuth, checkSubscriptionLimits, payrollFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, clientFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, employeeFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, leaveFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, loansFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, attendanceFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, reportsFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, emailFirestoreRoutes);
app.use('/api/portal', verifyAuth, checkSubscriptionLimits, portalFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, payrollRunsFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, departmentsFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, documentsFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, auditFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, kpiFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, workScheduleFirestoreRoutes);
app.use('/api/clients', verifyAuth, checkSubscriptionLimits, holidaysFirestoreRoutes);

// Subscription routes (protected, except webhook mounted above)
app.use('/api/subscriptions', verifyAuth, subscriptionRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ message: 'Route not found.' });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use(
    (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
    ) => {
        logger.error({ err }, 'Unhandled server error');
        res.status(500).json({ message: 'An unexpected error occurred.' });
    }
);

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT);

server.on('listening', () => {
    logger.info(`KRAFILER Compute API running on http://localhost:${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
        logger.error({ port: PORT }, `Port ${PORT} is already in use — exiting`);
    } else {
        logger.error({ err }, 'Failed to start server');
    }
    process.exit(1);
});

export default app;
