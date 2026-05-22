export interface PayrollInput {
    employeeId: number;
    employeeName: string;
    kraPin: string;
    payrollNumber: string;
    basicPay: number;
    benefits: number;
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
}

export interface PayrollComputed {
    employeeId: number;
    employeeName: string;
    kraPin: string;
    payrollNumber: string;
    basicPay: number;
    benefits: number;
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

function roundMoney(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

export function computePayrollEntry(input: PayrollInput, period: string, prorate: boolean): PayrollComputed {
    const rawBasicPay = typeof input.basicPay === 'number' ? input.basicPay : parseFloat(String(input.basicPay)) || 0;
    const rawBenefits = typeof input.benefits === 'number' ? input.benefits : parseFloat(String(input.benefits)) || 0;
    const payStructure = input.payStructure || 'fixed';

    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const totalDays = daysInMonth(year, month);

    let daysWorked = 30;

    if (prorate) {
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
            daysWorked = Math.min(30, activeDays);
        } else {
            daysWorked = activeDays;
        }
    }

    const prorationFactor = payStructure === 'prorated' && prorate
        ? daysWorked / totalDays
        : daysWorked / 30;

    const basicPay = roundMoney(rawBasicPay * prorationFactor);
    const benefits = roundMoney(rawBenefits * prorationFactor);

    const unpaidLeaveDays = input.unpaidLeaveDays || 0;
    const unpaidLeaveDeduction = roundMoney((rawBasicPay / 30) * unpaidLeaveDays);

    const overtimePay = roundMoney(input.overtimePay || 0);
    const rawBonusPay = input.bonusPay || 0;
    const isLowIncome = rawBasicPay <= 11180;
    const taxableBonus = isLowIncome ? 0 : roundMoney(rawBonusPay);
    const nonTaxableBonus = isLowIncome ? roundMoney(rawBonusPay) : 0;

    const absentDays = input.attendanceAbsentDays || 0;
    const lateHours = input.attendanceLateDays || 0;
    const dailyRate = payStructure === 'prorated'
        ? rawBasicPay / Math.max(1, totalDays)
        : rawBasicPay / 30;
    const attendanceDeduction = roundMoney(dailyRate * (absentDays + lateHours / 8));

    const grossPay = roundMoney(basicPay + benefits + overtimePay + taxableBonus - unpaidLeaveDeduction - attendanceDeduction);

    const loanDeduction = roundMoney(input.loanDeduction || 0);

    const shaDeduction = roundMoney(grossPay * 0.0275);

    const nssfTier1Gross = Math.min(grossPay, 9000);
    const nssfTier1 = roundMoney(nssfTier1Gross * 0.06);
    const nssfTier2Gross = Math.max(0, Math.min(grossPay - 9000, 99000));
    const nssfTier2 = roundMoney(nssfTier2Gross * 0.06);
    const nssfDeduction = roundMoney(nssfTier1 + nssfTier2);

    const ahlDeduction = roundMoney(grossPay * 0.015);

    const otherDeductions = roundMoney(loanDeduction);

    // KRA caps per the official P10_Return template
    const otherPension = input.otherPension || 0;
    const nssfPensionCapped = Math.min(nssfDeduction + otherPension, 30000);
    const postRetMedicalCapped = Math.min(input.postRetMedical || 0, 15000);
    const mortgageInterestCapped = Math.min(input.mortgageInterest || 0, 30000);
    const pwdExemption = (input.pwd === 'Yes') ? 12500 : 0;

    const taxablePay = roundMoney(Math.max(0, grossPay - shaDeduction - nssfPensionCapped - postRetMedicalCapped - mortgageInterestCapped - ahlDeduction - pwdExemption));

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
    const netPay = roundMoney(grossPay - totalDeductions + nonTaxableBonus);

    return {
        employeeId: input.employeeId,
        employeeName: input.employeeName,
        kraPin: input.kraPin,
        payrollNumber: input.payrollNumber,
        basicPay,
        benefits,
        grossPay,
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
