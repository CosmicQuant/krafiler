import { Router } from 'express';
import multer from 'multer';
import { openDb } from '../db/database';
import { db as kyselyDb } from '../db/kysely';
import path from 'path';
import fs from 'fs/promises';
import { processAndStandardizePayroll } from '../scripts/ai-mapper';
import { calculatePayrollFields } from '../utils/payroll-calculations';

const router = Router();
const upload = multer({ dest: path.resolve(__dirname, '..', '..', 'tmp') });

import csv from 'csv-parser';
import fsStandard from 'fs';
import * as fastCsv from 'fast-csv';

function normalizeObligationToken(value: string): string {
    const normalized = value.trim().toLowerCase();

    if (!normalized) return normalized;
    if (normalized === 'monthly_rental_income' || normalized === 'monthly rental income') return 'mri';
    if (normalized === 'turnover_tax' || normalized === 'turnover tax') return 'tot';
    if (normalized === 'elevy' || normalized === 'e-levy') return 'elevy';
    if (normalized === 'income_tax_resident_individual' || normalized === 'income tax resident individual') return 'income_tax_resident_individual';
    if (normalized === 'income_tax_non_resident_individual' || normalized === 'income tax non-resident individual') return 'income_tax_non_resident_individual';
    if (normalized === 'income_tax_company' || normalized === 'income tax company') return 'income_tax_company';
    if (normalized === 'excise_duty' || normalized === 'excise duty') return 'excise_duty';

    return normalized;
}

