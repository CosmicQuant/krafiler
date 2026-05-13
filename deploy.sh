#!/usr/bin/env bash
set -euo pipefail

# KRA Filer — Firebase + GCP Deployment Script
# Usage: ./deploy.sh [PROJECT_ID] [REGION]

PROJECT_ID="${1:-YOUR_GCP_PROJECT_ID}"
REGION="${2:-us-central1}"

API_SERVICE="krafiler-api"
WORKER_SERVICE="krafiler-worker"
IMAGE="gcr.io/${PROJECT_ID}/krafiler-backend"

echo "============================================"
echo " KRA Filer Deployment"
echo " Project: ${PROJECT_ID}"
echo " Region:  ${REGION}"
echo "============================================"

# ── 0. Verify prerequisites ─────────────────────────────────────────
command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI required. Install: https://cloud.google.com/sdk/docs/install"; exit 1; }
command -v firebase >/dev/null 2>&1 || { echo "Firebase CLI required. Install: npm install -g firebase-tools"; exit 1; }

# ── 1. Build & push backend image ───────────────────────────────────
echo ""
echo "[1/6] Building backend Docker image..."
cd backend
gcloud builds submit --tag "${IMAGE}:latest" .
cd ..

# ── 2. Deploy API to Cloud Run ──────────────────────────────────────
echo ""
echo "[2/6] Deploying API to Cloud Run..."
gcloud run deploy "${API_SERVICE}" \
  --image "${IMAGE}:latest" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,PORT=8080,DB_PATH=/data/db/krafiler.sqlite,RECEIPTS_DIR=/data/receipts,TEMP_DIR=/tmp,PLAYWRIGHT_HEADLESS=true" \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 80 \
  --max-instances 2 \
  --min-instances 1 \
  --command node \
  --args dist/server.js

API_URL=$(gcloud run services describe "${API_SERVICE}" --region "${REGION}" --format 'value(status.url)')
echo "API URL: ${API_URL}"

# ── 3. Deploy Worker to Cloud Run ───────────────────────────────────
echo ""
echo "[3/6] Deploying Worker to Cloud Run..."
gcloud run deploy "${WORKER_SERVICE}" \
  --image "${IMAGE}:latest" \
  --region "${REGION}" \
  --platform managed \
  --no-allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,PORT=8080,DB_PATH=/data/db/krafiler.sqlite,RECEIPTS_DIR=/data/receipts,TEMP_DIR=/tmp,PLAYWRIGHT_HEADLESS=true" \
  --memory 4Gi \
  --cpu 2 \
  --concurrency 1 \
  --max-instances 1 \
  --min-instances 1 \
  --command node \
  --args dist/workers/kraFilingWorker.js

# ── 4. Deploy Frontend to Firebase Hosting ──────────────────────────
echo ""
echo "[4/6] Building frontend..."
cd frontend
npm ci
# Replace API base URL for production build
# (Assumes your frontend uses VITE_API_BASE_URL or similar)
VITE_API_BASE_URL="${API_URL}/api" npm run build

echo ""
echo "[5/6] Deploying frontend to Firebase Hosting..."
firebase deploy --only hosting --project "${PROJECT_ID}"
cd ..

# ── 6. Post-deploy instructions ─────────────────────────────────────
echo ""
echo "============================================"
echo " Deployment Complete!"
echo "============================================"
echo ""
echo "API (Cloud Run):     ${API_URL}"
echo "Frontend (Firebase): https://${PROJECT_ID}.web.app"
echo ""
echo "IMPORTANT NEXT STEPS:"
echo "  1. Create a Cloud Memorystore (Redis) instance in ${REGION}."
echo "  2. Add the Redis connection env vars to BOTH Cloud Run services:"
echo "     gcloud run services update ${API_SERVICE} --region ${REGION} \\"
echo "       --set-env-vars REDIS_HOST=<IP>,REDIS_PORT=6379,REDIS_PASSWORD=<pwd>"
echo "     gcloud run services update ${WORKER_SERVICE} --region ${REGION} \\"
echo "       --set-env-vars REDIS_HOST=<IP>,REDIS_PORT=6379,REDIS_PASSWORD=<pwd>"
echo "  3. Add your GEMINI_API_KEY to the Worker:"
echo "     gcloud run services update ${WORKER_SERVICE} --region ${REGION} \\"
echo "       --set-env-vars GEMINI_API_KEY=<your-key>"
echo "  4. Mount a persistent volume for /data if you want SQLite to survive restarts:"
echo "     gcloud run services update ${API_SERVICE} --region ${REGION} \\"
echo "       --update-volume-mounts volume-1=/data"
echo "  5. (Recommended) Migrate to Cloud SQL instead of SQLite for production."
echo ""
echo "============================================"
