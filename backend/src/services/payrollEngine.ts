export interface PayrollInput {
    employeeId: number;
    employeeName: string;
    kraPin: string;
    payrollNumber: string;
    basicPay: number;
    // Individual benefits (new — fixed monthly values, not prorated)
    carBenefit?: number;
    mealsBenefit?: number;
    nonCashBenefits?: number;
    housingBenefit?: number;
    otherBenefits?: number;
    dateJoined: string;
    dateLeft: string | null;
    employmentStatus: string;
    loanDeduction?: number;
    unpaidLeaveDays?: number;
    payStructure?: 'fixed' | 'prorated';
    overtimePay?: number;
    attendanceAbsentDays?: number;
    attendanceLateDays?: number;
    pwd?: string;
    otherPension?: number;
    postRetMedical?: number;
    mortgageInterest?: number;
    insuranceRelief?: number;
    bonusPay?: number;
    standardCheckIn?: string;
    standardCheckOut?: string;
    basicPayOverride?: number;
}

export interface PayrollAdjustmentInput {
    type: 'allowance' | 'deduction';
    amount: number;
    isStatutory: boolean;
}

export interface PayrollComputed {
    employeeId: number;
    employeeName: string;
    kraPin: string;
    payrollNumber: string;
    basicPay: number;
    benefits: number; // total benefits sum
    // Individual benefits (new)
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    housingBenefit: number;
    otherBenefits: number;
    grossPay: number;
    shaDeduction: number;
    nssfDeduction: number;
    ahlDeduction: number;
    loanDeduction: number;
    unpaidLeaveDeduction: number;
    unpaidLeaveDays: number;
    otherDeductions: number;
    totalDeductions: number;
    taxablePay: number;
    payeTax: number;
    netPay: number;
    daysWorked: number;
    overtimePay: number;
    absentDays: number;
    lateDays: number;
    bonusPay: number;
    taxableBonus: number;
    nonTaxableBonus: number;
}

interface WorkScheduleConfig {
    Mon?: number;
    Tue?: number;
    Wed?: number;
    Thu?: number;
    Fri?: number;
    Sat?: number;
    Sun?: number;
}

interface HolidayInfo {
    date: string;
    isRecurring: number;
}

function roundMoney(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

function dayName(date: Date): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
}

export function getScheduledWorkDays(config: WorkScheduleConfig, period: string, holidays: HolidayInfo[] = []): number {
    if (!config || Object.keys(config).length === 0) return 30; // Fallback to legacy

    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const totalDays = daysInMonth(year, month);

    let workDays = 0;
    for (let d = 1; d <= totalDays; d++) {
        const date = new Date(year, month - 1, d);
        const day = dayName(date);
        const hours = config[day as keyof WorkScheduleConfig] || 0;
        if (hours > 0) {
            // Check if it's a holiday
            const dateStr = date.toISOString().split('T')[0];
            const isHoliday = holidays.some(h => {
                if (h.date === dateStr) return true;
                // Recurring: match MM-DD
                if (h.isRecurring === 1) {
                    const hDate = new Date(h.date);
                    return hDate.getMonth() === (month - 1) && hDate.getDate() === d;
                }
                return false;
            });
            if (!isHoliday) workDays++;
        }
    }
    return workDays || 30;
}

