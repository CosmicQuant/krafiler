# KRA iTax Return Filing Module

End-to-end automation for filing KRA nil returns and Monthly Rental Income returns via the iTax portal.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  React Frontend (Vite + Tailwind)                               │
│  KraNilReturnForm  ──POST /api/tax/file-nil-return──►           │
│  Return picker + job status polling                             │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ 202 Accepted + jobId
┌──────────────────────────────────▼──────────────────────────────┐
│  Express API (Node.js)                                          │
│  • Validates input          • Encrypts password (AES-256-GCM)   │
│  • Enqueues FilingJob ──────────────────────────────────────►   │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ BullMQ / Redis
┌──────────────────────────────────▼──────────────────────────────┐
│  BullMQ Worker (concurrency: 1)                                 │
│  • Playwright (stealth mode) automates KRA iTax portal          │
│  • Surfaces blocking KRA warning dialogs as failedReason        │
│  • Solves arithmetic captcha via Gemini vision                  │
│  • Handles forced KRA password changes automatically            │
│  • Downloads PDF receipt  ────────────────────────────────────► │
│  • Stores locally  •  Notifies user  •  Updates job status      │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
krafiler/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   └── tax.routes.ts          # Submission + job status routes
│   │   ├── queues/
│   │   │   └── kraFilingQueue.ts      # BullMQ queue + Redis connection
│   │   ├── types/
│   │   │   └── index.ts               # Shared TypeScript types
│   │   ├── utils/
│   │   │   ├── encryption.ts          # AES-256-GCM encrypt/decrypt
│   │   │   ├── storage.ts             # Local receipt storage helpers
│   │   │   └── notifications.ts       # Notification dispatcher (currently mock logging)
│   │   ├── workers/
│   │   │   └── kraFilingWorker.ts     # Playwright automation worker
│   │   └── server.ts                  # Express app entry point
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── KraNilReturnForm.tsx   # Main form component
    │   │   └── ToggleSwitch.tsx       # Accessible toggle switch
    │   ├── types/
    │   │   └── index.ts
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── index.css
    ├── index.html
    ├── package.json
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── vite.config.ts
    └── tsconfig.json
```

## Prerequisites

| Tool | Minimum Version |
|------|----------------|
| Node.js | 18.x LTS |
| Redis | 7.x |
| npm | 9.x |

## Setup

### 1. Backend

```bash
cd backend
npm install

# Install Playwright browser
npx playwright install chromium

# Configure environment
cp .env.example .env
# Edit .env — set ENCRYPTION_SECRET, ENCRYPTION_SALT, and Redis credentials
```

### 2. Frontend

```bash
cd frontend
npm install
```

## Running

Open **four terminals**:

```bash
# Terminal 1 — Redis (if running locally)
redis-server

# Or on this workspace's Windows bundle
# .\redis\redis-server.exe .\redis\redis.windows.conf

# Terminal 2 — Express API
cd backend && npm run dev

# Terminal 3 — BullMQ Worker
cd backend && npm run worker

# Terminal 4 — React dev server
cd frontend && npm run dev
```

Open http://localhost:3000

## Environment Variables

See `backend/.env.example` for the full list. Critical variables:

| Variable | Purpose |
|---|---|
| `ENCRYPTION_SECRET` | AES key derivation secret (≥ 32 chars) |
| `ENCRYPTION_SALT` | scrypt salt (unique per deployment) |
| `REDIS_HOST` / `REDIS_PORT` | BullMQ backing store |
| `GEMINI_API_KEY` | Captcha OCR for the KRA arithmetic image |
| `WEBHOOK_URL` | Post-filing notification endpoint if notifications are wired later |

## Security Notes

- KRA passwords are AES-256-GCM encrypted **before** leaving the API handler. Plaintext passwords are never stored or logged.
- The GCM authentication tag ensures ciphertext integrity — decryption fails if data is tampered.
- The key is derived via `scrypt` (not used raw) to prevent weak-key attacks.
- The Express API uses `helmet` (security headers), `cors` (origin allowlist), and `express-rate-limit` (10 req / 15 min per IP).
- Worker runs at `concurrency: 1` to avoid KRA portal rate-limiting and IP bans.
- Forced KRA password-reset flows are completed automatically and the replacement password is surfaced through job status for operator recovery.
- Receipts are kept locally under `receipts/<jobId>/...` until a real storage integration is introduced.
- Human-like random delays are injected between sensitive automation steps.

## Supported Return Types

- Income Tax - Resident Individual nil return
- Income Tax - Non-Resident Individual nil return
- Monthly Rental Income (MRI)

MRI submissions reuse the shared login and receipt flow, select `Returns -> File Return`, rely on KRA's prepopulated period, and submit the provided monthly rental income amount.

## Job Status Data

The status endpoint returns recent execution details so the frontend can surface worker progress:

- `stepLogs`: recent worker log entries with timestamps and progress
- `lastStep`: the latest recorded worker step
- `credentialUpdate`: the generated replacement password when KRA forces a reset
- `result.receiptPath`: the local receipt path inside the workspace

## Production Checklist

- [ ] Replace local receipt persistence with real object storage if receipts must leave the workspace
- [ ] Replace mock `sendReceiptNotification` with real SES / SendGrid / webhook
- [ ] Add JWT/session-based authentication middleware to the API
- [ ] Store job results in a persistent database (PostgreSQL recommended)
- [ ] Use a secrets manager (AWS Secrets Manager / Vault) instead of `.env`
- [ ] Enable Redis TLS and authentication
- [ ] Run the worker in a dedicated container (Docker) with resource limits
