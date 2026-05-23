# Complete Payroll Pipeline Implementation Plan

## Overview

Replace the monolithic `PayrollWebView.tsx` (~2500 lines, 14+ tabs) with a **step-driven pipeline wizard** embedded in a **Payroll Pipeline Dashboard**. Each step maps to one phase of the backend payroll lifecycle. The UI drives users forward with clear progress, validation gating, and sub-step status tracking.

---

## A. PAYROLL CALCULATION FLOW (correct Kenyan order)

```
┌──────────────────────────────────────────────────────────────────┐
│  STEP 1: Attendance-Based Pay                                    │
│                                                                  │
│  basicPay (prorated for days worked / joiners / leavers)         │
│  - absentDays × dailyRate                                        │
│  - lateHours / standardWorkHours × dailyRate                     │
│  - unpaidLeaveDays × dailyRate                                   │
│  + overtimePay                                                   │
│  = netAttendancePay                                              │
├──────────────────────────────────────────────────────────────────┤
│  STEP 2: Add Bonuses                                             │
│                                                                  │
│  + taxableBonus (included in SHA/NSSF/AHL base — this is correct)│
│  + nonTaxableBonus (added back at end, not in statutory base)    │
├──────────────────────────────────────────────────────────────────┤
│  STEP 3: Add Benefits (NOT prorated — fixed monthly values)    │
│                                                                  │
│  + carBenefit                                                    │
│  + mealsBenefit                                                  │
│  + nonCashBenefits                                               │
│  + housingBenefit                                                │
│  + otherBenefits                                                 │
│                                                                  │
│  = GROSS PAY  ← SHA, NSSF, AHL computed on this                  │
├──────────────────────────────────────────────────────────────────┤
│  STEP 4: Statutory Deductions                                    │
│                                                                  │
│  - SHA (2.75% of gross)                                          │
│  - NSSF (6% tiered: Tier 1 up to 9,000, Tier 2 up to 99,000)    │
│  - AHL (1.5% of gross)                                           │
├──────────────────────────────────────────────────────────────────┤
│  STEP 5: PAYE (Tax)                                              │
│                                                                  │
│  Taxable Pay = Gross - SHA - NSSF(pension capped 30k)             │
│                - postRetMedical(capped 15k)                       │
│                - mortgageInterest(capped 30k)                     │
│                - AHL - PWD exemption(12.5k)                       │
│                                                                  │
│  PAYE = progressive bands:                                       │
│    10% on 0-24,000                                               │
│    15% on 24,001-32,333                                          │
│    5% on 32,334-500,000                                          │
│    2.5% on 500,001-800,000                                       │
│    2.5% on 800,001+                                              │
│  - personalRelief(2,400)                                         │
│  - insuranceRelief(capped 5,000 — editable per-run, auto-capped) │
├──────────────────────────────────────────────────────────────────┤
│  STEP 6: Other Deductions                                        │
│                                                                  │
│  - loanDeduction (from active loans, auto-pulled)                │
│  - otherDeductions (from Adjustments step)                       │
├──────────────────────────────────────────────────────────────────┤
│  NET PAY = Gross - SHA - NSSF - AHL - PAYE - Other + nonTaxableBonus
└──────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions for the Calculation

| Decision | Choice | Rationale |
|---|---|---|
| Benefit proration | No — benefits are fixed monthly values | Car benefit, housing, etc. don't change if employee joins mid-month |
| Bonus in statutory base | Yes, for taxableBonus only | Low-income employees (basicPay ≤ 11,180) get nonTaxableBonus added at net pay |
| Insurance Relief | Auto-populated from employee record, overridable per-run, capped at 5,000 by backend | Master data is the default; user adjusts per run if situation changes |
| Loan Deduction | Auto-pulled from active loans with remainingInstallments > 0 | No manual entry; managed via Loans CRUD |

---

## B. BACKEND ENGINE CHANGES (Phase 0 — prerequisite)

### B1. Break `benefits` into individual components in `PayrollInput`

File: `backend/src/services/payrollEngine.ts`

Current:
```typescript
interface PayrollInput {
    basicPay: number;
    benefits: number;  // single combined value
    // ...
}
```

Change to:
```typescript
interface PayrollInput {
    basicPay: number;
    // Individual benefits (new)
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    housingBenefit: number;
    otherBenefits: number;
    // ...
}
```

In `computePayrollEntry`, line ~183:
```typescript
// Replace:
// const benefits = roundMoney(rawBenefits * prorationFactor);
// With:
const carBenefit = input.carBenefit || 0;
const mealsBenefit = input.mealsBenefit || 0;
const nonCashBenefits = input.nonCashBenefits || 0;
const housingBenefit = input.housingBenefit || 0;
const otherBenefits = input.otherBenefits || 0;
const totalBenefits = carBenefit + mealsBenefit + nonCashBenefits + housingBenefit + otherBenefits;
```

**Remove proration from benefits** — benefits stay at full monthly value regardless of days worked.

On line ~210, change:
```typescript
// From:
const grossPay = roundMoney(basicPay + benefits + overtimePay + taxableBonus - unpaidLeaveDeduction - attendanceDeduction);
// To:
const grossPay = roundMoney(basicPay + totalBenefits + overtimePay + taxableBonus - unpaidLeaveDeduction - attendanceDeduction);
```

Update `adjustedBenefits` (line ~221):
```typescript
const adjustedBenefits = roundMoney(totalBenefits + totalAllowances);
```

### B2. Update `PayrollComputed` output

File: `backend/src/services/payrollEngine.ts`

Add individual benefit fields to the output so the frontend can display them:
```typescript
interface PayrollComputed {
    // ... existing fields ...
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    housingBenefit: number;
    otherBenefits: number;
    housingType: string;  // from employee record
}
```

### B3. Update `POST /api/payroll/calculate-preview`

File: `backend/src/api/payroll.routes.ts`

Update the handler to accept the 5 individual benefit fields instead of the combined `benefits` field. Map them to the engine input.

### B4. Update `generateEntriesForRun`

File: `backend/src/api/payroll-runs.routes.ts`

Change line ~225 from `benefits: 0` to pass individual benefit values from the employee record:

```typescript
// Current:
benefits: 0,

