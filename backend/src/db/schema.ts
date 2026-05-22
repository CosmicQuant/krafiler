import { Generated } from 'kysely';
import { TaxObligationType } from '../types';

export interface ClientsTable {
    id: Generated<number>;
    name: string;
    pin: string;
    password: string;
    obligations: string;
    
    // Files
    masterFileUrl: string | null;
    masterFileLabel: string | null;
    payrollSourceUrl: string | null;
    latestZipUrl: string | null;
    latestZipLabel: string | null;
    payeZipUrl: string | null;
    payeZipLabel: string | null;
    nssfFileUrl: string | null;
    nssfFileLabel: string | null;
    shaFileUrl: string | null;
    shaFileLabel: string | null;
    
    // Statuses
    paye: string | null;
    nssf: string | null;
    sha: string | null;
    eLevy: string | null;
    vat: string | null;
    tot: string | null;
    mri: string | null;
    dst: string | null;
    incomeTaxResidentIndividual: string | null;
    incomeTaxNonResidentIndividual: string | null;
    incomeTaxCompany: string | null;
    exciseDuty: string | null;
    
    // Amounts
    payeAmount: number | null;
    nitaAmount: number | null;
    housingLevyAmount: number | null;
    nssfAmount: number | null;
    shaAmount: number | null;

    // Last filed tracking
    payeLastFiledDate: string | null;
    payeReceiptUrl: string | null;
    nssfLastFiledDate: string | null;
    nssfReceiptUrl: string | null;
    shaLastFiledDate: string | null;
    shaReceiptUrl: string | null;
    eLevyLastFiledDate: string | null;
    eLevyReceiptUrl: string | null;
    vatLastFiledDate: string | null;
    vatReceiptUrl: string | null;
    totLastFiledDate: string | null;
    totReceiptUrl: string | null;
    mriLastFiledDate: string | null;
    mriReceiptUrl: string | null;
    dstLastFiledDate: string | null;
    dstReceiptUrl: string | null;
    incomeTaxResidentIndividualLastFiledDate: string | null;
    incomeTaxResidentIndividualReceiptUrl: string | null;
    incomeTaxNonResidentIndividualLastFiledDate: string | null;
    incomeTaxNonResidentIndividualReceiptUrl: string | null;
    incomeTaxCompanyLastFiledDate: string | null;
    incomeTaxCompanyReceiptUrl: string | null;
    exciseDutyLastFiledDate: string | null;
    exciseDutyReceiptUrl: string | null;

    // Credentials
    sector: string | null;
    email: string | null;
    phone: string | null;
    nssfLogin: string | null;
    nssfPassword: string | null;
    shaLogin: string | null;
    shaPassword: string | null;
    etimsLogin: string | null;
    etimsPassword: string | null;
    eLevyLogin: string | null;
    eLevyPassword: string | null;
    payStructure: string;
    logoUrl: string | null;
}

export interface JobHistoryTable {
    id: Generated<number>;
    jobId: string;
    clientPin: string;
    taxObligation: string;
    status: 'completed' | 'failed';
    receiptPath: string | null;
    receiptNumber: string | null;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string;
    durationMs: number;
}

