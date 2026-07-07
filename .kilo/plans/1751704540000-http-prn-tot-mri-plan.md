# HTTP PRN Generation for ToT and MRI

## 1. Goal
Implement a pure HTTP state-machine path for generating Payment Registration Numbers (PRNs) for **Turnover Tax (ToT)** and **Monthly Rental Income (MRI)** after the return has already been filed. The implementation will be driven by the HAR capture `backend/itax.kra.go.ke.har` that records the manual Chrome flow.

This is **not** a generic standalone PRN creator; it assumes KRA already has a liability for the selected period (i.e. the return was filed first). For ToT/MRI that is the normal workflow.

## 2. Scope

### In scope
- HTTP PRN generation for `turnover_tax`.
- HTTP PRN generation for `monthly_rental_income`.
- Reuse of the existing `KraHttpSession`, `KraHttpClient`, DWR service, and login service.
- Navigation: Payments → Payment Registration → Applicant Type → Tax Form → Liability selection → Submit → Download PDF.
- Extraction of PRN number, search code, expiry date, and PDF URL from the success page.
- PDF download to the same local/GCS path used by Playwright PRNs.
- Integration into `kraFilingWorker.ts` so `printPrnOnly` jobs can be routed through HTTP when `USE_HTTP_ENGINE=true`.
- Playwright remains the fallback for any HTTP failure.

### Out of scope
- Generating PRNs for tax types with no filed liability (VAT, PAYE, etc.) in this phase.
- Payment modes other than **Other Payment Modes** (OPM).
- Pay-now / M-Pesa / card payment flows.
- iTax survey popup handling (we will suppress or dismiss it by not triggering it).

## 3. Flow mapped from HAR (ToT example)

The captured manual flow for PIN `A006711943R`, June 2026 ToT is:

1. **Login** — existing `HttpLoginService` (`KRA-Portal/` landing page, DWR preamble, login POST).
2. **Payment Registration pre-form**
   - `POST /KRA-Portal/paymentRegistration.htm?actionCode=beforeLoadPRForm`
   - Response contains the Applicant Type form with hidden `token_key`.
3. **Applicant Type submission**
   - `POST /KRA-Portal/paymentRegistration.htm?actionCode=loadPRForm`
   - Form fields include `applicantTypeDropDown=T`, `taxpayerPin`, hidden `clientPin`, `agentPinForSubAgent`, and `token_key`.
   - Response is the Tax Form (`Payment Information`).
4. **Tax Form initialization DWR calls**
   - `POST dwr/call/plaincall/FetchTaxPayerDetail.fetchTaxPayerDetail.dwr`
   - `POST dwr/call/plaincall/GetObligationRollOutDateDtls.getObligationRollOutDateDtls.dwr`
   - `POST dwr/call/plaincall/FetchTaxPeriod.fetchTaxPeriod.dwr`
   - These populate dropdowns and validate the obligation.
5. **Liability fetch**
   - `POST dwr/call/plaincall/FetchTotalLiabilityDetailsWeb.fetchTotalLiabilityDetailsWeb.dwr`
   - Returns the `LiablibilityTbl` rows (period, principal, interest, penalty, amount payable).
   - For June 2026 ToT: amount payable = 450.00.
6. **Obligation detail DWR**
   - `POST dwr/call/plaincall/FetchObligationDetail.fetchObligationDetail.dwr`
   - `POST dwr/call/plaincall/GetObligationRollOutDateDtls.getObligationRollOutDateDtls.dwr`
   - `POST dwr/call/plaincall/GetSelectedMonthOfSelectedYearWeb.getSelectedMonthOfSelectedYearWeb.dwr`
   - These are triggered by selecting the period and/or reading the liability row.
7. **Add selected liability**
   - The browser selects the radio for the June 2026 row, clicks **Add**, and accepts `confirm("Do you want to add details?")`.
   - No separate HTTP request is made for the Add; the row is serialized into the final submit POST.
8. **Final submit**
   - `POST /KRA-Portal/paymentRegistration.htm?actionCode=saveObligationDetail`
   - Massive form payload including:
     - `token_key`, `serverDate`, `currServerDate`
     - `paymentdetailDTO.pinNo`, `.taxPayerFirstName`, `.taxPayerFullAddr`, `.emailId`
     - `cmbTaxHead=IT`, `cmbTaxSubHead=8`, `cmbPaymentType=SAT`
     - `cmbTaxPeriod=-1`, `cmbTaxPeriodYear=-1`, `cmbIncomeType=-1`
     - `actualLiabilityAmount_0=450`
     - `start_taxObligationTable=3`, `counter_taxObligationTable=1`, `start_row_taxObligationTable=1`
     - `taxObligationTable_1=<encoded row data>`
     - `paymentdetailDTO.totalAmountTobePaid=450`
     - `paymentdetailDTO.paymentMode=OPM`
     - `paymentdetailDTO.bankCd=-1`, `paymentdetailDTO.bankIdRTGS=-1`, `paymentdetailDTO.branchIdRTGS=-1`, `paymentdetailDTO.beneAccIdRTGS=-1`
   - Response is the success page: `Payment registration done successfully`, PRN, search code, expiry date, and `Download Payment Slip` link.
