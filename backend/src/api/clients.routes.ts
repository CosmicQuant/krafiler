import { Router } from 'express';
import multer from 'multer';
import { openDb } from '../db/database';
import path from 'path';
import fs from 'fs/promises';
import { processAndStandardizePayroll } from '../scripts/ai-mapper';

const router = Router();
const upload = multer({ dest: path.resolve(__dirname, '..', '..', 'tmp') });

import csv from 'csv-parser';
import fsStandard from 'fs';

function normalizeObligationToken(value: string): string {
    const normalized = value.trim().toLowerCase();

    if (!normalized) return normalized;
    if (normalized === 'monthly_rental_income' || normalized === 'monthly rental income') return 'mri';
    if (normalized === 'turnover_tax' || normalized === 'turnover tax') return 'tot';
    if (normalized === 'elevy' || normalized === 'elevy') return 'elevy';

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
        const { name, pin, password, iTaxPassword, obligations, sector } = req.body;
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

        const db = await openDb();
        const result = await db.run(
            `INSERT INTO clients (name, pin, password, obligations, sector, paye, nssf, sha, vat, tot, mri, eLevy, dst) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, pin, effectivePassword, obligations || '', sector || '', paye, nssf, sha, vat, tot, mri, eLevy, dst]
        );
        
        const newClient = await db.get('SELECT * FROM clients WHERE id = ?', [result.lastID]);
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
        const { name, pin, password, iTaxPassword, obligations, sector, email, phone } = req.body;
        const clientId = req.params.id;
        const effectivePassword = String(iTaxPassword || password || '').trim();

        if (!name || !pin || !effectivePassword) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const db = await openDb();
        const existingClient = await db.get('SELECT * FROM clients WHERE id = ?', [clientId]);
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

        await db.run(
            `UPDATE clients 
             SET name = ?, pin = ?, password = ?, obligations = ?, sector = ?, email = ?, phone = ?,
                 paye = ?, nssf = ?, sha = ?, vat = ?, tot = ?, mri = ?, eLevy = ?, dst = ?
             WHERE id = ?`,
            [name, pin, effectivePassword, obligations || '', sector || '', email || '', phone || '', paye, nssf, sha, vat, tot, mri, eLevy, dst, clientId]
        );
        
        const updatedClient = await db.get('SELECT * FROM clients WHERE id = ?', [clientId]);
        res.json(updatedClient);
    } catch (err) {
        console.error('Error updating client:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update single status field
router.put('/:id/status', async (req, res) => {
    try {
        const { field, status } = req.body;
        const clientId = req.params.id;
        
        const validFields = ['paye', 'nssf', 'sha', 'vat', 'tot', 'mri', 'eLevy', 'dst'];
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

export default router;