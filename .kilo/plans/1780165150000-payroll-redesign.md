# Payroll Pipeline Redesign & Refactor Plan

## Goal
Redesign the Payroll View into a modern, industry-grade UI that reduces friction to compliance, surfaces attendance earlier, and makes the whole pipeline more modular, efficient, and cost-effective.

---

## Current State Summary

### Frontend Components
| Component | Lines | Role | Status |
|---|---|---|---|
| `PayrollPipelineDashboard.tsx` | 626 | Main payroll view (KPIs, runs, employee master, loans/leaves) | **Active** |
| `PipelineWizard.tsx` | 260 | 4-step wizard (1→5→6→7) | **Active** |
| `Step1Setup.tsx` | 66 | Step 1: wraps `AttendanceCalendarGrid` + Loan/Leave | **Active** |
| `Step5ReviewPreview.tsx` | ~1100 | Step 2: editable entries, auto-generate, compare, export | **Active** |
| `Step6Finalize.tsx` | 517 | Step 3: finalize/rollback with 1/3 warnings | **Active** |
| `Step7ComplianceOutput.tsx` | 821 | Step 4: compliance gen, payslips, email, P10/P11 | **Active** |
| `AttendanceCalendarGrid.tsx` | 1258 | Calendar grid + cell modal + summary computation + approval | **Active** |
| `PayrollViewShell.tsx` | 72 | Dropdown wrapper around `PayrollPipelineDashboard` | **Active** |
| `EmployeeMasterPage.tsx` | 435 | Standalone employee master page | **Dead code — never imported** |
| `EmployeeMasterModal.tsx` | ~120 | Employee master modal | Need to verify usage |
| `Step2AttendanceApproval.tsx` | 315 | Standalone attendance approval table | **Dead code — never imported** |
| `Step3RunGeneration.tsx` | 216 | Standalone run generation with progress | **Dead code — never imported** |
| `Step4Adjustments.tsx` | 364 | Standalone adjustments manager | **Dead code — never imported** |
| `KpiHeroCards.tsx`, `RunHistoryTable.tsx`, `ActiveRunCard.tsx`, `NoActiveRun.tsx` | ~300 total | Sub-components of dashboard | **Active** |

### Backend (`payrollEngine.ts`)
- Pure math engine (~388 lines). Computes statutory deductions, proration, adjustments, overtime, 1/3 rule.
- **Duplicated** in frontend: `computeRow()` exists in both `PayrollPipelineDashboard.tsx` and `EmployeeMasterPage.tsx` — same math, different code paths.
- `calculate-preview` API endpoint called on every cell edit in Step 5 — roundtrip to Cloud Run for pure math.

### Current Pipeline Flow
1. **Payroll View** → shows KPIs + run history + employee master (all at once)
2. **"New Payroll Run"** → opens wizard Step 1
3. **Step 1** → Attendance grid + approve (implicit via "Next" button) + Loan/Leave
4. **Step 2** → Auto-generates run, shows editable entries table
5. **Step 3** → Finalize / rollback
6. **Step 4** → Compliance files, payslips, P10/P11, email

---

## Problems Identified

### 1. UI/UX — Information Overload
- The Payroll View crams KPIs, run history, employee CRUD, loans, and leaves onto one screen. No progressive disclosure. Users are overwhelmed.
- Employee Master table has ~40 columns in a horizontal scroll — nearly unusable on laptops.
- Wizard step numbering is broken (1, 5, 6, 7 — missing 2, 3, 4) because old steps were deleted but file names preserved.
- Attendance is **only** accessible inside the wizard Step 1. Users can't review or edit attendance from the main payroll view.
- Compliance is buried 4 clicks deep. For a payroll accountant, the goal is "process payroll → get compliance files." The current path has too many gates.

### 2. Dead Code Bloat
- `Step2AttendanceApproval.tsx` — 315 lines, never imported. Approval is handled inline by `AttendanceCalendarGrid`.
- `Step3RunGeneration.tsx` — 216 lines, never imported. Generation is handled by `Step5ReviewPreview` via `autoGenerate`.
- `Step4Adjustments.tsx` — 364 lines, never imported. Adjustments are inline in `Step5ReviewPreview` expanded rows.
- `EmployeeMasterPage.tsx` — 435 lines, never imported. Employee master is inline in `PayrollPipelineDashboard`.
- These files add maintenance burden and confuse new developers.

