/**
 * firestoreSchema.ts
 *
 * TypeScript interfaces for Firestore collections.
 * These mirror the schema defined in the migration plan.
 *
 * Phase 2: All new data writes go to Firestore. SQLite remains as
 * read-only fallback until migration is validated end-to-end.
 */

import { Timestamp } from 'firebase-admin/firestore';

export type PlanType = 'starter' | 'solo' | 'practice' | 'firm';
export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'suspended';
export type TaxObligationType =
    | 'paye'
    | 'nssf'
    | 'sha'
    | 'vat'
    | 'tot'
    | 'mri'
    | 'dst'
    | 'eLevy'
    | 'income_tax_resident_individual'
    | 'income_tax_non_resident_individual'
    | 'income_tax_company'
    | 'excise_duty';

export type FilingStatus = 'na' | 'due' | 'generated' | 'queued' | 'filed' | 'failed';

export interface UserDoc {
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    role: 'accountant' | 'auditor' | 'admin';
    plan: PlanType;
    subscriptionStatus: SubscriptionStatus;
    subscriptionEndsAt: Timestamp | null;
    paystackCustomerCode?: string;
    paystackSubscriptionCode?: string;
    clientCount: number;
    filingsThisMonth: number;
    monthResetAt: Timestamp | null;
    taskQueueName?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface ClientDoc {
    id: string;
    ownerUid: string;
    name: string;
    pin: string; // KRA PIN
    email?: string;
    phone?: string;
    sector?: string;
    obligations: TaxObligationType[];
    status: Record<TaxObligationType, FilingStatus>;
    amounts: {
        payeAmount?: number;
        nitaAmount?: number;
        housingLevyAmount?: number;
        nssfAmount?: number;
        shaAmount?: number;
    };
    lastFiled: Record<TaxObligationType, { date: Timestamp; receiptUrl?: string; prnUrl?: string }>;
    generatedFiles: {
        payeZipUrl?: string;
        nssfFileUrl?: string;
        shaFileUrl?: string;
        totZipUrl?: string;
        vatPreparedZipUrl?: string;
        vatSourcePackageUrl?: string;
    };
    nssfNo?: string;
    credentials: {
        kraPassword?: string;       // AES-256-GCM ciphertext (hex)
        kraPasswordIv?: string;
        kraPasswordAuthTag?: string;
        nssfLogin?: string;
        nssfPassword?: string;
        shaLogin?: string;
        shaPassword?: string;
        helbLogin?: string;
        helbPassword?: string;
    };
    masterFile?: { url: string; uploadedAt: Timestamp; label: string };
    payStructure: 'fixed' | 'prorated';
    defaultWorkScheduleId?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface EmployeeDoc {
    id: string;
    clientId: string;
    ownerUid: string;
    employeeName: string;
    kraPin: string;
    idNumber: string;
    nssfNo: string;
    shaNo: string;
    department?: string;
    departmentId?: string;
    jobTitle?: string;
    employmentType: string;
    employmentStatus: 'Active' | 'Inactive';
    dateJoined: string; // ISO date
    dateLeft?: string;
    basicPay: number;
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    housingBenefit: number;
    otherBenefits: number;
    otherPension: number;
    postRetMedical: number;
    mortgageInterest: number;
    insuranceRelief: number;
    bonusPay: number;
    pwd: 'Yes' | 'No';
    standardCheckIn: string;
    standardCheckOut: string;
    workScheduleId?: string;
    offDay?: string;
    hourlyRate: number;
    passwordHash?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface PayrollRunDoc {
    id: string;
    clientId: string;
    ownerUid: string;
    period: string;
    periodLabel: string;
    status: 'draft' | 'completed' | 'closed' | 'rolled_back';
    totalEmployees: number;
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
    lockedAt?: Timestamp;
    notes?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface PayrollEntryDoc {
    id: string;
    employeeId: string;
    basicPay: number;
    benefits: number;
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    housingBenefit: number;
    otherBenefits: number;
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
    totalStdHours: number;
    unpaidLeaveDays: number;
    absentDays: number;
    lateDays: number;
    overtimePay: number;
    attendanceDeduction: number;
    hourlyRate: number;
    stdPayAmount: number;
    holidayHours: number;
    holidayPayAmount: number;
    paidLeaveHours: number;
    paidLeavePayAmount: number;
    absentHours: number;
    absentDedAmount: number;
    lateHours: number;
    lateDedAmount: number;
    unpaidLeaveHours: number;
    unpaidLeaveDedAmount: number;
    bonusPay: number;
    taxableBonus: number;
    nonTaxableBonus: number;
    loanDeduction: number;
    status: string;
    lockedAt?: Timestamp;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface JobDoc {
    id: string;
    ownerUid: string;
    clientId: string;
    clientPin: string;
    clientName: string;
    taxObligationType: TaxObligationType;
    filingType: 'nil' | 'upload' | 'prepare-only' | 'prn-only';
    status: 'queued' | 'preparing' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    message: string;
    queuePosition: number;
    cloudTaskName?: string;
    payload: Record<string, any>;
    artifacts: {
        receiptUrl?: string;
        prnUrl?: string;
        generatedZipUrl?: string;
        sourcePackageUrl?: string;
    };
    error?: {
        message: string;
        code: string;
        retryable: boolean;
        failedAt: Timestamp;
    };
    credentialUpdate?: {
        passwordChanged: boolean;
        newPassword: string;
        changedAt: Timestamp;
    };
    createdAt: Timestamp;
    updatedAt: Timestamp;
    startedAt?: Timestamp;
    completedAt?: Timestamp;
    durationMs?: number;
    expiresAt: Timestamp;
}

export interface JobLogDoc {
    timestamp: Timestamp;
    message: string;
    level: 'info' | 'warn' | 'error';
    progress?: number;
    step?: string;
}

export interface SubscriptionDoc {
    id: string;
    userId: string;
    paystackSubscriptionCode: string;
    paystackTransactionRef: string;
    plan: string;
    status: 'active' | 'past_due' | 'cancelled';
    amount: number;
    currency: 'KES';
    interval: 'monthly';
    startDate: Timestamp;
    endDate: Timestamp;
    nextPaymentDate: Timestamp;
    createdAt: Timestamp;
}

export interface EmailHistoryDoc {
    id: string;
    ownerUid: string;
    clientId: string;
    employeeId: string;
    employeeName: string;
    kraPin: string;
    emailAddress: string;
    documentType: 'payslip' | 'p9' | string;
    status: 'sent' | 'failed' | string;
    errorMessage?: string | null;
    sentAt: string;
}