// New:
carBenefit: emp.carBenefit || 0,
mealsBenefit: emp.mealsBenefit || 0,
nonCashBenefits: emp.nonCashBenefits || 0,
housingBenefit: emp.housingBenefit || 0,
otherBenefits: emp.otherBenefits || 0,
```

### B5. New table: `payroll_entry_overrides` (optional migration)

For persisting per-run input overrides (user edits benefits/absent days/bonus in the table).

```sql
CREATE TABLE payroll_entry_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payrollEntryId INTEGER NOT NULL,
    employeeId INTEGER NOT NULL,
    payrollRunId INTEGER NOT NULL,
    basicPay REAL,
    carBenefit REAL,
    mealsBenefit REAL,
    nonCashBenefits REAL,
    housingBenefit REAL,
    otherBenefits REAL,
    bonusPay REAL,
    insuranceRelief REAL,
    absentDays REAL,
    lateHours REAL,
    overtimePay REAL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (payrollEntryId) REFERENCES payroll_entries(id),
    FOREIGN KEY (employeeId) REFERENCES employees(id),
    FOREIGN KEY (payrollRunId) REFERENCES payroll_runs(id)
);
```

Alternatively: add an `overrides` JSON column directly on `payroll_entries` to avoid a join.

### B6. New endpoint: `POST /api/clients/:clientId/payroll-runs/:id/update-entry`

Purpose: Persist user overrides for a specific employee's inputs in a run.

```typescript
Request body: {
    employeeId: number;
    basicPay?: number;
    carBenefit?: number;
    mealsBenefit?: number;
    nonCashBenefits?: number;
    housingBenefit?: number;
    otherBenefits?: number;
    bonusPay?: number;
    insuranceRelief?: number;
    absentDays?: number;
    lateHours?: number;
    overtimePay?: number;
}
```

Upserts into `payroll_entry_overrides`. When `GET /payroll-runs/:id/entries` is called, merge overrides with generated values.

### B7. Update `GET /api/clients/:clientId/payroll-runs/:id/entries`

Return both:
1. Computed values (existing)
2. Overrideable input fields with current values (merged from generated + overrides)
3. A flag indicating which fields have overrides

---

## C. FRONTEND TABLE LAYOUT (Step 5 Review & Preview)

The table in Step 5 shows ALL columns grouped visually. Input columns trigger `POST /calculate-preview` on blur (300ms debounce).

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  [Search]  [Filter by dept]  [▼ Previous run comparison]  [Export CSV]                                         │
├─────────┬───────────┬────────┬────────┬────────┬────────┬──────────┬────────┬────────┬───────┬──────┬──────┬────┤
│ EMPLOYEE│ ATTENDANCE INPUTS         │ BONUS  │ BENEFITS (KRA Filing)              │ GROSS │STAT  │ TAX  │NET  │
├─────────┼───────────┼────────┼────────┼────────┼────────┼──────────┼────────┬───────┼───────┼──────┼──────┼────┤
│ Name    │ Basic Pay │ Absent │ Late   │ OT     │ Bonus  │ Car Ben  │ Meals  │ Hous  │ Gross │ SHA  │ PAYE │Net  │
│ PIN     │           │ Days   │ Hours  │        │        │          │ ...    │ Ben   │       │ NSSF │      │     │
│ #       │           │        │        │        │        │          │        │       │       │ AHL  │      │     │
├─────────┼───────────┼────────┼────────┼────────┼────────┼──────────┼────────┼───────┼───────┼──────┼──────┼────┤
│ John D  │  50,000   │   2    │  1.5   │ 3,000  │ 5,000  │  8,000   │ 0      │ 10,000│ 74,000│ 2,035│12,347│52.4│
│ P000A   │ editable  │ edit   │ edit   │ edit   │ edit   │  edit    │ edit   │ edit  │ auto  │ auto │ auto │auto│
├─────────┼───────────┼────────┼────────┼────────┼────────┼──────────┼────────┼───────┼───────┼──────┼──────┼────┤
│ Jane S  │  35,000   │   0    │  0     │ 0      │ 2,000  │  0       │ 1,500  │ 0     │ 38,500│ 1,059│ 5,400│... │
│ P000B   │ editable  │ edit   │ edit   │ edit   │ edit   │  edit    │ edit   │ edit  │ auto  │ auto │ auto │auto│
└─────────┴───────────┴────────┴────────┴────────┴────────┴──────────┴────────┴───────┴───────┴──────┴──────┴────┘
                                                          ┌──────────────────────────────────────────────────────────┐
                                                          │  Totals:  Gross 112,500  │  Deductions 25,480  │  Net 87,020│
                                                          └──────────────────────────────────────────────────────────┘
```

