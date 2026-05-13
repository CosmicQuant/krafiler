# Deploying KRA Filer to Firebase + Google Cloud

This guide covers deploying the KRA Filer stack (React frontend, Express API, Playwright worker, Redis queue, SQLite DB) to Firebase Hosting and Google Cloud Run.

> **Why Firebase + GCP?** Firebase Hosting is perfect for the Vite frontend, but the backend needs persistent processes (Express API), Chrome/Playwright (worker), and Redis (BullMQ queue) — none of which fit Firebase Functions. Cloud Run is the right home for the backend and worker.

---

## Architecture Overview

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Firebase       │      │  Cloud Run       │      │  Cloud Run      │
│  Hosting        │─────▶│  krafiler-api    │◀────▶│  Cloud          │
│  (React/Vite)   │      │  (Express)       │      │  Memorystore    │
└─────────────────┘      └──────────────────┘      │  (Redis)        │
                              │                    └─────────────────┘
                              │                           ▲
                              ▼                           │
                         ┌──────────────────┐             │
                         │  Cloud Run       │─────────────┘
                         │  krafiler-worker │
                         │  (Playwright)    │
                         └──────────────────┘
```

| Component | Service | Notes |
|---|---|---|
| **Frontend** | Firebase Hosting | Static Vite build, CDN, custom domain |
| **API** | Cloud Run | Express server; serves API + receipt PDFs |
| **Worker** | Cloud Run | Playwright + Chrome; concurrency locked to 1 |
| **Queue** | Cloud Memorystore | Redis instance required by BullMQ |
| **DB** | SQLite (quick) or Cloud SQL (prod) | SQLite lives on Cloud Run ephemeral disk or persistent volume |
| **Receipts** | Local volume (quick) or Cloud Storage (prod) | PDFs saved by worker, served by API |

---

## Prerequisites

1. **Google Cloud project** with billing enabled
2. **gcloud CLI** installed and authenticated: `gcloud auth login && gcloud config set project YOUR_PROJECT_ID`
3. **Firebase CLI** installed: `npm install -g firebase-tools` then `firebase login`
4. **Docker** installed (or use Cloud Build)
5. A **Gemini API key** for captcha solving
6. A **Redis instance** (Cloud Memorystore) or any Redis URL

---

## Step 1: Build & Push the Backend Image

The backend and worker share the same codebase, so we build **one** Docker image and deploy it twice with different commands.

```bash
cd backend

# Build using Google Cloud Build (no local Docker needed)
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/krafiler-backend:latest .

# Or build locally and push
docker build -t gcr.io/YOUR_PROJECT_ID/krafiler-backend:latest .
docker push gcr.io/YOUR_PROJECT_ID/krafiler-backend:latest
```

The `Dockerfile` uses the official Playwright image (`mcr.microsoft.com/playwright:v1.59.1-jammy`) so Chromium and all system dependencies are pre-installed.

---

## Step 2: Create a Redis Instance (Cloud Memorystore)

BullMQ requires Redis. Firebase doesn't include Redis, so use Cloud Memorystore:

```bash
gcloud redis instances create krafiler-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0 \
  --network=default

# Get the IP address
gcloud redis instances describe krafiler-redis --region=us-central1 --format='value(host)'
```

> **Cost tip:** A 1 GB Basic tier Memorystore instance costs ~$0.068/hour (~$50/month). For development, you can use an external Redis provider with a free tier (e.g. Redis Cloud, Upstash).

---

## Step 3: Deploy the API (Cloud Run)

```bash
gcloud run deploy krafiler-api \
  --image gcr.io/YOUR_PROJECT_ID/krafiler-backend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "PORT=8080" \
  --set-env-vars "DB_PATH=/data/db/krafiler.sqlite" \
  --set-env-vars "RECEIPTS_DIR=/data/receipts" \
  --set-env-vars "TEMP_DIR=/tmp" \
  --set-env-vars "REDIS_HOST=<REDIS_IP>" \
  --set-env-vars "REDIS_PORT=6379" \
  --set-env-vars "REDIS_PASSWORD=<REDIS_PASSWORD_IF_ANY>" \
  --set-env-vars "ALLOWED_ORIGIN=<YOUR_FIREBASE_HOSTING_URL>" \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 80 \
  --max-instances 2 \
  --min-instances 1 \
  --command node \
  --args dist/server.js
