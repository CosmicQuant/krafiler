# Capture-Driven HTTP Porting Plan

## Goal
Attach non-intrusive capture to the existing deployed worker (HTTP engine and Playwright fallback) so every production/dev filing run records request/response pairs, HAR, HTML snapshots, console logs, and token history. Use this recorded data to iteratively map and port the remaining obligation flows (TOT, PAYE upload, VAT, PRN, NSSF, MRI) to the HTTP state machine without relying on one-off local test scripts.

## Current State
- **HTTP nil filing works end-to-end** via `KraHttpSession` / `KraHttpClient` (`backend/src/workers/http/`).
- **Playwright flows exist** for PAYE upload, VAT, TOT, NSSF, PRN, MRI in `backend/src/workers/services/`.
- **Firestore** is the source of truth for jobs; logs live in `jobs/{id}/logs`.
- **Cloud Storage** already stores receipts, PRNs, and prepared ZIPs (`backend/src/lib/cloudStorage.ts`).
- **HAR capture exists** for Playwright via `KRA_HAR_CAPTURE_DIR`, but it is file-system only and not linked to the job document or uploaded to Cloud Storage.
- **HTML response capture exists** only in local test scripts (`kra-http-nil-return-test.ts` writes to `C:\Temp\kra-receipts`).
- There is **no centralized, queryable artifact store** tied to a job ID.

## Proposed Architecture

```
Deployed Worker
├── HTTP engine: KraHttpClient wraps got
│   └── interceptor writes: request, response body, status, headers, timestamp
├── Playwright fallback
│   └── existing HAR + new page snapshots + console logs
└── CaptureUploader
    └── writes to GCS: gs://bucket/captures/{jobId}/{sequence}-{step}-{type}.ext
        and updates Firestore job doc: artifacts.captureGcsPrefix
```

Frontend / API can then list/download captures for a job and replay them into fixtures.

## Capture System Design

### 1. What to Capture
| Artifact | HTTP Engine | Playwright | Purpose |
|---|---|---|---|
| Request URL + method + headers + body | ✅ | via HAR | Replay exact calls |
| Response body + status + headers | ✅ | via HAR | Build parsers |
| HTML snapshot at each milestone | ✅ | ✅ | Visual debugging, form inspection |
| HAR file (full network log) | ❌ (got does not produce HAR natively) | ✅ | End-to-end network timeline |
| Console logs | N/A | ✅ | JS errors/dialog text |
| `token_key` history | ✅ | via page eval | Token lifecycle |
| Form fields snapshot | ✅ | via page eval | Build form payloads |
| Page URL after each step | ✅ | ✅ | Navigation verification |
| Dialog/alert text | N/A | ✅ | Error extraction |

### 2. Capture Trigger Points
Capture at the start and end of every discrete step:
1. `login-start`, `login-end`
2. `captcha-solve`
3. `navigate-returns-start`, `navigate-returns-end`
4. `select-obligation-start`, `select-obligation-end`
5. `form-load` (nil details, upload page, TOT form, etc.)
6. `form-submit` (request + response)
7. `post-submit` (success/error page)
8. `receipt-download-start`, `receipt-download-end`
9. `error` (any caught error)

Use a shared `CaptureContext` object carried by the job adapter/session so every service appends to the same sequence.

### 3. Storage Layout in Cloud Storage
```
captures/
  {jobId}/
    manifest.json                  # index of all artifacts with metadata
    {seq:04d}-{step}-request.json  # HTTP engine: serialized got request
    {seq:04d}-{step}-response.html # HTTP engine: response body
    {seq:04d}-{step}-response.json # HTTP engine: status + headers
    {seq:04d}-{step}-snapshot.html # Playwright: page HTML
    {seq:04d}-{step}-console.json  # Playwright: console entries
    {seq:04d}-{step}-page.png      # Playwright: screenshot (optional)
    session.har                    # Playwright: full HAR
```

### 4. Manifest Schema
```json
{
  "jobId": "...",
  "taxObligationType": "paye",
  "isNil": true,
  "kraPin": "P051699440T",
  "startedAt": "2026-07-05T14:00:00Z",
  "artifacts": [
    {
      "seq": 1,
      "step": "login-end",
      "type": "response",
      "gcsPath": "captures/{jobId}/0001-login-end-response.html",
      "url": "https://itax.kra.go.ke/KRA-Portal/login.htm",
      "statusCode": 200,
      "timestamp": "2026-07-05T14:00:05Z"
    }
  ]
}
```

## Integration Points

### A. HTTP Engine (`KraHttpClient` / `KraHttpSession`)
- Add an optional `capture` callback to `KraHttpClientOptions`.
- In every `get`/`post`/`getBuffer`/`postMultipart`/`postRaw`, after receiving the response, call:
  ```ts
  await capture?.({
    seq: nextSeq(),
    step: options.step ?? 'unknown',
    url,
    method,
    requestHeaders,
    requestBody: maskSecrets(body),
    statusCode: response.statusCode,
    responseHeaders: response.headers,
    responseBody: response.body,
    timestamp: new Date().toISOString(),
  });
  ```
- `KraHttpSession` accepts a `CaptureContext` and passes it into the client; it also records `token_key` transitions.

### B. Playwright Fallback (`kraFilingWorker.ts`)
- Extend the existing HAR capture to always upload the HAR to Cloud Storage when the job finishes.
- Add a `CaptureHelper` that:
  - Writes full-page HTML snapshots before/after every meaningful action.
  - Captures console logs (`page.on('console')`, `page.on('pageerror')`).
  - Captures dialog text (`page.on('dialog')`).
- Upload all files + manifest to GCS at job completion/failure.