### 3. Component Size — Not Modular
- `AttendanceCalendarGrid` (1258 lines) handles: calendar rendering, cell modals, employee modals, bulk operations, optimistic updates, summary computation, approval API.
- `Step5ReviewPreview` (~1100 lines) handles: table rendering, inline editing, debounced preview API, compare mode, export CSV, department filtering, sorting, save per-entry.
- `Step7ComplianceOutput` (821 lines) handles: compliance generation, payslip download list, bulk email, P10/P11 annual reconciliation, auto-filing buttons.

### 4. Cost / Performance Inefficiency
- **Backend roundtrip for previews**: Every cell edit in Step 5 calls `POST /payroll/calculate-preview`. This hits Cloud Run (cost + latency) for pure math that could run client-side.
- **5 API calls on every period change** in attendance grid: employees, attendance records, schedules, holidays, leave requests. No caching between period switches.
- **Employee master loads on dashboard mount** even if user only wants to start a new run.
- **Attendance summaries recomputed O(employees × days)** on every cell change client-side. For 50 employees × 30 days = 1500 iterations per keystroke. Currently fine but won't scale.

### 5. Code Duplication
- `computeRow()` payroll math is duplicated in `PayrollPipelineDashboard.tsx`, `EmployeeMasterPage.tsx`, and exists properly in `payrollEngine.ts`.
- The frontend `calculateFields` utility was removed from `PayrollWebView.tsx` per migration notes, but `computeRow` survived in dashboard/page components.

---

## Proposed Redesign

### Phase A: Remove Dead Code (1 session)
- Delete `Step2AttendanceApproval.tsx`
- Delete `Step3RunGeneration.tsx`
- Delete `Step4Adjustments.tsx`
- Delete `EmployeeMasterPage.tsx`
- Rename wizard step files to sequential numbers:
  - `Step1Setup.tsx` → `Step1Attendance.tsx`
  - `Step5ReviewPreview.tsx` → `Step2Review.tsx`
  - `Step6Finalize.tsx` → `Step3Finalize.tsx`
  - `Step7ComplianceOutput.tsx` → `Step4Compliance.tsx`
- Update `StepIndicator.tsx` STEPS array and `PipelineWizard.tsx` imports.

### Phase B: Redesign Payroll View as a "Payroll Hub" (3–4 sessions)

**New Layout: Single-Page Dashboard with Tabs**

Replace the monolithic `PayrollPipelineDashboard` with a hub that uses **vertical tabs** or **sticky sub-navigation**:

