/**
 * payrollEngine.test.ts
 *
 * Unit tests for the core payroll computation logic.
 * Uses Node.js built-in test runner (node:test) — no external test framework required.
 *
 * Run: npx ts-node --transpile-only src/services/payrollEngine.test.ts
 * Or after build: node dist/services/payrollEngine.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    computePayrollEntry,
    getScheduledWorkDays,
    getScheduledDaysIncludingHolidays,
    getTotalScheduledHours,
    PayrollInput,
    PayrollAdjustmentInput,
} from './payrollEngine';

describe('payrollEngine', () => {
    describe('getScheduledWorkDays', () => {
        it('counts scheduled days excluding holidays', () => {
            const config = { Mon: 9, Tue: 9, Wed: 9, Thu: 9, Fri: 9, Sat: 4, Sun: 0 };
            const result = getScheduledWorkDays(config, '2026-05'); // May 2026
            // May 2026 has 31 days. Mon-Fri = 21 days, Sat = 5 days, Sun = 5 days
            // Without holidays: 21 + 5 = 26 work days
            assert.strictEqual(result, 26);
        });

        it('excludes holidays from work days', () => {
            const config = { Mon: 9, Tue: 9, Wed: 9, Thu: 9, Fri: 9, Sat: 0, Sun: 0 };
            const holidays = [{ date: '2026-05-01', isRecurring: 0 }];
            const result = getScheduledWorkDays(config, '2026-05', holidays);
            // May 2026: 21 weekdays. 1 May is Friday → 20 work days
            assert.strictEqual(result, 20);
        });

        it('falls back to 30 for empty config', () => {
            assert.strictEqual(getScheduledWorkDays({}, '2026-05'), 30);
        });
    });

    describe('getTotalScheduledHours', () => {
        it('sums per-day hours for the month', () => {
            const config = { Mon: 9, Tue: 9, Wed: 9, Thu: 9, Fri: 9, Sat: 4, Sun: 0 };
            const result = getTotalScheduledHours(config, '2026-05');
            // 21 Mon-Fri × 9 = 189, 5 Sat × 4 = 20, 5 Sun × 0 = 0 → total 209
            assert.strictEqual(result, 209);
        });

        it('falls back to 240 for empty config', () => {
            assert.strictEqual(getTotalScheduledHours({}, '2026-05'), 240);
        });
    });

    describe('computePayrollEntry', () => {
        const baseInput: PayrollInput = {
            employeeId: 1,
            employeeName: 'John Doe',
            kraPin: 'A123456789B',
            payrollNumber: 'EMP001',
            basicPay: 50000,
            dateJoined: '2020-01-01',
            dateLeft: null,
            employmentStatus: 'Active',
        };

        it('computes fixed-pay employee correctly with no proration', () => {
            const result = computePayrollEntry(baseInput, '2026-05', false);

            assert.strictEqual(result.employeeId, 1);
            assert.strictEqual(result.basicPay, 50000);
            assert.strictEqual(result.grossPay, 50000);
            // SHA = 50000 × 0.0275 = 1375
            assert.strictEqual(result.shaDeduction, 1375);
            // NSSF tier1 = 9000 × 0.06 = 540, tier2 = min(50000-9000, 99000) × 0.06 = 2460
            assert.strictEqual(result.nssfDeduction, 3000);
            // AHL = 50000 × 0.015 = 750
            assert.strictEqual(result.ahlDeduction, 750);
            // Taxable pay = 50000 - 1375 - 3000 - 750 = 44875 (no pension/mortgage/insurance)
            assert.strictEqual(result.taxablePay, 44875);
            // PAYE = max(0, 44875×0.1 + (44875-24000)×0.15 + (44875-32333)×0.05) - 2400
            // = 4487.5 + 3131.25 + 627.1 - 2400 = 5845.85 → rounded 5845.85
            assert.ok(result.payeTax > 0);
            assert.ok(result.netPay > 0);
            assert.ok(result.netPay < result.grossPay);
        });

        it('prorates basic pay for new employee mid-month', () => {
            const input: PayrollInput = {
                ...baseInput,
                dateJoined: '2026-05-15',
                payStructure: 'fixed',
            };
            const result = computePayrollEntry(input, '2026-05', true);
            // May has 31 days. Joined on 15th → activeDays = 31 - 15 + 1 = 17
            // Fixed: daysWorked = min(scheduledWorkDays=30, activeDays=17) = 17
            // prorationFactor = 17/30, basicPay = 50000 × 17/30 = 28333.33
            assert.ok(result.basicPay < 50000);
            assert.ok(result.basicPay > 0);
        });

        it('applies unpaid leave deduction correctly', () => {
            const input: PayrollInput = {
                ...baseInput,
                unpaidLeaveDays: 3,
                payStructure: 'fixed',
            };
            const result = computePayrollEntry(input, '2026-05', false);
            // unpaidLeaveDeduction = 50000/30 × 3 = 5000
            assert.strictEqual(result.unpaidLeaveDeduction, 5000);
            assert.strictEqual(result.unpaidLeaveDays, 3);
        });

        it('applies bonus correctly (taxable for high income)', () => {
            const input: PayrollInput = {
                ...baseInput,
                bonusPay: 10000,
            };
            const result = computePayrollEntry(input, '2026-05', false);
            // basicPay 50000 > 11180, so bonus is taxable
            assert.strictEqual(result.taxableBonus, 10000);
            assert.strictEqual(result.nonTaxableBonus, 0);
            assert.strictEqual(result.bonusPay, 10000);
        });

        it('applies bonus as non-taxable for low income', () => {
            const input: PayrollInput = {
                ...baseInput,
                basicPay: 10000,
                bonusPay: 5000,
            };
            const result = computePayrollEntry(input, '2026-05', false);
            // basicPay 10000 <= 11180, so bonus is non-taxable
            assert.strictEqual(result.taxableBonus, 0);
            assert.strictEqual(result.nonTaxableBonus, 5000);
        });

        it('applies dynamic allowance adjustments to gross pay', () => {
            const adjustments: PayrollAdjustmentInput[] = [
                { type: 'allowance', amount: 5000, isStatutory: false },
            ];
            const resultNoAdj = computePayrollEntry(baseInput, '2026-05', false);
            const resultWithAdj = computePayrollEntry(baseInput, '2026-05', false, undefined, [], adjustments);

            assert.strictEqual(resultWithAdj.grossPay, resultNoAdj.grossPay + 5000);
            assert.strictEqual(resultWithAdj.benefits, resultNoAdj.benefits + 5000);
        });

        it('applies dynamic non-statutory deduction to otherDeductions', () => {
            const adjustments: PayrollAdjustmentInput[] = [
                { type: 'deduction', amount: 2000, isStatutory: false },
            ];
            const result = computePayrollEntry(baseInput, '2026-05', false, undefined, [], adjustments);

            assert.strictEqual(result.otherDeductions, 2000);
        });

        it('caps NSSF + otherPension at 30000', () => {
            const input: PayrollInput = {
                ...baseInput,
                basicPay: 200000,
                otherPension: 50000,
            };
            const result = computePayrollEntry(input, '2026-05', false);
            // NSSF on 200000 = tier1 540 + tier2 5940 = 6480
            // otherPension 50000, but cap is 30000 total
            // taxablePay should cap the pension deduction at 30000
            const gross = result.grossPay;
            const sha = result.shaDeduction;
            const ahl = result.ahlDeduction;
            // taxable = gross - sha - 30000 - ahl
            const expectedTaxable = Math.round((gross - sha - 30000 - ahl) * 100) / 100;
            assert.strictEqual(result.taxablePay, expectedTaxable);
        });
    });
});
