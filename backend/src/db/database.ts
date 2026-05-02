import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve(__dirname, 'krafiler.sqlite');

export async function openDb(): Promise<Database> {
    return open({
        filename: dbPath,
        driver: sqlite3.Database
    });
}

export async function initDb() {
    const db = await openDb();
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            pin TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            obligations TEXT NOT NULL,
            masterFileUrl TEXT,
            masterFileLabel TEXT,
            payrollSourceUrl TEXT,
            latestZipUrl TEXT,
            latestZipLabel TEXT,
            payeZipUrl TEXT,
            payeZipLabel TEXT,
            nssfFileUrl TEXT,
            nssfFileLabel TEXT,
            shaFileUrl TEXT,
            shaFileLabel TEXT,
            paye TEXT DEFAULT 'na',
            nssf TEXT DEFAULT 'na',
            sha TEXT DEFAULT 'na',
            eLevy TEXT DEFAULT 'na',
            vat TEXT DEFAULT 'na',
            tot TEXT DEFAULT 'na',
            mri TEXT DEFAULT 'na',
            dst TEXT DEFAULT 'na',
            payeAmount REAL,
            nitaAmount REAL,
            housingLevyAmount REAL,
            nssfAmount REAL,
            shaAmount REAL
        )
    `);

    // Insert default client if not exists
    const existing = await db.get('SELECT id FROM clients WHERE pin = ?', ['P052262687K']);
    if (!existing) {
        await db.run(
            `INSERT INTO clients (
                name, pin, password, obligations, paye, nssf, sha, vat, masterFileUrl, masterFileLabel
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                'Golden Karafuu Investment Limited',
                'P052262687K',
                '0720470947',
                'VAT, PAYE, INCOME TAX COMPANY',
                'due',
                'due',
                'due',
                'due',
                '/clients/Golden Karafuu Investment Limited/Axon_Unified_Payroll_Template_v3.xlsx',
                'Axon master workbook'
            ]
        );
        
        // Ensure frontend public directory for this client exists and copy the master CSV
        const frontendDir = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients', 'Golden Karafuu Investment Limited');
        fs.mkdirSync(frontendDir, { recursive: true });
        const sourceExcel = path.resolve(__dirname, '..', '..', 'Axon_Unified_Payroll_Template_v3.xlsx');
        if (fs.existsSync(sourceExcel)) {
            fs.copyFileSync(sourceExcel, path.join(frontendDir, 'Axon_Unified_Payroll_Template_v3.xlsx'));
        }
    }

    // Dynamic schema evolution for the new amounts
    const columns = ['payeAmount', 'nitaAmount', 'housingLevyAmount', 'nssfAmount', 'shaAmount'];
    for (const col of columns) {
        try {
            await db.run(`ALTER TABLE clients ADD COLUMN ${col} REAL`);
        } catch (e) {
            // Already exist
        }
    }

    // Dynamic schema evolution for the obligation states
    const obligationCols = ['paye', 'nssf', 'sha', 'eLevy', 'vat', 'tot', 'mri', 'dst'];
    for (const col of obligationCols) {
        try {
            await db.run(`ALTER TABLE clients ADD COLUMN ${col} TEXT DEFAULT 'na'`);
        } catch (e) {
            // Already exist
        }
    }

    // Dynamic schema evolution for the last filed tracking
    const lastFiledCols = [
        'payeLastFiledDate', 'payeReceiptUrl',
        'nssfLastFiledDate', 'nssfReceiptUrl',
        'shaLastFiledDate', 'shaReceiptUrl',
        'eLevyLastFiledDate', 'eLevyReceiptUrl',
        'vatLastFiledDate', 'vatReceiptUrl',
        'totLastFiledDate', 'totReceiptUrl',
        'mriLastFiledDate', 'mriReceiptUrl',
        'dstLastFiledDate', 'dstReceiptUrl'
    ];
    for (const col of lastFiledCols) {
         try {
             await db.run(`ALTER TABLE clients ADD COLUMN ${col} TEXT`);
         } catch (e) {
             // Already exist
         }
    }

    // Dynamic schema evolution for extra credentials/details (Email, Phone, Third-Party Logins)
    const extraCredentialCols = [
        'email', 'phone', 
        'nssfLogin', 'nssfPassword', 
        'shaLogin', 'shaPassword', 
        'etimsLogin', 'etimsPassword', 
        'eLevyLogin', 'eLevyPassword'
    ];
    for (const col of extraCredentialCols) {
         try {
             await db.run(`ALTER TABLE clients ADD COLUMN ${col} TEXT`);
         } catch (e) {
             // Already exist
         }
    }

    console.log('Database initialized');
    return db;
}