// Get all clients
router.get('/', async (req, res) => {
    try {
        const db = await openDb();
        const clients = await db.all('SELECT * FROM clients');
        res.json(clients);
    } catch (err) {
        console.error('Error fetching clients:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update or upload master CSV
router.post('/:id/master-csv', upload.single('masterCsv'), async (req, res) => {
    try {
        const clientId = req.params.id;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const db = await openDb();
        const client = await db.get('SELECT * FROM clients WHERE id = ?', [clientId]);
        if (!client) {
            await fs.unlink(file.path);
            return res.status(404).json({ message: 'Client not found' });
        }

        const targetDir = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients', client.name);
        await fs.mkdir(targetDir, { recursive: true });

        let fileUrl = '';
        let finalLabel = '';
        let responseMessage = 'Master CSV uploaded successfully.';
        let fallbackReason: string | undefined;

        try {
            const result = await processAndStandardizePayroll(file.path, client, targetDir, file.originalname);

            if (!result.success) {
                throw new Error(result.message || 'AI standardization failed.');
            }

            await fs.unlink(file.path).catch(() => {});

            const filename = path.basename(result.mappedFile);
            fileUrl = `/clients/${encodeURIComponent(client.name)}/${filename}`;
            finalLabel = `${filename} (AI Standardized)`;
            responseMessage = 'Master CSV updated and mapped successfully via AI';
        } catch (error) {
            const fallbackFileName = path.basename(file.originalname || `master-upload-${Date.now()}.csv`);
            const fallbackPath = path.join(targetDir, fallbackFileName);
            await fs.rename(file.path, fallbackPath);

            fileUrl = `/clients/${encodeURIComponent(client.name)}/${fallbackFileName}`;
            finalLabel = fallbackFileName;
            fallbackReason = error instanceof Error ? error.message : 'AI standardization was unavailable.';
            responseMessage = 'Master CSV uploaded without AI standardization.';
            console.warn(`[Clients] Falling back to raw master CSV storage for client ${clientId}: ${fallbackReason}`);
        }

        await db.run('UPDATE clients SET masterFileUrl = ?, masterFileLabel = ? WHERE id = ?', [
            fileUrl,
            finalLabel,
            clientId
        ]);

        res.json({
            message: responseMessage,
            masterFileUrl: fileUrl,
            masterFileLabel: finalLabel,
            fallbackReason,
        });
    } catch (err) {
        console.error('Error updating master CSV:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Remove master CSV
router.delete('/:id/master-csv', async (req, res) => {
    try {
        const clientId = req.params.id;
        const db = await openDb();
        const client = await db.get('SELECT masterFileUrl, name FROM clients WHERE id = ?', [clientId]);
        
        if (!client) {
            return res.status(404).json({ message: 'Client not found' });
        }

        if (client.masterFileUrl) {
            try {
                // Decode the URI component to get the true filename from the URL route
                const decUrl = decodeURIComponent(client.masterFileUrl);
                const relPath = decUrl.replace(/^\/clients\//, '');
                // The DB stores paths like /clients/Client Name/Filename.csv
                const absolutePath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients', relPath);
                
                const stats = await fs.stat(absolutePath).catch(() => null);
                if (stats) {
                    await fs.unlink(absolutePath);
                }
            } catch (fsErr) {
                console.error('Error unlinking existing master CSV:', fsErr);
            }
        }

        await db.run('UPDATE clients SET masterFileUrl = NULL, masterFileLabel = NULL WHERE id = ?', [clientId]);
        res.json({ success: true, message: 'Master CSV deleted' });
        
    } catch (err) {
        console.error('Error deleting Master CSV:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Add new client
router.post('/', async (req, res) => {
    try {
        const { name, pin, password, iTaxPassword, obligations, sector, payStructure } = req.body;
        const effectivePassword = String(iTaxPassword || password || '').trim();

        if (!name || !pin || !effectivePassword) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const obsList = (obligations || '').split(',').map((s: string) => normalizeObligationToken(s));
        const paye = obsList.includes('paye') ? 'due' : 'na';
        const nssf = obsList.includes('nssf') ? 'due' : 'na';
        const sha = obsList.includes('sha') ? 'due' : 'na';
        const vat = obsList.includes('vat') ? 'due' : 'na';
        const tot = obsList.includes('tot') ? 'due' : 'na';
        const mri = obsList.includes('mri') ? 'due' : 'na';
        const eLevy = obsList.includes('elevy') ? 'due' : 'na';
        const dst = obsList.includes('dst') ? 'due' : 'na';
        const incomeTaxResidentIndividual = obsList.includes('income_tax_resident_individual') ? 'due' : 'na';
        const incomeTaxNonResidentIndividual = obsList.includes('income_tax_non_resident_individual') ? 'due' : 'na';
        const incomeTaxCompany = obsList.includes('income_tax_company') ? 'due' : 'na';
        const exciseDuty = obsList.includes('excise_duty') ? 'due' : 'na';

        const db = await openDb();
        const result = await db.run(
            `INSERT INTO clients (name, pin, password, obligations, sector, paye, nssf, sha, vat, tot, mri, eLevy, dst, incomeTaxResidentIndividual, incomeTaxNonResidentIndividual, incomeTaxCompany, exciseDuty, payStructure) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, pin, effectivePassword, obligations || '', sector || '', paye, nssf, sha, vat, tot, mri, eLevy, dst, incomeTaxResidentIndividual, incomeTaxNonResidentIndividual, incomeTaxCompany, exciseDuty, payStructure || 'fixed']
        );
        
        const newClient = await db.get('SELECT * FROM clients WHERE id = ?', [result.lastID]);

        // Seed default leave types for new client
        try {
            const now = new Date().toISOString();
            const defaults = [
                { name: 'Annual', isPaid: 1, maxDaysPerYear: 21 },
                { name: 'Sick', isPaid: 1, maxDaysPerYear: 10 },
                { name: 'Maternity', isPaid: 1, maxDaysPerYear: 90 },
                { name: 'Paternity', isPaid: 1, maxDaysPerYear: 14 },
                { name: 'Compassionate', isPaid: 1, maxDaysPerYear: 5 },
                { name: 'Study', isPaid: 1, maxDaysPerYear: 0 },
                { name: 'Unpaid', isPaid: 0, maxDaysPerYear: 0 },
            ];
                const clientId = Number(result.lastID);
                await kyselyDb
                .insertInto('leave_types')
                .values(defaults.map(d => ({
                    clientId,
                    name: d.name,
                    isPaid: d.isPaid,
                    maxDaysPerYear: d.maxDaysPerYear,
                    createdAt: now,
                    updatedAt: now,
                })))
                .execute();
        } catch (seedErr) {
            console.error('Error seeding default leave types:', seedErr);
        }

        res.status(201).json(newClient);
    } catch (err) {
        console.error('Error adding client:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Bulk import clients via CSV
router.post('/bulk', upload.single('clientsCsv'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No CSV file uploaded' });
        }

        const results: any[] = [];
        const filePath = req.file.path;

        await new Promise((resolve, reject) => {
            fsStandard.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => results.push(data))
                .on('end', resolve)
                .on('error', reject);
        });

        const db = await openDb();
        let addedCount = 0;
        let skippedRows: any[] = [];

        for (const rawRow of results) {
            // Normalize keys to lowercase and trim spaces/BOM
            const row: any = {};
            for (const [key, value] of Object.entries(rawRow)) {
                // remove typical BOM signature if present \uFEFF and spaces
                const cleanKey = key.replace(/^\uFEFF/, '').trim().toLowerCase();
                row[cleanKey] = typeof value === 'string' ? value.trim() : value;
            }

            const name = row['company name'] || row['name'];
            const pin = row['pin'];
            const password = row['password'] || '';

            if (!name || !pin) {
                console.warn('Skipped row (missing name or pin):', row);
                skippedRows.push(row);
                continue;
            }

            const email = row['email'] || '';
            const phone = row['phone'] || row['phone number'] || '';
            
            const nssfLogin = row['nssf login'] || row['nssflogin'] || '';
            const nssfPassword = row['nssf password'] || row['nssfpassword'] || row['e-citizen password'] || row['ecitizen password'] || '';
            
            const shaLogin = row['sha login'] || row['shalogin'] || '';
            const shaPassword = row['sha password'] || row['shapassword'] || row['e-citizen password'] || row['ecitizen password'] || '';
            
            const etimsLogin = row['etims login'] || row['etimslogin'] || '';
            const etimsPassword = row['etims password'] || row['etimspassword'] || row['e-citizen password'] || row['ecitizen password'] || '';
            
            const eLevyLogin = row['elevy login'] || row['elevylogin'] || '';
            const eLevyPassword = row['elevy password'] || row['elevypassword'] || row['e-citizen password'] || row['ecitizen password'] || '';

            const obligations = row['obligations'] || row['tax obligation'] || '';
            let parsedObs = obligations;
            if (parsedObs.toLowerCase().includes('income tax')) {
                parsedObs += ', paye'; // Or if it maps to paye or mri
            }

            const obsList = parsedObs.split(/[\s,]+/).map((s: string) => s.trim().toLowerCase());
            const paye = obsList.includes('paye') ? 'due' : 'na';
            const nssf = obsList.includes('nssf') ? 'due' : 'na';
            const sha = obsList.includes('sha') ? 'due' : 'na';
            const vat = obsList.includes('vat') ? 'due' : 'na';
            const tot = obsList.includes('tot') ? 'due' : 'na';
            const mri = obsList.includes('mri') ? 'due' : 'na';
            const eLevy = obsList.includes('elevy') ? 'due' : 'na';
            const dst = obsList.includes('dst') ? 'due' : 'na';

            try {
                await db.run(
                    `INSERT INTO clients (
                        name, pin, password, obligations, 
                        paye, nssf, sha, vat, tot, mri, eLevy, dst,
                        email, phone, nssfLogin, nssfPassword, shaLogin, shaPassword, etimsLogin, etimsPassword, eLevyLogin, eLevyPassword
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(pin) DO UPDATE SET
                        name=excluded.name, password=excluded.password, obligations=excluded.obligations,
                        paye=excluded.paye, nssf=excluded.nssf, sha=excluded.sha, vat=excluded.vat, tot=excluded.tot, mri=excluded.mri, eLevy=excluded.eLevy, dst=excluded.dst,
                        email=excluded.email, phone=excluded.phone,
                        nssfLogin=excluded.nssfLogin, nssfPassword=excluded.nssfPassword,
                        shaLogin=excluded.shaLogin, shaPassword=excluded.shaPassword,
                        etimsLogin=excluded.etimsLogin, etimsPassword=excluded.etimsPassword,
                        eLevyLogin=excluded.eLevyLogin, eLevyPassword=excluded.eLevyPassword`,
                    [
                        name, pin, password, obligations,
                        paye, nssf, sha, vat, tot, mri, eLevy, dst,
                        email, phone, nssfLogin, nssfPassword, shaLogin, shaPassword, etimsLogin, etimsPassword, eLevyLogin, eLevyPassword
                    ]
                );
                addedCount++;
            } catch (err) {
                console.error(`Failed to insert/update client ${pin}:`, err);
            }
        }

        await fs.unlink(filePath);
        
        if (addedCount === 0 && skippedRows.length > 0) {
            await fs.writeFile(path.resolve(__dirname, '..', '..', 'tmp', 'debug.json'), JSON.stringify(skippedRows, null, 2));
            return res.status(400).json({ 
                message: `0 clients added. Skipped ${skippedRows.length} rows. Please check backend/tmp/debug.json to see the parsed headers. Make sure the file is a standard CSV (not an Excel .xlsx) and has columns 'Company Name', 'PIN', and 'Password'.`,
                skipped: skippedRows.slice(0, 5) // Return first 5 for debugging
            });
        }

        res.json({ message: `Successfully added/updated ${addedCount} clients. Skipped ${skippedRows.length} invalid rows.` });
    } catch (err) {
        console.error('Error processing bulk CSV:', err);
        res.status(500).json({ message: 'Internal server error during bulk import' });
    }
});

// Update client
router.put('/:id', async (req, res) => {
    try {
        const { name, pin, password, iTaxPassword, obligations, sector, email, phone, payStructure } = req.body;
        const clientIdInt = parseInt(req.params.id, 10);
        if (isNaN(clientIdInt)) return res.status(400).json({ message: 'Invalid client ID' });
        const effectivePassword = String(iTaxPassword || password || '').trim();

        if (!name || !pin || !effectivePassword) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const legacyDb = await openDb();
        const existingClient = await legacyDb.get('SELECT * FROM clients WHERE id = ?', [clientIdInt]);
        if (!existingClient) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const obsList = (obligations || '').split(',').map((s: string) => normalizeObligationToken(s));
        const paye = obsList.includes('paye') ? (existingClient.paye === 'na' ? 'due' : existingClient.paye) : 'na';
        const nssf = obsList.includes('nssf') ? (existingClient.nssf === 'na' ? 'due' : existingClient.nssf) : 'na';
        const sha = obsList.includes('sha') ? (existingClient.sha === 'na' ? 'due' : existingClient.sha) : 'na';
        const vat = obsList.includes('vat') ? (existingClient.vat === 'na' ? 'due' : existingClient.vat) : 'na';
        const tot = obsList.includes('tot') ? (existingClient.tot === 'na' ? 'due' : existingClient.tot) : 'na';
        const mri = obsList.includes('mri') ? (existingClient.mri === 'na' ? 'due' : existingClient.mri) : 'na';
        const eLevy = obsList.includes('elevy') ? (existingClient.eLevy === 'na' ? 'due' : existingClient.eLevy) : 'na';
        const dst = obsList.includes('dst') ? (existingClient.dst === 'na' ? 'due' : existingClient.dst) : 'na';
        const incomeTaxResidentIndividual = obsList.includes('income_tax_resident_individual') ? (existingClient.incomeTaxResidentIndividual === 'na' ? 'due' : existingClient.incomeTaxResidentIndividual) : 'na';
        const incomeTaxNonResidentIndividual = obsList.includes('income_tax_non_resident_individual') ? (existingClient.incomeTaxNonResidentIndividual === 'na' ? 'due' : existingClient.incomeTaxNonResidentIndividual) : 'na';
        const incomeTaxCompany = obsList.includes('income_tax_company') ? (existingClient.incomeTaxCompany === 'na' ? 'due' : existingClient.incomeTaxCompany) : 'na';
        const exciseDuty = obsList.includes('excise_duty') ? (existingClient.exciseDuty === 'na' ? 'due' : existingClient.exciseDuty) : 'na';

        // Build column list dynamically — only include columns that exist in the table
        const tableCols = new Set(Object.keys(existingClient));
        const setClauses: string[] = [];
        const setValues: any[] = [];

        const addCol = (col: string, val: any) => {
            if (tableCols.has(col)) { setClauses.push(`${col} = ?`); setValues.push(val); }
        };
        addCol('name', name);
        addCol('pin', pin);
        addCol('password', effectivePassword);
        addCol('obligations', obligations || '');
        addCol('sector', sector || '');
        addCol('email', email || '');
        addCol('phone', phone || '');
        addCol('paye', paye);
        addCol('nssf', nssf);
        addCol('sha', sha);
        addCol('vat', vat);
        addCol('tot', tot);
        addCol('mri', mri);
        addCol('eLevy', eLevy);
        addCol('dst', dst);
        addCol('incomeTaxResidentIndividual', incomeTaxResidentIndividual);
        addCol('incomeTaxNonResidentIndividual', incomeTaxNonResidentIndividual);
        addCol('incomeTaxCompany', incomeTaxCompany);
        addCol('exciseDuty', exciseDuty);
        addCol('payStructure', payStructure || 'fixed');

        if (setClauses.length > 0) {
            setValues.push(clientIdInt);
            await legacyDb.run(`UPDATE clients SET ${setClauses.join(', ')} WHERE id = ?`, setValues);
        }

        const updated = await legacyDb.get('SELECT * FROM clients WHERE id = ?', [clientIdInt]);
        res.json(updated);
    } catch (err) {
        console.error('Error updating client:', err);
        console.error('Request body:', JSON.stringify(req.body));
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update single status field
router.put('/:id/status', async (req, res) => {
    try {
        const { field, status } = req.body;
        const clientId = req.params.id;
        
        const validFields = ['paye', 'nssf', 'sha', 'vat', 'tot', 'mri', 'eLevy', 'dst', 'incomeTaxResidentIndividual', 'incomeTaxNonResidentIndividual', 'incomeTaxCompany', 'exciseDuty'];
        if (!validFields.includes(field)) {
            return res.status(400).json({ message: 'Invalid status field' });
        }
        
        if (!status || typeof status !== 'string') {
            return res.status(400).json({ message: 'Status is required' });
        }

        const db = await openDb();
        await db.run(`UPDATE clients SET ${field} = ? WHERE id = ?`, [status, clientId]);
        
        const updatedClient = await db.get('SELECT * FROM clients WHERE id = ?', [clientId]);
        res.json(updatedClient);
    } catch (err) {
        console.error('Error updating client status:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete client
router.delete('/:id', async (req, res) => {
    try {
        const clientId = req.params.id;
        const db = await openDb();
        const client = await db.get('SELECT * FROM clients WHERE id = ?', [clientId]);
        if (!client) {
            return res.status(404).json({ message: 'Client not found' });
        }
        await db.run('DELETE FROM clients WHERE id = ?', [clientId]);
        res.json({ success: true, message: 'Client deleted' });
    } catch (err) {
        console.error('Error deleting client:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update payroll source URL 
router.post('/:id/payroll-source', async (req, res) => {
    try {
        const { payrollSourceUrl } = req.body;
        const clientId = req.params.id;
        
        const db = await openDb();
        await db.run('UPDATE clients SET payrollSourceUrl = ? WHERE id = ?', [payrollSourceUrl, clientId]);
        
        res.json({ message: 'Updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get payroll data (standardized CSV)
router.get('/:id/payroll-data', async (req, res) => {
    try {
        const clientId = parseInt(req.params.id, 10);
        if (isNaN(clientId)) return res.status(400).json({ message: 'Invalid client ID' });

        const client = await kyselyDb.selectFrom('clients').selectAll().where('id', '=', clientId).executeTakeFirst();
        if (!client) return res.status(404).json({ message: 'Client not found' });

        const employees = await kyselyDb.selectFrom('employees').selectAll().where('clientId', '=', clientId).orderBy('employeeName', 'asc').execute();

        if (employees.length === 0) {
            // Fallback: try reading from master CSV file
            const legacydb = await openDb();
            const clientLegacy = await legacydb.get('SELECT * FROM clients WHERE id = ?', [clientId]);
            if (clientLegacy?.masterFileUrl) {
                const decUrl = decodeURIComponent(clientLegacy.masterFileUrl);
                const relPath = decUrl.replace(/^\/clients\//, '');
                const csvPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients', relPath);
                const fileExists = await fs.stat(csvPath).then(() => true).catch(() => false);
                if (fileExists) {
                    const fsStandard = require('fs');
                    const fastCsv = require('fast-csv');
                    const rawRows: string[][] = [];
                    await new Promise<void>((resolve, reject) => {
                        fsStandard.createReadStream(csvPath)
                            .pipe(fastCsv.parse({ headers: false, ignoreEmpty: true, trim: true }))
                            .on('data', (row: string[]) => rawRows.push(row))
                            .on('error', reject)
                            .on('end', resolve);
                    });
                    let dataStartIndex = 0;
                    for (let i = 0; i < rawRows.length; i++) {
                        const row = rawRows[i];
                        if (row.some(c => c.toLowerCase().includes('payroll number'))) { dataStartIndex = i + 1; break; }
                    }
                    const headers = rawRows[dataStartIndex - 1] || [];
                    const csvEmployees = rawRows.slice(dataStartIndex).filter(row => row.some(c => c.trim())).map(row => {
                        const record: Record<string, string | number> = {};
                        headers.forEach((h, idx) => { const val = row[idx] || ''; const num = parseFloat(val); record[h] = isNaN(num) || val.trim() === '' ? val : num; });
                        return record;
                    });
                    return res.json({ hasData: true, clientId, clientName: clientLegacy.name, preamble: { companyName: clientLegacy.name || '', companyPin: clientLegacy.pin || '', companyNssf: '', companyNssfPassword: '', companyShaLogin: '', companyShaPassword: '' }, headers, employees: csvEmployees });
                }
            }
            return res.json({ hasData: false, clientId, clientName: client.name, employees: [] });
        }

        const headers = [
            'Payroll Number', 'PIN of Employee', 'ID Number', 'Identity Type', 'Name of Employee',
            'SHA No', 'NSSF No', 'Residential Status', 'Type of Employee', 'Persons with Disability(PWD)',
            'Exemption Certificate', 'Total Cash Pay (A)', 'Value of Car Benefit (B)', 'Value of Meals (C)',
            'Non Cash Benefits (D)', 'Type of Housing', 'Housing Benefit (F)', 'Other Benefits (G)',
            'Total Gross Pay (Ksh) (H)', 'Social Health Insurance Fund (I)', 'NSSF Contribution (J)',
            'Other Pension Contribution (K)', 'Post Retirement Medical Fund (L)', 'Mortgage Interest (M)',
            'Affordable Housing Levy (N)', 'Taxable Pay(Ksh) (O)', 'Monthly Personal Relief (Ksh) (P)',
            'Amount of Insurance Relief (Q)', 'PAYE Tax (Ksh) (R)', 'Self Assessed PAYE Tax (Ksh) (S)',
        ];

        const mapped = employees.map((emp, i) => {
            const totalCashPay = emp.basicPay || 0;
            const grossSalary = totalCashPay + (emp.carBenefit || 0) + (emp.mealsBenefit || 0) + (emp.nonCashBenefits || 0) + (emp.housingBenefit || 0) + (emp.otherBenefits || 0);
            const sha = Math.round(grossSalary * 0.0275 * 100) / 100;
            const nssf = Math.round((Math.min(grossSalary, 9000) * 0.06 + Math.max(0, Math.min(grossSalary - 9000, 99000)) * 0.06) * 100) / 100;
            const ahl = Math.round(grossSalary * 0.015 * 100) / 100;
            const taxablePay = Math.round(Math.max(0, grossSalary - sha - nssf - ahl) * 100) / 100;
            const paye = Math.round(Math.max(0,
                Math.max(0, taxablePay * 0.1) + Math.max(0, (taxablePay - 24000) * 0.15) + Math.max(0, (taxablePay - 32333) * 0.05) + Math.max(0, (taxablePay - 500000) * 0.025) + Math.max(0, (taxablePay - 800000) * 0.025) - 2400
            ) * 100) / 100;

            const record: Record<string, string | number> = {};
            record[headers[0]] = emp.payrollNumber || String(i + 1);
            record[headers[1]] = emp.kraPin || '';
            record[headers[2]] = emp.idNumber || '';
            record[headers[3]] = emp.identityType || 'National ID';
            record[headers[4]] = emp.employeeName || '';
            record[headers[5]] = emp.shaNo || '';
            record[headers[6]] = emp.nssfNo || '';
            record[headers[7]] = emp.residentialStatus || 'Resident';
            record[headers[8]] = emp.typeOfEmployee || 'Primary Employee';
            record[headers[9]] = emp.pwd || 'No';
            record[headers[10]] = emp.exemptionCert || '';
            record[headers[11]] = totalCashPay;
            record[headers[12]] = emp.carBenefit || 0;
            record[headers[13]] = emp.mealsBenefit || 0;
            record[headers[14]] = emp.nonCashBenefits || 0;
            record[headers[15]] = emp.typeOfHousing || 'Benefit not given';
            record[headers[16]] = emp.housingBenefit || 0;
            record[headers[17]] = emp.otherBenefits || 0;
            record[headers[18]] = grossSalary;
            record[headers[19]] = sha;
            record[headers[20]] = nssf;
            record[headers[21]] = emp.otherPension || 0;
            record[headers[22]] = emp.postRetMedical || 0;
            record[headers[23]] = emp.mortgageInterest || 0;
            record[headers[24]] = ahl;
            record[headers[25]] = taxablePay;
            record[headers[26]] = 2400;
            record[headers[27]] = emp.insuranceRelief || 0;
            record[headers[28]] = paye;
            record[headers[29]] = paye;
            record['Std Check-In'] = emp.standardCheckIn || '08:00';
            record['Std Check-Out'] = emp.standardCheckOut || '17:00';
            return record;
        });

        // Merge payroll pipeline data if period is provided
        const period = req.query.period as string;
        if (period) {
            const runs = await kyselyDb.selectFrom('payroll_runs').select('id').where('clientId', '=', clientId).where('period', '=', period).execute();
            if (runs.length > 0) {
                const entries = await kyselyDb.selectFrom('payroll_entries').selectAll().where('payrollRunId', 'in', runs.map(r => r.id as any)).execute();
                const entryMap = new Map<number, any>();
                for (const e of entries) entryMap.set(e.employeeId, e);
                for (const m of mapped) {
                    const kraPin = String(m[headers[1]] || '');
                    const emp = employees.find(e => e.kraPin === kraPin);
                    if (emp && entryMap.has(emp.id)) {
                        const en = entryMap.get(emp.id)!;
                        m['OT Pay (read-only)'] = en.overtimePay || 0;
                        m['Absent Days (read-only)'] = en.absentDays || 0;
                        m['Late Days (read-only)'] = en.lateDays || 0;
                        m['Unpaid Leave Days (read-only)'] = en.unpaidLeaveDays || 0;
                        m['Bonus Pay (read-only)'] = en.bonusPay || emp.bonusPay || 0;
                    }
                }
            }
        }

        res.json({
            hasData: true,
            clientId,
            clientName: client.name,
            preamble: {
                companyName: client.name || '',
                companyPin: client.pin || '',
                companyNssf: client.nssfLogin || '',
                companyNssfPassword: '',
                companyShaLogin: client.shaLogin || '',
                companyShaPassword: '',
            },
            headers,
            employees: mapped,
        });
    } catch (err) {
        console.error('[PayrollData] Error fetching payroll data:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update payroll data (save edited standardized CSV)
router.put('/:id/payroll-data', async (req, res) => {
    try {
        const clientId = req.params.id;
        const { employees } = req.body;
        const db = await openDb();
        const client = await db.get('SELECT * FROM clients WHERE id = ?', [clientId]);
        if (!client) {
            return res.status(404).json({ message: 'Client not found' });
        }

        let csvPath: string;
        let relPath: string;
        if (client.masterFileUrl) {
            const decUrl = decodeURIComponent(client.masterFileUrl);
            relPath = decUrl.replace(/^\/clients\//, '');
            csvPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients', relPath);
        } else {
            // No master CSV yet — create one from scratch
            const safeName = String(client.name || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
            relPath = path.join(String(clientId), `${safeName}_Standardized.csv`);
            const clientsDir = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients', String(clientId));
            await fs.mkdir(clientsDir, { recursive: true });
            csvPath = path.join(clientsDir, `${safeName}_Standardized.csv`);
            const fileUrl = `/clients/${clientId}/${safeName}_Standardized.csv`;
            await db.run('UPDATE clients SET masterFileUrl = ?, masterFileLabel = ? WHERE id = ?', [fileUrl, `${safeName}_Standardized.csv`, clientId]);
        }

        const rawRows: string[][] = [];
        const fileExists = fsStandard.existsSync(csvPath);
        if (fileExists) {
            await new Promise<void>((resolve, reject) => {
                fsStandard.createReadStream(csvPath)
                    .pipe(fastCsv.parse({ headers: false, ignoreEmpty: true, trim: true }))
                    .on('data', (row: string[]) => rawRows.push(row))
                    .on('error', reject)
                    .on('end', resolve);
            });
        }

        const headerRowIndex = rawRows.findIndex(row =>
            row.some(c => c.toLowerCase().includes('payroll number'))
        );

        const headers = rawRows[headerRowIndex] || [];

        const standardHeaders = [
            "Payroll Number", "PIN of Employee", "ID Number", "Identity Type", "Name of Employee",
            "SHA No", "NSSF No", "Residential Status", "Type of Employee", "Persons with Disability(PWD)",
            "Exemption Certificate", "Total Cash Pay (A)", "Value of Car Benefit (B)", "Value of Meals (C)",
            "Non Cash Benefits (D)", "Type of Housing", "Housing Benefit (F)", "Other Benefits (G)",
            "Total Gross Pay (Ksh) (H)", "Social Health Insurance Fund (I)", "NSSF Contribution (J)",
            "Other Pension Contribution (K)", "Post Retirement Medical Fund (L)", "Mortgage Interest (M)",
            "Affordable Housing Levy (N)", "Taxable Pay(Ksh) (O)", "Monthly Personal Relief (Ksh) (P)",
            "Amount of Insurance Relief (Q)", "PAYE Tax (Ksh) (R)", "Self Assessed PAYE Tax (Ksh) (S)"
        ];

        const preambleRows = rawRows.slice(0, headerRowIndex)
            .filter(row => row.length > 0 && row[0]);
        if (preambleRows.length === 0) {
            preambleRows.push(
                ['COMPANY NAME:', client.name || ''],
                ['COMPANY KRA PIN:', client.pin || ''],
                ['COMPANY NSSF NO:', ''],
                ['COMPANY NSSF PASSWORD:', ''],
                ['COMPANY SHA LOGIN:', ''],
                ['COMPANY SHA PASSWORD:', ''],
            );
        }

        const getVal = (emp: any, idx: number): string => {
            const header = standardHeaders[idx];
            const val = emp[header] !== undefined ? emp[header] : '';
            return String(val);
        };

        const headerMap: Record<string, number> = {};
        standardHeaders.forEach((h, i) => { headerMap[h] = i; });

        const csvLines: string[] = [];
        preambleRows.forEach(row => csvLines.push(row.join(',')));
        csvLines.push('');
        csvLines.push(standardHeaders.join(','));

        let totalPaye = 0;
        let totalNssf = 0;
        let totalSha = 0;
        let totalNita = 0;
        let totalHousingLevy = 0;

        employees.forEach((emp: any, index: number) => {
            const totalCashPay = parseFloat(emp[standardHeaders[11]]) || 0;
            const carBenefit = parseFloat(emp[standardHeaders[12]]) || 0;
            const meals = parseFloat(emp[standardHeaders[13]]) || 0;
            const nonCash = parseFloat(emp[standardHeaders[14]]) || 0;
            const housingBenefit = parseFloat(emp[standardHeaders[16]]) || 0;
            const otherBenefits = parseFloat(emp[standardHeaders[17]]) || 0;
            const pwd = String(emp[standardHeaders[9]] || 'No');
            const otherPension = parseFloat(emp[standardHeaders[21]]) || 0;
            const postRetMedical = parseFloat(emp[standardHeaders[22]]) || 0;
            const mortgage = parseFloat(emp[standardHeaders[23]]) || 0;
            const insuranceRelief = parseFloat(emp[standardHeaders[27]]) || 0;
            const nameOfEmployee = String(emp[standardHeaders[4]] || '');

            const calc = calculatePayrollFields({
                employeeName: nameOfEmployee,
                totalCashPay,
                carBenefit,
                meals,
                nonCash,
                housingBenefit,
                otherBenefits,
                pwd,
                otherPension,
                postRetMedical,
                mortgage,
                insuranceRelief,
            });

            const row: string[] = [];
            for (let i = 0; i < standardHeaders.length; i++) {
                const header = standardHeaders[i];
                switch (i) {
                    case 0: row.push(getVal(emp, i) || String(index + 1)); break;
                    case 1: case 2: case 3: case 4: case 5: case 6: case 7: case 8: case 9: case 10: case 15:
                        row.push(getVal(emp, i)); break;
                    case 11: row.push(String(totalCashPay)); break;
                    case 12: row.push(String(carBenefit)); break;
                    case 13: row.push(String(meals)); break;
                    case 14: row.push(String(nonCash)); break;
                    case 16: row.push(String(housingBenefit)); break;
                    case 17: row.push(String(otherBenefits)); break;
                    case 18: row.push(calc.grossSalary.toFixed(2)); break;
                    case 19: row.push(calc.shaContribution.toFixed(2)); break;
                    case 20: row.push(calc.nssfContribution.toFixed(2)); break;
                    case 21: row.push(String(otherPension)); break;
                    case 22: row.push(String(postRetMedical)); break;
                    case 23: row.push(String(mortgage)); break;
                    case 24: row.push(calc.ahl.toFixed(2)); break;
                    case 25: row.push(calc.taxablePay.toFixed(2)); break;
                    case 26: row.push(calc.personalRelief.toFixed(2)); break;
                    case 27: row.push(String(insuranceRelief)); break;
                    case 28: row.push(calc.paye.toFixed(2)); break;
                    case 29: row.push(calc.selfAssessedPaye.toFixed(2)); break;
                    default: row.push(getVal(emp, i)); break;
                }
            }

            totalPaye += calc.paye;
            totalNssf += calc.nssfContribution;
            totalSha += calc.shaContribution;
            totalNita += calc.paye * 0.0175; // approximate NITA
            totalHousingLevy += calc.ahl;

            csvLines.push(row.join(','));
        });

        await fs.writeFile(csvPath, '\ufeff' + csvLines.join('\n'), 'utf-8');

        // Update summary amounts in DB
        await db.run(
            `UPDATE clients SET 
                payeAmount = ?, nitaAmount = ?, housingLevyAmount = ?, 
                nssfAmount = ?, shaAmount = ? 
             WHERE id = ?`,
            [
                Math.round(totalPaye * 100) / 100,
                Math.round(totalNita * 100) / 100,
                Math.round(totalHousingLevy * 100) / 100,
                Math.round(totalNssf * 100) / 100,
                Math.round(totalSha * 100) / 100,
                clientId
            ]
        );

        res.json({ success: true, message: 'Payroll data saved and recalculated.' });
    } catch (err) {
        console.error('Error saving payroll data:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:id/logo — upload company logo
router.post('/:id/logo', upload.single('logo'), async (req, res) => {
    try {
        const clientId = req.params.id;
        const file = req.file;
        if (!file) return res.status(400).json({ message: 'No logo file uploaded' });

        const db = await openDb();
        const client = await db.get('SELECT * FROM clients WHERE id = ?', [clientId]);
        if (!client) {
            await fs.unlink(file.path);
            return res.status(404).json({ message: 'Client not found' });
        }

        const safeName = String(client.name || 'client').replace(/[^a-zA-Z0-9]/g, '_');
        const ext = path.extname(file.originalname) || '.png';
        const logoDir = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients', String(clientId));
        const logoPath = path.join(logoDir, `${safeName}_logo${ext}`);
        await fs.mkdir(logoDir, { recursive: true });
        await fs.copyFile(file.path, logoPath);
        await fs.unlink(file.path);

        const fileUrl = `/clients/${clientId}/${safeName}_logo${ext}`;
        await db.run('UPDATE clients SET logoUrl = ? WHERE id = ?', [fileUrl, clientId]);

        res.json({ success: true, logoUrl: fileUrl });
    } catch (err) {
        console.error('Error uploading logo:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;