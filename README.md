# KRA iTax Nil Return Filing Module

End-to-end automation for filing KRA nil returns via the iTax portal.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  React Frontend (Vite + Tailwind)                               │
│  KraNilReturnForm  ──POST /api/tax/file-nil-return──►           │
│  Obligation picker + job status polling                         │
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
│  • Solves arithmetic captcha via regex                          │
│  • Downloads PDF receipt  ────────────────────────────────────► │
│  • Uploads to S3  •  Notifies user  •  Updates job status       │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
krafiler/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   └── tax.routes.ts          # POST /api/tax/file-nil-return
│   │   ├── queues/
│   │   │   └── kraFilingQueue.ts      # BullMQ queue + Redis connection
│   │   ├── types/
│   │   │   └── index.ts               # Shared TypeScript types
│   │   ├── utils/
│   │   │   ├── encryption.ts          # AES-256-GCM encrypt/decrypt
│   │   │   ├── storage.ts             # Cloud storage adapter (mock → S3)
│   │   │   └── notifications.ts       # Notification dispatcher (mock → SES/webhook)
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

Open **three terminals**:

```bash
# Terminal 1 — Redis (if running locally)
redis-server

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
| `S3_BUCKET_NAME` | Receipt storage bucket |
| `WEBHOOK_URL` | Post-filing notification endpoint |

## Security Notes

- KRA passwords are AES-256-GCM encrypted **before** leaving the API handler. Plaintext passwords are never stored or logged.
- The GCM authentication tag ensures ciphertext integrity — decryption fails if data is tampered.
- The key is derived via `scrypt` (not used raw) to prevent weak-key attacks.
- The Express API uses `helmet` (security headers), `cors` (origin allowlist), and `express-rate-limit` (10 req / 15 min per IP).
- Worker runs at `concurrency: 1` to avoid KRA portal rate-limiting and IP bans.
- Human-like random delays (3–8 s) are injected between each automation step.

## Production Checklist

- [ ] Replace mock `uploadReceiptToStorage` with real AWS S3 SDK calls
- [ ] Replace mock `sendReceiptNotification` with real SES / SendGrid / webhook
- [ ] Add JWT/session-based authentication middleware to the API
- [ ] Store job results in a persistent database (PostgreSQL recommended)
- [ ] Use a secrets manager (AWS Secrets Manager / Vault) instead of `.env`
- [ ] Enable Redis TLS and authentication
- [ ] Run the worker in a dedicated container (Docker) with resource limits