export function computePayrollEntry(
    input: PayrollInput,
    period: string,
    prorate: boolean,
    workScheduleConfig?: WorkScheduleConfig,
    holidays: HolidayInfo[] = [],
    adjustments: PayrollAdjustmentInput[] = [],
): PayrollComputed {
    const rawBasicPay = typeof input.basicPay === 'number' ? input.basicPay : parseFloat(String(input.basicPay)) || 0;
    const payStructure = input.payStructure || 'fixed';
    const hasOverride = input.basicPayOverride !== undefined && input.basicPayOverride !== null;

    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const totalDays = daysInMonth(year, month);

    // Determine scheduled work days for the month
    const scheduledWorkDays = workScheduleConfig
        ? getScheduledWorkDays(workScheduleConfig, period, holidays)
        : 30; // Legacy fallback

    let daysWorked = scheduledWorkDays;

    if (prorate && !hasOverride) {
        let activeDays = totalDays;

        const joined = input.dateJoined ? new Date(input.dateJoined) : null;
        const left = input.dateLeft ? new Date(input.dateLeft) : null;

        if (joined) {
            const joinDay = joined.getDate();
            const joinMonth = joined.getMonth() + 1;
            const joinYear = joined.getFullYear();
            if (joinYear === year && joinMonth === month) {
                activeDays = totalDays - joinDay + 1;
            }
        }

        if (left) {
            const leftDay = left.getDate();
            const leftMonth = left.getMonth() + 1;
            const leftYear = left.getFullYear();
            if (leftYear === year && leftMonth === month) {
                activeDays = leftDay - (joined && activeDays < totalDays ? joined.getDate() : 1) + 1;
                if (activeDays < 0) activeDays = 0;
            }
        }

        activeDays = Math.max(0, Math.min(totalDays, activeDays));

        if (payStructure === 'fixed') {
            daysWorked = Math.min(scheduledWorkDays, activeDays);
        } else {
            daysWorked = activeDays;
        }
    }

    const prorationFactor = payStructure === 'prorated' && prorate && !hasOverride
        ? daysWorked / totalDays
        : daysWorked / scheduledWorkDays;

    const basicPay = hasOverride
        ? roundMoney(input.basicPayOverride!)
        : roundMoney(rawBasicPay * prorationFactor);

    // Benefits are fixed monthly values — NOT prorated
    const carBenefit = roundMoney(input.carBenefit || 0);
    const mealsBenefit = roundMoney(input.mealsBenefit || 0);
    const nonCashBenefits = roundMoney(input.nonCashBenefits || 0);
    const housingBenefit = roundMoney(input.housingBenefit || 0);
    const otherBenefits = roundMoney(input.otherBenefits || 0);
    const totalBenefits = roundMoney(carBenefit + mealsBenefit + nonCashBenefits + housingBenefit + otherBenefits);

    const unpaidLeaveDays = input.unpaidLeaveDays || 0;
    const unpaidLeaveDeduction = roundMoney((rawBasicPay / scheduledWorkDays) * unpaidLeaveDays);

    const overtimePay = roundMoney(input.overtimePay || 0);
    const rawBonusPay = input.bonusPay || 0;
    const isLowIncome = rawBasicPay <= 11180;
    const taxableBonus = isLowIncome ? 0 : roundMoney(rawBonusPay);
    const nonTaxableBonus = isLowIncome ? roundMoney(rawBonusPay) : 0;

    const absentDays = hasOverride ? 0 : (input.attendanceAbsentDays || 0);
    const lateHours = hasOverride ? 0 : (input.attendanceLateDays || 0);
    const dailyRate = payStructure === 'prorated'
        ? rawBasicPay / Math.max(1, totalDays)
        : rawBasicPay / scheduledWorkDays;

    // Calculate actual standard working hours per day from employee schedule
    const standardIn = input.standardCheckIn || '08:00';
    const standardOut = input.standardCheckOut || '17:00';
    const [siH, siM] = standardIn.split(':').map(Number);
    const [soH, soM] = standardOut.split(':').map(Number);
    const standardWorkingMinutes = (soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0));
    const standardWorkingHours = Math.max(1, standardWorkingMinutes / 60);

    const attendanceDeduction = hasOverride
        ? 0
        : roundMoney(dailyRate * (absentDays + lateHours / standardWorkingHours));

    const grossPay = roundMoney(basicPay + totalBenefits + overtimePay + taxableBonus - unpaidLeaveDeduction - attendanceDeduction);

    // Apply dynamic adjustments
    const totalAllowances = adjustments
        .filter(a => a.type === 'allowance')
        .reduce((sum, a) => sum + a.amount, 0);
    const totalNonStatutoryDeductions = adjustments
        .filter(a => a.type === 'deduction' && !a.isStatutory)
        .reduce((sum, a) => sum + a.amount, 0);

    const adjustedGrossPay = roundMoney(grossPay + totalAllowances);
    const adjustedBenefits = roundMoney(totalBenefits + totalAllowances);

    const loanDeduction = roundMoney(input.loanDeduction || 0);

    const shaDeduction = roundMoney(adjustedGrossPay * 0.0275);

    const nssfTier1Gross = Math.min(adjustedGrossPay, 9000);
    const nssfTier1 = roundMoney(nssfTier1Gross * 0.06);
    const nssfTier2Gross = Math.max(0, Math.min(adjustedGrossPay - 9000, 99000));
    const nssfTier2 = roundMoney(nssfTier2Gross * 0.06);
    const nssfDeduction = roundMoney(nssfTier1 + nssfTier2);

    const ahlDeduction = roundMoney(adjustedGrossPay * 0.015);

    const otherDeductions = roundMoney(loanDeduction + totalNonStatutoryDeductions);

    // KRA caps per the official P10_Return template
    const otherPension = input.otherPension || 0;
    const nssfPensionCapped = Math.min(nssfDeduction + otherPension, 30000);
    const postRetMedicalCapped = Math.min(input.postRetMedical || 0, 15000);
    const mortgageInterestCapped = Math.min(input.mortgageInterest || 0, 30000);
    const pwdExemption = (input.pwd === 'Yes') ? 12500 : 0;

    const taxablePay = roundMoney(Math.max(0, adjustedGrossPay - shaDeduction - nssfPensionCapped - postRetMedicalCapped - mortgageInterestCapped - ahlDeduction - pwdExemption));

    const personalRelief = 2400;
    const insuranceRelief = Math.min(input.insuranceRelief || 0, 5000);

    const grossPayeTax = roundMoney(
        Math.max(0, taxablePay * 0.1)
        + Math.max(0, (taxablePay - 24000) * 0.15)
        + Math.max(0, (taxablePay - 32333) * 0.05)
        + Math.max(0, (taxablePay - 500000) * 0.025)
        + Math.max(0, (taxablePay - 800000) * 0.025)
    );

    const payeTax = roundMoney(Math.max(0, grossPayeTax - personalRelief - insuranceRelief));

    const totalDeductions = roundMoney(shaDeduction + nssfDeduction + ahlDeduction + otherDeductions + payeTax);
    const netPay = roundMoney(adjustedGrossPay - totalDeductions + nonTaxableBonus);

    return {
        employeeId: input.employeeId,
        employeeName: input.employeeName,
        kraPin: input.kraPin,
        payrollNumber: input.payrollNumber,
        basicPay,
        benefits: adjustedBenefits,
        // Individual benefits (new)
        carBenefit,
        mealsBenefit,
        nonCashBenefits,
        housingBenefit,
        otherBenefits,
        grossPay: adjustedGrossPay,
        shaDeduction,
        nssfDeduction,
        ahlDeduction,
        loanDeduction,
        unpaidLeaveDeduction,
        unpaidLeaveDays,
        otherDeductions,
        totalDeductions,
        taxablePay,
        payeTax,
        netPay,
        daysWorked,
        overtimePay,
        absentDays,
        lateDays: lateHours,
        bonusPay: taxableBonus + nonTaxableBonus,
        taxableBonus,
        nonTaxableBonus,
    };
}
