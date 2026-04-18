// ─── Encryption ──────────────────────────────────────────────────────────────

export interface EncryptionResult {
    encryptedData: string;
    iv: string;
    authTag: string;
}

export const TAX_OBLIGATION_TYPES = [
    'income_tax_resident_individual',
    'income_tax_non_resident_individual',
    'monthly_rental_income',
    'income_tax_company',
    'vat',
    'paye',
    'turnover_tax',
] as const;

export type TaxObligationType = (typeof TAX_OBLIGATION_TYPES)[number];

// ─── Job Payload ──────────────────────────────────────────────────────────────

export interface NilReturnPayload {
    kraPin: string;
    /** AES-256-GCM ciphertext (hex) — plaintext password is NEVER stored */
    encryptedPassword: string;
    /** GCM initialisation vector (hex) */
    iv: string;
    /** GCM authentication tag (hex) */
    authTag: string;
    /** ISO-8601 date string */
    periodFrom: string;
    /** ISO-8601 date string */
    periodTo: string;
    taxObligationType: TaxObligationType;
    ownsRentalProperty: boolean;
    rentalIncomeAmount?: number;
    zipFilePath?: string;
    otpCode?: string;
}

export interface FilingJob {
    jobId: string;
    userId: string;
    payload: NilReturnPayload;
    createdAt: string;
    credentialUpdate?: CredentialUpdate;
}

export interface FilingStepLog {
    timestamp: string;
    message: string;
    progress: number | null;
    level: 'info' | 'error';
}

export interface CredentialUpdate {
    passwordChanged: boolean;
    newPassword: string;
    changedAt: string;
}

// ─── Job Result ───────────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface JobResult {
    status: JobStatus;
    receiptPath?: string;
    receiptNumber?: string | null;
    credentialUpdate?: CredentialUpdate | null;
    error?: string;
    completedAt?: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export interface FileNilReturnRequest {
    kraPin: string;
    kraPassword: string;
    periodFrom?: string;
    periodTo?: string;
    taxObligationType: TaxObligationType;
    ownsRentalProperty?: boolean;
    rentalIncomeAmount?: number;
    zipFilePath?: string;
    otpCode?: string;
}

export interface FileNilReturnResponse {
    success: boolean;
    message: string;
    jobId?: string;
}