9. **PDF download**
   - The success page link is a JS function (`downloadPinCertificate()` or similar) that triggers a PDF download.
   - We must parse the actual download URL from the page (likely `paymentRegistration.htm?actionCode=downloadPRN...` or a certificate URL) and stream it with `KraHttpClient.getBuffer`.

## 4. Module design

Create under `backend/src/workers/http/`:

```
backend/src/workers/http/
├── prn/
│   ├── HttpPrnService.ts          # orchestrates the full PRN flow
│   ├── PaymentRegistrationNavigator.ts  # beforeLoadPRForm → loadPRForm
│   ├── TaxFormInteractor.ts       # selects head/sub-head/payment-type/period
│   ├── LiabilitySelector.ts       # parses LiablibilityTbl and builds row payload
│   └── PrnSuccessParser.ts        # extracts PRN number / PDF URL from success page
```

### 4.1 `PaymentRegistrationNavigator`
- `enterApplicantType(pin: string, applicantType = 'T')`
  - POST `paymentRegistration.htm?actionCode=beforeLoadPRForm` to fetch form.
  - Extract hidden `token_key` and form fields.
  - POST `paymentRegistration.htm?actionCode=loadPRForm` with `applicantTypeDropDown=T`, `taxpayerPin=<pin>`, and hidden fields.
  - Return the Tax Form HTML.

### 4.2 `TaxFormInteractor`
- `selectTaxHeadAndSubHead(html: string, taxHead = 'IT', subHeadLabelRegex: RegExp)`
  - Parse the Tax Form HTML for `cmbTaxHead` options and values.
  - Parse `cmbTaxSubHead` options (populated by JS after Tax Head selection; may need DWR `FetchObligationDetail`).
  - For ToT: select `cmbTaxHead=IT`, `cmbTaxSubHead=8` (value for `(0107) Income Tax - Turnover Tax`).
  - For MRI: select `cmbTaxHead=IT`, `cmbTaxSubHead=<value matching Rent Income>`.
- `selectPaymentType(paymentType = 'SAT')` (`SAT` = Self Assessment Tax).
- `selectTaxPeriod(year: string, month: string)`
  - Triggers DWR `FetchTaxPeriod`, `GetSelectedMonthOfSelectedYearWeb`, and `FetchTotalLiabilityDetailsWeb`.
  - Returns the liability table rows.

### 4.3 `LiabilitySelector`
- `parseLiabilityTable(html: string)`
  - Extract rows from `#LiablibilityTbl` with columns: period, principal, fines, penalty, interest, amount payable, amount to be paid.
- `selectPeriod(rows, targetPeriod)`
  - Find the row matching the requested period.
  - Return fields needed for `taxObligationTable_1` and `actualLiabilityAmount_0`.

### 4.4 `HttpPrnService`
- `execute(input: HttpPrnInput): Promise<HttpPrnResult>`
  - Accepts `kraPin`, `taxObligationType`, `periodFrom`, `periodTo`.
  - Calls login (or receives an already-authenticated session from the orchestrator).
  - Navigates to Payment Registration, fills Tax Form, selects liability, submits.
  - Parses success page, downloads PDF.
  - Returns `{ prnNumber, searchCode, expiryDate, receiptPath }`.

### 4.5 `PrnSuccessParser`
- `parseSuccessPage(html: string)`
  - Extract PRN number, search code, expiry date.
  - Extract the PDF download URL from the `Download Payment Slip` link or JS function.
- `downloadPdf(url: string, destPath: string)`
  - Stream with `KraHttpClient.getBuffer` and save.

## 5. Files to modify

1. **`backend/src/workers/http/index.ts`**
   - Export new PRN modules.

2. **`backend/src/workers/http/filing/HttpFilingOrchestrator.ts`**
   - Add a new branch: when `payload.printPrnOnly === true` and tax type is `turnover_tax` or `monthly_rental_income`, delegate to `HttpPrnService` instead of filing services.

