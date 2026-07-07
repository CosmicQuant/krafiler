# KRA Filing Engine Refactor — Pure HTTP State Machine Plan

## 1. Goal & Scope

Replace the Playwright/UI browser automation in `backend/src/workers/kraFilingWorker.ts` and its per-obligation services with a **pure HTTP state machine** implemented in TypeScript/Node.js. The new pipeline will make direct backend calls to the KRA iTax portal, preserve session state in a cookie jar, solve the arithmetic CAPTCHA from raw image bytes, and file returns via parameterized POSTs.

### In Scope
- KRA iTax login, session management, and CSRF (`token_key`) handling.
- Navigation to Returns → File Nil Return / File Return.
- Tax-obligation selection and period entry.
- Nil-return submission and receipt/acknowledgement PDF download.
- Turnover Tax (ToT) parameterized filing (the simplest non-nil upload flow).
- Error parsing and retry policies for 502/504/timeout/session errors.
- Refactor of the worker entry-point orchestration to use HTTP services.

### Explicitly Out of Scope (Phase 2+)
- PAYE/VAT/MRI/Excise upload flows and VAT auto-populated/current-month downloads in this phase. They will be ported after the HTTP foundation and nil/ToT flows are proven.
- NSSF filing remains a separate portal and keeps its existing implementation.
- PRN generation after filing remains Playwright-based until the Payment Registration HTTP flow is mapped.

## 2. Guiding Principles

1. **No browser runtime in the hot path.** Playwright remains only as an opt-in fallback while the HTTP engine is being validated.
2. **Stateless HTTP client, stateful session object.** Each job creates a fresh `KraHttpSession` that owns cookies, headers, and the latest `token_key`.
3. **Parser-first design.** Every HTML response is parsed with `cheerio` to extract the next `token_key`, form fields, and error messages.
4. **Type-safe payloads.** All POST bodies are constructed from explicit TypeScript interfaces; no string-key duck typing.
5. **Fail-fast with clean error mapping.** KRA-specific error strings/codes are normalized into typed errors (`KraSessionError`, `KraValidationError`, `KraPortalError`).

## 3. New Dependencies

Add to `backend/package.json`:

- `got` v11 — CJS-compatible HTTP client (replaced `got-scraping`, which is ESM-only and incompatible with the backend tsconfig).
- `tough-cookie` — RFC-compliant cookie jar for `JSESSIONID` persistence.
- `cheerio` — Fast, server-side HTML parsing for `token_key`/form/error extraction.
- `tls-client` (optional fallback) — JA3/TLS fingerprint impersonation. **Omitted**: native build failure on Windows (`ffi-napi`). Revisit only if KRA WAF blocks the `got` client.

## 4. New Module Structure

Create `backend/src/workers/http/`:

```
backend/src/workers/http/
├── client/
│   ├── KraHttpClient.ts          # got-scraping wrapper + cookie jar + TLS options
│   └── HttpClientAdapter.ts      # interface to allow got-scraping ↔ tls-client swap
├── session/
│   └── KraHttpSession.ts         # owns client, base URL, last response, token_key, logging
├── parsers/
│   ├── parseTokenKey.ts          # extract <input name="token_key"> value
│   ├── parseCaptchaImage.ts      # resolve CAPTCHA <img> src to absolute URL
│   ├── parseLoginOutcome.ts      # detect errors / password-change / mobile-verification
│   ├── parseObligations.ts       # read <select id="regType"> options
│   ├── parseReturnForm.ts        # read period fields, nil flags, submit targets
│   └── parsePortalErrors.ts      # scan response body for KRA error strings/codes
├── navigation/
│   └── ReturnsNavigator.ts       # Returns → File Nil Return / File Return handshakes
├── filing/
│   ├── NilReturnSubmitter.ts     # nil-return POST builder + submit
│   └── TotReturnSubmitter.ts     # ToT parameter-driven POST + ZIP upload
├── download/
│   └── BinaryDownloader.ts       # stream PDF/ZIP payloads to disk
├── errors/
│   ├── KraError.ts               # base typed error
│   ├── KraErrorCode.ts           # enum of mapped codes (e.g. SESSION_INVALID, CAPTCHA_INCORRECT)
│   └── mapPortalMessage.ts       # regex/string → KraErrorCode mapping
└── index.ts                      # public factory/orchestration exports
```

## 5. Files to Modify

