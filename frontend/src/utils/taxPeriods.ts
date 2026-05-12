/**
 * Tax period utilities for KRA filing automation.
 * All periods follow the Kenyan tax calendar.
 */

export function getPreviousMonthIsoRange(referenceDate = new Date()) {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth();
    const previousMonthStart = new Date(year, month - 1, 1);
    const previousMonthEnd = new Date(year, month, 0);
    return {
        periodFrom: previousMonthStart.toISOString().slice(0, 10),
        periodTo: previousMonthEnd.toISOString().slice(0, 10),
    };
}

export function getPreviousYearIsoRange(referenceDate = new Date()) {
    const previousYear = referenceDate.getFullYear() - 1;
    return {
        periodFrom: `${previousYear}-01-01`,
        periodTo: `${previousYear}-12-31`,
    };
}

export function getCurrentPeriodMmYyyy(referenceDate = new Date()) {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth();
    // Use previous month for filing periods (due in current month)
    const target = new Date(year, month - 1, 1);
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const yyyy = target.getFullYear();
    return `${mm}/${yyyy}`;
}
