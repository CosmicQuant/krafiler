/**
 * server.worker.ts
 *
 * Minimal Express server for the KRAFILER worker service.
 * Receives Pub/Sub push messages and runs Playwright automation.
 *
 * Routes:
 * - POST /process-job  (Pub/Sub push handler)
 * - GET  /health
 */

import dotenv from 'dotenv';
import path from 'path';

// Load env vars before any module that reads process.env at import time
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
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

import httpWorkerRoutes from './workers/httpWorker';
import pinoHttp from 'pino-http';

const app = express();
const PORT = parseInt(process.env.PORT ?? '8080', 10);

app.set('trust proxy', 1);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(pinoHttp({ logger }));
app.use(helmet());

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'krafiler-worker', timestamp: new Date().toISOString() });
});

// Pub/Sub push endpoint
app.use('/', httpWorkerRoutes);

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
        logger.error({ err }, 'Unhandled worker error');
        res.status(500).json({ message: 'An unexpected error occurred.' });
    }
);

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT);

server.on('listening', () => {
    logger.info(`KRAFILER Worker service running on http://localhost:${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
        logger.error({ port: PORT }, `Port ${PORT} is already in use — exiting`);
    } else {
        logger.error({ err }, 'Failed to start worker');
    }
    process.exit(1);
});

export default app;