1. `backend/src/workers/kraFilingWorker.ts`
   - Replace browser launch/login/navigation block (lines ~2060–2220) with `KraHttpSession` creation.
   - Replace `performKraLogin` Playwright call with `HttpLoginService.execute(...)`.
   - Replace Returns menu navigation with `ReturnsNavigator`.
   - Replace nil/ToT submission branches with `NilReturnSubmitter` / `TotReturnSubmitter`.
   - Keep receipt storage, GCS upload, client doc updates, and PRN generation hooks unchanged.

2. `backend/src/workers/services/`
   - Mark `LoginService.ts`, `NavigationService.ts`, `BrowserService.ts` as deprecated; do not delete yet.
   - Keep `TotFilingService.ts`, `PayeFilingService.ts`, `VatFilingService.ts`, `MriFilingService.ts`, `PrnService.ts`, `NssfService.ts` in place; they remain Playwright-based for Phase 1 fallback and will be ported later.

3. `backend/src/workers/constants/selectors.ts`
   - Add HTTP-oriented constants: login form field names (`logid`, `captcahText`, `token_key`), action-code URLs, and known KRA error strings/codes.

4. `backend/src/workers/utils/captcha.ts`
   - Add `solveCaptchaFromBuffer(imageBuffer: Buffer): Promise<string>` that reuses the existing Gemma4 Vision call but accepts a raw Buffer instead of a screenshot path.

5. `backend/src/types/index.ts`
   - Add interfaces for HTTP-specific DTOs: `KraLoginPayload`, `KraReturnSelectionPayload`, `KraNilReturnPayload`, `KraFilingResult`.

6. `backend/src/workers/httpWorker.ts`
   - No functional change; it will continue to call `processFilingJob`. Add a feature flag (`USE_HTTP_ENGINE=true`) to the adapter/job data so the worker can route between HTTP and Playwright during rollout.

## 6. Implementation Order

### Phase 0: Foundation & Tooling
1. Install dependencies (`got-scraping`, `tough-cookie`, `cheerio`, `tls-client`).
2. Create `KraHttpClient.ts` and `KraHttpSession.ts` with:
   - Base URL `https://itax.kra.go.ke/KRA-Portal/`
   - `tough-cookie` jar wired into `got-scraping` hooks.
   - Chrome 120 TLS defaults (HTTP/2, ALPN, cipher suites) via `got-scraping` options or `tls-client` adapter.
   - Request/response logging hooks (redact passwords).
3. Add parser utilities (`parseTokenKey`, `parseCaptchaImage`, `parsePortalErrors`).
4. Add `solveCaptchaFromBuffer` to `utils/captcha.ts`.

### Phase 1: HTTP Login
1. Implement `HttpLoginService`:
   - `GET /KRA-Portal/login.htm` → parse `token_key`, CAPTCHA image URL.
   - `GET <captcha-url>` → download Buffer → solve with Gemini.
   - `POST /KRA-Portal/login.htm?actionCode=login` with `logid`, password, `captcahText`, `token_key`, and hidden form fields.
   - Parse outcome: success, failure (captcha/password), password-change prompt, mobile verification.
2. Wire `processFilingJob` to use `HttpLoginService` when `USE_HTTP_ENGINE=true`.
3. Add error mapping for login failure patterns.
4. Validate end-to-end login reaches the authenticated dashboard via HTTP.

### Phase 2: Returns Navigation
1. Implement `ReturnsNavigator`:
   - `GET /KRA-Portal/eReturns.htm?actionCode=showEReturns` (or the JS menu equivalent URL).
   - Parse the obligation `<select>` and `token_key`.
   - `POST` obligation selection with `regType`/`obligationId` and `token_key`.
   - Parse the next page (nil form or upload form) and extract fresh `token_key`.
2. Handle redirect-after-login edge cases (e.g. My Ledger redirect).

### Phase 3: Nil Return Submission
1. Implement `NilReturnSubmitter`:
   - Build `KraNilReturnPayload` from `periodFrom`, `periodTo`, `ownsRentalProperty`, `nilReturnFlag`, and latest `token_key`.
   - POST to the nil-return submission endpoint.
   - Parse response for success indicators (`Return Submitted successfully`, acknowledgement number).
2. Implement `BinaryDownloader` to stream the acknowledgement PDF from the receipt URL.
3. Integrate into `processFilingJob`; store receipt and update Firestore client doc as today.

### Phase 4: ToT Parameter Filing
1. Implement `TotReturnSubmitter`:
   - Reuse existing `packageToTZip` to generate the ZIP locally.
   - Build multipart/form-data POST with the generated ZIP, period parameters, `obligationId`, declaration flag, and `token_key`.
   - Parse submission response and download receipt PDF.
2. Integrate into `processFilingJob` for `taxObligationType === 'turnover_tax'`.

