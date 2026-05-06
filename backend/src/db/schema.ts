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

export interface Database {
    clients: ClientsTable;
    job_history: JobHistoryTable;
}
