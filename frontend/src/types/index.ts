export type DashboardView = 'overview' | 'desk-9th' | 'desk-20th' | 'desk-elevy' | 'desk-nil' | 'clients' | 'settings';
export type PlanKey = 'starter' | 'growth' | 'enterprise';

export type PracticePlan = {
    label: string;
    capacity: number | 'Unlimited';
    used: number;
};

export type TaxStatus = 'done' | 'due' | 'na' | 'generated' | 'filed' | 'paid';

export type VatPreparationSummary = {
    inputVat: number;
    outputVat: number;
    previousCredit: number;
    payableVat: number;
    netVatBalance: number;
};

export type ClientObligation = {
    iTaxPassword?: string;
    sector?: string;
    obligations?: string;
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
    payeLastFiledDate?: string;
    payeReceiptUrl?: string;
    nssfLastFiledDate?: string;
    nssfReceiptUrl?: string;
    shaLastFiledDate?: string;
    shaReceiptUrl?: string;
    eLevyLastFiledDate?: string;
    eLevyReceiptUrl?: string;
    vatLastFiledDate?: string;
    vatReceiptUrl?: string;
    totLastFiledDate?: string;
    totReceiptUrl?: string;
    mriLastFiledDate?: string;
    mriReceiptUrl?: string;
    dstLastFiledDate?: string;
    dstReceiptUrl?: string;
};

export type FilingJobState = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'unknown' | 'cancelling' | 'cancelled';

export type ActiveDashboardJob = {
    id: string;
    state: FilingJobState;
    progress: number;
    message: string;
    obligationType?: string;
    failedReason?: string;
    receiptUrl?: string;
    prnUrl?: string;
    generatedZipUrl?: string;
    generatedZipLabel?: string;
    sourcePackageUrl?: string;
    sourcePackageLabel?: string;
    vatSummary?: VatPreparationSummary;
};
