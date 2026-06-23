# AGENTS.md — KRAFILER

Compact guide for agents working in this repo. Every line answers "would I miss this without help?".

## Architecture

- **Monorepo** (`npm workspaces`): `frontend/` (React 18 + Vite + Tailwind) and `backend/` (Express 4 + TypeScript).
- **Two subsystems**: (1) **Practice Management** — HR/payroll/attendance/leave/loans/documents; (2) **KRA Filing** — Frontend → Express API → Pub/Sub → Playwright worker.
- **Primary database is Firestore**, not SQLite. All practice-management route files are `*.firestore.ts` and read/write Firestore collections. SQLite files under `backend/src/db/` are legacy artifacts.
- **Authentication is Firebase Auth** (Google sign-in) plus a dev bypass token.
- **Queue is Cloud Pub/Sub**, not Redis/BullMQ. The worker is an HTTP server that receives Pub/Sub push messages.
- **Hardcoded GCP project**: backend (`backend/src/lib/firebaseAdmin.ts`) and frontend (`frontend/src/lib/firebase.ts`) both point to `taxpulse-498006` by default.
- **Return types supported**: `income_tax_resident_individual`, `income_tax_non_resident_individual`, `monthly_rental_income` (MRI), `income_tax_company`, `turnover_tax` (ToT), `vat`, `paye`, `nssf`, `excise_duty`. (`nita` and `affordable_housing` are generated as PRNs after PAYE filing, not filed standalone.)
- **VAT has two modes**: `prepareVatOnly` (download auto-populated data & generate ZIP without filing) and `upload` (file the prepared ZIP).
- **README.md and DEPLOYMENT.md are stale** — they describe an older Redis/BullMQ + SQLite architecture. Trust executable sources (`package.json`, `server*.ts`, route files, `deploy.sh`) over those docs.

## Backend Entry Points

| Component | File | Default Port | Purpose |
|---|---|---|---|
| Full API | `backend/src/server.ts` | 3001 | Local dev; mounts every route including tax filing. |
| Compute API | `backend/src/server.compute.ts` | 3001 | Cloud Run entrypoint; same routes as `server.ts`. |
| Worker service | `backend/src/server.worker.ts` | 8080 | Receives Pub/Sub push POSTs at `/process-job`. |

Start commands:
- Full API dev: `cd backend && npm run dev`
- Compute API (prod): `cd backend && npm run build && npm run start:compute`
- Worker service (prod): `cd backend && npm run build && npm run start:worker-service`
- Frontend dev: `cd frontend && npm run dev`
- Root shortcuts: `npm run dev:backend`, `npm run dev:frontend`

Utility scripts:
- `cd backend && npm run tot` — one-off ToT filing script.
- `cd backend && npm run generate:tot` — ToT ZIP generator.

## Critical Setup

1. `npm install` in both `frontend/` and `backend/`.
2. `cd backend && npx playwright install chromium`
3. `cp backend/.env.example backend/.env` — note that `.env.example` is stale/incomplete; you must add `GEMMA4_API_KEY` (captcha) and `GOOGLE_APPLICATION_CREDENTIALS` / `CLOUD_STORAGE_BUCKET` if not using ADC defaults.
4. Authenticate to GCP for Firestore/Pub/Sub: `gcloud auth application-default login` (or set `GOOGLE_APPLICATION_CREDENTIALS`).
5. Set required vars in `backend/.env`: `GEMMA4_API_KEY` (captcha solving — the worker does not use `GEMINI_API_KEY`, even though `.env.example` still references it), `JWT_SECRET`, and `SMTP_*` if emailing payslips.
6. For local dev without Firebase Auth, set `DEV_BYPASS_AUTH=true` in `backend/.env` and `VITE_DEV_BYPASS_AUTH=true` in `frontend/.env`.
7. Start API → Worker → Frontend (three terminals). The frontend dev server runs on `http://localhost:3000` and proxies `/api` → `http://localhost:3001`.

> End-to-end KRA filing locally requires the worker reachable at `localhost:8080/process-job` so Pub/Sub can push to it. In GCP this is automatic via `deploy.sh`; locally you may need to point a Pub/Sub push subscription at your local tunnel or invoke `/process-job` manually with the `jobId`.
> 
> The `filing-jobs` Pub/Sub topic must exist before the API publishes; `ensureTopicExists()` is defined but currently unused. `deploy.sh` creates it, but for local/dev projects create it manually if needed.

