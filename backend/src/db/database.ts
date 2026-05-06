import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { db } from './kysely';
import { Migrator, FileMigrationProvider } from 'kysely';
import { logger } from '../logger';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

const dbPath = path.resolve(__dirname, 'krafiler.sqlite');

// Keep openDb for backward compatibility until all routes are migrated
export async function openDb(): Promise<Database> {
    return open({
        filename: dbPath,
        driver: sqlite3.Database
    });
}

export async function initDb() {
    logger.info('Running database migrations...');

    const migrator = new Migrator({
        db,
        provider: new FileMigrationProvider({
            fs: fsPromises,
            path,
            migrationFolder: path.join(__dirname, 'migrations'),
        }),
    });

    const { error, results } = await migrator.migrateToLatest();

    results?.forEach((it) => {
        if (it.status === 'Success') {
            logger.info(`Migration "${it.migrationName}" was executed successfully`);
        } else if (it.status === 'Error') {
            logger.error(`Failed to execute migration "${it.migrationName}"`);
        }
    });

    if (error) {
        logger.error({ err: error }, 'Failed to run migrations');
        process.exit(1);
    }

    logger.info('Database initialized');

    // Default seed (only required for standard backward compatibility initially)
    const legacyDb = await openDb();
    const existing = await legacyDb.get('SELECT id FROM clients WHERE pin = ?', ['P052262687K']);
    if (!existing) {
        await legacyDb.run(
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
}
