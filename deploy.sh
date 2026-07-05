#!/usr/bin/env bash
set -euo pipefail

# KRA Filer — Firebase + GCP Deployment Script
# Usage: ./deploy.sh [PROJECT_ID] [REGION]

PROJECT_ID="${1:-taxpulse-498006}"
REGION="${2:-us-central1}"

API_SERVICE="krafiler-api"
WORKER_SERVICE="krafiler-worker"
API_IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/krafiler-repo/krafiler-api"
WORKER_IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/krafiler-repo/krafiler-worker"

echo "============================================"
echo " KRA Filer Deployment"
echo " Project: ${PROJECT_ID}"
echo " Region:  ${REGION}"
echo "============================================"

# ── 0. Verify prerequisites ─────────────────────────────────────────
command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI required. Install: https://cloud.google.com/sdk/docs/install"; exit 1; }
command -v firebase >/dev/null 2>&1 || { echo "Firebase CLI required. Install: npm install -g firebase-tools"; exit 1; }

# ── 1. Build & push Compute API image ───────────────────────────────
echo ""
echo "[1/7] Building Compute API Docker image..."
cd backend
gcloud builds submit --config cloudbuild.compute.yaml .
cd ..

# ── 2. Build & push Worker image ────────────────────────────────────
echo ""
echo "[2/7] Building Worker Docker image..."
cd backend
gcloud builds submit --config cloudbuild.worker.yaml .
cd ..

# ── 3. Deploy Compute API to Cloud Run ──────────────────────────────
echo ""
echo "[3/7] Deploying Compute API to Cloud Run..."
gcloud run deploy "${API_SERVICE}" \
  --image "${API_IMAGE}:latest" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,USE_PUBSUB=true,PUBSUB_TOPIC=filing-jobs,TEMP_DIR=/tmp,RECEIPTS_DIR=/data/receipts,CLOUD_STORAGE_BUCKET=taxpulse,JWT_SECRET=99a8917c4ca99856f71403091907ce69205d99fbc42c53f03077adaef7709bae,ALLOWED_ORIGIN=https://taxpulse-498006.web.app,PLAYWRIGHT_HEADLESS=true" \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 80 \
  --max-instances 2 \
  --min-instances 0 \
  --command node \
  --args dist/server.compute.js

API_URL=$(gcloud run services describe "${API_SERVICE}" --region "${REGION}" --format 'value(status.url)')
echo "API URL: ${API_URL}"

# ── 4. Deploy Worker to Cloud Run ───────────────────────────────────
echo ""
echo "[4/7] Deploying Worker to Cloud Run..."
gcloud run deploy "${WORKER_SERVICE}" \
  --image "${WORKER_IMAGE}:latest" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --update-env-vars "NODE_ENV=production,TEMP_DIR=/tmp,KRA_REUSE_BROWSER_PROFILE=false,USE_HTTP_ENGINE=true" \
  --memory 4Gi \
  --cpu 2 \
  --concurrency 1 \
  --max-instances 1 \
  --min-instances 0 \
  --command node \
  --args dist/server.worker.js

WORKER_URL=$(gcloud run services describe "${WORKER_SERVICE}" --region "${REGION}" --format 'value(status.url)')
echo "Worker URL: ${WORKER_URL}"

# ── 5. Create Pub/Sub topic & push subscription ─────────────────────
echo ""
echo "[5/7] Creating Pub/Sub topic and push subscription..."
gcloud pubsub topics create filing-jobs 2>/dev/null || echo "Topic filing-jobs already exists."
gcloud pubsub subscriptions create filing-jobs-push \
  --topic=filing-jobs \
  --push-endpoint="${WORKER_URL}/process-job" \
  --ack-deadline=600 \
  --max-delivery-attempts=1 2>/dev/null || echo "Subscription filing-jobs-push already exists."

# ── 6. Deploy Frontend to Firebase Hosting ──────────────────────────
echo ""
echo "[6/7] Building frontend..."
cd frontend
npm ci
# Replace API base URL for production build
VITE_API_BASE_URL="${API_URL}/api" npm run build

echo ""
echo "[7/7] Deploying frontend to Firebase Hosting..."
firebase deploy --only hosting --project "${PROJECT_ID}"
cd ..

# ── 7. Post-deploy instructions ─────────────────────────────────────
echo ""
echo "============================================"
echo " Deployment Complete!"
echo "============================================"
echo ""
echo "API (Cloud Run):     ${API_URL}"
echo "Worker (Cloud Run):  ${WORKER_URL}"
echo "Frontend (Firebase): https://${PROJECT_ID}.web.app"
echo ""
echo "IMPORTANT NEXT STEPS:"
echo "  1. Add GEMMA4_API_KEY to the Worker (if not already set via --update-env-vars):"
echo "     gcloud run services update ${WORKER_SERVICE} --region ${REGION} \"
echo "       --update-env-vars GEMMA4_API_KEY=<your-key>"
echo "  2. Grant Pub/Sub service account permission to invoke the worker:"
echo "     gcloud run services add-iam-policy-binding ${WORKER_SERVICE} \"
echo "       --region=${REGION} \"
echo "       --member=serviceAccount:service-${PROJECT_ID}@gcp-sa-pubsub.iam.gserviceaccount.com \"
echo "       --role=roles/run.invoker"
echo "  3. Ensure Firestore Security Rules are deployed:"
echo "     firebase deploy --only firestore:rules --project ${PROJECT_ID}"
echo ""
echo "============================================"
