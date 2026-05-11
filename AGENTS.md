# AGENTS.md — KRAFILER

Compact guide for agents working in this repo. Skip anything that looks obvious from file names.

## Architecture

- **Monorepo** (`npm workspaces`): `frontend/` (React 18 + Vite) and `backend/` (Express 4 + TypeScript).
- **Runtime model**: Frontend → Express API → BullMQ on Redis → Playwright worker. The worker runs at `concurrency: 1` to avoid KRA rate limits.
- **Database**: SQLite (`backend/src/db/krafiler.sqlite`) managed via Kysely with file-based migrations in `backend/src/db/migrations/`.
- **Return types supported**: nil income tax, Monthly Rental Income (MRI), Turnover Tax (ToT), VAT (prepare + upload), PAYE (upload), NSSF, PRN-only generation.

## Entry Points

| Component | File | Start Command |
|---|---|---|
| Express API | `backend/src/server.ts` | `cd backend && npm run dev` |
| BullMQ Worker | `backend/src/workers/kraFilingWorker.ts` | `cd backend && npm run worker` |
| React Frontend | `frontend/src/main.tsx` | `cd frontend && npm run dev` |
| Redis | — | `redis-server` (or `./redis/redis-server.exe ./redis/redis.windows.conf` on Windows bundle) |

Root-level shortcuts exist but just delegate:
- `npm run dev:backend` → `npm --prefix backend run dev`
- `npm run dev:frontend` → `npm --prefix frontend run dev`
- `npm run worker` → `npm --prefix backend run worker`

## Critical Setup

1. `npm install` in both `frontend/` and `backend/`.
2. `cd backend && npx playwright install chromium`
3. `cp backend/.env.example backend/.env` and fill in `GEMINI_API_KEY` and Redis credentials.
4. Start Redis, then the API, worker, and frontend (four terminals).

Frontend dev server runs on `http://localhost:3000` and proxies `/api` to the backend on `http://localhost:3001`.

## Type Checking

- Backend: `cd backend && npx tsc --noEmit`
- Frontend: `cd frontend && npx tsc --noEmit`
- No tests, no lint config, no formatter config exist in this repo.

## Database

- SQLite file lives at `backend/src/db/krafiler.sqlite`.
- Migrations run automatically on API startup (`initDb()` in `server.ts`).
- Kysely schema is in `backend/src/db/schema.ts`; migrations are numbered `001_...ts`, `002_...ts`, etc.
- A legacy `sqlite`/`sqlite3` connection (`openDb()`) is still used in some routes; prefer Kysely for new code.

## Environment Variables (Backend)

Key vars from `.env.example`:
- `GEMINI_API_KEY` / `GEMINI_MODEL` — Required. Used for KRA captcha solving (arithmetic image → answer).
- `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` — BullMQ backing store.
- `ENCRYPTION_SECRET` / `ENCRYPTION_SALT` — Still referenced by `encryption.ts` but **password encryption is currently disabled** for speed (plaintext `kraPassword` is passed through the job payload).
- `PLAYWRIGHT_HEADLESS=false` — Set to `true` only if you want headless mode.
- `PORT=3001`, `ALLOWED_ORIGIN=http://localhost:3000`

## Worker Behavior & Quirks

- **Stealth**: `puppeteer-extra-plugin-stealth` is applied once at module load in the worker.
- **Captcha**: Solved exclusively via Gemini Vision API. Tesseract and manual entry fallbacks were removed.
- **Password changes**: KRA forced password resets are handled automatically; the new password is surfaced in job status (`credentialUpdate`).
- **Receipts**: Stored locally under `receipts/<jobId>/receipt.pdf` and served statically via `/api/receipts/...`.
- **Job queue settings**: `attempts: 1`, no retries. KRA validation/credential errors should fail immediately so the user can correct and resubmit.
- **Browser profile reuse**: `KRA_BROWSER_PROFILE_DIR` can be set to reuse a profile across jobs; cookies and storage are cleared before each run.

## API Routes

- `POST /api/tax/file-return` (and legacy `/api/tax/file-nil-return`) — Enqueue filing job. Rate limited: 10 req / 15 min per IP.
- `GET /api/tax/filing-status/:jobId` — Poll job status/progress.
- `POST /api/tax/filing-status/:jobId/cancel` — Request job cancellation.
- `POST /api/tax/file-nssf-return` — NSSF filing (reads credentials from uploaded Master CSV).
- `POST /api/tax/generate-tot-zip` — Generate ToT ZIP package without filing.
- `POST /api/payroll/generate-unified` — Payroll processing.
- `GET|POST|PUT|DELETE /api/clients/...` — Client CRUD and Master CSV upload.

## Worker Services

Major services under `backend/src/workers/services/`:
- `LoginService.ts` — Portal login, captcha, password reset, mobile verification.
- `NilReturnService.ts`, `MriFilingService.ts`, `TotFilingService.ts`, `VatFilingService.ts`, `PayeFilingService.ts` — Per-return-type filing logic.
- `NssfService.ts` — NSSF portal automation.
- `PrnService.ts` — PRN generation.
- `BrowserService.ts`, `NavigationService.ts`, `ReceiptService.ts` — Shared browser/navigation/receipt helpers.

## Important Constraints

- **Do not add retries to BullMQ jobs** — KRA errors (wrong PIN, wrong password, invalid captcha) must fail fast and surface to the user.
- **Do not log passwords** — Even though encryption is disabled, plaintext passwords must never be logged or persisted outside the job payload.
- **Worker concurrency must stay at 1** — Increasing it risks KRA IP bans.
- **No CI, no tests, no lint rules** — Verify by manual type-checking (`tsc --noEmit`) and local worker runs.