### C. CaptureUploader (`backend/src/workers/capture/CaptureUploader.ts`)
Responsibilities:
- Generate sequence numbers per job.
- Mask secrets in request bodies (password fields, `kraPassword`, `nssfPassword`, tokens optional).
- Upload artifacts to GCS under `captures/{jobId}/`.
- Update `manifest.json` incrementally.
- Update Firestore job doc with `artifacts.captureGcsPrefix` and `artifacts.captureManifestGcsPath`.

### D. API Endpoints (`backend/src/api/tax.routes.ts`)
- `GET /api/tax/jobs/:jobId/captures` — list artifacts from manifest.
- `GET /api/tax/jobs/:jobId/captures/:artifactName` — proxy download from GCS (auth-required, same as receipts).

### E. Frontend Job Panel
- Add a "Captures" tab/section in `KraNilReturnForm` / `JobStatusInline` / dashboard job views.
- Show artifact list with links to view HTML / download HAR.
- For terminal jobs, show a "Download captures" button.

## From Captures to HTTP Flows

### 1. Fixture Generator Script
Create `backend/src/scripts/generate-fixture-from-capture.ts`:
- Input: job ID or GCS prefix.
- Output: a local folder with:
  - `request-{seq}.json`
  - `response-{seq}.html`
  - `extracted-fields.json` (form fields, token_keys, obligation options)
  - `submission-payload.json` (reconstructed POST body)
- This lets developers build parsers and submitters against real KRA HTML offline.

### 2. Replay Harness
Create `backend/src/scripts/replay-capture-locally.ts`:
- Reads captured requests/responses.
- Replays the sequence up to a chosen step using recorded responses (no live KRA calls).
- Useful for testing parsers and verifying payload construction.

### 3. Obligation Porting Workflow
For each obligation, follow this loop:
1. Enable capture and run the existing Playwright flow in staging/production for that obligation.
2. Download captures via the API/frontend.
3. Identify login → obligation selection → form loading → submission → receipt download sequence.
4. Extract form fields, token patterns, and required POST bodies from captured responses.
5. Build a new HTTP service in `backend/src/workers/http/filing/` modeled on `NilReturnSubmitter`.
6. Write parser unit tests using captured HTML fixtures.
7. Add the new obligation to the HTTP engine router in `kraFilingWorker.ts`.
8. Run a live filing with capture enabled; compare success path to the Playwright capture.
9. Disable Playwright fallback for that obligation once stable.

## Security & Privacy
- **Mask credentials**: strip `kraPassword`, `nssfPassword`, `encryptedPassword`, `authTag`, `iv` from captured request bodies. Log a placeholder `[REDACTED]`.
- **Mask or hash PII**: store KRA PIN in manifest metadata because it is already in the job doc; do not include it in HTML file names.
- **Bucket**: use the existing private Cloud Storage bucket (`taxpulse`).
- **Signed URLs**: reuse the existing 7-day signed URL mechanism for capture downloads.
- **Retention**: apply a 30-day TTL on the `captures/` prefix via GCS lifecycle rule to control costs. Captures used for fixtures should be copied to the repo as test data.

## Rollout Phases

### Phase 1 — HTTP Engine Capture (foundation)
- Add `CaptureContext` and `CaptureUploader`.
- Instrument `KraHttpClient` and `KraHttpSession`.
- Upload HTTP-engine captures to GCS and link to the job doc.
- Add `GET /api/tax/jobs/:jobId/captures` endpoint.
- Add minimal frontend link to view captures.

### Phase 2 — Playwright Capture Upload
- Extend existing HAR capture to upload to GCS on completion.
- Add HTML snapshots and console logs around key actions.
- Upload manifest + artifacts to GCS.

### Phase 3 — Fixture & Replay Tools
- Build `generate-fixture-from-capture.ts`.
- Build `replay-capture-locally.ts`.
- Move successful nil-return captures into the repo as test fixtures.

### Phase 4 — Obligation Porting (iterative)
Recommended order based on similarity to nil filing and usage frequency:
1. **TOT** — similar eReturns flow, already has ZIP generator.
2. **PAYE upload** — file upload over HTTP (multipart), high value.
3. **VAT prepare + upload** — more complex due to auto-populated data and ZIP artifacts.
4. **PRN generation** — standalone payment slip flow.
5. **NSSF** — separate NSSF portal, lower priority for HTTP porting.
6. **MRI** — nil variant is simple; transactional variant can follow VAT pattern.

For each, repeat the capture → fixture → parser → service → test → deploy loop.

### Phase 5 — Cleanup
- Make capture retention automatic.
- Add cost alerts on the `captures/` bucket.
- Document the porting playbook for future obligations.

## Validation Plan
1. Run a PAYE nil filing with capture enabled; verify all expected artifacts appear in GCS.
2. Download the capture via the API; confirm manifest is complete and credentials are redacted.
3. Generate a fixture from the capture; run parser tests against it.
4. Run one Playwright filing with capture enabled; verify HAR + snapshots + console logs upload.
5. For the first ported obligation (TOT), compare the HTTP-engine capture to the Playwright capture and confirm identical POST URLs/payloads where expected.

## Open Decisions
1. **Enable by default?** Recommended: capture is **opt-in per job** (`payload.capture: true`) and can be overridden by env var `KRA_CAPTURE_ENABLED=true` in dev/staging. This avoids surprise storage costs in production.
2. **Screenshot capture?** Recommended: skip full screenshots in Phase 1 to save cost; keep HTML snapshots. Add screenshots later only if needed.
3. **Priority obligation?** Recommended: start with **TOT** because it uses the same eReturns portal and already has a ZIP generator, making it the quickest validation of the capture-to-port workflow.
