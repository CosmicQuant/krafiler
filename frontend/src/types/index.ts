export type DashboardView = 'overview' | 'payroll' | 'vat' | 'tot' | 'mri' | 'dst' | 'nil-filing' | 'income-tax-individual' | 'income-tax-company' | 'clients' | 'settings';
export type PlanKey = 'starter' | 'growth' | 'enterprise';

export type PracticePlan = {
    label: string;
    capacity: number | 'Unlimited';
    used: number;
};

export type TaxStatus = 'done' | 'due' | 'na' | 'generated' | 'filed' | 'paid';

export type VatBreakdownItem = {
    label: string;
    base: number;
    vat: number;
    rate: number;
};

export type VatPreparationSummary = {
    inputVat: number;
    outputVat: number;
    previousCredit: number;
    withholdingAmount: number;
    payableVat: number;
    netVatBalance: number;
    sales?: VatBreakdownItem[];
    purchases?: VatBreakdownItem[];
};

export type ClientObligation = {
    password?: string;
    iTaxPassword?: string;
    nssfNo?: string;
    nssfPassword?: string;
    shaLogin?: string;
    shaPassword?: string;
    helbLogin?: string;
    helbPassword?: string;
    sector?: string;
    obligations?: string;
    email?: string;
    phone?: string;
    id: string;
    name: string;
    pin: string;
    masterFileUrl?: string;
    masterFileLabel?: string;
    payrollSourceUrl?: string;
    payeZipUrl?: string;
    vatZipUrl?: string;
    vatZipLabel?: string;
    vatSourcePackageUrl?: string;
    vatSourcePackageLabel?: string;
    totZipUrl?: string;
    totZipLabel?: string;
    payeZipLabel?: string;
    nssfFileUrl?: string;
    nssfFileLabel?: string;
    shaFileUrl?: string;
    shaFileLabel?: string;
    lastGeneratedAt?: string;
    payeAmount?: number;
    nitaAmount?: number;
    housingLevyAmount?: number;
    nssfAmount?: number;
    shaAmount?: number;
    vatInputVat?: number;
    vatOutputVat?: number;
    vatPreviousCredit?: number;
    vatWithholdingAmount?: number;
    vatSectionBWithoutPinSales?: number;
    vatPayableVat?: number;
    vatNetVatBalance?: number;
    vatPreparedAt?: string;
    paye: TaxStatus;
    nssf: TaxStatus;
    sha: TaxStatus;
    eLevy: TaxStatus;
    vat: TaxStatus;
    tot: TaxStatus;
    mri: TaxStatus;
    dst: TaxStatus;
    incomeTaxResidentIndividual: TaxStatus;
    incomeTaxNonResidentIndividual: TaxStatus;
    incomeTaxCompany: TaxStatus;
    exciseDuty: TaxStatus;
    payeLastFiledDate?: string;
    payeReceiptUrl?: string;
    payePrnUrl?: string;
    payePeriod?: string;
    nssfLastFiledDate?: string;
    nssfReceiptUrl?: string;
    nssfPrnUrl?: string;
    nssfPeriod?: string;
    shaLastFiledDate?: string;
    shaReceiptUrl?: string;
    shaPrnUrl?: string;
    shaPeriod?: string;
    eLevyLastFiledDate?: string;
    eLevyReceiptUrl?: string;
    eLevyPrnUrl?: string;
    eLevyPeriod?: string;
    vatLastFiledDate?: string;
    vatReceiptUrl?: string;
    vatPrnUrl?: string;
    vatPeriod?: string;
    vatPeriodMonth?: number;
    vatPeriodYear?: number;
    payePeriodMonth?: number;
    payePeriodYear?: number;
    totPeriodMonth?: number;
    totPeriodYear?: number;
    mriPeriodMonth?: number;
    mriPeriodYear?: number;
    filedPeriods?: Record<string, string[]>;
    nssfError?: string;
    nssfErrorType?: string;
    payeError?: string;
    payeErrorType?: string;
    shaError?: string;
    shaErrorType?: string;
    totLastFiledDate?: string;
    totReceiptUrl?: string;
    totPrnUrl?: string;
    totPeriod?: string;
    mriLastFiledDate?: string;
    mriReceiptUrl?: string;
    mriPrnUrl?: string;
    mriPeriod?: string;
    dstLastFiledDate?: string;
    dstReceiptUrl?: string;
    dstPrnUrl?: string;
    dstPeriod?: string;
    incomeTaxResidentIndividualLastFiledDate?: string;
    incomeTaxResidentIndividualReceiptUrl?: string;
    incomeTaxResidentIndividualPrnUrl?: string;
    incomeTaxResidentIndividualPeriod?: string;
    incomeTaxNonResidentIndividualLastFiledDate?: string;
    incomeTaxNonResidentIndividualReceiptUrl?: string;
    incomeTaxNonResidentIndividualPrnUrl?: string;
    incomeTaxNonResidentIndividualPeriod?: string;
    incomeTaxCompanyLastFiledDate?: string;
    incomeTaxCompanyReceiptUrl?: string;
    incomeTaxCompanyPrnUrl?: string;
    incomeTaxCompanyPeriod?: string;
    exciseDutyLastFiledDate?: string;
    exciseDutyReceiptUrl?: string;
    exciseDutyPrnUrl?: string;
    exciseDutyPeriod?: string;
    logoUrl?: string;
    defaultWorkScheduleId?: string | null;
};