## Type Checking, Tests & Lint

| Command | Package | Notes |
|---|---|---|
| `npm run test` | backend | `tsc && node --test dist/services/payrollEngine.test.js`. Passes. |
| `npx tsc --noEmit` | backend | Required safety net; dev server uses `ts-node-dev --transpile-only`, so runtime errors can slip through. |
| `npx tsc --noEmit` | frontend | `noUnusedLocals` / `noUnusedParameters` enabled — stricter than backend. |
| `npx eslint .` | either | ESLint 9 flat configs exist in both packages but are not wired to npm scripts. |

- `.prettierrc` exists at repo root (4-space tabs, single quotes, 120 width) but is not wired to an npm script.
- `backend/tsconfig.json` excludes `src/db/migrations`, `src/db/schema.ts`, `src/db/kysely.ts`, `src/scripts/migrateSqliteToFirestore.ts`, and `src/services/complianceFileGenerator.ts`.

## Database & Auth

- **Firestore**: `backend/src/lib/firebaseAdmin.ts` initializes Firebase Admin with Application Default Credentials. Set `GOOGLE_APPLICATION_CREDENTIALS` for explicit service-account keys, or use `gcloud auth application-default login` for local dev.
- **No migrations to run** — Firestore is schemaless. Legacy SQLite/Kysely files are gone or excluded from compilation.
- **Dev bypass**: `DEV_BYPASS_AUTH=true` lets the frontend send `Authorization: Bearer dev` and the backend treat it as `uid=dev-user` with an active `firm` plan.
- **Subscription limits**: `checkSubscriptionLimits` middleware reads the `users/{uid}` doc and enforces client/filing caps from `PLAN_CONFIG`. It auto-creates a default `starter` user doc if missing.
- **Auth context**: frontend Firebase client config is hardcoded in `frontend/src/lib/firebase.ts`; `frontend/src/services/api.ts` attaches the Firebase ID token (or `dev` token in dev mode) to every request.

## Environment Variables

