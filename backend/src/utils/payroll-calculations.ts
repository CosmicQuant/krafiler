export interface PayrollCalculationInput {
    employeeName?: string;
    totalCashPay: number;
    carBenefit?: number;
    meals?: number;
    nonCash?: number;
    housingBenefit?: number;
    otherBenefits?: number;
    typeOfHousing?: string;
    pwd?: string;
    otherPension?: number;
    postRetMedical?: number;
    mortgage?: number;
    insuranceRelief?: number;
}

export interface PayrollCalculationResult {
    grossSalary: number;
    shaContribution: number;
    nssfContribution: number;
    ahl: number;
    taxablePay: number;
    personalRelief: number;
    insuranceRelief: number;
    paye: number;
    selfAssessedPaye: number;
}

function roundMoney(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function isPwdExempt(value?: string): boolean {
    return value?.trim().toLowerCase() === 'yes';
}

export function calculatePayrollFields(input: PayrollCalculationInput): PayrollCalculationResult {
    const totalCashPay = input.totalCashPay || 0;
    const carBenefit = input.carBenefit || 0;
    const meals = input.meals || 0;
    const nonCash = input.nonCash || 0;
    const housingBenefit = input.housingBenefit || 0;
    const otherBenefits = input.otherBenefits || 0;
    const typeOfHousing = input.typeOfHousing || 'Benefit not given';
    const otherPension = input.otherPension || 0;
    const postRetMedical = input.postRetMedical || 0;
    const mortgage = input.mortgage || 0;
    const insuranceRelief = input.insuranceRelief || 0;

    // Apply the same benefit inclusion rules as the payroll engine.
    const taxableMeals = Math.max(0, meals - 5000);
    const taxableNonCash = nonCash > 5000 ? nonCash : 0;
    const housingGiven = typeOfHousing !== 'Benefit not given';
    const taxableHousing = housingGiven ? housingBenefit : 0;
    const grossSalary = roundMoney(totalCashPay + carBenefit + taxableMeals + taxableNonCash + taxableHousing + otherBenefits);
    const shaContribution = grossSalary > 0 ? roundMoney(grossSalary * 0.0275) : 0;
    const nssfContribution = grossSalary > 0 ? roundMoney(Math.min(grossSalary * 0.06, 6480)) : 0;
    const ahl = grossSalary > 0 ? roundMoney(grossSalary * 0.015) : 0;
    const pwdExemption = isPwdExempt(input.pwd) ? 150000 : 0;
    const nssfPensionCapped = Math.min(nssfContribution + otherPension, 30000);
    const postRetMedicalCapped = Math.min(postRetMedical, 15000);
    const mortgageCapped = Math.min(mortgage, 30000);
    const taxablePay = roundMoney(Math.max(0, grossSalary - shaContribution - nssfPensionCapped - postRetMedicalCapped - mortgageCapped - ahl - pwdExemption));
    const personalRelief = totalCashPay > 0 || !!input.employeeName?.trim() ? 2400 : 0;

    const paye = roundMoney(Math.max(
        0,
        Math.max(0, taxablePay * 0.1)
            + Math.max(0, (taxablePay - 24000) * 0.15)
            + Math.max(0, (taxablePay - 32333) * 0.05)
            + Math.max(0, (taxablePay - 500000) * 0.025)
            + Math.max(0, (taxablePay - 800000) * 0.025)
            - personalRelief
            - insuranceRelief
    ));

    return {
        grossSalary,
        shaContribution,
        nssfContribution,
        ahl,
        taxablePay,
        personalRelief,
        insuranceRelief,
        paye,
        selfAssessedPaye: paye,
    };
}