/**
 * server.ts
 *
 * Express application entry point.
 * Run with: npm run dev
 */

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import taxRoutes from './api/tax.routes';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ─── Security Middleware ──────────────────────────────────────────────────────

// Sets secure HTTP response headers (CSP, HSTS, X-Frame-Options, etc.)
app.use(helmet());

// CORS — restrict to the configured frontend origin only
app.use(
    cors({
        origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:3000',
        credentials: true,
        methods: ['GET', 'POST'],
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

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/tax', filingLimiter, taxRoutes);

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
        console.error('[Server] Unhandled error:', err);
        res.status(500).json({ message: 'An unexpected error occurred.' });
    }
);

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`[Server] KRA Filing API running on http://localhost:${PORT}`);
    console.log(`[Server] Environment: ${process.env.NODE_ENV ?? 'development'}`);
});

export default app;
