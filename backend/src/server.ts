/**
 * server.ts
 *
 * Express application entry point.
 * Run with: npm run dev
 */

import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
import rateLimit from 'express-rate-limit';
import taxRoutes from './api/tax.routes';
import payrollRoutes from './api/payroll.routes';
import clientRoutes from './api/clients.routes';
import { initDb } from './db/database';
import { logger } from './logger';
import pinoHttp from 'pino-http';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ─── Security Middleware ──────────────────────────────────────────────────────

// HTTP Request logging
app.use(pinoHttp({ logger }));

// Sets secure HTTP response headers (CSP, HSTS, X-Frame-Options, etc.)
app.use(helmet());

// CORS — restrict to the configured frontend origin only
app.use(
    cors({
        origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:3000',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    })
);

// ─── Rate Limiting ────────────────────────────────────────────────────────────

/**
 * Filing endpoint limiter: max 10 requests per IP per 15-minute window.
 * This is intentionally conservative — each request triggers a full KRA
 * automation run which is expensive and identifiable.
 */
const filingLimiter = rateLimit({
    windowMs: 15 * 60 * 1_000, // 15 minutes
    max: 10,
    message: {
        success: false,
        message: 'Too many requests. Please wait 15 minutes before trying again.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// ─── Body Parsing ─────────────────────────────────────────────────────────────

// Limit body size to prevent large-payload DoS attacks
app.use(express.json({ limit: '10kb' }));

// Serve receipts statically
app.use('/api/receipts', express.static(path.resolve(__dirname, '..', '..', 'receipts')));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Only submission requests should consume the expensive filing quota.
// Status polling must stay available while the frontend tracks an active job.
app.use('/api/tax/file-return', filingLimiter);
app.use('/api/tax/file-nil-return', filingLimiter);
app.use('/api/tax', taxRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/clients', clientRoutes);

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

initDb().then(() => {
    app.listen(PORT, () => {
        logger.info(`KRA Filing API running on http://localhost:${PORT}`);
        logger.info(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
    });
}).catch(err => {
    logger.error({ err }, 'Failed to init DB');
    process.exit(1);
});

export default app;