### Phase 5: Resiliency, Retries & Error Mapping
1. Add retry wrapper around `KraHttpClient`:
   - Exponential backoff (1s → 2s → 4s) for 502/504/ECONNRESET/ETIMEDOUT.
   - No retry for 4xx KRA validation errors.
   - Per-request timeout (30s default, 90s for login).
2. Implement `KraErrorMapper`:
   - Map strings: `session has timed out`, `Session Invalid`, `page re-submit`, `4002`, `incorrect password`, `captcha incorrect`, etc.
   - Return typed `KraError` with `code`, `message`, `retryable`.
3. Add session-recovery logic: if a mid-flow request returns a session error, re-login once and replay the last request.
4. Add feature flag and dark-launch: run HTTP engine for a configurable percentage of jobs, falling back to Playwright on failure.

## 7. Key Design Details

### 7.1 Cookie Jar
- Use `tough-cookie.CookieJar` instance per job.
- Wire into `got-scraping` via `cookieJar` option (or manual `headers.Cookie` if the library version requires it).
- Ensure `JSESSIONID` is sent on every request and updated on every `Set-Cookie` response.

### 7.2 `token_key` State Machine
- After every POST/GET, run `parseTokenKey($('input[name="token_key"]'))`.
- If a new `token_key` is found, update `KraHttpSession.tokenKey`.
- If missing, preserve the previous token and log a warning; fail if the next POST requires it and it is absent.

### 7.3 CAPTCHA Flow
1. Login page response contains `<img src="/KRA-Portal/...GenerateCaptcha...">`.
2. Resolve absolute URL.
3. `GET` the image with the same session client.
4. Pass `Buffer` to `solveCaptchaFromBuffer`, which calls the existing Gemma4 Vision endpoint.
5. Fill `captcahText` in the login POST payload.

### 7.4 Binary Downloads
- Use `got-scraping` stream API or `BinaryDownloader` with `fs.createWriteStream`.
- Detect PDF/ZIP by `Content-Type` and magic bytes (`%PDF`, `PK\x03\x04`).
- Validate downloaded file is not an HTML error page; if it is, throw `KraErrorCode.RECEIPT_DOWNLOAD_FAILED`.

### 7.5 Error Mapping Examples

| KRA Response Text / Code | Mapped Code | Retryable |
|---|---|---|
| `session has timed out` | `SESSION_INVALID` | Yes (re-login) |
| `Session Invalid` / `4002` | `SESSION_INVALID` | Yes (re-login) |
| `page re-submit` | `SESSION_INVALID` | Yes (re-login) |
| `incorrect password` / `invalid login` | `CREDENTIALS_INVALID` | No |
| `security stamp.*incorrect` / `captcha.*incorrect` | `CAPTCHA_INCORRECT` | Yes (re-solve) |
| `period already filed` | `ALREADY_FILED` | No |
| 502 / 504 / `ECONNRESET` | `PORTAL_UNAVAILABLE` | Yes (backoff) |

## 8. Rollout & Validation

1. **Feature flag:** Add `USE_HTTP_ENGINE` env var (default `false`).
2. **Dark launch:** Initially send 10% of non-production jobs through HTTP engine; compare success rate and timing against Playwright.
3. **Logging parity:** Ensure every HTTP step logs the same progress/messages as the Playwright path so the frontend status table works unchanged.
4. **Tests:**
   - Unit tests for `parseTokenKey`, `parseCaptchaImage`, `parsePortalErrors`, `KraErrorMapper` using captured HTML snippets.
   - Integration test script that performs a real KRA login (manual credential injection) to verify session/CAPTCHA flow.
   - `npm run build` and `npx tsc --noEmit` must pass before merging each phase.
5. **PRN generation:** Deferred to Phase 2+. HTTP TOT filing returns the receipt only; PRN generation remains Playwright-based and is not invoked after an HTTP filing.
6. **Cleanup:** Once HTTP engine reaches parity for nil + ToT, remove Playwright login/navigation code from `kraFilingWorker.ts` and delete deprecated services.

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| KRA WAF blocks Node HTTP client | Use `got-scraping` headers/HTTP/2; fallback to `tls-client`; keep Playwright fallback under feature flag. |
| Hidden JS redirects not replicated as HTTP | Capture real browser network log for each flow to discover exact `actionCode` URLs and parameters. |
| `token_key` regeneration rules change | Centralize parsing; add tests with captured HTML; fail loudly when token is missing. |
| CAPTCHA image format changes | Reuse existing Gemini vision solver; keep OCR/Tesseract fallback from `captcha.ts`. |
| Multipart upload format incompatible with KRA | Match KRA's exact field names and boundary; validate with a real test filing. |
| Receipt download requires JS token | Parse the download URL from the success page HTML; stream it directly. |