```

Note the URL after deployment (e.g. `https://krafiler-api-xyz-uc.a.run.app`).

---

## Step 4: Deploy the Worker (Cloud Run)

The **worker must run exactly 1 instance at a time** (`--max-instances 1 --concurrency 1`) to respect KRA rate limits.

```bash
gcloud run deploy krafiler-worker \
  --image gcr.io/YOUR_PROJECT_ID/krafiler-backend:latest \
  --region us-central1 \
  --platform managed \
  --no-allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "PORT=8080" \
  --set-env-vars "DB_PATH=/data/db/krafiler.sqlite" \
  --set-env-vars "RECEIPTS_DIR=/data/receipts" \
  --set-env-vars "TEMP_DIR=/tmp" \
  --set-env-vars "PLAYWRIGHT_HEADLESS=true" \
  --set-env-vars "REDIS_HOST=<REDIS_IP>" \
  --set-env-vars "REDIS_PORT=6379" \
  --set-env-vars "REDIS_PASSWORD=<REDIS_PASSWORD_IF_ANY>" \
  --set-env-vars "GEMINI_API_KEY=<YOUR_GEMINI_KEY>" \
  --set-env-vars "GEMINI_MODEL=gemini-flash-latest" \
  --memory 4Gi \
  --cpu 2 \
  --concurrency 1 \
  --max-instances 1 \
  --min-instances 1 \
  --command node \
  --args dist/workers/kraFilingWorker.js
```

> **Memory:** Playwright + Chrome needs at least 2–4 GB RAM. Don't go below 2 GiB or the browser will crash.
> **CPU:** 2 vCPUs recommended so Chrome doesn't bottleneck.

---

## Step 5: Deploy the Frontend (Firebase Hosting)

### 5a. Configure the API URL

Your frontend needs to know where the backend lives. If you use an environment variable like `VITE_API_BASE_URL`:

```bash
cd frontend
```

Create a `.env.production`:

```env
VITE_API_BASE_URL=https://krafiler-api-xyz-uc.a.run.app/api
```

> If your frontend proxies `/api` requests during development, update the production build to call the full Cloud Run URL.

### 5b. Build & Deploy

```bash
npm ci
npm run build          # outputs to frontend/dist

# Initialize Firebase (first time only)
firebase init hosting

# Deploy
firebase deploy --only hosting
```

The `firebase.json` in `frontend/` already includes a rewrite rule so `/api/**` requests are forwarded to your Cloud Run API service:

```json
{
  "hosting": {
    "public": "dist",
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
    ]
  }
}
```

> **Important:** For the Firebase rewrite to Cloud Run to work, both services must be in the **same GCP project and region**.

---

## Step 6: Persistent Data (SQLite & Receipts)

### The Problem
Cloud Run containers have an **ephemeral filesystem**. Anything written to disk (SQLite DB, receipt PDFs) disappears when the container restarts.

### Option A: Persistent Volume (Quick & Simple)
Cloud Run supports mounting persistent volumes (Cloud Storage FUSE or Filestore). This lets you keep SQLite and receipts across restarts.

```bash
# Create a Filestore instance for shared persistent storage
gcloud filestore instances create krafiler-data \
  --tier=BASIC_HDD \
  --file-share=name="krafiler",capacity=100GB \
  --network=name="default" \
  --region=us-central1

# Mount it to both services (see Cloud Run docs for volume mounts)
```

### Option B: Cloud SQL + Cloud Storage (Production-Grade)
- **Database:** Migrate SQLite → Cloud SQL (PostgreSQL). Kysely supports PostgreSQL with minimal changes.
- **Receipts:** Replace local `fs.rename()` with Cloud Storage uploads. The API can then serve receipts via signed URLs or proxy through Express.

This requires code changes but is the correct long-term architecture.

### Option C: Accept Ephemeral (Development Only)
For quick testing, you can accept that the DB resets on every deploy. Set `--min-instances 1` so the container rarely restarts. Not recommended for real usage.

---

## Environment Variables Reference