### Column Specifications

| Group | Columns | Editable | Source |
|---|---|---|---|
| **Employee** | Employee Name, Payroll #, KRA PIN | No | DB |
| **Attendance** | Basic Pay, Absent Days, Late Hours, Unpaid Leave, Overtime | Yes | Overrides table (defaults from generated) |
| **Bonuses** | Bonus Pay | Yes | Overrides table |
| **Benefits** | Car Ben, Meals, Non-Cash, Housing Type, Housing Ben, Other Ben | Yes (housing type is dropdown) | Overrides table (defaults from employee record) |
| **Gross** | Gross Pay | No | Auto from engine |
| **Statutory** | SHA, NSSF, AHL | No | Auto from engine |
| **Tax** | Taxable Pay, PAYE | No | Auto from engine |
| **Reliefs** | Personal Relief (2,400), Insurance Relief | Insurance only (capped 5k) | Auto from engine |
| **Deductions** | Loan Deduction, Other Deductions | Loan = auto, Other = from adjustments | Auto |
| **Net** | Total Deductions, Net Pay | No | Auto from engine |

### Visual Treatment

- **Input columns**: white background, border on hover, click-to-edit shows inline input
- **Computed columns**: subtle gray background, non-editable
- **Benefits group**: light yellow/amber background tint to distinguish as KRA-filing-critical values
- **Totals bar**: sticky bottom, bold, dark background
- **Comparison mode**: when toggled on, each row shows a delta column (+3.2% with arrow indicator)

---