export type FilingJobState = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'unknown' | 'cancelling' | 'cancelled';

export type ActiveDashboardJob = {
    id: string;
    state: FilingJobState;
    progress: number;
    message: string;
    obligationType?: string;
    isNil?: boolean;
    failedReason?: string;
    receiptUrl?: string;
    prnUrl?: string;
    generatedZipUrl?: string;
    generatedZipLabel?: string;
    sourcePackageUrl?: string;
    sourcePackageLabel?: string;
    vatSummary?: VatPreparationSummary;
    stepLogs?: FilingStepLog[];
};

export type TaxObligationType =
    | 'income_tax_resident_individual'
    | 'income_tax_non_resident_individual'
    | 'income_tax_company'
    | 'vat'
    | 'paye'
    | 'turnover_tax'
    | 'monthly_rental_income'
    | 'excise_duty';

export const TAX_OBLIGATION_OPTIONS: { value: TaxObligationType; label: string; filingMode: 'nil' | 'transactional'; description?: string }[] = [
    { value: 'income_tax_resident_individual', label: 'Income Tax - Resident Individual (Nil)', filingMode: 'nil', description: 'File a nil income tax return for resident individuals.' },
    { value: 'income_tax_non_resident_individual', label: 'Income Tax - Non-Resident Individual (Nil)', filingMode: 'nil', description: 'File a nil income tax return for non-resident individuals.' },
    { value: 'income_tax_company', label: 'Income Tax - Company (Nil)', filingMode: 'nil', description: 'File a nil income tax return for companies.' },
    { value: 'vat', label: 'Value Added Tax (Nil)', filingMode: 'nil', description: 'File a nil VAT return when there are no taxable supplies.' },
    { value: 'paye', label: 'PAYE (Nil)', filingMode: 'nil', description: 'File a nil PAYE return when no salaries were paid.' },
    { value: 'turnover_tax', label: 'Turnover Tax (Nil)', filingMode: 'nil', description: 'File a nil Turnover Tax return.' },
    { value: 'monthly_rental_income', label: 'Monthly Rental Income (Nil)', filingMode: 'nil', description: 'File a nil Monthly Rental Income return.' },
    { value: 'excise_duty', label: 'Excise Duty (Nil)', filingMode: 'nil', description: 'File a nil Excise Duty return when no excisable goods were manufactured or imported.' },
];

export type FilingStepLog = {
    timestamp: string;
    message: string;
    level?: 'info' | 'error' | 'warn';
    progress?: number;
};

export type FilingStatusResponse = {
    jobId: string;
    state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'unknown' | 'cancelling' | 'cancelled';
    progress: number;
    attemptsMade: number;
    failedReason: string | null;
    stepLogs: FilingStepLog[];
    lastStep: FilingStepLog | null;
    credentialUpdate: { newPassword: string } | null;
    result: { receiptPath?: string; receiptNumber?: string } | null;
    processedOn: string | null;
    finishedOn: string | null;
};

export type FilingResponse = {
    success: boolean;
    message: string;
    jobId?: string;
};

export type FilingFormData = {
    kraPin: string;
    kraPassword: string;
    periodFrom: string;
    periodTo: string;
    taxObligationType: TaxObligationType;
    ownsRentalProperty: boolean;
    rentalIncomeAmount?: number;
    totYear: number;
    totMonth: number;
    totTurnover?: number;
    otpCode?: string;
};