```
┌─────────────────────────────────────────────────────────────┐
│  [Client: JAHAWI LIMITED]          [Period: May 2026] ▼   │
├─────────────────────────────────────────────────────────────┤
│  Overview  │  Attendance  │  Employees  │  Review  │  Compliance  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [Tab Content Area]                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Tab 1: Overview (default)**
- **Status Pipeline Card**: Visual pipeline showing current client's payroll status:
  - `Attendance → Review → Finalize → Compliance`
  - Each stage shows a mini status (e.g., "Attendance: 28/30 days marked", "Review: 4 entries generated", "Finalize: Not locked", "Compliance: Not generated").
  - Clicking any stage jumps to that tab.
- **KPI Row**: Total employees, total payroll YTD, active runs count, pending approvals.
- **Run History**: Collapsible table (not always visible). Only last 3 runs shown by default; "Show all" expands.
- **Quick Actions**: "New Payroll Run" primary CTA, "Sync Master CSV" secondary.

**Tab 2: Attendance**
- Embed `AttendanceCalendarGrid` directly here (currently only inside wizard).
- Add a **period selector** tied to the global period.
- Show **summary cards** at the top: Total scheduled days, Days marked, Absent days, Late hours, Overtime hours — so users see the headline numbers without scrolling through the grid.
- Keep the grid itself with cell editing.
- **"Mark Scheduled Days"** and **"Approve"** buttons as clear CTAs.
- This answers the user's question: "should attendance show in payroll view?" → **Yes, as its own tab.**

**Tab 3: Employees**
- Extract the employee master table from the dashboard into this tab.
- **Redesign the table**:
  - Use a **data grid** approach: show only essential columns by default (Name, KRA PIN, Basic Pay, Status, Actions).
  - Click a row to expand an **inline detail panel** or open a **slide-over drawer** with all 40 fields.
  - This eliminates the 40-column horizontal scroll disaster.
- Keep Add/Edit/Delete/Sync CSV actions.

**Tab 4: Review**
- This is essentially the current `Step5ReviewPreview` but accessible directly from the hub.
- Shows the payroll entries table with inline editing.
- **Auto-generate on first visit** if no entries exist for the selected period.
- Add a **"Compare with Previous Run"** toggle that shows delta columns inline (not a separate mode).

**Tab 5: Compliance**
- This is the current `Step7ComplianceOutput` but accessible directly.
- **Key friction reduction**: If the current period's run is **finalized**, show compliance actions immediately. If not, show a clear "Finalize First" prompt with a one-click button.
- Organize into **accordion sections**:
  1. **Compliance Files** (PAYE ZIP, NSSF, SHA) — generate + download + auto-file
  2. **Payslips** — per-employee download list + bulk email
  3. **Annual Returns** (P10/P11) — year input + load
  4. **Email Log** — history of sent payslips/P9s

### Phase C: Streamline the Wizard (1 session)

The wizard should still exist for users who want a **guided walkthrough**, but it should be simpler:

**New 3-Step Wizard:**
1. **Setup & Attendance** — `AttendanceCalendarGrid` + Loan/Leave
2. **Review & Generate** — Entry table + adjustments
3. **Finalize & Compliance** — Merge old Step 6 and 7. Once finalized, compliance actions appear inline immediately (no need for a 4th step).

This reduces clicks from 4 to 3 and eliminates the "wait, where's step 4?" confusion.

### Phase D: Modularize Large Components (2–3 sessions)

**Break `AttendanceCalendarGrid.tsx` (1258 lines) into:**
- `AttendanceCalendarGrid.tsx` — calendar rendering + cell click handlers only (~400 lines)
- `AttendanceSummaryBar.tsx` — top summary cards with key numbers (~80 lines)
- `AttendanceCellModal.tsx` — cell edit modal (status, check-in/out, notes) (~120 lines)
- `AttendanceBulkActions.tsx` — "Mark All Scheduled" button + import button (~60 lines)
- `useAttendanceSummaries.ts` — custom hook that computes summaries from attendance data, with memoization (~200 lines)

**Break `Step5ReviewPreview.tsx` (~1100 lines) into:**
- `PayrollEntryTable.tsx` — table rendering with sticky header (~350 lines)
- `PayrollEntryEditor.tsx` — inline edit row + expanded detail panel (~250 lines)
- `PayrollEntryToolbar.tsx` — search, dept filter, compare toggle, export (~150 lines)
- `usePayrollPreview.ts` — hook for debounced preview calculation (~200 lines)

**Break `Step7ComplianceOutput.tsx` (821 lines) into:**
- `ComplianceGenerator.tsx` — checkboxes + generate button + result cards (~200 lines)
- `PayslipDownloader.tsx` — per-employee download list + bulk email (~180 lines)
- `AnnualReturnsPanel.tsx` — P10/P10 loader + table (~150 lines)
- `EmailHistoryPanel.tsx` — email log table (~100 lines)

### Phase E: Client-Side Preview Computation (1 session)

**Port `computePayrollEntry` from backend to a frontend utility** (`frontend/src/utils/payrollEngine.ts`).

Why:
- The engine is pure math. No database access, no external APIs.
- Moving it client-side eliminates the `POST /payroll/calculate-preview` Cloud Run roundtrip on every cell edit.
- Reduces Cloud Run request count = direct cost savings.
- Improves UX (instant preview instead of 150–300ms debounced API call).

How:
- Copy `computePayrollEntry`, `getScheduledWorkDays`, `getTotalScheduledHours`, `getScheduledDaysIncludingHolidays`, `roundMoney`, `daysInMonth`, `dayName` into a frontend module.
- Add a thin wrapper `calculatePayrollPreview(input, period, prorate, config, holidays, adjustments)` that returns the same shape as the backend.
- Replace `updateEntryField`'s debounced API call with a synchronous client-side compute.
- Keep the backend endpoint as a fallback for edge cases / validation.

### Phase F: Smart Data Loading & Caching (1 session)

- **React Query for attendance data**: Wrap attendance, schedules, holidays, and leave requests in TanStack Query with `staleTime: 5 * 60 * 1000` (5 minutes). This avoids the 5-request burst on every tab switch.
- **Lazy-load Employee Master**: Only fetch `/clients/{id}/employees` when the "Employees" tab is active. Currently loads on dashboard mount.
- **Server-side attendance summaries**: The backend `attendance-payroll-preview` endpoint already computes absent/late/OT summaries. Return them alongside attendance records so the grid doesn't recompute O(n×m) client-side.
- **Memoize calendar grid**: Use `React.memo` on calendar day cells. Only re-render cells that changed.

### Phase G: Employee Table Redesign (1 session)

Replace the 40-column inline table with a **row-expansion pattern**:

```
┌──────────────────────────────────────────────────────────┐
│ Name          │ KRA PIN    │ Basic Pay │ Status │ Actions│
├──────────────────────────────────────────────────────────┤
│ Brian Vulimwa │ A00899...  │ 25,000    │ Active │ [Edit] │
├──────────────────────────────────────────────────────────┤
│ Suleiman M... │ A01901...  │ 17,000    │ Active │ [Edit] │
│ ┌─ Expanded Detail Drawer ───────────────────────────┐│
│ │  Car Benefit: [____]  Meals: [____]  Housing: [____] ││
│ │  Bank: [________]  Account: [________]  Code: [__]  ││
│ │  [Save] [Cancel]                                    ││
│ └──────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────┤
```

- Default columns: Name, KRA PIN, Basic Pay, Status, Actions (5 columns).
- Clicking "Edit" expands a drawer or opens a modal with all fields grouped logically (Personal, Employment, Compensation, Banking, Benefits).
- This is the industry-standard pattern (see: Gusto, BambooHR, Workday).

---

## Files to Create / Modify

### New Files
| File | Purpose |
|---|---|
| `frontend/src/utils/payrollEngine.ts` | Client-side payroll computation (ported from backend) |
| `frontend/src/components/payroll-pipeline/tabs/OverviewTab.tsx` | Overview tab content |
| `frontend/src/components/payroll-pipeline/tabs/AttendanceTab.tsx` | Attendance tab wrapper |
| `frontend/src/components/payroll-pipeline/tabs/EmployeesTab.tsx` | Employees tab with new table |
| `frontend/src/components/payroll-pipeline/tabs/ReviewTab.tsx` | Review tab wrapper |
| `frontend/src/components/payroll-pipeline/tabs/ComplianceTab.tsx` | Compliance tab wrapper |
| `frontend/src/components/payroll-pipeline/attendance/AttendanceSummaryBar.tsx` | Summary cards |
| `frontend/src/components/payroll-pipeline/attendance/AttendanceCellModal.tsx` | Cell edit modal |
| `frontend/src/components/payroll-pipeline/attendance/AttendanceBulkActions.tsx` | Bulk action buttons |
| `frontend/src/components/payroll-pipeline/attendance/useAttendanceSummaries.ts` | Memoized summary hook |
| `frontend/src/components/payroll-pipeline/review/PayrollEntryTable.tsx` | Entry table |
| `frontend/src/components/payroll-pipeline/review/PayrollEntryEditor.tsx` | Inline editor drawer |
| `frontend/src/components/payroll-pipeline/review/PayrollEntryToolbar.tsx` | Toolbar |
| `frontend/src/components/payroll-pipeline/review/usePayrollPreview.ts` | Preview hook |
| `frontend/src/components/payroll-pipeline/compliance/ComplianceGenerator.tsx` | Compliance generation |
| `frontend/src/components/payroll-pipeline/compliance/PayslipDownloader.tsx` | Payslip list |
| `frontend/src/components/payroll-pipeline/compliance/AnnualReturnsPanel.tsx` | P10/P11 |
| `frontend/src/components/payroll-pipeline/compliance/EmailHistoryPanel.tsx` | Email log |

### Modified Files
| File | Change |
|---|---|
| `PayrollPipelineDashboard.tsx` | Complete rewrite as tabbed hub |
| `PipelineWizard.tsx` | Reduce to 3 steps, merge finalize+compliance |
| `StepIndicator.tsx` | Update to 3 steps |
| `Step1Setup.tsx` | Rename to `Step1Attendance.tsx` |
| `Step5ReviewPreview.tsx` | Rename to `Step2Review.tsx`, extract sub-components |
| `Step6Finalize.tsx` | Merge into `Step3FinalizeCompliance.tsx` |
| `Step7ComplianceOutput.tsx` | Merge into `Step3FinalizeCompliance.tsx` |
| `AttendanceCalendarGrid.tsx` | Extract sub-components, keep core grid |
| `PracticeDashboard.tsx` | Update routing if needed |

### Deleted Files
- `Step2AttendanceApproval.tsx`
- `Step3RunGeneration.tsx`
- `Step4Adjustments.tsx`
- `EmployeeMasterPage.tsx`
- `EmployeeMasterModal.tsx` (if confirmed unused)

---

## Cost & Efficiency Impact

| Change | Impact |
|---|---|
| Client-side preview compute | **Eliminates ~N Cloud Run requests per editing session** (where N = number of cell edits). For a 50-employee run with 5 edits each = 250 requests saved per payroll cycle. |
| React Query caching for attendance | **Reduces API calls by ~60%** during a session (attendance data cached for 5 min, holidays/schedules cached longer). |
| Lazy-loaded employee master | **Saves 1 API call** on dashboard mount if user doesn't visit Employees tab. |
| Deleted dead code | **Smaller bundle size** (~1300 lines removed = ~20KB less JS). Faster build, faster load. |
| Memoized calendar cells | **Reduced re-render cost** — only changed cells re-render instead of entire grid. |
| Tabbed layout | **Faster initial paint** — only Overview tab content renders on first load. |

---

## User Questions / Tradeoffs — RESOLVED

1. **Wizard retention:** **Replace entirely with tabs.** The tabbed hub serves both new and power users — new users follow left-to-right tab order as a guided flow; power users jump directly. Maintaining two code paths is not worth it.

2. **Employee table: inline drawer or full modal?** **Inline expanding drawer.** Keeps list context visible while editing. Modal hides context and forces users to remember which row they were on. Drawers are the industry standard (Gusto, BambooHR, Rippling).

3. **Data grid library?** **TanStack Table (react-table).** Headless, lightweight (~15KB), gives sorting/filtering/resizing/pagination without dictating markup. We retain full control over zani brand styling. Custom 40-column tables are unmaintainable.

4. **Compliance tab visibility:** **Always visible with a "Finalize first" CTA.** Hidden tabs confuse users. A disabled state with a clear action button teaches the workflow and reduces friction to the user's primary goal.

5. **Attendance approval explicit or implicit?** **Explicit.** Add a clear "Approve Attendance" button in the Attendance tab. Do NOT auto-approve when generating — users should consciously sign off before payroll computes.

---

## Implementation Order

1. Phase A: Remove dead code + rename steps
2. Phase E: Port payroll engine to frontend (enables instant previews later)
3. Phase G: Employee table redesign (independent of other changes)
4. Phase B: Build new tabbed hub shell
5. Phase D: Extract sub-components from large files
6. Phase C: Streamline wizard
7. Phase F: Add caching and lazy loading
8. End-to-end testing: attendance → generate → finalize → compliance

---

## Notes
- All changes are frontend-only except for the optional server-side attendance summary optimization (Phase F).
- The backend `payrollEngine.ts` stays untouched — it's the source of truth. The frontend port is a read-only mirror.
- The `zani` brand identity (red `#ff0613`, rounded cards, clean typography) should be preserved and enhanced.
- No backend API changes required for Phases A–E and G.

## Clarifying Questions for User

**Q1. Wizard retention:** Do you want to keep the step-by-step wizard alongside the new tabbed hub, or replace it entirely with tabs?

**Q2. Compliance tab visibility:** Should the Compliance tab always be visible (with a "Finalize first" prompt when needed), or hidden until the run is finalized?

**Q3. Employee edit pattern:** For the employee table, do you prefer an inline expanding drawer per row, or a full modal/popup for editing?

**Q4. Data grid library:** Should we introduce TanStack Table (lightweight, headless) for the employee and payroll entry tables, or keep custom table markup?