export interface EmployeesTable {
    id: Generated<number>;
    clientId: number;
    payrollNumber: string;
    employeeName: string;
    idNumber: string;
    kraPin: string;
    nssfNo: string;
    shaNo: string;
    phone: string;
    email: string;
    bankName: string;
    bankAccount: string;
    bankCode: string;
    department: string;
    departmentId: number | null;
    role: string;
    jobTitle: string;
    employmentType: string;
    employmentStatus: string;
    dateJoined: string;
    dateLeft: string | null;
    standardCheckOut: string;
    standardCheckIn: string;
    basicPay: number;
    identityType: string;
    residentialStatus: string;
    typeOfEmployee: string;
    pwd: string;
    exemptionCert: string;
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    typeOfHousing: string;
    housingBenefit: number;
    otherBenefits: number;
    otherPension: number;
    postRetMedical: number;
    mortgageInterest: number;
    insuranceRelief: number;
    payStructure: string;
    bonusPay: number;
    passwordHash: string | null;
    passwordChangedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface LeaveRequestsTable {
    id: Generated<number>;
    clientId: number;
    employeeId: number;
    employeeName: string;
    kraPin: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    daysCount: number;
    reason: string;
    status: string;
    isPaid: number; // 1 = paid, 0 = unpaid
    createdAt: string;
    updatedAt: string;
}

export interface LeaveTypesTable {
    id: Generated<number>;
    clientId: number;
    name: string;
    isPaid: number; // 1 = paid, 0 = unpaid
    maxDaysPerYear: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface LoansTable {
    id: Generated<number>;
    clientId: number;
    employeeId: number;
    employeeName: string;
    kraPin: string;
    loanType: string;
    principal: number;
    monthlyDeduction: number;
    installments: number;
    remainingInstallments: number;
    interestRate: number;
    totalInterest: number;
    totalRepayable: number;
    amountPaid: number;
    status: string;
    disbursedAt: string | null;
    notes: string;
    createdAt: string;
    updatedAt: string;
}

export interface AttendanceRecordsTable {
    id: Generated<number>;
    clientId: number;
    employeeId: number;
    employeeName: string;
    kraPin: string;
    date: string;
    checkIn: string;
    checkOut: string;
    status: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
}

export interface EmailHistoryTable {
    id: Generated<number>;
    clientId: number;
    employeeId: number;
    employeeName: string;
    kraPin: string;
    emailAddress: string;
    documentType: string;
    status: string;
    errorMessage: string | null;
    sentAt: string;
}

export interface PayrollRunsTable {
    id: Generated<number>;
    clientId: number;
    period: string;
    periodLabel: string;
    status: string;
    totalEmployees: number;
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PayrollEntriesTable {
    id: Generated<number>;
    payrollRunId: number;
    clientId: number;
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
    otherDeductions: number;
    totalDeductions: number;
    taxablePay: number;
    payeTax: number;
    netPay: number;
    daysWorked: number;
    unpaidLeaveDays: number;
    loanDeduction: number;
    overtimePay: number;
    absentDays: number;
    lateDays: number;
    bonusPay: number;
    taxableBonus: number;
    nonTaxableBonus: number;
    status: string;
    createdAt: string;
}

export interface DepartmentsTable {
    id: Generated<number>;
    clientId: number;
    name: string;
    headEmployeeId: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface DocumentsTable {
    id: Generated<number>;
    clientId: number;
    employeeId: number;
    documentType: string;
    fileName: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
    notes: string;
    uploadedAt: string;
}

export interface OvertimeRecordsTable {
    id: Generated<number>;
    clientId: number;
    employeeId: number;
    period: string;
    hours: number;
    rate: number;
    multiplier: number;
    amount: number;
    description: string;
    createdAt: string;
}

export interface AuditLogTable {
    id: Generated<number>;
    clientId: number;
    employeeId: number | null;
    action: string;
    entityType: string;
    entityId: number | null;
    oldValues: string | null;
    newValues: string | null;
    performedBy: string;
    createdAt: string;
}

export interface AttendancePayrollApprovalsTable {
    id: Generated<number>;
    clientId: number;
    period: string;
    employeeId: number;
    employeeName: string;
    absentDays: number;
    lateHours: number;
    overtimeHours: number;
    overtimeRate: number;
    overtimeMultiplier: number;
    overtimeAmount: number;
    approvedBy: string | null;
    approvedAt: string | null;
    createdAt: string;
}

export interface Database {
    clients: ClientsTable;
    job_history: JobHistoryTable;
    employees: EmployeesTable;
    leave_requests: LeaveRequestsTable;
    leave_types: LeaveTypesTable;
    loans: LoansTable;
    attendance_records: AttendanceRecordsTable;
    email_history: EmailHistoryTable;
    payroll_runs: PayrollRunsTable;
    payroll_entries: PayrollEntriesTable;
    departments: DepartmentsTable;
    documents: DocumentsTable;
    audit_log: AuditLogTable;
    overtime_records: OvertimeRecordsTable;
    attendance_payroll_approvals: AttendancePayrollApprovalsTable;
}