3. **`backend/src/workers/kraFilingWorker.ts`**
   - Route `printPrnOnly` jobs through HTTP engine when `USE_HTTP_ENGINE=true`/`payload.useHttpEngine=true`.
   - On HTTP failure, fall back to existing Playwright `PrnService`.

4. **`backend/src/utils/kra-prn-generator.ts`** (optional)
   - Keep for Playwright fallback; do not delete.

5. **`backend/src/types/index.ts`**
   - Add `HttpPrnInput`, `HttpPrnResult` interfaces.

## 6. Implementation order

### Step 1: Parse the HAR into a minimal replay script
- Write a temporary Node script that replays the captured requests using `KraHttpClient` and confirms the same success page is reached.
- This validates that cookies, token_key, and form field order are correct.

### Step 2: Build `PaymentRegistrationNavigator`
- Implement Applicant Type page handling.
- Confirm it reaches the Tax Form page for both ToT and MRI.

### Step 3: Build `TaxFormInteractor` + DWR calls
- Replicate the DWR calls that populate Tax Head / Tax Sub Head / Payment Type / Tax Period.
- Confirm the liability table appears for the target period.

### Step 4: Build `LiabilitySelector`
- Parse the liability table and build the `taxObligationTable_1` encoded row string.

### Step 5: Build final submit + success parser
- Construct the `saveObligationDetail` POST payload.
- Submit and parse the success page for PRN details.

### Step 6: PDF download
- Extract the PDF URL from the success page.
- Download and save to `receipts/<jobId>/...pdf`.

### Step 7: Integrate into worker
- Wire `HttpPrnService` into the orchestrator / `kraFilingWorker.ts`.
- Add fallback to Playwright.

### Step 8: Test
- End-to-end test with Joe Taxi June 2026 ToT.
- End-to-end test with Sam Cornelius June 2026 MRI.

## 7. Key technical details

### 7.1 Form field order
The `saveObligationDetail` POST body is `application/x-www-form-urlencoded` and contains hundreds of fields in a specific order. We will build it with `URLSearchParams` (or ordered object) and mirror the exact sequence from the HAR for the fields that KRA validates.

### 7.2 `token_key`
Every page response contains a new `token_key`. The session must extract and use the latest one before each POST.

### 7.3 DWR batch IDs
DWR calls use `scriptSessionId` and batch IDs. The existing `DwrService` already handles this; extend or reuse it for the new DWR methods:
- `FetchTaxPayerDetail.fetchTaxPayerDetail`
- `GetObligationRollOutDateDtls.getObligationRollOutDateDtls`
- `FetchTaxPeriod.fetchTaxPeriod`
- `FetchTotalLiabilityDetailsWeb.fetchTotalLiabilityDetailsWeb`
- `FetchObligationDetail.fetchObligationDetail`
- `GetSelectedMonthOfSelectedYearWeb.getSelectedMonthOfSelectedYearWeb`

### 7.4 Period encoding
Tax Period is split into a year dropdown and month dropdown. The HAR shows the period selected as `2026` / `June`, and the final form uses `-1` for the combined `cmbTaxPeriod` but the liability row encodes `fromDate=01/06/2026&toDate=30/06/2026`.

### 7.5 MRI differences
- Tax Sub Head will be the Rent Income option (likely a different numeric value and label).
- Liability table columns/period format may differ slightly; the parser should be flexible.

## 8. Validation plan

| Test | Expected result |
|---|---|
| Replay HAR with `KraHttpClient` | Reaches success page with PRN number |
| ToT PRN for Joe Taxi June 2026 via HTTP | PRN generated, PDF downloaded, Firestore updated |
| MRI PRN for Sam Cornelius June 2026 via HTTP | PRN generated, PDF downloaded, Firestore updated |
| HTTP failure fallback to Playwright | If HTTP fails, Playwright PRN is attempted |
| Type-check | `npx tsc --noEmit` passes |

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `saveObligationDetail` rejects field subset | Build payload from HAR exactly; minimize only after success |
| DWR batch ID / scriptSessionId mismatch | Reuse existing `DwrService`; add tests against captured DWR bodies |
| PDF download URL is JS-generated | Parse the JS function body or the `href`/`onclick` attribute on the success page |
| MRI obligation has different DWR flow | Capture separate MRI HAR if needed; keep parser flexible |
| KRA portal changes hidden field names | Centralize field-name constants; update from fresh HAR |

## 10. Deliverables

1. New HTTP PRN modules under `backend/src/workers/http/prn/`.
2. Integration into `HttpFilingOrchestrator` and `kraFilingWorker.ts`.
3. Updated types in `backend/src/types/index.ts`.
4. End-to-end validation for ToT and MRI.
5. No changes to frontend (status/progress messages remain identical).