Key backend vars from `.env.example` and code:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs employee-portal JWT tokens. |
| `GEMMA4_API_KEY` / `GEMMA4_MODEL` | Solves KRA arithmetic captcha via Google's generativelanguage API (default model `gemma-4-31b-it`). `GEMINI_API_KEY` in `.env.example` is stale and unused. |
| `USE_PUBSUB` | Enable Pub/Sub queueing. Current code is Pub/Sub-only. |
| `PUBSUB_TOPIC` | Topic name for filing jobs (default: `filing-jobs`). |
| `PORT` | API default `3001`; worker service default `8080`. |
| `ALLOWED_ORIGIN` | CORS origin, default `http://localhost:3000`. |
| `DEV_BYPASS_AUTH` | `true` for local dev only; never in production. |
| `PLAYWRIGHT_HEADLESS` | `false` shows the browser window (default in Dockerfile). |
| `PLAYWRIGHT_SLOW_MO` | Millisecond delay between Playwright actions (debug). |
| `KRA_BROWSER_CHANNEL` | `chrome` or `msedge`. |
| `KRA_BROWSER_EXECUTABLE_PATH` | Exact browser path. |
| `KRA_REUSE_BROWSER_PROFILE` | Persist profile across jobs. |
| `KRA_BROWSER_PROFILE_DIR` | Profile directory path. |
| `KRA_OTP_CODE` | Pre-set OTP for mobile verification. |
| `KRA_DEBUG_ARTIFACTS` | Dump login page debug info. |
| `TEMP_DIR` | Temp dir for receipts/captchas (default `/tmp` or `C:\Temp`). |
| `RECEIPTS_DIR` | Receipt storage directory (default `receipts/` relative to project root). |
| `CLOUD_STORAGE_BUCKET` / `FIREBASE_PROJECT_ID` / `GOOGLE_APPLICATION_CREDENTIALS` | GCP/Firebase wiring. Cloud Storage is actively used for documents, receipts, and PRNs. |
| `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` / `RESEND_FROM_EMAIL` | Resend email API for payslips/P9s; webhook secret verifies Resend webhook signatures. |
| `SMTP_*` / `EMAIL_FROM` | Legacy SMTP fallback for payslip/P9 mass emailing. |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` | Paystack subscription integration. |
| `AWS_*` / `S3_BUCKET_NAME` / `WEBHOOK_URL` / `WEBHOOK_SECRET` | Defined but not wired; use Cloud Storage and Firestore instead. |

## Worker Behavior & Quirks

- **Concurrency**: Worker Cloud Run is deployed with `--concurrency 1 --max-instances 1` to avoid KRA rate limits.
- **No retries**: Job `attempts` are 1; KRA validation/credential errors surface immediately.
- **Always returns HTTP 200**: `/process-job` acks every successfully parsed Pub/Sub message, even if the job itself fails. Only malformed messages or missing jobs return non-2xx.
- **Dedup**: API rejects identical pending (waiting/active) filing jobs with 409 and the existing `jobId`.
- **Captcha**: Solved via Gemma 4 Vision using `GEMMA4_API_KEY`/`GEMMA4_MODEL`; Tesseract code exists but is unused.
- **Password resets**: KRA forced password changes are handled automatically; the new password is returned in `credentialUpdate`.
- **OTP**: Provide via payload `otpCode` or `KRA_OTP_CODE` env var; no SMS gateway integration.
- **Browser launch**: tries `KRA_BROWSER_EXECUTABLE_PATH` → Windows system Chrome/Edge → Playwright channel → bundled Chromium.
- **Receipts**: stored locally under `receipts/<jobId>/receipt.pdf` and uploaded to Cloud Storage; `/api/receipts/*` serves local first, then streams from GCS (auth-protected).
- **Cancellation**: `POST /api/tax/filing-status/:jobId/cancel`; worker polls `cancelRequestedAt` at checkpoints.
- **PAYE/VAT uploads**: artifacts resolved from URLs (downloaded to `TEMP_DIR`) or local filesystem paths via `resolveUploadArtifactPath()`.

## Worker Services

Located at `backend/src/workers/services/`:
- `LoginService.ts`, `NilReturnService.ts` — Defined but **dead code** (never instantiated); login and nil returns are handled inline in the worker.
- `MriFilingService.ts`, `TotFilingService.ts`, `VatFilingService.ts`, `PayeFilingService.ts` — Per-return-type filing.
- `NssfService.ts` — NSSF portal automation.
- `PrnService.ts` — Payment Registration Number (PRN) generation.
- `BrowserService.ts`, `NavigationService.ts`, `ReceiptService.ts` — Shared helpers.

## Email (Resend)

- **Provider**: payslips and P9s are sent via the Resend API (`backend/src/services/emailService.ts`). Resend is primary; legacy SMTP is a fallback if `RESEND_API_KEY` is unset.
- **Webhook endpoint**: `POST /api/webhooks/resend` receives Resend events (`email.sent`, `email.delivered`, `email.opened`, etc.). It is mounted **before** the global JSON body parser so the raw body is available for signature verification.
- **Signature verification**: uses `resend.webhooks.verify()` with `RESEND_WEBHOOK_SECRET`. In dev, if the secret is unset, the endpoint logs a warning and skips verification.
- **Event storage**: verified events are stored in the `events` subcollection under `emailHistory/{id}`. The `emailHistory` doc status is updated to `sent`, `delivered`, `opened`, `bounced`, etc.
- **Frontend UI**: the email history table in `Step7ComplianceOutput.tsx` has expandable rows that show a timeline of delivery events via `EmailEventTimeline`.

## API Routes

Routes are mounted in `backend/src/server.ts:101-138` and `backend/src/server.compute.ts:100-136`.

### `/api/tax` — KRA Filing (`backend/src/api/tax.routes.ts`)
- `POST /api/tax/file-return` (+ legacy `POST /api/tax/file-nil-return`) — enqueue filing job. Rate limited: 10 req / 15 min per IP (`server.ts`); 100 req / 15 min (`server.compute.ts`).
- `GET /api/tax/filing-status/:jobId` — poll status/progress/stepLogs.
- `POST /api/tax/filing-status/:jobId/cancel` — request cancellation.
- `POST /api/tax/file-nssf-return` — NSSF filing.
- `POST /api/tax/generate-tot-zip` — generate ToT ZIP without filing.

### Practice Management routes (`backend/src/api/*.firestore.ts`)
All mounted under `/api/clients` unless noted:
- `clients.firestore.ts` — clients and Master CSV upload.
- `employees.firestore.ts` — employees.
- `leave.firestore.ts` — leave.
- `loans.firestore.ts` — loans.
- `attendance.firestore.ts` — attendance.
- `reports.firestore.ts` — reports.
- `email.firestore.ts` — mass emailing.
- `payroll-runs.firestore.ts` — payroll run lifecycle.
- `payroll.firestore.ts` — payroll processing.
- `departments.firestore.ts` — departments.
- `documents.firestore.ts` — documents.
- `audit.firestore.ts` — audit log.
- `kpi.firestore.ts` — KPIs.
- `work-schedules.firestore.ts` — work schedules.
- `holidays.firestore.ts` — holidays.
- `subscriptions.firestore.ts` — Paystack subscriptions and `PLAN_CONFIG`.
- `auth.firestore.ts` — employee portal JWT login (mounted at `/api/auth`).
- `portal.firestore.ts` — employee self-service (mounted at `/api/portal`).

### Other
- `GET /health` — health check.
- `GET /api/receipts/*` — auth-protected receipt download.
- `POST /api/subscriptions/webhook` — public Paystack webhook.

## Frontend Architecture

- **Stack**: React 18, Vite, Tailwind CSS, React Router v6, react-hook-form + zod, TanStack Query, Zustand, framer-motion, lucide-react.
- **Routes** (`frontend/src/App.tsx`): `/` → landing, `/login` → Firebase login, `/dashboard/*` → protected dashboard, `/subscription` → plan page. Legacy `/accountant`, `/auditor`, `/payroll`, `/kra` redirect to `/dashboard`.
- **API client**: `frontend/src/services/api.ts` — fetch-based wrapper that injects the Firebase ID token (or `dev` token).
- **State**: `frontend/src/store/uiStore.ts` — Zustand UI store.

## Deployment

- `deploy.sh` builds and deploys: Cloud Build → Cloud Run (`krafiler-api` + `krafiler-worker`) → Firebase Hosting, plus Pub/Sub topic/subscription.
- Two Dockerfiles: `backend/Dockerfile` (worker, includes Playwright + xvfb) and `backend/Dockerfile.compute` (API, no browser).
- `frontend/firebase.json` rewrites `/api/**` to the `krafiler-api` Cloud Run service in `us-central1`.
- `deploy.sh` correctly reminds you to set `GEMMA4_API_KEY` on the worker after deploy.

## Payroll Engine Gotchas

- **Work schedule proration**: `computePayrollEntry` accepts a work-schedule config and holiday list. `getScheduledWorkDays()` (excludes holidays) drives proration; `getScheduledDaysIncludingHolidays()` (includes holidays) drives rate calculations. `getTotalScheduledHours()` sums per-day hours for the month.
- **Hourly rate rounding**: rounded to 4 decimal places.
- **Dynamic adjustments**: allowances increase benefits/gross, non-statutory deductions increase `otherDeductions`.
- **Ledger-based loans**: `loan_transactions` record deductions; `remainingInstallments` only mutates on finalize, not on draft generation.
- **Finalize/rollback**: `lockedAt` on the run/entries tracks lock state. Finalize creates loan transactions and warns (but does not block) if net pay drops below 1/3 of gross pay.
- **Payslip PDF**: reads stored `attendanceDeduction`, `unpaidLeaveDeduction`, and `basicPay` from the payroll entry; it does not recompute rates on the fly.

## Important Constraints

- **Do not add retries** to filing jobs — KRA errors must fail fast.
- **Do not log passwords** — `kraPassword` is plaintext in job payloads; never log or persist it outside the payload.
- **Worker concurrency must stay at 1** — increasing it risks KRA IP bans.
- **No CI/GitHub Actions** — `.github/` does not exist. Verify manually with `tsc --noEmit` and `npm run test`.
- **Duplicate filing guard**: modifying filing parameters changes the dedup key; be aware when editing enqueue logic.
- **Search policy**: `AGENTS-node_modules.md` prohibits reading/traversing `node_modules/` without explicit user instruction.
- **`receipts/` is git-ignored**.
