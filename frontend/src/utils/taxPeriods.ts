/**
 * Tax period utilities for KRA filing automation.
 * All periods follow the Kenyan tax calendar.
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

export function getCurrentPeriodMmYyyy(referenceDate = new Date()) {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth();
    // Use previous month for filing periods (due in current month)
    const target = new Date(year, month - 1, 1);
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const yyyy = target.getFullYear();
    return `${mm}/${yyyy}`;
}
