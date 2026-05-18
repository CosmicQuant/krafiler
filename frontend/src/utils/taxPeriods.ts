/**
 * Tax period utilities for KRA filing automation.
 * All periods follow the Kenyan tax calendar.
 *
 * Kenyan filing deadlines (due date in month M+1):
 *   PAYE: 9th
 *   VAT:  20th
 *   TOT:  20th
 *   MRI:  20th
 *   NSSF: 15th
 * Before the deadline: file for previous month.
 * After the deadline:  file for current month.
 */

function formatLocalIsoDate(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function getPreviousMonthIsoRange(referenceDate = new Date()) {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth();
    const previousMonthStart = new Date(year, month - 1, 1);
    const previousMonthEnd = new Date(year, month, 0);
    return {
        periodFrom: formatLocalIsoDate(previousMonthStart),
        periodTo: formatLocalIsoDate(previousMonthEnd),
    };
}

export function getPreviousYearIsoRange(referenceDate = new Date()) {
    const previousYear = referenceDate.getFullYear() - 1;
    return {
        periodFrom: `${previousYear}-01-01`,
        periodTo: `${previousYear}-12-31`,
    };
}

function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

function deadlineDayForObligation(taxObligationType?: string): number {
    switch (taxObligationType) {
        case 'paye':  return  9;
        case 'nssf':  return 15;
        case 'vat':
        case 'turnover_tax':
        case 'monthly_rental_income': return 20;
        default:       return  9;  // preserve existing behavior (PAYE rule)
    }
}

export function getCurrentFilingPeriod(taxObligationType?: string) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const deadlineDay = deadlineDayForObligation(taxObligationType);

    let filingMonth = month;
    let filingYear = year;

    if (day <= deadlineDay) {
        filingMonth = month - 1;
        if (filingMonth === 0) {
            filingMonth = 12;
            filingYear = year - 1;
        }
    }

    const mm = String(filingMonth).padStart(2, '0');
    const yyyy = String(filingYear);
    const lastDay = daysInMonth(filingYear, filingMonth);
    const dd = String(lastDay).padStart(2, '0');

    return {
        period: `${yyyy}-${mm}`,
        periodFrom: `${yyyy}-${mm}-01`,
        periodTo: `${yyyy}-${mm}-${dd}`,
        mmYYYY: `${mm}${yyyy}`,
        mmSlashYYYY: `${mm}/${yyyy}`,
    };
}

export function periodFromRun(runPeriod: string) {
    const parts = runPeriod.split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(y) || isNaN(m)) {
        return getCurrentFilingPeriod();
    }
    const mm = String(m).padStart(2, '0');
    const yyyy = String(y);
    const lastDay = daysInMonth(y, m);
    const dd = String(lastDay).padStart(2, '0');

    return {
        period: `${yyyy}-${mm}`,
        periodFrom: `${yyyy}-${mm}-01`,
        periodTo: `${yyyy}-${mm}-${dd}`,
        mmYYYY: `${mm}${yyyy}`,
        mmSlashYYYY: `${mm}/${yyyy}`,
    };
}

export function isPastDeadline(periodYYYYMM: string): boolean {
    const parts = periodYYYYMM.split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(y) || isNaN(m)) return false;
    const deadline = new Date(y, m, 9);
    return new Date() > deadline;
}

export function getCurrentPeriodMmYyyy() {
    return getCurrentFilingPeriod().mmSlashYYYY;
}
