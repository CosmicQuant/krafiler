/**
 * server.ts
 *
 * Express application entry point.
 * Run with: npm run dev
 */

import 'express-async-errors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
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
import clientFirestoreRoutes from './api/clients.firestore';
import employeeFirestoreRoutes from './api/employees.firestore';
import leaveFirestoreRoutes from './api/leave.firestore';
import loansFirestoreRoutes from './api/loans.firestore';
import attendanceFirestoreRoutes from './api/attendance.firestore';
import reportsFirestoreRoutes from './api/reports.firestore';
import emailFirestoreRoutes from './api/email.firestore';
import authFirestoreRoutes from './api/auth.firestore';
import portalFirestoreRoutes from './api/portal.firestore';
import payrollRunsFirestoreRoutes from './api/payroll-runs.firestore';
import departmentsFirestoreRoutes from './api/departments.firestore';
import documentsFirestoreRoutes from './api/documents.firestore';
import auditFirestoreRoutes from './api/audit.firestore';
import kpiFirestoreRoutes from './api/kpi.firestore';
import workScheduleFirestoreRoutes from './api/work-schedules.firestore';
import holidaysFirestoreRoutes from './api/holidays.firestore';
import pinoHttp from 'pino-http';
import { verifyAuth } from './middleware/verifyAuth';
import { serveReceipt } from './middleware/receipts';
import httpWorkerRoutes from './workers/httpWorker';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ─── Security Middleware ──────────────────────────────────────────────────────

app.use(pinoHttp({ logger }));
app.use(helmet());
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
    max: 10,
    message: {
        success: false,
        message: 'Too many requests. Please wait 15 minutes before trying again.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

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

// Protected API routes — Firestore only
app.use('/api/tax', verifyAuth, taxRoutes);
app.use('/api/payroll', verifyAuth, payrollFirestoreRoutes);
app.use('/api/clients', verifyAuth, clientFirestoreRoutes);
app.use('/api/clients', verifyAuth, employeeFirestoreRoutes);
app.use('/api/clients', verifyAuth, leaveFirestoreRoutes);
app.use('/api/clients', verifyAuth, loansFirestoreRoutes);
app.use('/api/clients', verifyAuth, attendanceFirestoreRoutes);
app.use('/api/clients', verifyAuth, reportsFirestoreRoutes);
app.use('/api/clients', verifyAuth, emailFirestoreRoutes);
app.use('/api/portal', verifyAuth, portalFirestoreRoutes);
app.use('/api/clients', verifyAuth, payrollRunsFirestoreRoutes);
app.use('/api/clients', verifyAuth, departmentsFirestoreRoutes);
app.use('/api/clients', verifyAuth, documentsFirestoreRoutes);
app.use('/api/clients', verifyAuth, auditFirestoreRoutes);
app.use('/api/clients', verifyAuth, kpiFirestoreRoutes);
app.use('/api/clients', verifyAuth, workScheduleFirestoreRoutes);
app.use('/api/clients', verifyAuth, holidaysFirestoreRoutes);

// Cloud Tasks worker endpoint
if (process.env.USE_CLOUD_TASKS === 'true') {
    app.use('/', httpWorkerRoutes);
}

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
    logger.info(`KRA Filing API running on http://localhost:${PORT}`);
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
