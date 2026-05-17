# AGENTS.md — KRAFILER

Compact guide for agents working in this repo. Every line answers "would I miss this without help?".

## Architecture

- **Monorepo** (`npm workspaces`): `frontend/` (React 18 + Vite + Tailwind) and `backend/` (Express 4 + TypeScript).
- **Two subsystems**: (1) **Practice Management** — conventional CRUD (HR, payroll, attendance, leave, loans, documents); (2) **KRA Filing** — Frontend → Express API → BullMQ on Redis → Playwright worker. Worker runs at `concurrency: 1` to avoid KRA rate limits.
- **Database**: SQLite (`backend/src/db/krafiler.sqlite`) via Kysely (preferred) + `better-sqlite3`. Legacy `sqlite3`/`sqlite` connection (`openDb()`) still used in some routes.
- **Frontend stack**: Tailwind CSS, React Router v7, react-hook-form + zod, TanStack Query, Zustand, framer-motion, lucide-react.
- **Return types supported**: `income_tax_resident_individual`, `income_tax_non_resident_individual`, `monthly_rental_income` (MRI), `income_tax_company`, `turnover_tax` (ToT), `vat`, `paye`, `nssf`.
- **VAT has two modes**: `prepareVatOnly` (download auto-populated data & generate ZIP without filing) and `upload` (file the prepared ZIP).

## Entry Points

| Component | File | Start Command |
|---|---|---|
| Express API | `backend/src/server.ts` | `cd backend && npm run dev` |
| BullMQ Worker | `backend/src/workers/kraFilingWorker.ts` | `cd backend && npm run worker` |
| React Frontend | `frontend/src/main.tsx` | `cd frontend && npm run dev` |
| Redis | — | `redis-server` (or `./redis/redis-server.exe ./redis/redis.windows.conf`) |

Root-level shortcuts:
- `npm run dev:backend` / `npm run dev:frontend` / `npm run worker`

Utility scripts (backend):
- `npm run tot` — one-off ToT filing script (`src/scripts/file-kra-tot-return.ts`)
- `npm run generate:tot` — ToT ZIP generator (`src/scripts/kra-tot-generator.ts`)
- `npm run start` / `npm run start:worker` / `npm run start:tot` — production runs from compiled `dist/`

## Critical Setup

1. `npm install` in both `frontend/` and `backend/`.
2. `cd backend && npx playwright install chromium`
3. `cp backend/.env.example backend/.env` — fill `GEMINI_API_KEY`, Redis credentials, `JWT_SECRET` (employee portal), and `SMTP_*` for payslip emailing.
4. Start Redis → API → Worker → Frontend (four terminals).

Frontend dev server: `http://localhost:3000`, proxies `/api` → backend `http://localhost:3001`.

## Type Checking

- Backend: `cd backend && npx tsc --noEmit`
- Frontend: `cd frontend && npx tsc --noEmit` (note: frontend tsconfig has `noUnusedLocals`, `noUnusedParameters` — expect extra strictness)
- No tests, no lint config, no formatter config exist.

## Database

- SQLite file at `backend/src/db/krafiler.sqlite`.
- Migrations auto-run on API startup (`initDb()` in `server.ts`). All 13 migrations in `backend/src/db/migrations/` run via Kysely's `migrateToLatest()`.
- Kysely schema: `backend/src/db/schema.ts`. Prefer Kysely for new code; legacy `sqlite3`/`sqlite` still used in some routes and the worker.
- Seed data: on first run, a default client (`P052262687K` — Golden Karafuu Investment Limited) is inserted and the workbook template is copied to `frontend/public/clients/`.

## Environment Variables (Backend)

From `.env.example`, key groups:

| Variable | Purpose |
|---|---|---|
| `JWT_SECRET` | Secret for signing employee portal JWT tokens |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Captcha solving via Gemini Vision API |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | BullMQ backing store |
| `PORT` / `ALLOWED_ORIGIN` | Express server port (default 3001) and CORS origin (default http://localhost:3000) |
| `ENCRYPTION_SECRET` / `ENCRYPTION_SALT` | Referenced by `encryption.ts` — **currently disabled** for speed (plaintext `kraPassword` passes through payload) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | SMTP credentials for payslip/P9 emailing (leave unset for dev JSON transport) |
| `PLAYWRIGHT_HEADLESS=false` | `true` for headless mode |
| `PLAYWRIGHT_SLOW_MO=0` | Millisecond delay between Playwright actions (debugging) |
| `KRA_BROWSER_CHANNEL=chrome` | Browser channel: `chrome` or `msedge` |
| `KRA_BROWSER_EXECUTABLE_PATH` | Exact path to system browser |
| `KRA_REUSE_BROWSER_PROFILE=true` | Persist browser profile across jobs (cookies cleared each run) |
| `KRA_BROWSER_PROFILE_DIR` | Profile directory path |
| `KRA_OTP_CODE` | Pre-set OTP for mobile verification (bypasses SMS fetch) |
| `KRA_DEBUG_ARTIFACTS=false` | Dump login page elements, screenshots, nav metadata to console |
| `TEMP_DIR` | Temporary directory for receipts/captchas (default: `/tmp` or `C:\Temp`) |
| `AWS_*` / `S3_BUCKET_NAME` | Defined in `.env.example`, **not wired** — receipts stay local |
| `WEBHOOK_URL` / `WEBHOOK_SECRET` | Defined, **not wired** — notification is a mock log |

## Worker Behavior & Quirks

- **Stealth**: `puppeteer-extra-plugin-stealth` applied once at module load.
- **Captcha**: Solved via Gemini Vision API. Tesseract fallback function exists but is dead code — only Gemini is called in the main login flow.
- **Password changes**: KRA forced password resets handled automatically; new password surfaced in job status (`credentialUpdate`).
- **Mobile verification**: Worker waits for OTP — provide via `otpCode` in payload or `KRA_OTP_CODE` env var. No SMS gateway integration exists.
- **Browser launch strategy**: tries `KRA_BROWSER_EXECUTABLE_PATH` → Windows system browsers (Chrome/Edge) → Playwright channel → bundled Chromium.
- **Job dedup**: API checks for pending (waiting/active/delayed) jobs with identical parameters before enqueuing — returns 409 with existing `jobId`.
- **Receipts**: Stored locally under `receipts/<jobId>/receipt.pdf`, served via `/api/receipts/...`.
- **Job queue settings**: `attempts: 1`, no retries. KRA validation/credential errors surface immediately.
- **Cancellation**: Jobs can be cancelled mid-execution via `POST /api/tax/filing-status/:jobId/cancel`. Worker polls for `cancelRequestedAt` at checkpoints.
- **PAYE/VAT**: Upload artifacts are resolved from URLs (downloaded to `TEMP_DIR`) or local filesystem paths — see `resolveUploadArtifactPath()`.

## API Routes

Routes are mounted in `backend/src/server.ts:87-104`:

### `/api/tax` — KRA Filing (`tax.routes.ts`)
- `POST /api/tax/file-return` (+ legacy `/api/tax/file-nil-return`) — Enqueue filing job. Rate limited: 10 req / 15 min per IP.
- `GET /api/tax/filing-status/:jobId` — Poll job status/progress/stepLogs.
- `POST /api/tax/filing-status/:jobId/cancel` — Request job cancellation (graceful checkpoint-based).
- `POST /api/tax/file-nssf-return` — NSSF filing (reads credentials from uploaded Master CSV rows 3-4).
- `POST /api/tax/generate-tot-zip` — Generate ToT ZIP package without filing.

### `/api/payroll` — Payroll Processing (`payroll.routes.ts`)
- `POST /api/payroll/generate-unified` — Payroll processing.

### `/api/clients` — Practice Management
All mounted under `/api/clients`:
- `clients.routes.ts` — Client CRUD and Master CSV upload.
- `employees.routes.ts` — Employee management.
- `leave.routes.ts` — Leave requests and approvals.
- `loans.routes.ts` — Loan management.
- `attendance.routes.ts` — Attendance tracking.
- `reports.routes.ts` — Reports.
- `email.routes.ts` — Email sending (payslips, P9s).
- `payroll-runs.routes.ts` — Payroll run lifecycle.
- `departments.routes.ts` — Department management.
- `documents.routes.ts` — Document upload/storage.
- `audit.routes.ts` — Audit log queries.
- `kpi.routes.ts` — KPI tracking.

### `/api/auth` — Authentication (`auth.routes.ts`)
- Employee portal login (JWT-based).

### `/api/portal` — Employee Portal (`portal.routes.ts`)
- Employee self-service endpoints (payslips, P9s, leave requests).

### Other
- `GET /health` — Health check.

## Backend Services (non-worker)

Located at `backend/src/services/`:
- `payrollEngine.ts` — Core payroll computation logic.
- `emailService.ts` — SMTP email dispatch for payslips/P9s.
- `auditService.ts` — Audit trail recording (used across routes).

## Frontend Architecture

- **Router**: `App.tsx` defines routes: `/` → PracticeLandingPage, `/dashboard` → PracticeDashboard (catch-all for all modules).
- **API client**: `services/api.ts` — Axios-based REST client.
- **State**: `store/uiStore.ts` — Zustand store for UI state.
- **Hooks**: `useClients.ts`, `useFilingActions.ts`, `useJobPolling.ts`, `useClientModal.ts` — TanStack Query wrappers in `hooks/`.

## Worker Services

Located at `backend/src/workers/services/`:
- `LoginService.ts` — Defined but **dead code** (never instantiated); login+captcha is inline in the worker.
- `NilReturnService.ts` — Defined but **dead code** (never instantiated); nil returns are handled inline.
- `MriFilingService.ts`, `TotFilingService.ts`, `VatFilingService.ts`, `PayeFilingService.ts` — Per-return-type filing.
- `NssfService.ts` — NSSF portal automation.
- `PrnService.ts` — Payment Registration Number (PRN) generation.
- `BrowserService.ts`, `NavigationService.ts`, `ReceiptService.ts` — Shared helpers.

## Important Constraints

- **Do not add retries to BullMQ jobs** — KRA errors must fail fast and surface to the user.
- **Do not log passwords** — plaintext `kraPassword` exists in job payloads; never log it or persist outside the payload.
- **Worker concurrency must stay at 1** — increasing it risks KRA IP bans.
- **No CI, no tests, no lint rules** — verify by manual type-checking (`tsc --noEmit`) and local worker runs.
- **Duplicate filing guard**: the API rejects identical pending jobs — an agent modifying filing parameters should be aware of the dedup key.
