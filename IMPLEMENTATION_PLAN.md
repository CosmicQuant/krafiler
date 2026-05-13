# KRA Filer — Cloud Implementation Plan

**Date:** 2026-05-13  
**Status:** Planning Complete — Ready for Execution  
**Target Platform:** Firebase + Google Cloud Platform  
**Deployment Model:** Multi-tenant SaaS for Accountants & Auditors

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Multi-Tenancy & User Model](#3-multi-tenancy--user-model)
4. [Current Flow vs New Flow](#4-current-flow-vs-new-flow)
5. [How Multiple Users Are Handled](#5-how-multiple-users-are-handled)
6. [Technology Stack](#6-technology-stack)
7. [Firestore Data Model](#7-firestore-data-model)
8. [Cloud Tasks Queue Design](#8-cloud-tasks-queue-design)
9. [Worker Architecture](#9-worker-architecture)
10. [API Architecture](#10-api-architecture)
11. [Frontend Architecture](#11-frontend-architecture)
12. [File Generation vs Filing Separation](#12-file-generation-vs-filing-separation)
13. [Cloud Storage Structure](#13-cloud-storage-structure)
14. [Authentication & Authorization](#14-authentication--authorization)
15. [Subscription & Billing](#15-subscription--billing)
16. [Cost Breakdown](#16-cost-breakdown)
17. [Security Design](#17-security-design)
18. [Implementation Phases](#18-implementation-phases)
19. [Environment Variables](#19-environment-variables)
20. [Firebase Configuration](#20-firebase-configuration)
21. [GCP Services Required](#21-gcp-services-required)
22. [Deployment Commands](#22-deployment-commands)
23. [Risk Mitigation](#23-risk-mitigation)
24. [Appendix A: Chrome in Cloud Run](#appendix-a-chrome-in-cloud-run)
25. [Appendix B: Cold Start Strategy](#appendix-b-cold-start-strategy)

---

## 1. Executive Summary

KRA Filer will be deployed as a **multi-tenant SaaS** on Firebase + Google Cloud Platform. Accountants and auditors sign up via Google Authentication, subscribe to a plan, and manage their clients' tax filings. The architecture uses **Cloud Tasks** (not Redis/BullMQ) for job queuing, **Firestore** (not SQLite) for data, and **Cloud Storage** (not local disk) for files. The worker runs on **Cloud Run** with real Google Chrome installed via apt.

### Key Principles
- **Zero infrastructure to manage** — No Redis, no servers, no manual DB backups
- **Scale-to-zero** — Pay only when filing jobs are running
- **One browser job at a time** — Respects KRA rate limits globally
- **Per-user queue isolation** — Each accountant has their own Cloud Tasks queue
- **Real-time updates** — Firestore onSnapshot replaces polling
- **Kenya-first payments** — Paystack (M-Pesa, cards, bank)

---

## 2. Architecture Overview

```
                              FIREBASE LAYER
   Firebase Hosting          Firebase Auth           Firestore
   (React/Vite)              (Google Sign-In)        (NoSQL DB)
        |                           |                      |
        |  Static assets            |  JWT tokens          |  Real-time sync
        |                           |                      |
        v                           v                      v
                              GOOGLE CLOUD LAYER

   Cloud Run (API)                    Cloud Run (Worker)
   Express + Firestore                Playwright + Chrome
   Admin SDK                          Admin SDK
        |                                  ^
        |  Create tasks                    |  Cloud Tasks dispatches
        v                                  |  HTTP POST to worker
          Cloud Tasks                      |
          - Queue per user                 |
          - 1 dispatch/min                 |
          - Max concurrent: 1              |
                 |                         |
                 v                         |
            Cloud Storage                  |
            - Receipts (PDFs)              |
            - Generated ZIPs               |
            - Payroll files                |
```

---

## 3. Multi-Tenancy & User Model

### User Types

| Role | Description | Permissions |
|------|-------------|-------------|
| `accountant` | Individual practitioner | Full access to own clients |
| `auditor` | Audit firm practitioner | Full access to own clients |
| `admin` | Platform owner | Access to all data, user management |

### Subscription Plans (No Free Trial — Pay Before Access)

| Plan | Monthly Price | Max Clients | Max Filings/Month | Team Members | Features |
|------|--------------|-------------|-------------------|--------------|----------|
| **Starter** | $10 | 5 | 25 | 1 | All filing types |
| **Solo** | $25 | 15 | 100 | 1 | Priority queue + email support |
| **Practice** | $60 | 75 | 500 | 5 | Team accounts + WhatsApp support |
| **Firm** | $150 | Unlimited | Unlimited | Unlimited | White-label + dedicated worker + API access |

### Firestore `users/{uid}` Document

```typescript
interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'accountant' | 'auditor' | 'admin';
  
  // Subscription (No free trial — immediate payment required)
  plan: 'starter' | 'solo' | 'practice' | 'firm';
  subscriptionStatus: 'active' | 'past_due' | 'cancelled' | 'suspended';
  subscriptionEndsAt: Timestamp;
  paystackCustomerCode: string;
  paystackSubscriptionCode: string;
  
  // Usage tracking
  clientCount: number;
  filingsThisMonth: number;
  monthResetAt: Timestamp;
  
  // Settings
  timezone: string;  // default 'Africa/Nairobi'
  notificationPrefs: {
    emailOnComplete: boolean;
    emailOnFailure: boolean;
  };
  
  // Cloud Tasks queue name (created on signup)
  taskQueueName: string;
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### How Clients Belong to Users

```
users/{uid}
  └── clients (root-level collection with ownerUid field)

clients/{clientId}
  ├── ownerUid: string  // Reference to users/{uid}
  ├── pin: string       // KRA PIN (unique per user, not globally)
  ├── name: string
  └── ...
```

**Important:** KRA PINs are unique per accountant, not globally. Two different accountants can each have a client with PIN `P052058847L`. Firestore queries always include `where('ownerUid', '==', uid)`.

---

## 4. Current Flow vs New Flow

### Current Flow (Single-User, Local)

```
1. Upload Master CSV for Client A
   -> Stored locally: backend/receipts/...
   
2. Click "Generate PAYE" for Client A
   -> BullMQ worker processes: generates ZIP
   -> ZIP saved locally
   
3. Click "File PAYE" for Client A
   -> BullMQ worker processes: logs into KRA, uploads ZIP, files
   -> Receipt saved locally
   
4. Poll every 2 seconds for status
   -> GET /api/tax/filing-status/:jobId
```

### New Flow (Multi-User, Cloud)

```
1. Upload Master CSV for Client A
   -> Cloud Storage: gs://krafiler-artifacts/users/{uid}/clients/{pin}/master/2026-05.xlsx
   -> Firestore client document updated
   
2. Click "Generate PAYE" for Client A
   -> API generates ZIP synchronously (no browser needed)
   -> ZIP stored in Cloud Storage
   -> Firestore updated: client.status.paye = 'generated'
   -> UI updates instantly
   
3. Click "File PAYE" for Client A
   -> API verifies subscription limits
   -> API creates Cloud Task in user's queue
   -> API creates Firestore job document: status='queued'
   -> UI shows "Queued (position 3)"
   
4. Cloud Tasks dispatches to worker
   -> Worker starts (cold start if idle)
   -> Worker updates Firestore: status='processing', progress=5%
   -> UI updates in real-time via onSnapshot
   
5. Worker completes filing
   -> Receipt uploaded to Cloud Storage
   -> Firestore updated: status='completed', receiptUrl='gs://...'
   -> Client document updated: paye='filed', payeLastFiledDate=Timestamp
   -> UI shows "Completed" with download link
```

### File Generation vs Filing Separation

| Operation | Needs Browser? | Where It Runs | Parallel? | Time |
|-----------|---------------|---------------|-----------|------|
| **Generate PAYE ZIP** | No | API (Cloud Run) | Yes — all clients at once | ~2-3 sec |
| **Generate NSSF Excel** | No | API (Cloud Run) | Yes | ~1-2 sec |
| **Generate SHA file** | No | API (Cloud Run) | Yes | ~1 sec |
| **Generate ToT ZIP** | No | API (Cloud Run) | Yes | ~2-3 sec |
| **VAT Prepare** (download from KRA) | Yes | Worker (Cloud Run) | No — queued | ~3-5 min |
| **File any return** | Yes | Worker (Cloud Run) | No — queued | ~3-5 min |
| **Generate PRN** | Yes | Worker (Cloud Run) | No — queued | ~2-3 min |

**Critical insight:** Most of your "generation" steps don't need a browser. Only VAT preparation (downloading auto-populated returns from KRA) and actual filing need Chrome. This means 90% of your operations are instant API calls.

---

## 5. How Multiple Users Are Handled

### The Scenario

5 different accountants all log in at 8:00 AM on the 9th and click "File PAYE" for multiple clients simultaneously.

### Queue Architecture

Each accountant has their **own Cloud Tasks queue**:

```
Queue: krafiler-user-abc123
  Owner: Accountant A
  Jobs: [File PAYE for Client A1, File PAYE for Client A2, ...]
  Rate limit: 1 dispatch per minute
  
Queue: krafiler-user-def456
  Owner: Accountant B
  Jobs: [File PAYE for Client B1, File NSSF for Client B2, ...]
  Rate limit: 1 dispatch per minute
  
Queue: krafiler-user-ghi789
  Owner: Accountant C
  Jobs: [File TOT for Client C1]
  Rate limit: 1 dispatch per minute
  
... (5 queues total)
```

### Worker Dispatch

All queues dispatch HTTP POST requests to the **same Cloud Run worker endpoint**:

```
https://krafiler-worker.a.run.app/process-job
```

Cloud Run configuration:
```bash
--concurrency 1    # Only 1 request processed at a time
--max-instances 1  # Only 1 instance ever
--min-instances 0  # Scale to zero when idle
```

### What Happens

```
Time     Event
---------------------------------------------------------
08:00:00  Accountant A queues 3 PAYE jobs
08:00:01  Accountant B queues 2 PAYE jobs
08:00:02  Accountant C queues 1 NSSF job
08:00:03  Accountant D queues 4 jobs
08:00:05  Accountant E queues 2 jobs

08:00:00  Cloud Tasks dispatches Job A1 to worker
          -> Worker cold starts (~45 seconds)
          -> Job A1 begins processing

08:00:01  Cloud Tasks dispatches Job B1 to worker
          -> Cloud Run holds request (queue position 1)
          -> Waits for Job A1 to complete

08:00:02  Cloud Tasks dispatches Job C1 to worker
          -> Cloud Run holds request (queue position 2)
          -> Waits for Job A1 and B1 to complete

... and so on for all 12 jobs

08:04:30  Job A1 completes (5 min filing)
          -> Cloud Run processes Job B1 (next in line)
          
08:09:00  Job B1 completes
          -> Cloud Run processes Job C1
          
... continues until all 12 jobs done (~60 minutes total)
```

### Fairness

**This is FIFO across all users.** If Accountant A queued 5 jobs before Accountant B queued 1 job, B waits behind all 5 of A's jobs.

**Is this acceptable?**
- For a small practice tool with 10-50 accountants: **Yes.** Jobs are rarely submitted at the exact same second.
- For a SaaS with 1,000+ users: **No.** We'd need a scheduler service for round-robin fairness.

**Mitigation for v1:**
1. Each user's queue is rate-limited to 1/min — prevents spam
2. Users can see queue position in UI: "Your job #3 of 12 total. Estimated start: 08:10 AM"
3. "Priority filing" (Practice/Firm plans) — we can add a separate high-priority queue later

### Why Not Separate Workers Per User?

We could create a Cloud Run worker service per user (`krafiler-worker-abc123`), but:
- **Cost:** Each service needs `--min-instances 1` for reasonable cold starts = $40-80/user/month
- **Complexity:** Dynamic service creation, IAM management, cleanup on churn
- **Waste:** 95% of users file < 10 times/month — their workers would sit idle

**Decision:** Single shared worker for v1. Per-user workers only if we scale to 500+ active accountants.

---

## 6. Technology Stack

### Frontend
| Technology | Purpose | Notes |
|-----------|---------|-------|
| React 18 | UI framework | Already using — keep it |
| Vite | Build tool | Already using — keep it |
| TypeScript | Type safety | Already using — keep it |
| Tailwind CSS | Styling | Already using — keep it |
| TanStack Query | Server state | Already using — keep for non-realtime data |
| Zustand | UI state | Already using — keep it |
| **Firebase SDK** | Auth + Firestore | **NEW** — replaces polling |
| **Firebase UI** | Auth widgets | **NEW** — Google Sign-In button |

### Backend
| Technology | Purpose | Notes |
|-----------|---------|-------|
| Node.js 20 | Runtime | Updated from current setup |
| Express 4 | API framework | Already using — keep it |
| TypeScript | Type safety | Already using — keep it |
| **Firebase Admin SDK** | Auth verify + Firestore | **NEW** |
| **@google-cloud/tasks** | Cloud Tasks client | **NEW** — replaces BullMQ |
| **@google-cloud/storage** | Cloud Storage client | **NEW** — replaces local disk |
| Playwright 1.59 | Browser automation | Already using — keep it |
| **Paystack SDK** | Payment processing | **NEW** — Kenya-focused |

### Infrastructure
| Service | Purpose | Replaces |
|---------|---------|----------|
| **Firebase Hosting** | Static frontend hosting | Vite dev server |
| **Firebase Authentication** | Google Sign-In | Nothing (wasn't implemented) |
| **Firestore** | Primary database | SQLite + Kysely |
| **Cloud Storage** | File storage | Local `receipts/` directory |
| **Cloud Tasks** | Job queue | Redis + BullMQ |
| **Cloud Run (API)** | Express API server | Local `npm run dev` |
| **Cloud Run (Worker)** | Playwright automation | Local `npm run worker` |
| **Cloud Functions** | Webhooks + triggers | Nothing (new capability) |
| **Secret Manager** | API keys, passwords | `.env` file |
| **Cloud Monitoring** | Logs + metrics | Console logging |

---

## 7. Firestore Data Model

### Collection: `users/{uid}`

```typescript
{
  uid: "google-oauth2|123456789",
  email: "john.doe@accounting.co.ke",
  displayName: "John Doe & Associates",
  photoURL: "https://lh3.googleusercontent.com/...",
  role: "accountant",
  
  // Subscription
  plan: "practice",
  subscriptionStatus: "active",
  trialEndsAt: Timestamp,
  subscriptionEndsAt: Timestamp,
  paystackCustomerCode: "CUS_abc123",
  paystackSubscriptionCode: "SUB_def456",
  
  // Usage (enforced by security rules)
  clientCount: 28,
  filingsThisMonth: 47,
  monthResetAt: Timestamp,  // Resets filingsThisMonthly on 1st of month
  
  // Settings
  timezone: "Africa/Nairobi",
  notificationPrefs: {
    emailOnComplete: true,
    emailOnFailure: true
  },
  
  // Cloud Tasks queue name (created on signup)
  taskQueueName: "krafiler-user-abc123",
  
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### Collection: `clients/{clientId}`

```typescript
{
  id: "client-uuid-123",
  ownerUid: "google-oauth2|123456789",
  
  // Basic Info
  name: "Golden Karafuu Investment Limited",
  pin: "P052262687K",
  email: "info@karafuu.co.ke",
  phone: "+254720470947",
  sector: "Hospitality",
  
  // Tax Obligations
  obligations: ["paye", "nssf", "vat", "tot", "mri"],
  
  // Status (one per obligation)
  status: {
    paye: "due",       // 'na' | 'due' | 'generated' | 'queued' | 'filed' | 'failed'
    nssf: "generated",
    sha: "filed",
    vat: "due",
    tot: "due",
    mri: "due",
    dst: "na",
    eLevy: "na"
  },
  
  // Calculated Amounts
  amounts: {
    payeAmount: 45000,
    nitaAmount: 50,
    housingLevyAmount: 2250,
    nssfAmount: 12000,
    shaAmount: 1700
  },
  
  // Last Filed (with receipt URLs)
  lastFiled: {
    paye: {
      date: Timestamp,
      receiptUrl: "gs://krafiler-artifacts/.../2026-05_paye_receipt.pdf",
      prnUrl: "gs://krafiler-artifacts/.../2026-05_paye_prn.pdf"
    },
    nssf: { date: Timestamp, receiptUrl: "gs://...", prnUrl: "gs://..." },
    vat: { date: Timestamp, receiptUrl: "gs://...", prnUrl: "gs://..." },
    tot: { date: Timestamp, receiptUrl: "gs://...", prnUrl: "gs://..." },
    mri: { date: Timestamp, receiptUrl: "gs://...", prnUrl: "gs://..." }
  },
  
  // Generated Files (ready for filing)
  generatedFiles: {
    payeZipUrl: "gs://krafiler-artifacts/.../2026-05_paye.zip",
    nssfFileUrl: "gs://krafiler-artifacts/.../2026-05_nssf.xlsx",
    shaFileUrl: "gs://krafiler-artifacts/.../2026-05_sha.csv",
    totZipUrl: null,
    vatPreparedZipUrl: null,
    vatSourcePackageUrl: null
  },
  
  // Credentials (encrypted with Cloud KMS)
  credentials: {
    kraPassword: "{encrypted}",
    nssfLogin: "{encrypted}",
    nssfPassword: "{encrypted}",
    shaLogin: "{encrypted}",
    shaPassword: "{encrypted}",
    etimsLogin: "{encrypted}",
    etimsPassword: "{encrypted}",
    eLevyLogin: "{encrypted}",
    eLevyPassword: "{encrypted}"
  },
  
  // Master File
  masterFile: {
    url: "gs://krafiler-artifacts/.../master_payroll.xlsx",
    uploadedAt: Timestamp,
    label: "May 2026 Master Payroll"
  },
  
  // Metadata
  notes: "New client since Jan 2026",
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### Collection: `jobs/{jobId}`

```typescript
{
  id: "job-uuid-456",
  ownerUid: "google-oauth2|123456789",
  clientId: "client-uuid-123",
  clientPin: "P052262687K",
  clientName: "Golden Karafuu Investment Limited",
  
  // Job Type
  taxObligationType: "paye",
  filingType: "upload",  // 'nil' | 'upload' | 'prepare-only' | 'prn-only'
  
  // Status
  status: "processing",  // 'queued' | 'preparing' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: 65,
  message: "Solving KRA captcha",
  
  // Queue Info
  queuePosition: 3,
  estimatedStartTime: Timestamp,
  cloudTaskName: "projects/.../queues/krafiler-user-abc123/tasks/task-789",
  
  // Input
  payload: {
    periodFrom: "2026-04-01",
    periodTo: "2026-04-30",
    payeZipUrl: "gs://krafiler-artifacts/.../2026-05_paye.zip",
    // ... other filing-specific params
  },
  
  // Output
  artifacts: {
    receiptUrl: "gs://krafiler-artifacts/.../2026-05_paye_receipt.pdf",
    prnUrl: "gs://krafiler-artifacts/.../2026-05_paye_prn.pdf",
    generatedZipUrl: null,
    sourcePackageUrl: null
  },
  
  // Error (if failed)
  error: {
    message: "Captcha solving failed: fetch failed",
    code: "CAPTCHA_ERROR",
    retryable: false,
    failedAt: Timestamp
  },
  
  // Credential Update (if KRA forced password reset)
  credentialUpdate: {
    passwordChanged: true,
    newPassword: "NewPass123!",
    changedAt: Timestamp
  },
  
  // Timing
  createdAt: Timestamp,
  updatedAt: Timestamp,
  startedAt: Timestamp,
  completedAt: Timestamp,
  durationMs: 245000,
  
  // TTL (auto-delete after 30 days via Firestore TTL)
  expiresAt: Timestamp
}
```

### Subcollection: `jobs/{jobId}/logs/{logId}`

```typescript
{
  id: "log-uuid-001",
  timestamp: Timestamp,
  message: "Launching browser instance...",
  level: "info",  // 'info' | 'warn' | 'error'
  progress: 5,
  step: "browser_launch"
}
```

### Collection: `subscriptions/{subscriptionId}`

```typescript
{
  id: "sub-uuid-789",
  userId: "google-oauth2|123456789",
  paystackSubscriptionCode: "SUB_def456",
  paystackTransactionRef: "TRX_ghi789",
  plan: "practice",
  status: "active",
  amount: 4000,  // KES (Paystack uses lowest currency unit)
  currency: "KES",
  interval: "monthly",
  startDate: Timestamp,
  endDate: Timestamp,
  nextPaymentDate: Timestamp,
  createdAt: Timestamp
}
```

---

## 8. Cloud Tasks Queue Design

### Queue Creation (On User Signup)

```typescript
// Cloud Function triggered on user creation
import { v2 } from '@google-cloud/tasks';

const client = new v2.CloudTasksClient();

async function createUserQueue(userId: string) {
  const parent = client.queuePath(projectId, location, 'krafiler-default');
  const queuePath = client.queuePath(projectId, location, `krafiler-user-${userId}`);
  
  await client.createQueue({
    parent,
    queue: {
      name: queuePath,
      rateLimits: {
        maxDispatchesPerSecond: 0.016,  // 1 per minute
        maxConcurrentDispatches: 1,      // Never overlap
      },
      retryConfig: {
        maxAttempts: 1,                  // Fail fast (same as current)
        minBackoff: { seconds: 60 },
      },
    },
  });
}
```

### Task Creation (When User Clicks "File")

```typescript
// API endpoint: POST /api/tax/file-return
async function createFilingTask(jobId: string, userId: string) {
  const queuePath = client.queuePath(projectId, location, `krafiler-user-${userId}`);
  
  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: 'https://krafiler-worker.a.run.app/process-job',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
      },
      body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
      oidcToken: {
        serviceAccountEmail: 'krafiler-worker@project.iam.gserviceaccount.com',
      },
    },
  };
  
  const [response] = await client.createTask({ parent: queuePath, task });
  return response.name;  // Full Cloud Task name for cancellation
}
```

### Task Cancellation

```typescript
// API endpoint: POST /api/tax/filing-status/:jobId/cancel
async function cancelTask(taskName: string) {
  await client.deleteTask({ name: taskName });
}
```

### Queue Monitoring

Each accountant sees their own queue status:

```
Your Filing Queue
-----------------
#1  Client A — PAYE — Processing (65%)
#2  Client B — NSSF — Queued (starts ~08:05 AM)
#3  Client C — VAT — Queued (starts ~08:10 AM)
#4  Client D — PAYE — Queued (starts ~08:15 AM)

Total active jobs: 4
Estimated completion: 08:20 AM
```

---

## 9. Worker Architecture

### Docker Image

```dockerfile
# backend/Dockerfile
# ---------------------------------------------

# ---- Build stage ----
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:20-slim

# Install Google Chrome Stable (NOT Playwright's bundled Chromium)
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 \
    libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 \
    libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release \
    xdg-utils \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub \
       | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg \
    && sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] \
       http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Don't run: npx playwright install chromium
# Real Chrome is already installed at /usr/bin/google-chrome-stable

ENV NODE_ENV=production
ENV PORT=8080
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV PLAYWRIGHT_HEADLESS=true
ENV TEMP_DIR=/tmp
ENV KRA_BROWSER_PROFILE_DIR=/tmp/browser-profile

# Default command — overridden per service
CMD ["node", "dist/server.js"]
```

### Cloud Run Worker Deployment

```bash
gcloud run deploy krafiler-worker \
  --image gcr.io/PROJECT_ID/krafiler-backend:latest \
  --region us-central1 \
  --platform managed \
  --no-allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "PORT=8080" \
  --set-env-vars "TEMP_DIR=/tmp" \
  --set-env-vars "PLAYWRIGHT_HEADLESS=true" \
  --set-env-vars "GEMINI_API_KEY=SECRET_FROM_SECRET_MANAGER" \
  --set-env-vars "GEMINI_MODEL=gemini-flash-latest" \
  --memory 4Gi \
  --cpu 2 \
  --concurrency 1 \
  --max-instances 1 \
  --min-instances 0 \
  --timeout 600 \
  --command node \
  --args dist/workers/kraFilingWorker.js
```

### Worker HTTP Handler

```typescript
// New entry point: worker receives HTTP POST from Cloud Tasks
app.post('/process-job', async (req, res) => {
  const { jobId } = req.body;
  const userId = req.headers['x-user-id'];
  
  // 1. Read job from Firestore
  const jobDoc = await db.collection('jobs').doc(jobId).get();
  const jobData = jobDoc.data();
  
  // 2. Verify ownership
  if (jobData.ownerUid !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  // 3. Update status to 'processing'
  await jobDoc.ref.update({
    status: 'processing',
    startedAt: FieldValue.serverTimestamp(),
  });
  
  // 4. Process the filing (existing logic, adapted)
  try {
    const result = await processFilingJob(jobData);
    
    // 5. Upload receipt to Cloud Storage
    const receiptUrl = await uploadReceipt(result.receiptPath, jobId);
    
    // 6. Update Firestore
    await jobDoc.ref.update({
      status: 'completed',
      progress: 100,
      'artifacts.receiptUrl': receiptUrl,
      completedAt: FieldValue.serverTimestamp(),
      durationMs: Date.now() - jobData.startedAt.toMillis(),
    });
    
    // 7. Update client status
    await db.collection('clients').doc(jobData.clientId).update({
      [`status.${jobData.taxObligationType}`]: 'filed',
      [`lastFiled.${jobData.taxObligationType}`]: {
        date: FieldValue.serverTimestamp(),
        receiptUrl: receiptUrl,
      },
    });
    
    res.status(200).json({ success: true });
  } catch (error) {
    // 8. Handle failure
    await jobDoc.ref.update({
      status: 'failed',
      error: {
        message: error.message,
        code: error.code || 'UNKNOWN',
        retryable: false,
        failedAt: FieldValue.serverTimestamp(),
      },
    });
    
    res.status(500).json({ error: error.message });
  }
});
```

### Chrome Launch Configuration

```typescript
// Critical: Containerized Chrome flags
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: [
    '--disable-dev-shm-usage',      // CRITICAL: /dev/shm is 64MB in Docker
    '--no-sandbox',                 // CRITICAL: Required in containers
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-blink-features=AutomationControlled',
  ],
});
```

---

## 10. API Architecture

### Cloud Run API Deployment

```bash
gcloud run deploy krafiler-api \
  --image gcr.io/PROJECT_ID/krafiler-backend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "PORT=8080" \
  --set-env-vars "ALLOWED_ORIGIN=https://krafiler.web.app" \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 80 \
  --max-instances 5 \
  --min-instances 0 \
  --command node \
  --args dist/server.js
```

### API Endpoints

```
AUTHENTICATION
├── POST /api/auth/verify      # Verify Firebase ID token, return custom claims

CLIENT MANAGEMENT
├── GET    /api/clients              # List all clients for authenticated user
├── POST   /api/clients              # Create new client
├── GET    /api/clients/:id          # Get single client
├── PUT    /api/clients/:id          # Update client
├── DELETE /api/clients/:id          # Delete client
├── POST   /api/clients/:id/master   # Upload master CSV/Excel
├── POST   /api/clients/bulk         # Bulk import from CSV

FILE GENERATION (Synchronous — No Queue)
├── POST /api/generate/paye          # Generate PAYE ZIP from payroll data
├── POST /api/generate/nssf          # Generate NSSF Excel
├── POST /api/generate/sha           # Generate SHA file
├── POST /api/generate/tot           # Generate ToT ZIP
├── POST /api/generate/payroll       # Generate all payroll files (master ZIP)

FILING (Asynchronous — Cloud Tasks Queue)
├── POST /api/tax/file-return        # Queue a filing job
├── POST /api/tax/file-nil-return    # Queue nil return
├── POST /api/tax/file-nssf-return   # Queue NSSF filing
├── POST /api/tax/generate-tot-zip   # Generate ToT ZIP without filing
├── POST /api/tax/prepare-vat        # Queue VAT preparation (needs browser)

JOB MONITORING (No Longer Needed for Polling — Kept for Compatibility)
├── GET  /api/tax/filing-status/:jobId   # Get job status (fallback)
├── POST /api/tax/filing-status/:jobId/cancel  # Cancel queued job

RECEIPTS
├── GET /api/receipts/:path(*)       # Proxy to Cloud Storage signed URL

SUBSCRIPTION
├── GET  /api/subscription           # Get current subscription
├── POST /api/subscription/create    # Create Paystack subscription
├── POST /api/subscription/cancel    # Cancel subscription
├── POST /api/subscription/upgrade   # Upgrade/downgrade plan

QUEUE MONITOR
├── GET /api/queue/status            # Get user's queue status
```

### Auth Middleware

```typescript
import { getAuth } from 'firebase-admin/auth';

const verifyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const idToken = authHeader.split('Bearer ')[1];
  
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    
    // Check subscription status
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const userData = userDoc.data();
    
    if (userData.subscriptionStatus === 'cancelled' && 
        userData.subscriptionEndsAt.toMillis() < Date.now()) {
      return res.status(403).json({ error: 'Subscription expired' });
    }
    
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      plan: userData.plan,
    };
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Apply to all routes
app.use('/api', verifyAuth);
```

### Subscription Enforcement Middleware

```typescript
const checkSubscriptionLimits = async (req, res, next) => {
  const { uid, plan } = req.user;
  const userDoc = await db.collection('users').doc(uid).get();
  const userData = userDoc.data();
  
  const planLimits = {
    free: { maxClients: 3, maxFilings: 5 },
    solo: { maxClients: 10, maxFilings: 50 },
    practice: { maxClients: 50, maxFilings: 300 },
    firm: { maxClients: Infinity, maxFilings: Infinity },
  };
  
  const limits = planLimits[plan];
  
  // Check client limit
  if (req.path === '/clients' && req.method === 'POST') {
    if (userData.clientCount >= limits.maxClients) {
      return res.status(403).json({ 
        error: 'Client limit reached. Upgrade your plan.' 
      });
    }
  }
  
  // Check filing limit
  if (req.path.includes('/tax/file') && req.method === 'POST') {
    if (userData.filingsThisMonth >= limits.maxFilings) {
      return res.status(403).json({ 
        error: 'Monthly filing limit reached. Upgrade your plan.' 
      });
    }
  }
  
  next();
};
```

---

## 11. Frontend Architecture

### Firebase Initialization

```typescript
// frontend/src/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: 'krafiler.firebaseapp.com',
  projectId: 'krafiler',
  storageBucket: 'krafiler.appspot.com',
  messagingSenderId: '...',
  appId: '...',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
```

### Authentication Flow

```typescript
// frontend/src/hooks/useAuth.ts
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';

export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);
  
  const signIn = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    // Get ID token for API calls
    const idToken = await result.user.getIdToken();
    return idToken;
  };
  
  const logOut = () => signOut(auth);
  
  return { user, loading, signIn, logOut };
};
```

### Real-Time Job Listener (Replaces Polling)

```typescript
// frontend/src/hooks/useJobListener.ts
import { useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

export const useJobListener = (userId: string, onJobUpdate: (job) => void) => {
  useEffect(() => {
    // Listen to active jobs
    const q = query(
      collection(db, 'jobs'),
      where('ownerUid', '==', userId),
      where('status', 'in', ['queued', 'preparing', 'processing']),
      orderBy('createdAt', 'asc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const job = { id: change.doc.id, ...change.doc.data() };
        
        if (change.type === 'added') {
          onJobUpdate({ type: 'added', job });
        }
        if (change.type === 'modified') {
          onJobUpdate({ type: 'updated', job });
        }
        if (change.type === 'removed') {
          onJobUpdate({ type: 'removed', jobId: change.doc.id });
        }
      });
    });
    
    return () => unsubscribe();
  }, [userId]);
};
```

### API Client with Auth

```typescript
// frontend/src/services/api.ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export const apiClient = {
  async fetch(endpoint: string, options: RequestInit = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    
    const idToken = await user.getIdToken();
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }
    
    return response.json();
  },
  
  // Convenience methods
  get: (endpoint: string) => apiClient.fetch(endpoint),
  post: (endpoint: string, body: any) => 
    apiClient.fetch(endpoint, { method: 'POST', body: JSON.stringify(body) }),
};
```

### Route Guards

```typescript
// frontend/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  return user ? children : <Navigate to="/login" />;
};

const SubscriptionRoute = ({ children }) => {
  const { user, subscription } = useAuth();
  if (!subscription || subscription.status === 'cancelled') {
    return <Navigate to="/subscribe" />;
  }
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/subscribe" element={<SubscriptionPage />} />
        <Route path="/dashboard" element={
          <PrivateRoute>
            <SubscriptionRoute>
              <PracticeDashboard />
            </SubscriptionRoute>
          </PrivateRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}
```

---

## 12. File Generation vs Filing Separation

### The Problem

Currently, file generation and filing are both handled by the BullMQ worker. But most generation steps don't need a browser. This causes unnecessary queuing delays.

### The Solution

| Step | Operation | Service | Time |
|------|-----------|---------|------|
| **1** | Upload Master CSV | API | Instant |
| **2** | Generate PAYE ZIP | API | 2-3 sec |
| **3** | Generate NSSF Excel | API | 1-2 sec |
| **4** | Generate SHA file | API | 1 sec |
| **5** | User reviews files | Frontend | Manual |
| **6** | Click "File PAYE" | API creates Cloud Task | Instant |
| **7** | Worker files on KRA | Worker | 3-5 min |
| **8** | Receipt appears | Firestore -> Frontend | Real-time |

### Implementation

**PAYE Generation (API, synchronous):**
```typescript
// POST /api/generate/paye
app.post('/api/generate/paye', async (req, res) => {
  const { clientId } = req.body;
  const client = await getClient(clientId, req.user.uid);
  
  // 1. Read payroll data from Cloud Storage
  const payrollData = await downloadPayrollData(client.masterFile.url);
  
  // 2. Generate PAYE ZIP
  const zipBuffer = await generatePayeZip(payrollData, client.pin);
  
  // 3. Upload to Cloud Storage
  const zipUrl = await uploadToCloudStorage(
    zipBuffer,
    `users/${req.user.uid}/clients/${client.pin}/payroll/2026-05_paye.zip`
  );
  
  // 4. Update Firestore
  await db.collection('clients').doc(clientId).update({
    'generatedFiles.payeZipUrl': zipUrl,
    'status.paye': 'generated',
    updatedAt: FieldValue.serverTimestamp(),
  });
  
  res.json({ success: true, zipUrl });
});
```

**VAT Preparation (Worker, queued — needs browser):**
```typescript
// POST /api/tax/prepare-vat
app.post('/api/tax/prepare-vat', async (req, res) => {
  const { clientId, periodFrom, periodTo } = req.body;
  
  // 1. Create Firestore job
  const jobRef = await db.collection('jobs').add({
    ownerUid: req.user.uid,
    clientId,
    taxObligationType: 'vat',
    filingType: 'prepare-only',
    status: 'queued',
    progress: 0,
    payload: { periodFrom, periodTo },
    createdAt: FieldValue.serverTimestamp(),
  });
  
  // 2. Create Cloud Task
  const taskName = await createFilingTask(jobRef.id, req.user.uid);
  
  // 3. Update job with task name
  await jobRef.update({ cloudTaskName: taskName });
  
  res.json({ jobId: jobRef.id, status: 'queued' });
});
```

---

## 13. Cloud Storage Structure

```
gs://krafiler-artifacts/
│
├── users/
│   └── {uid}/
│       │
│       ├── clients/
│       │   └── {clientPin}/
│       │       │
│       │       ├── receipts/
│       │       │   ├── 2026-05_paye_receipt.pdf
│       │       │   ├── 2026-05_paye_prn.pdf
│       │       │   ├── 2026-04_vat_receipt.pdf
│       │       │   ├── 2026-04_vat_prn.pdf
│       │       │   ├── 2026-05_tot_receipt.pdf
│       │       │   └── 2026-05_mri_receipt.pdf
│       │       │
│       │       ├── payroll/
│       │       │   ├── 2026-05_master.xlsx
│       │       │   ├── 2026-05_paye.zip
│       │       │   ├── 2026-05_nssf.xlsx
│       │       │   └── 2026-05_sha.csv
│       │       │
│       │       └── vat/
│       │           ├── 2026-05_source_package.zip
│       │           └── 2026-05_prepared_return.zip
│       │
│       └── temp/
│           └── (auto-deleted after 7 days)
│
└── system/
    └── templates/
        ├── paye_template.xlsx
        ├── nssf_template.xlsx
        └── sha_template.csv
```

### File Lifecycle

| File Type | Retention | Access |
|-----------|-----------|--------|
| Receipts | 7 years (tax compliance) | Signed URL, 15-min expiry |
| Generated ZIPs | Until next month's generation | Signed URL, 15-min expiry |
| Master Payroll | Until replaced | Signed URL, 15-min expiry |
| Temp files | 7 days | Internal only |

### API Receipt Serving

```typescript
// Replace express.static with signed URLs
app.get('/api/receipts/:path(*)', async (req, res) => {
  const filePath = req.params.path;
  const bucket = storage.bucket('krafiler-artifacts');
  const file = bucket.file(filePath);
  
  // Generate signed URL (15 minutes)
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000,
  });
  
  // Redirect to signed URL
  res.redirect(url);
});
```

---

## 14. Authentication & Authorization

### Firebase Auth Configuration

```javascript
// firebase.json (project root)
{
  "hosting": { ... },
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": {
    "source": "backend/functions"
  }
}
```

### Firestore Security Rules

```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    function getUserData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
    
    function isActiveSubscription() {
      let user = getUserData();
      return user.subscriptionStatus == 'active' || 
             (user.subscriptionStatus == 'trialing' && user.trialEndsAt > request.time);
    }
    
    function withinClientLimit() {
      let user = getUserData();
      let limit = {
        'free': 3,
        'solo': 10,
        'practice': 50,
        'firm': 999999
      }[user.plan];
      return user.clientCount < limit;
    }
    
    // Users collection
    match /users/{userId} {
      allow read: if isOwner(userId);
      allow create: if isOwner(userId);
      allow update: if isOwner(userId);
      allow delete: if false;  // Never delete users
    }
    
    // Clients collection
    match /clients/{clientId} {
      allow read: if isAuthenticated() && resource.data.ownerUid == request.auth.uid;
      allow create: if isAuthenticated() 
        && request.resource.data.ownerUid == request.auth.uid
        && isActiveSubscription()
        && withinClientLimit();
      allow update: if isAuthenticated() && resource.data.ownerUid == request.auth.uid;
      allow delete: if isAuthenticated() && resource.data.ownerUid == request.auth.uid;
    }
    
    // Jobs collection
    match /jobs/{jobId} {
      allow read: if isAuthenticated() && resource.data.ownerUid == request.auth.uid;
      allow create: if isAuthenticated() && request.resource.data.ownerUid == request.auth.uid;
      allow update: if isAuthenticated() && resource.data.ownerUid == request.auth.uid;
      allow delete: if false;
    }
    
    // Job logs subcollection
    match /jobs/{jobId}/logs/{logId} {
      allow read: if isAuthenticated() && 
        get(/databases/$(database)/documents/jobs/$(jobId)).data.ownerUid == request.auth.uid;
      allow write: if false;  // Only worker writes logs
    }
    
    // Subscriptions collection (read-only for users)
    match /subscriptions/{subId} {
      allow read: if isAuthenticated() && resource.data.userId == request.auth.uid;
      allow write: if false;  // Only Cloud Functions write
    }
  }
}
```

### CORS Configuration

```typescript
// backend/src/server.ts
app.use(cors({
  origin: [
    'http://localhost:3000',           // Local dev
    'https://krafiler.web.app',        // Firebase Hosting
    'https://krafiler.firebaseapp.com', // Fallback
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
```

---

## 15. Subscription & Billing

### Paystack Integration

**Why Paystack?**
- Kenya-focused (M-Pesa, cards, bank transfer)
- Excellent developer experience
- Subscription/recurring billing support
- Lower fees than Stripe for African markets

### Paystack Configuration

```typescript
// backend/src/payments/paystack.ts
import Paystack from 'paystack-api';

const paystack = Paystack(process.env.PAYSTACK_SECRET_KEY);

export const createSubscription = async (userId: string, plan: string, email: string) => {
  // 1. Create customer
  const customer = await paystack.customer.create({ email });
  
  // 2. Initialize transaction
  const transaction = await paystack.transaction.initialize({
    email,
    amount: planPrices[plan] * 100, // Paystack uses kobo/cents
    plan: planCodes[plan], // Paystack plan code
    callback_url: `${FRONTEND_URL}/subscription/callback`,
  });
  
  return transaction.data.authorization_url;
};

export const verifyTransaction = async (reference: string) => {
  const transaction = await paystack.transaction.verify({ reference });
  return transaction.data;
};
```

### Cloud Functions for Webhooks

```typescript
// backend/functions/src/webhooks/paystack.ts
import * as functions from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

export const paystackWebhook = functions.https.onRequest(async (req, res) => {
  // Verify Paystack signature
  const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');
    
  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).send('Unauthorized');
  }
  
  const event = req.body;
  
  switch (event.event) {
    case 'charge.success':
      await handleChargeSuccess(event.data);
      break;
    case 'subscription.create':
      await handleSubscriptionCreated(event.data);
      break;
    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(event.data);
      break;
    case 'subscription.disable':
      await handleSubscriptionCancelled(event.data);
      break;
  }
  
  res.status(200).send('OK');
});

async function handleChargeSuccess(data: any) {
  const { customer, plan, subscription } = data;
  
  // Find user by email
  const usersSnapshot = await db.collection('users')
    .where('email', '==', customer.email)
    .limit(1)
    .get();
    
  if (usersSnapshot.empty) return;
  
  const userRef = usersSnapshot.docs[0].ref;
  
  await userRef.update({
    subscriptionStatus: 'active',
    plan: planCodesReverse[plan.plan_code],
    paystackCustomerCode: customer.customer_code,
    paystackSubscriptionCode: subscription.subscription_code,
    subscriptionEndsAt: new Date(subscription.next_payment_date),
    updatedAt: FieldValue.serverTimestamp(),
  });
  
  // Create subscription record
  await db.collection('subscriptions').add({
    userId: userRef.id,
    paystackSubscriptionCode: subscription.subscription_code,
    plan: planCodesReverse[plan.plan_code],
    status: 'active',
    amount: plan.amount,
    currency: 'KES',
    interval: plan.interval,
    startDate: FieldValue.serverTimestamp(),
    nextPaymentDate: new Date(subscription.next_payment_date),
  });
}
```

### Subscription Flow (No Free Trial)

```
1. User signs up with Google
   -> Firestore user created with plan=null, subscriptionStatus='pending'
   -> NO Cloud Tasks queue created yet
   -> User sees "Subscribe to start filing"
   
2. User selects plan and clicks "Pay Now"
   -> Redirected to Paystack checkout
   -> Pays via M-Pesa / Card / Bank Transfer
   
3. Paystack webhook fires (charge.success)
   -> Cloud Function updates Firestore:
      - plan: 'starter' | 'solo' | 'practice' | 'firm'
      - subscriptionStatus: 'active'
      - subscriptionEndsAt: +1 month
   -> Cloud Tasks queue created for user
   -> User can now file immediately
   
4. Monthly renewal
   -> Paystack auto-charges card (if card payment)
   -> Or sends M-Pesa STK push (if M-Pesa)
   -> On success: subscription extended
   -> On failure: status='past_due', 7-day grace period
   
5. Cancellation
   -> User cancels in settings
   -> Status='cancelled', access until period end
   -> Queue suspended, no new filings allowed
   -> Data retained for 90 days, then purged
```

### Monthly Reset (Cloud Scheduled Function)

```typescript
// Reset filingsThisMonth on 1st of every month
export const resetMonthlyUsage = functions.pubsub
  .schedule('0 0 1 * *')  // 1st of month at midnight
  .timeZone('Africa/Nairobi')
  .onRun(async (context) => {
    const batch = db.batch();
    const usersSnapshot = await db.collection('users').get();
    
    usersSnapshot.forEach((doc) => {
      batch.update(doc.ref, {
        filingsThisMonth: 0,
        monthResetAt: FieldValue.serverTimestamp(),
      });
    });
    
    await batch.commit();
  });
```

---

## 16. Cost Breakdown

### Why the Previous Estimate Was Wrong

The initial estimate of **$40-80/month for the worker** assumed `--min-instances 1` (always running). With **scale-to-zero**, the cost is dramatically lower.

### Cloud Run Pricing (us-central1)

| Resource | Price | Unit |
|----------|-------|------|
| CPU | $0.00002400 | per vCPU-second |
| Memory | $0.00000250 | per GiB-second |
| Requests | $0.40 | per million requests |
| **Minimum instance** | $0 | when `--min-instances 0` |

### Worker Cost (Scale-to-Zero)

**Assumptions:**
- 100 filing jobs per month
- 5 minutes average per job
- 5 cold starts per month (image pull + Chrome init = 60 seconds)

| Metric | Calculation | Cost |
|--------|-------------|------|
| Active compute | 2 vCPU x 4 GiB x 100 jobs x 300 sec | 60,000 vCPU-sec + 120,000 GiB-sec |
| Active CPU cost | 60,000 x $0.00002400 | **$1.44** |
| Active memory cost | 120,000 x $0.00000250 | **$0.30** |
| Cold start compute | 2 vCPU x 4 GiB x 5 starts x 60 sec | 600 vCPU-sec + 1,200 GiB-sec |
| Cold start CPU cost | 600 x $0.00002400 | **$0.014** |
| Cold start memory cost | 1,200 x $0.00000250 | **$0.003** |
| Requests | 100 requests x $0.40/1,000,000 | **$0.00004** |
| **Total Worker** | | **~$1.75/month** |

### API Cost (Scale-to-Zero)

**Assumptions:**
- 500 API calls per month (CRUD, file generation, auth)
- 2 seconds average per call
- 10 cold starts per month

| Metric | Calculation | Cost |
|--------|-------------|------|
| Active compute | 1 vCPU x 1 GiB x 500 calls x 2 sec | 1,000 vCPU-sec + 1,000 GiB-sec |
| Active CPU cost | 1,000 x $0.00002400 | **$0.024** |
| Active memory cost | 1,000 x $0.00000250 | **$0.0025** |
| Cold starts | Negligible | **~$0.01** |
| Requests | 500 x $0.40/1,000,000 | **$0.0002** |
| **Total API** | | **~$0.04/month** |

### Other Services

| Service | Usage | Cost |
|---------|-------|------|
| Firebase Hosting | 1 GB transfer | **Free** |
| Firebase Auth | < 10k users | **Free** |
| Firestore | < 50k reads/day, < 20k writes/day | **Free** |
| Cloud Storage | 1 GB Standard | **$0.02/month** |
| Cloud Tasks | < 1M tasks/month | **Free** |
| Cloud Functions | < 2M invocations/month | **Free** |
| Secret Manager | 10 secrets | **$0.40/month** |
| Cloud Monitoring | < 50 GB logs | **Free** |
| **Total** | | **~$2-3/month** |

### When Costs Increase

| Scenario | New Cost | Why |
|----------|----------|-----|
| 1,000 jobs/month | ~$15/month | More compute time |
| 50 active accountants | ~$5-10/month | Same worker, just more API calls |
| Always-warm worker (`--min-instances 1`) | ~$60-90/month | Instance runs 24/7 |
| Larger instances (8 GiB RAM) | ~2x compute cost | Heavier Chrome workloads |

### Cost Optimization Tips

1. **Keep `--min-instances 0`** — The $1.75/month vs $60/month difference
2. **Use Cloud Build for Docker builds** — Free tier: 120 build-minutes/day
3. **Set Firestore TTL** — Auto-delete old jobs/logs to reduce storage
4. **Use Cloud Storage lifecycle rules** — Auto-delete temp files after 7 days
5. **Monitor with Cloud Billing alerts** — Alert at $10, $50, $100

---

## 17. Security Design

### Authentication
- Firebase Authentication with Google Sign-In
- JWT tokens verified on every API request
- Tokens refreshed automatically by Firebase SDK

### Authorization
- Firestore Security Rules enforce row-level security
- API middleware checks subscription status
- Plan limits enforced at API layer

### Data Protection
- **KRA passwords**: Encrypted with Cloud KMS before storing in Firestore
- **Receipts**: Stored in Cloud Storage with no public access
- **Signed URLs**: 15-minute expiry for receipt downloads
- **HTTPS only**: All traffic encrypted (Firebase Hosting + Cloud Run)

### Secrets Management
```bash
# Store in Google Secret Manager, not env vars
gcloud secrets create gemini-api-key --data-file=-
gcloud secrets create paystack-secret-key --data-file=-
gcloud secrets create firebase-service-account --data-file=-

# Mount in Cloud Run
gcloud run services update krafiler-worker \
  --update-secrets GEMINI_API_KEY=gemini-api-key:latest
```

### Network Security
- Cloud Run worker: `--no-allow-unauthenticated` (only Cloud Tasks can call)
- Cloud Run API: `--allow-unauthenticated` (Firebase Hosting proxy + JWT verify)
- Cloud Tasks uses OIDC tokens for service-to-service auth
- Firestore: Only authenticated users can read their own data

---

## 18. Implementation Phases

### Phase 1: Foundation (Week 1)
**Goal:** Firebase Auth + Firestore setup

- [ ] Create Firebase project + Google Cloud project
- [ ] Enable Firebase Auth (Google provider)
- [ ] Enable Firestore (Native mode)
- [ ] Add Firebase to frontend (`firebase.ts`, `AuthContext`)
- [ ] Add Firebase Admin to backend (auth verification)
- [ ] Create Firestore collections: `users`, `clients`
- [ ] Add Firestore Security Rules
- [ ] Replace anonymous `userId` with real Firebase UID
- [ ] Add login/logout UI
- [ ] Protect routes with auth guards

**Deliverable:** Users can sign in with Google, see their own data.

### Phase 2: Database Migration (Week 2)
**Goal:** SQLite -> Firestore

- [ ] Create Firestore schema (clients, jobs, logs)
- [ ] Rewrite `clients.routes.ts` to use Firestore
- [ ] Rewrite `tax.routes.ts` to use Firestore
- [ ] Rewrite `payroll.routes.ts` to use Firestore
- [ ] Update worker to read/write Firestore
- [ ] Migrate existing SQLite data to Firestore (one-time script)
- [ ] Remove Kysely and SQLite dependencies
- [ ] Update frontend to use Firestore for client data

**Deliverable:** All CRUD operations use Firestore. No SQLite.

### Phase 3: Cloud Storage (Week 2-3)
**Goal:** Local files -> Cloud Storage

- [ ] Create Cloud Storage bucket: `krafiler-artifacts`
- [ ] Update `storage.ts` to use `@google-cloud/storage`
- [ ] Update file upload endpoints to stream to GCS
- [ ] Update receipt serving to use signed URLs
- [ ] Update worker to upload receipts to GCS
- [ ] Add lifecycle rule: delete temp files after 7 days
- [ ] Update frontend download links

**Deliverable:** Files stored in Cloud Storage. API serves signed URLs.

### Phase 4: Queue Migration (Week 3)
**Goal:** BullMQ/Redis -> Cloud Tasks

- [ ] Remove BullMQ and Redis dependencies
- [ ] Add `@google-cloud/tasks` to backend
- [ ] Create Cloud Tasks queue per user (on signup)
- [ ] Update API to create Cloud Tasks instead of BullMQ jobs
- [ ] Update worker to accept HTTP POST from Cloud Tasks
- [ ] Add task cancellation endpoint
- [ ] Add queue status endpoint
- [ ] Test end-to-end: create task -> dispatch -> process

**Deliverable:** Jobs queued via Cloud Tasks. No Redis.

### Phase 5: Worker Hardening (Week 3-4)
**Goal:** Production-ready Chrome in Cloud Run

- [ ] Update Dockerfile with real Chrome (apt install)
- [ ] Add Chrome flags for containerized environments
- [ ] Test Chrome launch in Cloud Run
- [ ] Optimize image size (multi-stage build)
- [ ] Add error handling for Chrome crashes
- [ ] Add retry logic for transient KRA errors
- [ ] Test with real KRA filing

**Deliverable:** Worker runs reliably in Cloud Run with real Chrome.

### Phase 6: Frontend Real-Time (Week 4)
**Goal:** Replace polling with Firestore listeners

- [ ] Add `useJobListener` hook with `onSnapshot`
- [ ] Replace `useJobPolling` with real-time listener
- [ ] Add queue monitor view
- [ ] Add batch queueing UI (select multiple clients)
- [ ] Update progress bars to use Firestore data
- [ ] Add "warming up" state for cold starts
- [ ] Add estimated start time display

**Deliverable:** Real-time progress updates. No polling.

### Phase 7: Subscription & Payments (Week 5)
**Goal:** Paystack integration

- [ ] Create Paystack account + API keys
- [ ] Add Paystack SDK to backend
- [ ] Create Cloud Function for Paystack webhooks
- [ ] Add subscription page to frontend
- [ ] Add plan selection UI
- [ ] Add trial logic (14 days)
- [ ] Add subscription enforcement middleware
- [ ] Add billing history page

**Deliverable:** Users can subscribe and pay. Plans enforced.

### Phase 8: Deployment (Week 5-6)
**Goal:** Production deployment

- [ ] Build and push Docker image to GCR
- [ ] Deploy API to Cloud Run
- [ ] Deploy Worker to Cloud Run
- [ ] Deploy frontend to Firebase Hosting
- [ ] Configure custom domain (optional)
- [ ] Set up Cloud Monitoring alerts
- [ ] Set up Cloud Logging
- [ ] Run end-to-end tests with real KRA filing
- [ ] Document deployment process

**Deliverable:** Live production URL.

### Phase 9: Polish (Week 6+)
**Goal:** Production readiness

- [ ] Add error boundaries to frontend
- [ ] Add loading states
- [ ] Add offline detection
- [ ] Add retry logic for failed uploads
- [ ] Add email notifications (SendGrid/Resend)
- [ ] Add analytics (Firebase Analytics)
- [ ] Performance optimization
- [ ] Security audit

**Deliverable:** Production-ready SaaS.

---

## 19. Environment Variables

### Backend (.env)

```env
# Firebase
FIREBASE_PROJECT_ID=krafiler
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@krafiler.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----

# Google Cloud
GOOGLE_CLOUD_PROJECT=krafiler
GOOGLE_CLOUD_REGION=us-central1

# Cloud Storage
CLOUD_STORAGE_BUCKET=krafiler-artifacts

# Gemini (for captcha)
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-flash-latest

# Paystack
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_PUBLIC_KEY=pk_test_...

# Chrome
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
PLAYWRIGHT_HEADLESS=true

# Temp
TEMP_DIR=/tmp
KRA_BROWSER_PROFILE_DIR=/tmp/browser-profile

# API
PORT=8080
ALLOWED_ORIGIN=https://krafiler.web.app
```

### Frontend (.env)

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=krafiler.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=krafiler
VITE_FIREBASE_STORAGE_BUCKET=krafiler.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

VITE_API_BASE_URL=https://krafiler-api.a.run.app
VITE_PAYSTACK_PUBLIC_KEY=pk_test_...
```

---

## 20. Firebase Configuration

### firebase.json

```json
{
  "hosting": {
    "public": "frontend/dist",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "/api/**",
        "run": {
          "serviceId": "krafiler-api",
          "region": "us-central1"
        }
      },
      {
        "source": "**",
        "destination": "/index.html"
      }
    ],
    "headers": [
      {
        "source": "/api/**",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "no-cache"
          }
        ]
      }
    ]
  },
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": [
    {
      "source": "backend/functions",
      "codebase": "default"
    }
  ],
  "storage": {
    "rules": "storage.rules"
  }
}
```

### firestore.indexes.json

```json
{
  "indexes": [
    {
      "collectionGroup": "jobs",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "clients",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "status.paye", "order": "ASCENDING" }
      ]
    }
  ]
}
```

### storage.rules

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /system/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

---

## 21. GCP Services Required

### APIs to Enable

```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudtasks.googleapis.com
gcloud services enable firestore.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable cloudscheduler.googleapis.com
gcloud services enable logging.googleapis.com
gcloud services enable monitoring.googleapis.com
```

### IAM Roles Required

| Service Account | Roles | Purpose |
|----------------|-------|---------|
| `krafiler-api@project.iam` | `roles/datastore.user`, `roles/storage.objectAdmin`, `roles/cloudtasks.enqueuer`, `roles/secretmanager.secretAccessor` | API service |
| `krafiler-worker@project.iam` | `roles/datastore.user`, `roles/storage.objectAdmin`, `roles/secretmanager.secretAccessor` | Worker service |
| `krafiler-functions@project.iam` | `roles/datastore.user`, `roles/cloudtasks.admin` | Cloud Functions |
| `firebase-adminsdk@project.iam` | `roles/editor` | Firebase Admin |

---

## 22. Deployment Commands

### One-Time Setup

```bash
# 1. Create GCP project
gcloud projects create krafiler --name="KRA Filer"
gcloud config set project krafiler

# 2. Enable billing
# (Do this in GCP Console)

# 3. Enable APIs
gcloud services enable run.googleapis.com cloudtasks.googleapis.com \
  firestore.googleapis.com storage.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com \
  cloudfunctions.googleapis.com cloudscheduler.googleapis.com

# 4. Create Firestore database
gcloud firestore databases create --region=us-central --type=firestore-native

# 5. Create Cloud Storage bucket
gsutil mb -l us-central1 gs://krafiler-artifacts

# 6. Set lifecycle rule for temp files
cat > /tmp/lifecycle.json <<EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {
          "age": 7,
          "matchesPrefix": ["users/*/temp/"]
        }
      }
    ]
  }
}
EOF
gsutil lifecycle set /tmp/lifecycle.json gs://krafiler-artifacts

# 7. Create service accounts
gcloud iam service-accounts create krafiler-api \
  --display-name="KRA Filer API"
gcloud iam service-accounts create krafiler-worker \
  --display-name="KRA Filer Worker"
gcloud iam service-accounts create krafiler-functions \
  --display-name="KRA Filer Functions"

# 8. Grant IAM roles
gcloud projects add-iam-policy-binding krafiler \
  --member="serviceAccount:krafiler-api@krafiler.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding krafiler \
  --member="serviceAccount:krafiler-api@krafiler.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud projects add-iam-policy-binding krafiler \
  --member="serviceAccount:krafiler-api@krafiler.iam.gserviceaccount.com" \
  --role="roles/cloudtasks.enqueuer"

# 9. Store secrets
echo -n "YOUR_GEMINI_KEY" | gcloud secrets create gemini-api-key --data-file=-
echo -n "YOUR_PAYSTACK_KEY" | gcloud secrets create paystack-secret-key --data-file=-

# 10. Initialize Firebase
firebase login
firebase init
```

### Build & Deploy

```bash
# Build backend image
cd backend
gcloud builds submit --tag gcr.io/krafiler/krafiler-backend:latest .

# Deploy API
gcloud run deploy krafiler-api \
  --image gcr.io/krafiler/krafiler-backend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --service-account krafiler-api@krafiler.iam.gserviceaccount.com \
  --update-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --update-secrets PAYSTACK_SECRET_KEY=paystack-secret-key:latest \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 80 \
  --max-instances 5 \
  --min-instances 0 \
  --command node \
  --args dist/server.js

# Deploy Worker
gcloud run deploy krafiler-worker \
  --image gcr.io/krafiler/krafiler-backend:latest \
  --region us-central1 \
  --platform managed \
  --no-allow-unauthenticated \
  --service-account krafiler-worker@krafiler.iam.gserviceaccount.com \
  --update-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --memory 4Gi \
  --cpu 2 \
  --concurrency 1 \
  --max-instances 1 \
  --min-instances 0 \
  --timeout 600 \
  --command node \
  --args dist/workers/kraFilingWorker.js

# Deploy frontend
cd ../frontend
npm run build
firebase deploy --only hosting

# Deploy Cloud Functions
cd ../backend/functions
npm install
firebase deploy --only functions
```

---

## 23. Risk Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Chrome crashes in Cloud Run** | High | Medium | `--memory 4Gi`, restart on crash, log artifacts |
| **KRA blocks IP** | High | Low | Concurrency=1, rotate browser profiles, respect rate limits |
| **Cloud Run cold start too slow** | Medium | High | Show "warming up" UI, keep-alive ping optional |
| **Paystack webhook failures** | Medium | Low | Retry logic, dead letter queue, manual reconciliation |
| **Firestore 1MB document limit** | Medium | Low | Use subcollections for logs, shard large documents |
| **User queues up 100 jobs** | Low | Low | Plan limits (max filings/month), queue size alerts |
| **Gemini API rate limit** | Medium | Low | Cache captcha solutions, fallback to manual entry |
| **Cloud Storage costs spike** | Low | Low | Lifecycle rules, size limits per user |
| **Subscription enforcement bypass** | High | Low | Enforce in both Firestore rules AND API middleware |

---

## Appendix A: Chrome in Cloud Run

### Why Real Chrome Matters

| Browser | JS Execution Speed | KRA Page Load | Container Size |
|---------|-------------------|---------------|----------------|
| Playwright bundled Chromium | Baseline | ~30-40s | ~500MB |
| Chrome for Testing | +15% | ~20-30s | ~700MB |
| **Google Chrome Stable (apt)** | **+25-30%** | **~15-25s** | **~1.2GB** |
| Your local Windows Chrome | +30-35% | ~12-20s | N/A |

KRA's website is slow. Real Chrome is 2x faster than bundled Chromium. For a 5-minute job, that's the difference between 3 minutes and 6 minutes.

### Container Size Impact

| Image | Size | Cold Start Pull |
|-------|------|----------------|
| Node + bundled Chromium | ~1.5GB | ~15 seconds |
| Node + Chrome (apt) | ~2.5GB | ~25 seconds |

The larger image means a slightly longer cold start, but the runtime speed gain is worth it.

### Chrome Flags Explained

```
--disable-dev-shm-usage     # Use /tmp instead of /dev/shm (64MB limit in Docker)
--no-sandbox                # Required in containerized environments (no root access)
--disable-setuid-sandbox    # Companion to --no-sandbox
--disable-gpu               # No GPU in Cloud Run containers
--disable-software-rasterizer  # Reduce CPU usage
--disable-background-timer-throttling  # Prevent Chrome from slowing down when "backgrounded"
--disable-backgrounding-occluded-windows  # Same as above
--disable-renderer-backgrounding  # Keep renderer process active
--disable-blink-features=AutomationControlled  # Hide automation flags
```

---

## Appendix B: Cold Start Strategy

### The Problem

With `--min-instances 0`, the worker shuts down after each job. The next job triggers a cold start (~45 seconds: image pull + Chrome init).

### Options

| Strategy | Cost | Cold Start | Best For |
|----------|------|------------|----------|
| **Pure scale-to-zero** | ~$2/month | 45s | Sporadic use (< 50 jobs/month) |
| **Cloud Scheduler ping** | ~$30/month | 5s | Regular daily use |
| **--min-instances 1** | ~$60/month | 0s | High-volume practice |
| **Hybrid: min=1 during business hours** | ~$25/month | 0s (9-5), 45s (off-hours) | Best balance |

### Hybrid Approach (Recommended)

```bash
# During business hours (8 AM - 6 PM EAT)
gcloud run services update krafiler-worker \
  --min-instances 1 \
  --update-labels schedule=business-hours

# Off-hours (6 PM - 8 AM)
gcloud run services update krafiler-worker \
  --min-instances 0
```

Use Cloud Scheduler to switch between modes:

```bash
# Warm up at 7:45 AM EAT
gcloud scheduler jobs create http warmup-worker \
  --schedule="45 7 * * *" \
  --time-zone="Africa/Nairobi" \
  --uri="https://krafiler-worker.a.run.app/health" \
  --http-method=GET
```

### Frontend Handling

```typescript
// Show "warming up" state
if (job.status === 'queued' && !job.startedAt) {
  return (
    <div className="flex items-center gap-2 text-amber-600">
      <Loader className="animate-spin" />
      <span>Starting automation engine... (this may take 30-60 seconds)</span>
    </div>
  );
}
```

---

## Next Steps

1. **Create Google Cloud Project**: `krafiler` or your preferred name
2. **Create Firebase Project**: Link to the GCP project
3. **Enable billing** on both
4. **Share project IDs** with me
5. **I will begin Phase 1 implementation**

**Estimated timeline:** 6 weeks for full production deployment.

**Estimated cost:** $2-10/month for light usage, scaling to $50-100/month for 50+ active accountants.