| Variable | API | Worker | Description |
|---|---|---|---|
| `NODE_ENV` | ✅ | ✅ | `production` |
| `PORT` | ✅ | ✅ | `8080` (Cloud Run requirement) |
| `DB_PATH` | ✅ | ✅ | Path to SQLite file, e.g. `/data/db/krafiler.sqlite` |
| `RECEIPTS_DIR` | ✅ | ✅ | Path to receipts folder, e.g. `/data/receipts` |
| `TEMP_DIR` | ✅ | ✅ | Temp working dir, e.g. `/tmp` |
| `REDIS_HOST` | ✅ | ✅ | Redis IP or hostname |
| `REDIS_PORT` | ✅ | ✅ | Redis port (usually `6379`) |
| `REDIS_PASSWORD` | ✅ | ✅ | Redis password (if auth enabled) |
| `ALLOWED_ORIGIN` | ✅ | ❌ | Your Firebase Hosting URL (CORS) |
| `GEMINI_API_KEY` | ❌ | ✅ | Required for captcha solving |
| `GEMINI_MODEL` | ❌ | ✅ | e.g. `gemini-flash-latest` |
| `PLAYWRIGHT_HEADLESS` | ❌ | ✅ | `true` in production |

---

## Using the Deploy Script

A helper script is provided at the repo root:

```bash
chmod +x deploy.sh
./deploy.sh YOUR_GCP_PROJECT_ID us-central1
```

This automates building the image, deploying the API, deploying the worker, building the frontend, and deploying to Firebase Hosting. **You still need to manually:**
1. Create the Redis instance
2. Add Redis connection env vars to both services
3. Add `GEMINI_API_KEY` to the worker
4. Set up persistent storage (if desired)

---

## Security Checklist

- [ ] **Redis**: Enable auth and use a strong password. Don't expose Redis to the public internet.
- [ ] **API**: The API is `--allow-unauthenticated` so Firebase Hosting can reach it. If you want stricter security, use Firebase App Check or IAM.
- [ ] **Worker**: Use `--no-allow-unauthenticated` — nothing external should call the worker directly.
- [ ] **Secrets**: Move `GEMINI_API_KEY` and `REDIS_PASSWORD` to **Google Secret Manager**, then mount them as env vars:
  ```bash
  gcloud run services update krafiler-worker --update-secrets GEMINI_API_KEY=gemini-api-key:latest
  ```
- [ ] **CORS**: Set `ALLOWED_ORIGIN` to your exact Firebase Hosting domain.

---

## Cost Estimate (Monthly, us-central1)

| Service | Config | ~Cost/Month |
|---|---|---|
| Firebase Hosting | 10 GB transfer | **Free** (within free tier) |
| Cloud Run (API) | 1 vCPU, 1 GiB, min 1 instance | ~$30–40 |
| Cloud Run (Worker) | 2 vCPU, 4 GiB, min 1 instance | ~$60–90 |
| Cloud Memorystore | 1 GB Basic | ~$50 |
| Cloud SQL (optional) | db-f1-micro | ~$7–10 |
| **Total (SQLite)** | | ~**$140–180** |
| **Total (Cloud SQL)** | | ~**$150–190** |

> Prices vary with usage. Use the [GCP Pricing Calculator](https://cloud.google.com/products/calculator) for precise estimates.

---

## Troubleshooting

**"fetch failed" in captcha solving**
- The worker lost internet connectivity. Cloud Run instances have reliable egress, so this usually means the Gemini API key is invalid or the Gemini service is down. Check the key.

**"Cannot find module" errors in Cloud Run**
- Make sure `npm run build` succeeds locally and `dist/` is included in the Docker image. The Dockerfile copies from the builder stage.

**Receipts returning 404**
- The API and worker must share the same `RECEIPTS_DIR` path. In Cloud Run, if each service has its own ephemeral disk, receipts saved by the worker won't be visible to the API. Use a shared persistent volume or Cloud Storage.

**SQLite database resets after deploy**
- Expected with ephemeral disks. Mount a persistent volume or migrate to Cloud SQL.

---

## Next Steps

1. **Migrate to Cloud SQL** for a real production database.
2. **Add Cloud Storage** for receipts so they survive container restarts.
3. **Add monitoring** with Cloud Logging and Cloud Monitoring.
4. **Set up CI/CD** with Cloud Build triggers on Git push.