## 10. Performance Expectations

| Phase | Current Playwright Path | Target HTTP Path | Primary Gain |
|---|---|---|---|
| Session setup | Browser launch/context init (~2–5s) | TCP connection + cookie jar (~<500ms) | Eliminates Chromium startup |
| Login page fetch | Full page load + networkidle wait | GET login.htm + cheerio parse | No asset rendering, no idle wait |
| CAPTCHA solve | Element screenshot to disk, read file, send to Gemma4 | Download image Buffer, send directly to Gemma4 | Removes file I/O and screenshot overhead |
| Returns navigation | Hover menus, wait for selectors, JS click | Direct GET/POST to known `actionCode` URLs | Removes UI interaction delays |
| Form submission | Fill inputs, click Next, wait for page | Build typed payload, POST, parse response | No artificial human delays |
| Receipt download | Intercept browser download/popup/print | Stream PDF directly to disk | Reliable, no browser event race |
| **Nil return e2e** | **~30–90s** | **~5–15s** | **~3–6x faster** |

**Resource impact:** CPU and memory per job will drop because there is no Chromium process, no rendered DOM, and no image/screenshot manipulation except the CAPTCHA image itself.

**Caveats:**
- KRA backend slowness (502/504) is external and unchanged; retries absorb it but do not eliminate it.
- Gains are limited to the obligation types ported to HTTP. PAYE/VAT/MRI/PRN remain Playwright-based in this phase.

## 12. Phase 2 Porting Playbook (PAYE / VAT / MRI / PRN)

### 12.1 Capture Real Browser Traffic
1. Instrument the existing Playwright path in `kraFilingWorker.ts` to record a HAR file or request/response JSONL during one real filing per obligation type.
2. Alternative: use Playwright's built-in `recordHar` option when creating the context.
3. Keep capture artifacts out of git; add `*.har`, `*.jsonl`, and `kra-captures/` to `.gitignore`.

### 12.2 Extract Required Parameters
For each captured request, record:
- HTTP method and full URL.
- All request headers (`Content-Type`, `Referer`, `Cookie`).
- Complete POST body (form fields, multipart boundaries, file parts).
- Response status, `Set-Cookie` headers, and response HTML.
- The preceding page URL and the UI action that triggered the request.

### 12.3 Replay with curl / got-scraping
1. Reconstruct the login POST from the capture and verify `JSESSIONID` is issued.
2. Replay each subsequent request in order, parsing each response HTML with `cheerio` to extract the fresh `token_key`.
3. For uploads, rebuild multipart bodies using the captured field names and file part metadata.
4. Confirm end-to-end success: acknowledgement number or receipt PDF is returned.

### 12.4 Minimize Payloads
Remove one non-obvious field at a time from each POST body until KRA rejects the request. The surviving set becomes the typed payload interface for that step.

### 12.5 Expected Phase 2 Flows

| Flow | HTTP Steps | Special Notes |
|---|---|---|
| **PAYE upload** | 1. GET upload form → 2. POST multipart ZIP + declaration + token_key → 3. Submit → 4. Download receipt | Reuse `resolveUploadArtifactPath()` for local ZIP resolution |
| **VAT upload** | Same shape as PAYE; may include additional fields from VAT upload form | Validate against `VAT_SUBMISSION_ERROR_PATTERNS` |
| **VAT prepare-only** | 1. Select VAT obligation → 2. Click auto-populated download → 3. Capture ZIP response → 4. Run `prepareVatReturnArtifacts` | Download trigger is currently `eReturns.htm?actionCode=downloadAmendmentForms` |
| **MRI** | 1. POST period → 2. POST rental income (`mriRentAmount_0`) → 3. Submit → 4. Download receipt | Two-stage Next/Submit POSTs |
| **PRN** | 1. Payment Registration → 2. Applicant Next → 3. Tax Head POST → 4. Tax Sub Head POST (AJAX) → 5. Payment Type → 6. Tax Period → 7. Add Liability → 8. Submit → 9. Download PDF | Most steps; may require replaying AJAX cascade that populates dependent dropdowns |

## 13. Implementation Status

