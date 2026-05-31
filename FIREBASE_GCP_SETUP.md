# Firebase + GCP Setup Checklist for KRAFILER

## What YOU need to do (GCP Console / Firebase Console / CLI)

### Step 1 — Create the GCP Project
1. Go to https://console.cloud.google.com/projectcreate
2. Create a new project. **Project ID** suggestions:
   - `krafiler-prod`
   - `krafiler-saas`
   - or your own unique ID (must be globally unique)
3. **Billing**: Link a billing account (required for Cloud Run, Cloud Tasks, etc.)
4. Note the **Project ID** and **Project Number** — you'll need both.

### Step 2 — Link Firebase to the GCP Project
1. Go to https://console.firebase.google.com/
2. Click **"Add project"**
3. Choose **"Add Firebase to a Google Cloud project"** and select your GCP project from Step 1
4. Enable **Google Analytics** if you want (optional)
5. Complete the setup wizard

### Step 3 — Enable Firebase Auth
1. In Firebase Console → **Authentication** → **Get started**
2. Enable **Google** as the sign-in provider
3. Add your local dev URL to **Authorized domains**:
   - `localhost`
   - `krafiler-prod.firebaseapp.com` (or whatever your Firebase Hosting default domain is)
4. Go to **Project settings** → **General** → scroll down to **Your apps**
5. Click **"Add app"** → **Web**
6. Register the app (e.g. `krafiler-web`)
7. Copy the **Firebase config object** — it looks like this:
   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "krafiler-prod.firebaseapp.com",
     projectId: "krafiler-prod",
     storageBucket: "krafiler-prod.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123"
   };
   ```

### Step 4 — Create a Firebase Admin SDK Service Account
1. In Firebase Console → **Project settings** → **Service accounts**
2. Click **"Generate new private key"**
3. Download the JSON file (e.g. `krafiler-prod-firebase-adminsdk-abc12-xxxxxxxxxxxx.json`)
4. **KEEP THIS FILE SECRET** — it has full admin access to your Firebase project

### Step 5 — Enable GCP APIs
In GCP Console → **APIs & Services** → **Enabled APIs & services** → **+ ENABLE APIS AND SERVICES**, enable ALL of these:

- `Cloud Run API`
- `Cloud Tasks API`
- `Cloud Firestore API`
- `Cloud Storage API`
- `Secret Manager API`
- `Cloud Build API`
- `Cloud Functions API`
- `Cloud Scheduler API`
- `Cloud Logging API`
- `Cloud Monitoring API`
- `Identity and Access Management (IAM) API`

Or via gcloud CLI (if you have it installed):
```bash
gcloud services enable run.googleapis.com cloudtasks.googleapis.com \
  firestore.googleapis.com storage.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com \
  cloudfunctions.googleapis.com cloudscheduler.googleapis.com \
  logging.googleapis.com monitoring.googleapis.com
```

### Step 6 — Create Firestore Database
1. GCP Console → **Firestore** → **Create database**
2. Choose **Native mode**
3. Choose a region: **`us-central1`** (or `europe-west1` if you prefer)
4. Select **"Start in production mode"**

### Step 7 — Create Cloud Storage Bucket
1. GCP Console → **Cloud Storage** → **Buckets** → **Create**
2. Name: `krafiler-artifacts` (must be globally unique, can append your project ID)
3. Location: same region as Firestore (`us-central1`)
4. Storage class: **Standard**
5. Access control: **Uniform** (simpler IAM)
6. Uncheck **"Prevent public access"** if you plan to use signed URLs for downloads

### Step 8 — Install gcloud CLI (if not already installed)
Download from https://cloud.google.com/sdk/docs/install
Then run:
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

---

## What you need to SEND BACK TO ME

Once you've completed the steps above, copy-paste the following values so I can wire them into the codebase:

### 1. Firebase Web Config (from Step 3)
```json
{
  "apiKey": "YOUR_API_KEY",
  "authDomain": "YOUR_AUTH_DOMAIN",
  "projectId": "YOUR_PROJECT_ID",
  "storageBucket": "YOUR_STORAGE_BUCKET",
  "messagingSenderId": "YOUR_MESSAGING_SENDER_ID",
  "appId": "YOUR_APP_ID"
}
```

### 2. GCP Project Details
```
Project ID: _______________
Project Number: _______________
Region: _______________ (e.g. us-central1)
```

### 3. Cloud Storage Bucket Name
```
Bucket name: _______________
```

### 4. Firebase Admin SDK JSON
Upload the downloaded `.json` file or paste its contents. I'll store it securely in Secret Manager instructions.

---

## What I will do once you provide the above

1. **Create `frontend/src/lib/firebase.ts`** — initialize Firebase Auth client
2. **Create `backend/src/lib/firebaseAdmin.ts`** — initialize Firebase Admin SDK
3. **Add Firebase Auth login/logout UI** to the frontend
4. **Wire `verifyAuth` middleware** to actually call `admin.auth().verifyIdToken()`
5. **Update `.env` files** with the correct project IDs, bucket names, etc.
6. **Add Firestore security rules** (from the plan)
7. **Start Phase 2** — migrate SQLite routes to Firestore

---

## Paystack (for Phase 7 — Subscription Billing)

When you're ready for payments, you'll need:
1. A Paystack account: https://paystack.com/
2. **Test Secret Key** (starts with `sk_test_`)
3. **Test Public Key** (starts with `pk_test_`)
4. A **webhook endpoint URL** (will be a Cloud Function URL, e.g. `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/paystackWebhook`)

You can set this up now or wait until Phase 7.