## D. PIPELINE STEPS

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  PIPELINE NAV (horizontal stepper — collapses to dots on mobile)              │
│                                                                               │
│  ① Setup  →  ② Attendance  →  ③ Run Gen  →  ④ Adjust  →  ⑤ Review  →  ⑥ Finalize  →  ⑦ Compliance  │
│     Approval                  ments          Preview                           │
│  ┌──┐       ┌──┐             ┌──┐          ┌──┐          ┌──┐               ┌──┐            ┌──┐         │
│  │✓ │       │2 │             │3 │          │4 │          │5 │               │6 │            │7 │         │
│  │  │       │  │             │  │          │  │          │  │               │  │            │  │         │
│  └──┘       └──┘             └──┘          └──┘          └──┘               └──┘            └──┘         │
│  Complete   75%              Locked       Locked        Active              Locked          Locked      │
│  (click to   (sub-step:                    (disabled)   (disabled)          (current)       (disabled)  │
│   revisit)   "3 done)                                                       (disabled)                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Step 1: Setup

**When**: Creating a new payroll run or editing employee master data before generating.

**Content** (all extracted from existing PayrollWebView tabs):
- Employee manager (CRUD, import from master CSV)
- Loan manager (CRUD for active loans)
- Work schedule manager
- Leave types

**Validation**: At least 1 active employee with basicPay > 0.

**Navigation**: Next → Step 2 (if no attendance data exists, warn and skip directly to Step 3).

### Step 2: Attendance Approval

**When**: Before generating a run. Reviews attendance for the period.

**Content** (extracted from attendance approval modal):
- Preview grid: per-employee absentDays, lateHours, overtimeHours (read from DB)
- Approved attendance data takes priority (from `attendance_payroll_approvals`)
- Bulk approve button
- Override fields for individual employees

**API**: `POST /api/clients/:clientId/attendance-payroll-preview?period=YYYY-MM`
**API**: `POST /api/clients/:clientId/attendance-payroll-approve`

**Validation**: All employees reviewed (approved or explicitly set to 0 absent days).

**Navigation**: Previous → Step 1 | Next → Step 3.

### Step 3: Run Generation

**When**: Creating entries for the period.

**Content**:
- Period selector (default: current period from `getCurrentFilingPeriod()`)
- Notes field (optional)
- "Generate Payroll Run" button
- Animated progress with sub-step labels (simulated or from backend `processingSteps`):

```
  "Creating payroll run..." (0%)
  "Fetching employees (5/5)" (15%)
  "Computing benefits" (25%)
  "Computing SHA (12/12)" (40%)
  "Computing NSSF (12/12)" (55%)
  "Computing AHL (12/12)" (70%)
  "Applying loan deductions (3/3)" (80%)
  "Computing PAYE (12/12)" (90%)
  "Done — 12 entries generated" (100%)
```

**API** (if no existing run): `POST /api/clients/:clientId/payroll-runs` with `{ period, notes, prorate: true }`
**API** (if run exists): `POST /api/clients/:clientId/payroll-runs/:id/generate`

**Auto-advance**: On 100%, transition to Step 4.

**Navigation**: Previous → Step 2 (or Step 1 if skipped) | Next → auto to Step 4.

### Step 4: Adjustments

**When**: After generating entries. User adds dynamic allowances/deductions.

**Content** (extracted from existing adjustment UI):
- Per-employee table of adjustments
- Add: employee, type, label, amount, isStatutory flag
- Edit/Delete existing adjustments

**Behavior**:
- Allowances increase gross pay (affects SHA/NSSF/AHL/PAYE)
- Non-statutory deductions increase otherDeductions (post-tax)
- After changes: "Re-generate entries" button (calls `POST /.../generate`)

**API**: `GET/POST/PUT/DELETE /api/clients/:clientId/payroll-runs/:id/adjustments`

**Validation**: At least reviewed (no hard validation — can skip with 0 adjustments).

**Navigation**: Previous → Step 3 | Next → Step 5.

### Step 5: Review & Preview

**When**: Reviewing computed entries before finalizing.

**Content** (see Section C for full table spec):
- Payroll entries table with all columns (attendance inputs, benefits, computed values)
- Search by name/KRA PIN
- Filter by department
- Sort any column
- Per-employee row expansion (click to see full breakdown)
- Comparison toggle: diff against previous run
- Sticky totals bar at bottom
- "Edit" on input columns triggers inline editing + `POST /calculate-preview` with 300ms debounce

**API**: `GET /api/clients/:clientId/payroll-runs/:id/entries`
**API**: `POST /api/payroll/calculate-preview` (for inline preview)
**API**: `POST /api/clients/:clientId/payroll-runs/:id/update-entry` (for persisting overrides)

**Behavior**:
- Input column edit → 300ms debounce → `POST /calculate-preview` → update computed columns
- "Save" button persists overrides via `POST /update-entry` for all changed rows
- If overrides exist, show "Modified" badge on the row

**Navigation**: Previous → Step 4 | Next → Step 6.

### Step 6: Finalize

**When**: Locking the run for closure.

**Content**:

**Receipt Summary Modal**:
```
┌────────────────────────────────────────────────────┐
│  💰 Finalize Payroll — November 2024               │
│                                                    │
│  ┌──────────────────────────────────────┐          │
│  │  Total Gross Pay:    KES 1,245,000  │          │
│  │  Total Deductions:   KES   345,200  │          │
│  │  Total Net Pay:      KES   899,800  │          │
│  │  Employees:          12             │          │
│  └──────────────────────────────────────┘          │
│                                                    │
│  ⚠  1/3 Rule Warning:                              │
│  John Doe net pay (18,000) < 1/3 of gross (74,000) │
│  [Not blocking — review recommended]               │
│                                                    │
│  [Cancel]  [Confirm Finalize]                      │
└────────────────────────────────────────────────────┘
```

**After Finalize — Success**:
```
┌────────────────────────────────────────────────────┐
│  ✅ Payroll Finalized                              │
│  Finalized at: Nov 25, 2024 14:30                  │
│  ┌──────────────────────────────────────┐          │
│  │  Total Gross:    KES 1,245,000      │          │
│  │  Total Net:      KES   899,800      │          │
│  │  Loan Deductions: KES   45,000      │          │
│  └──────────────────────────────────────┘          │
│                                                    │
│  [Undo Finalize — 25s remaining]                   │
│  [Continue to Compliance]  [Back to Dashboard]     │
└────────────────────────────────────────────────────┘
```

**API**: `POST /api/clients/:clientId/payroll-runs/:id/finalize`
**API**: `POST /api/clients/:clientId/payroll-runs/:id/rollback`

**Rollback** (from run history after undo window):
- Button on run row: "Rollback" → confirmation → `POST /rollback` → run unlocked

**Navigation**: Previous → Step 5 | Next → auto to Step 7 on success.

### Step 7: Compliance & Output

**When**: After finalization. Generate statutory files and distribute payslips.

**Content** (extracted from existing compliance/payslip/email/P10 sections):

**Compliance Generation**:
- Toggle: PAYE ZIP, NSSF CSV, SHA CSV
- "Generate Compliance Files" button
- Progress: "Generating PAYE ZIP...", "NSSF done", "SHA done"
- Download links for each file

**Payslip Download**:
- "Download All Payslips (ZIP)" button
- Per-employee dropdown: "Download Single Payslip"

**Email**:
- "Email All Payslips" button
- "Email All P9s" button
- Email history table (audit trail)

**P10/P11**:
- Year selector
- P10: view annual PAYE reconciliation + PDF download
- P11: search by KRA PIN → monthly breakdown + PDF download

**API**: `POST /api/clients/:clientId/payroll-runs/:id/generate-compliance`
**API**: `GET /api/clients/:clientId/payroll-runs/:id/payslips` (ZIP)
**API**: `GET /api/clients/:clientId/payroll-runs/:id/payslip/:employeeId`
**API**: `POST /api/clients/:clientId/email/send-payslips`
**API**: `GET /api/clients/:clientId/p10?year=YYYY`
**API**: `GET /api/clients/:clientId/p11/:kraPin?year=YYYY`

**Navigation**: Previous → Step 6 | "Back to Dashboard" to return to Payroll Pipeline Dashboard.

---

## E. COMPONENT TREE

```
PracticeDashboard
├── PayrollPipelineDashboard              ← NEW
│   ├── KpiHeroCards                      ← NEW
│   ├── ActiveRunCard                     ← NEW (shows in-progress run with sub-step progress bar)
│   ├── RunHistoryTable                   ← NEW (extracted from monolith)
│   │   └── StepStatusBadge               ← NEW (badge with sub-step detail)
│   └── "New Payroll Run" button          → opens PipelineWizard
│
├── PipelineWizard                        ← NEW (step orchestrator)
│   ├── StepIndicator                     ← NEW (horizontal stepper)
│   │   └── StepIndicatorItem             ← per-step circle + label + sub-step text
│   ├── Step1_Setup                       ← EXTRACTED from monolith (employees, loans, schedules)
│   ├── Step2_AttendanceApproval          ← EXTRACTED (attendance approval modal)
│   │   └── AttendancePreviewGrid
│   │       └── EmployeeAttendanceRow
│   ├── Step3_RunGeneration               ← NEW (period picker + generate + progress)
│   │   └── ProgressAnimation             ← NEW (animated steps with sub-step labels + progress bar)
│   ├── Step4_Adjustments                 ← EXTRACTED (adjustment table + modals)
│   │   ├── AdjustmentTable
│   │   └── AdjustmentFormModal
│   ├── Step5_ReviewPreview               ← NEW (the big table)
│   │   ├── PayrollDataTable              ← NEW (reusable editable data table)
│   │   │   ├── PayrollDataRow
│   │   │   │   └── EditableCell          ← NEW (click-to-edit, blur triggers preview)
│   │   │   └── RowExpansionPanel         ← NEW (full breakdown on expand)
│   │   ├── ComparisonDeltaCard           ← NEW (toggle to show previous-run delta)
│   │   ├── RunTotalsBar                  ← NEW (sticky bottom totals bar)
│   │   └── SaveOverridesButton
│   ├── Step6_Finalize                    ← NEW
│   │   ├── FinalizeReceiptModal          ← NEW (receipt-style summary)
│   │   ├── OneThirdRuleWarning           ← NEW (non-blocking warning)
│   │   └── RollbackButton                ← NEW (visible after finalize)
│   └── Step7_ComplianceOutput            ← EXTRACTED (compliance gen, payslips, email, P10/P11)
│       ├── ComplianceGenerator           ← EXTRACTED
│       ├── PayslipDownloader             ← EXTRACTED
│       ├── EmailSender                   ← EXTRACTED
│       └── P10P11Viewer                  ← EXTRACTED
│
└── PortalView (employee self-service)    ← KEEP EXISTING (minor polish)
```

---

## F. ROUTE MAP (final)

```
/dashboard                                   → PracticeDashboard (overview)
/dashboard/client/:id                        → CompanyDetails
/dashboard/client/:id/payroll                → PayrollPipelineDashboard  ← NEW
/dashboard/client/:id/payroll/new            → PipelineWizard (new run → Step 1)  ← NEW
/dashboard/client/:id/payroll/run/:runId     → PipelineWizard (resume existing run)  ← NEW
/dashboard/client/:id/payroll/history        → RunHistoryTable (all past runs)  ← NEW
```

### Sidebar Navigation

Current "Payroll" sidebar item → stays. Clicking a client's payroll navigates to:
```
PracticeDashboard → select client in list → "Payroll" button → PayrollPipelineDashboard
```

From PayrollPipelineDashboard:
- Click existing run → `PipelineWizard` at the step it's on
- "New Payroll Run" button → `PipelineWizard` at Step 1

---

## G. IMPLEMENTATION PHASES

### Phase 0 — Backend Engine Changes (2-3 days)

| Task | Files | Description |
|---|---|---|
| 0.1 | `payrollEngine.ts` | Break `benefits` into 5 individual fields; remove benefit proration; add to PayrollComputed output |
| 0.2 | `payroll-runs.routes.ts:225` | Pass individual benefits from employee record to engine input |
| 0.3 | `payroll.routes.ts:217` | Update `POST /calculate-preview` to accept 5 benefit fields |
| 0.4 | `payroll-runs.routes.ts` | NEW: `POST /payroll-runs/:id/update-entry` for per-run overrides |
| 0.5 | `payroll-runs.routes.ts` | Update `GET /payroll-runs/:id/entries` to return overrideable inputs + merged values |
| 0.6 | migration | NEW: `payroll_entry_overrides` table (or JSON column on `payroll_entries`) |
| 0.7 | verify | `cd backend && npx tsc --noEmit` |

### Phase 1 — Pipeline Shell + Dashboard + Step 1 (2-3 days)

| Task | New/Modified File | Description |
|---|---|---|
| 1.1 | `PayrollPipelineDashboard.tsx` | Landing page: KPI cards + run history table with sub-step badges |
| 1.2 | `PipelineWizard.tsx` | 7-step orchestrator with state management, step transitions, URL-based step position |
| 1.3 | `StepIndicator.tsx` | Horizontal stepper, mobile-collapsible to dots, sub-step progress text |
| 1.4 | `StepStatusBadge.tsx` | Badge: "3/5 steps done — computing SHA" |
| 1.5 | `KpiHeroCards.tsx` | 4 summary cards: total payroll, employee count, active run, pending issues |
| 1.6 | `RunHistoryTable.tsx` | Table: period, status with sub-step detail, totals, actions (view/delete) |
| 1.7 | `Step1_Setup.tsx` | Extract employee CRUD, loan CRUD, work schedule manager from monolith |
| 1.8 | `PracticeDashboard.tsx` | Route `/dashboard/client/:id/payroll` → PayrollPipelineDashboard |
| 1.9 | `frontend/src/App.tsx` | Add new routes if they don't exist yet |

### Phase 2 — Steps 2 & 3 (2-3 days)

| Task | New File | Description |
|---|---|---|
| 2.1 | `Step2_AttendanceApproval.tsx` | Preview grid + bulk approve, extracted from attendance approval modal |
| 2.2 | `Step3_RunGeneration.tsx` | Period selector → Create Run → Animated progress with sub-step labels |
| 2.3 | `ProgressAnimation.tsx` | Reusable component: progress bar + sub-step list with checkmarks |
| 2.4 | PipelineWizard logic | Poll `GET /payroll-runs/:id` during generation; auto-advance on 100% |

### Phase 3 — Steps 4, 5 & 6 (3-4 days)

| Task | New File | Description |
|---|---|---|
| 3.1 | `Step4_Adjustments.tsx` | Per-employee adjustment table + add/edit/delete modals |
| 3.2 | `Step5_ReviewPreview.tsx` | Main table with all columns, search/filter/sort, previous-run comparison toggle |
| 3.3 | `PayrollDataTable.tsx` | Reusable data table: column groups, inline editing, expand row, bulk selection |
| 3.4 | `EditableCell.tsx` | Click-to-edit cell: shows value, click → input, blur → calls preview API after debounce |
| 3.5 | `RowExpansionPanel.tsx` | Expand row to see full breakdown of all computed fields |
| 3.6 | `RunTotalsBar.tsx` | Sticky bottom bar: total gross, deductions, net, employee count |
| 3.7 | `ComparisonDeltaCard.tsx` | Toggle to show delta columns vs previous run |
| 3.8 | `Step6_Finalize.tsx` | Finalize workflow: receipt modal, 1/3 rule warning, success/rollback |
| 3.9 | `FinalizeReceiptModal.tsx` | Receipt-style summary modal |
| 3.10 | `OneThirdRuleWarning.tsx` | Warning banner for 1/3 rule violations |
| 3.11 | Rollback UI | "Undo" button (30s timer), then rollback link in run history |

### Phase 4 — Step 7 + Polish + Monolith Removal (2-3 days)

| Task | New File | Description |
|---|---|---|
| 4.1 | `Step7_ComplianceOutput.tsx` | Compliance generator toggles + payslip download + email + P10/P11 |
| 4.2 | `ComplianceGenerator.tsx` | Extract from monolith's compliance section, add sub-step progress |
| 4.3 | `PayslipDownloader.tsx` | Bulk ZIP + single per-employee download |
| 4.4 | `EmailSender.tsx` | Extract email sending UI with history table |
| 4.5 | `P10P11Viewer.tsx` | P10 annual view, P11 per-employee monthly breakdown, PDF download |
| 4.6 | Delete `PayrollWebView.tsx` | Remove monolith file and its import from PracticeDashboard |
| 4.7 | Mobile responsive | Stepper → dots on <768px; tables → horizontal scroll; modals → bottom sheets |
| 4.8 | Empty states | Each step shows informative empty state when no data present |
| 4.9 | Loading skeletons | Skeleton placeholders while each step loads data |
| 4.10 | Error recovery | Per-step error boundary with retry and back navigation |
| 4.11 | Animated transitions | framer-motion transitions between steps (already a dependency) |

---

## H. SUB-STEP PROGRESS SYSTEM

### Status States per Run (displayed on RunHistoryTable and StepIndicator)

| State | Color | Sub-step Detail | Sub-text Example |
|---|---|---|---|
| Draft | Gray | — | "No entries generated" |
| Generated | Blue | "Entires computed: {n}" | "12 entries computed" |
| Adjusting | Yellow | "Adjustments: {n}" | "3 adjustments pending" |
| ReadyForReview | Blue | "Review needed" | "Review 12 entries" |
| Finalized | Green | "Finalized at {date}" | "Finalized at 25-Nov-2024" |
| RollingBack | Orange | "Rolling back..." | "Restoring loan transactions..." |
| Compliant | Emerald | "PAYE ✓ NSSF ✓ SHA ✓" | "All compliance files generated" |

### Sub-step Progress in Step 3 (Run Generation)

```typescript
// Frontend simulates progress based on known stages and employee count
const generationSteps = [
    { id: 'creating', label: 'Creating payroll run', progress: 0, total: 1 },
    { id: 'employees', label: 'Fetching employees', progress: 0, total: employeeCount },
    { id: 'benefits', label: 'Computing benefits', progress: 0, total: 1 },
    { id: 'sha', label: 'Computing SHA', progress: 0, total: employeeCount },
    { id: 'nssf', label: 'Computing NSSF', progress: 0, total: employeeCount },
    { id: 'ahl', label: 'Computing AHL', progress: 0, total: employeeCount },
    { id: 'loans', label: 'Applying loan deductions', progress: 0, total: loanCount },
    { id: 'paye', label: 'Computing PAYE', progress: 0, total: employeeCount },
    { id: 'done', label: 'Done', progress: 1, total: 1 },
];
```

Each step animates for ~300-500ms or until `GET /payroll-runs/:id` returns entries.

### Backend `processingSteps` Response (if added to API)

```json
{
    "id": 42,
    "status": "generating",
    "processingSteps": [
        { "label": "Fetching employees", "progress": 5, "total": 5, "done": true },
        { "label": "Computing SHA", "progress": 12, "total": 12, "done": true },
        { "label": "Applying loan deductions", "progress": 3, "total": 3, "done": false }
    ]
}
```

---

## I. KEY DESIGN DECISIONS SUMMARY

| Decision | Choice | Rationale |
|---|---|---|
| Classic View fallback | No — replace entirely | Cleaner codebase; monolith deleted in Phase 4 |
| Sub-step progress | Show detailed sub-steps | User preference — granular visibility into payroll processing |
| Insurance Relief | Auto-populated from employee record, overridable per-run, capped at 5,000 by backend | Master data is default; backend enforces KRA cap |
| Benefit proration | No — benefits are fixed monthly values | Car benefit, housing, etc. don't prorate |
| Override storage | New `payroll_entry_overrides` table | Clean separation: generated entries vs user overrides |
| Comparison data | `GET /payroll-runs?period=X` for previous period | No new endpoint needed (already exists) |
| Preview engine | `POST /calculate-preview` with 300ms debounce | Already exists — reuse as-is with new benefit fields |
| State management | React state in PipelineWizard (no global store) | Wizard is single-use per run instance |

---

## J. TIMELINE ESTIMATE

| Phase | Focus | Days |
|---|---|---|
| 0 | Backend engine changes (benefits breakdown, overrides endpoint) | 2-3 |
| 1 | Pipeline shell + PayrollPipelineDashboard + Step 1 (Setup) | 2-3 |
| 2 | Step 2 (Attendance Approval) + Step 3 (Run Generation) | 2-3 |
| 3 | Step 4 (Adjustments) + Step 5 (Review & Preview) + Step 6 (Finalize) | 3-4 |
| 4 | Step 7 (Compliance & Output) + Mobile responsive + Delete monolith | 2-3 |
| **Total** | | **11-16 days** |