| Item | Status | Notes |
|---|---|---|
| Dependencies (`got-scraping`, `tough-cookie`, `cheerio`) | ✅ Installed | `tls-client` omitted due to native build failure on Windows; can be revisited if WAF blocks |
| `KraHttpClient` / `KraHttpSession` | ✅ Implemented | Cookie jar + token extraction wired |
| `HttpLoginService` | ✅ Implemented | CAPTCHA fetched as Buffer and sent to Gemma4 |
| `ReturnsNavigator` | ✅ Implemented | Obligation selection by regex pattern |
| `NilReturnSubmitter` | ✅ Implemented | Parameter-driven POST builder |
| `BinaryDownloader` | ✅ Implemented | PDF streaming (JS-function download path stubbed) |
| Error mapper (`KraErrorCode`, `mapPortalMessage`) | ✅ Implemented | Covers session/password/captcha/portal errors |
| Parser unit tests | ✅ Passing | 11 tests covering token, CAPTCHA, login, obligations, submission, noticeId extraction |
| Playwright fallback in `kraFilingWorker.ts` | ✅ Implemented | `USE_HTTP_ENGINE` env var or `payload.useHttpEngine` triggers HTTP path; falls back on error |
| Live KRA login validation | ✅ Done | Credentials accepted; dashboard HTML returned via pure HTTP |
| Live nil-return endpoint validation | ✅ Done | Filed PAYE nil returns for April/May/June 2026 via pure HTTP; receipts downloaded and validated as PDF |
| HAR/network/token capture | ✅ Done | `file-paye-nil-existing-flow.ts` captures HAR, requests+responses, console logs, token history, and state snapshots |
| `ReturnsNavigator` non-nil support | ✅ Implemented | `selectReturnObligation` for upload flows (ToT) |
| `TotReturnSubmitter` | ✅ Implemented | Generates TOT ZIP, builds multipart form, POSTs `actionCode=excelUpload`, parses receipt |
| TOT HTTP routing | ✅ Implemented | `turnover_tax` jobs routed through HTTP engine when `USE_HTTP_ENGINE=true` |

## 14. Activation

Set the environment variable before starting the worker:

```bash
USE_HTTP_ENGINE=true
```

Or send `"useHttpEngine": true` in the filing job payload.

## 15. Known Limitations / Next Steps

1. **KRA login entry path.** Direct `GET /KRA-Portal/login.htm` returns `invalidAccess`. The real login form is embedded in `GET /KRA-Portal/` (the landing page). The HTTP engine now uses the landing page.

2. **KRA login uses client-side JS crypto.** The password is encrypted with SHA1 + AES-CTR over a DH-style shared secret (`generator`, `modulus`, `senderIntrmKey`, `rcpntIntrmKey`). The engine executes the original `login_merged.js` in a Node `vm` context (with a patched iterative `xpowYmodN` to avoid stack overflow) instead of porting the crypto by hand.

3. **DWR preamble is required.** Before the login POST, the browser loads DWR JS files and calls `__System.pageLoaded` (which returns the `scriptSessionId`) followed by `CheckLoginPin.checkLoginPin`. The HTTP engine replicates this.

4. **Exact form field order matters.** The login form has interleaved duplicate keys (`fieldsToSkip`, `logid`). The engine builds the POST body with `URLSearchParams` to preserve insertion order.

5. **CAPTCHA `rand` parameter must be randomized.** The landing page embeds a placeholder `rand=10.0`; the engine replaces it with a random value before fetching the image.

6. **Login outcome parser must distinguish menu from forced change.** The post-login dashboard contains a "Change Password" menu item. The parser now checks for forced-change text (`password has expired`, `first time login`, etc.) and also verifies the absence of a post-login menu before flagging `password-change`.

7. **Receipt download via JS function is implemented.** The parser extracts the real `noticeId` from the `downloadReturnsReceipt()` function body and downloads the PDF directly from `eCerificate.htm?actionCode=loadReceipt&noticeId=<id>`.

8. **Phase 2 flows (PAYE/VAT/MRI/PRN)** remain on Playwright and require HAR capture before HTTP porting.

9. **Captured nil-return sequence.** The Playwright capture script `backend/src/scripts/file-paye-nil-existing-flow.ts` recorded the full network sequence; the HTTP engine replays it.

## 16. Decisions Log

| # | Decision | Status |
|---|---|---|
| 1 | First HTTP implementation: **nil returns** | ✅ Resolved |
| 2 | Keep Playwright as feature-flag fallback during validation | ✅ Resolved |
| 3 | Use `got` v11 (CJS) instead of ESM `got-scraping` | ✅ Resolved |
| 4 | Execute original KRA `login_merged.js` in Node `vm` for crypto | ✅ Resolved |
| 5 | Replicate DWR preamble (`pageLoaded` + `CheckLoginPin`) before login POST | ✅ Resolved |
| 3 | Reuse existing `JobContext` progress steps for parity | ✅ Resolved |
