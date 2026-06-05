/**
 * clients.firestore.ts
 *
 * Firestore-backed clients routes.
 * Mounted when DATABASE_MODE=firestore.
 *
 * Phase 2: This is the first Firestore route file. Others will follow
 * the same pattern (employees, payroll-runs, etc.).
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import fsStandard from 'fs';
import { adminDb } from '../lib/firebaseAdmin';
import { calculatePayrollFields } from '../utils/payroll-calculations';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { ClientDoc, TaxObligationType, FilingStatus } from '../types/firestoreSchema';
import { verifyAuth, AuthenticatedRequest } from '../middleware/verifyAuth';
import { uploadFile, uploadBuffer, getSignedDownloadUrl, masterCsvPath, logoPath } from '../lib/cloudStorage';
import { ensureAllClientDefaults } from '../services/seedClientDefaults';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const COLLECTION = 'clients';

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

function defaultStatus(): Record<TaxObligationType, FilingStatus> {
    return {
        paye: 'na', nssf: 'na', sha: 'na', vat: 'na', tot: 'na', mri: 'na',
        dst: 'na', eLevy: 'na', income_tax_resident_individual: 'na',
        income_tax_non_resident_individual: 'na', income_tax_company: 'na',
        excise_duty: 'na',
    };
}

// ─── GET /api/clients ─────────────────────────────────────────────────────────
router.get('/', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const snapshot = await adminDb
            .collection(COLLECTION)
            .where('ownerUid', '==', uid)
            .get();

        const clients = await Promise.all(
            snapshot.docs.map(async (doc) => {
                const data = doc.data() as any;
                const client: any = {
                    id: doc.id,
                    ...data,
                    // Flatten credentials for frontend compatibility
                    password: data.credentials?.kraPassword || null,
                    iTaxPassword: data.credentials?.kraPassword || null,
                    nssfNo: data.credentials?.nssfLogin || data.nssfNo || null,
                    nssfPassword: data.credentials?.nssfPassword || null,
                    shaLogin: data.credentials?.shaLogin || null,
                    shaPassword: data.credentials?.shaPassword || null,
                    helbLogin: data.credentials?.helbLogin || null,
                    helbPassword: data.credentials?.helbPassword || null,
                };
                if (data.masterFile?.gcsPath) {
                    try {
                        client.masterFileUrl = await getSignedDownloadUrl(data.masterFile.gcsPath, 60);
                    } catch {
                        // leave as-is
                    }
                }
                return client;
            })
        );
        res.json(clients);
    } catch (err) {
        console.error('Error fetching clients from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── GET /api/clients/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.id;
        const docRef = adminDb.collection(COLLECTION).doc(clientId);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const data = doc.data() as any;
        const result: any = {
            id: doc.id,
            ...data,
            // Flatten credentials for frontend compatibility
            password: data.credentials?.kraPassword || null,
            iTaxPassword: data.credentials?.kraPassword || null,
            nssfNo: data.credentials?.nssfLogin || data.nssfNo || null,
            nssfPassword: data.credentials?.nssfPassword || null,
            shaLogin: data.credentials?.shaLogin || null,
            shaPassword: data.credentials?.shaPassword || null,
            helbLogin: data.credentials?.helbLogin || null,
            helbPassword: data.credentials?.helbPassword || null,
        };

        // Generate fresh signed URL for master file so the frontend "View" link works
        if (data.masterFile?.gcsPath) {
            try {
                result.masterFileUrl = await getSignedDownloadUrl(data.masterFile.gcsPath, 60);
            } catch {
                // leave masterFileUrl as-is if signing fails
            }
        }

        // Auto-create default work schedules, holidays, and leave types on first access
        ensureAllClientDefaults(uid, clientId).catch((err) => {
            console.error('[auto-seed] Failed to seed defaults for client', clientId, err);
        });

        res.json(result);
    } catch (err) {
        console.error('Error fetching client:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── POST /api/clients ────────────────────────────────────────────────────────
router.post('/', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const { name, pin, password, email, phone, sector, obligations, payStructure, nssfNo, nssfPassword, shaLogin, shaPassword, helbLogin, helbPassword } = req.body;

        if (!name || !pin || !password) {
            return res.status(400).json({ message: 'Name, PIN, and password are required' });
        }

        // Check for duplicate PIN under this owner
        const existing = await adminDb
            .collection(COLLECTION)
            .where('ownerUid', '==', uid)
            .where('pin', '==', pin.trim().toUpperCase())
            .limit(1)
            .get();

        if (!existing.empty) {
            return res.status(409).json({ message: 'A client with this KRA PIN already exists.' });
        }

        const normalizedObligations = (obligations || '')
            .split(',')
            .map((s: string) => normalizeObligationToken(s))
            .filter(Boolean) as TaxObligationType[];

        const status: Record<string, FilingStatus> = defaultStatus();
        for (const ob of normalizedObligations) {
            status[ob] = 'due';
        }

        const newClient: Omit<ClientDoc, 'id'> = {
            ownerUid: uid,
            name: name.trim(),
            pin: pin.trim().toUpperCase(),
            email: email?.trim() || null,
            phone: phone?.trim() || null,
            sector: sector?.trim() || null,
            obligations: normalizedObligations,
            status: status as Record<TaxObligationType, FilingStatus>,
            amounts: {},
            lastFiled: {} as any,
            generatedFiles: {} as any,
            credentials: {
                kraPassword: password,
                nssfLogin: nssfNo?.trim() || null,
                nssfPassword: nssfPassword?.trim() || null,
                shaLogin: shaLogin?.trim() || null,
                shaPassword: shaPassword?.trim() || null,
                helbLogin: helbLogin?.trim() || null,
                helbPassword: helbPassword?.trim() || null,
            },
            nssfNo: nssfNo?.trim() || null,
            masterFile: undefined,
            payStructure: payStructure || 'fixed',
            defaultWorkScheduleId: undefined,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        };

        const docRef = await adminDb.collection(COLLECTION).add(newClient);

        // Increment user clientCount
        await adminDb.collection('users').doc(uid).update({
            clientCount: FieldValue.increment(1),
        });

        res.status(201).json({ id: docRef.id, ...newClient });
    } catch (err) {
        console.error('Error creating client:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── PUT /api/clients/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const docRef = adminDb.collection(COLLECTION).doc(req.params.id);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const { name, pin, password, email, phone, sector, obligations, payStructure, nssfNo, nssfPassword, shaLogin, shaPassword, helbLogin, helbPassword, defaultWorkScheduleId } = req.body;
        const updateData: any = { updatedAt: Timestamp.now() };

        if (name !== undefined) updateData.name = name.trim();
        if (pin !== undefined) updateData.pin = pin.trim().toUpperCase();
        if (email !== undefined) updateData.email = email?.trim() || null;
        if (phone !== undefined) updateData.phone = phone?.trim() || null;
        if (sector !== undefined) updateData.sector = sector?.trim() || null;
        if (payStructure !== undefined) updateData.payStructure = payStructure;
        if (nssfNo !== undefined) updateData.nssfNo = nssfNo?.trim() || null;
        if (defaultWorkScheduleId !== undefined) updateData.defaultWorkScheduleId = defaultWorkScheduleId || null;

        const credUpdate: any = {};
        if (password !== undefined) credUpdate.kraPassword = password;
        if (nssfPassword !== undefined) credUpdate.nssfPassword = nssfPassword?.trim() || null;
        if (shaLogin !== undefined) credUpdate.shaLogin = shaLogin?.trim() || null;
        if (shaPassword !== undefined) credUpdate.shaPassword = shaPassword?.trim() || null;
        if (helbLogin !== undefined) credUpdate.helbLogin = helbLogin?.trim() || null;
        if (helbPassword !== undefined) credUpdate.helbPassword = helbPassword?.trim() || null;
        if (Object.keys(credUpdate).length > 0) {
            updateData.credentials = { ...doc.data()!.credentials, ...credUpdate };
        }

        if (obligations !== undefined) {
            const normalized = obligations
                .split(',')
                .map((s: string) => normalizeObligationToken(s))
                .filter(Boolean) as TaxObligationType[];
            updateData.obligations = normalized;
        }

        await docRef.update(updateData);
        const updated = await docRef.get();
        res.json({ id: updated.id, ...updated.data() });
    } catch (err) {
        console.error('Error updating client:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── DELETE /api/clients/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const docRef = adminDb.collection(COLLECTION).doc(req.params.id);
        const doc = await docRef.get();

        if (!doc.exists || doc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }

        // Delete subcollections (employees, payrollRuns, etc.)
        const employees = await adminDb.collection('employees').where('clientId', '==', req.params.id).get();
        const batch = adminDb.batch();
        employees.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();

        await docRef.delete();

        // Decrement user clientCount
        await adminDb.collection('users').doc(uid).update({
            clientCount: FieldValue.increment(-1),
        });

        res.json({ success: true, message: 'Client deleted' });
    } catch (err) {
        console.error('Error deleting client:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── POST /api/clients/:id/master-csv ──────────────────────────────────────────
router.post('/:id/master-csv', upload.single('masterCsv'), async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.id;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const docRef = adminDb.collection(COLLECTION).doc(clientId);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const destName = path.basename(file.originalname || `master-upload-${Date.now()}.csv`);
        const gcsPath = masterCsvPath(uid, clientId, destName);
        const { uploadBuffer } = await import('../lib/cloudStorage');
        await uploadBuffer(file.buffer, gcsPath, {
            contentType: file.mimetype || 'text/csv',
            metadata: { originalName: file.originalname, uploadedBy: uid },
        });

        await docRef.update({
            masterFile: {
                gcsPath,
                uploadedAt: Timestamp.now(),
                label: destName,
            },
            updatedAt: Timestamp.now(),
        });

        res.json({ masterFileGcsPath: gcsPath, masterFileLabel: destName });
    } catch (err) {
        console.error('Error uploading master CSV:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── POST /api/clients/:id/logo ────────────────────────────────────────────────
router.post('/:id/logo', upload.single('logo'), async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.id;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const docRef = adminDb.collection(COLLECTION).doc(clientId);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const ext = path.extname(file.originalname) || '.png';
        const destName = `logo${ext}`;
        const gcsPath = logoPath(uid, clientId, destName);
        const { uploadBuffer } = await import('../lib/cloudStorage');
        await uploadBuffer(file.buffer, gcsPath, {
            contentType: file.mimetype || 'image/png',
            metadata: { originalName: file.originalname, uploadedBy: uid },
        });

        await docRef.update({ logoGcsPath: gcsPath, updatedAt: Timestamp.now() });

        res.json({ logoGcsPath: gcsPath });
    } catch (err) {
        console.error('Error uploading logo:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/clients/:id/master-csv-download — proxy GCS download to avoid CORS
router.get('/:id/master-csv-download', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.id;

        const doc = await adminDb.collection(COLLECTION).doc(clientId).get();
        if (!doc.exists || doc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const gcsPath = (doc.data() as any).masterFile?.gcsPath;
        if (!gcsPath) {
            return res.status(404).json({ message: 'No master CSV found' });
        }

        const { createReadStream } = await import('../lib/cloudStorage');
        const stream = createReadStream(gcsPath);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(gcsPath)}"`);
        stream.pipe(res);
    } catch (err) {
        console.error('Error downloading master CSV from GCS:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ─── Payroll Data Endpoints ───────────────────────────────────────────────────

// GET /api/clients/:id/payroll-data
router.get('/:id/payroll-data', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.id;

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        if (!clientDoc.exists || clientDoc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }
        const client = { id: clientDoc.id, ...clientDoc.data() };

        const employeesSnapshot = await adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();

        if (employeesSnapshot.empty) {
            // Fallback: try reading from master CSV file (GCS or local)
            const masterFile = (client as any).masterFile;
            let csvContent = '';
            if (masterFile?.gcsPath) {
                try {
                    const { downloadToTemp } = await import('../lib/cloudStorage');
                    const tempPath = await downloadToTemp(masterFile.gcsPath);
                    csvContent = await fs.readFile(tempPath, 'utf-8');
                    await fs.unlink(tempPath).catch(() => {});
                } catch (e) {
                    console.warn('Failed to download master CSV from GCS:', e);
                }
            } else if (masterFile?.url) {
                const decUrl = decodeURIComponent(masterFile.url);
                const relPath = decUrl.replace(/^\/clients\//, '');
                const csvPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients', relPath);
                const fileExists = await fs.stat(csvPath).then(() => true).catch(() => false);
                if (fileExists) {
                    csvContent = await fs.readFile(csvPath, 'utf-8');
                }
            }
            if (csvContent) {
                const fastCsv = require('fast-csv');
                const rawRows: string[][] = [];
                await new Promise<void>((resolve, reject) => {
                    const Readable = require('stream').Readable;
                    const stream = new Readable();
                    stream.push(csvContent);
                    stream.push(null);
                    stream.pipe(fastCsv.parse({ headers: false, ignoreEmpty: true, trim: true }))
                        .on('data', (row: string[]) => rawRows.push(row))
                        .on('error', reject)
                        .on('end', resolve);
                });
                let dataStartIndex = 0;
                for (let i = 0; i < rawRows.length; i++) {
                    const row = rawRows[i];
                    if (row.some((c: string) => c.toLowerCase().includes('payroll number'))) { dataStartIndex = i + 1; break; }
                }
                const headers = rawRows[dataStartIndex - 1] || [];
                const csvEmployees = rawRows.slice(dataStartIndex).filter((row: string[]) => row.some((c: string) => c.trim())).map((row: string[]) => {
                    const record: Record<string, string | number> = {};
                    headers.forEach((h: string, idx: number) => {
                        const val = row[idx] || '';
                        const num = parseFloat(val);
                        record[h] = isNaN(num) || val.trim() === '' ? val : num;
                    });
                    return record;
                });
                return res.json({
                    hasData: true,
                    clientId,
                    clientName: (client as any).name,
                    preamble: {
                        companyName: (client as any).name || '',
                        companyPin: (client as any).pin || '',
                        companyNssf: '',
                        companyNssfPassword: '',
                        companyShaLogin: '',
                        companyShaPassword: '',
                    },
                    headers,
                    employees: csvEmployees,
                });
            }
            return res.json({ hasData: false, clientId, clientName: (client as any).name, employees: [] });
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

        const mapped = employeesSnapshot.docs.map((doc, i) => {
            const emp = doc.data() as any;
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
            const runsSnapshot = await adminDb
                .collection('payrollRuns')
                .where('ownerUid', '==', uid)
                .where('clientId', '==', clientId)
                .where('period', '==', period)
                .get();

            if (!runsSnapshot.empty) {
                const runIds = runsSnapshot.docs.map((d) => d.id);
                const entryMap = new Map<string, any>();
                // Firestore 'in' queries limited to 10 items; if more, query in chunks
                const chunkSize = 10;
                for (let i = 0; i < runIds.length; i += chunkSize) {
                    const chunk = runIds.slice(i, i + chunkSize);
                    const entriesSnapshot = await adminDb
                        .collection('payrollEntries')
                        .where('ownerUid', '==', uid)
                        .where('clientId', '==', clientId)
                        .where('payrollRunId', 'in', chunk)
                        .get();
                    for (const entryDoc of entriesSnapshot.docs) {
                        const e = entryDoc.data() as any;
                        entryMap.set(e.employeeId, e);
                    }
                }

                for (const m of mapped) {
                    const kraPin = String(m[headers[1]] || '');
                    const empDoc = employeesSnapshot.docs.find((d) => (d.data() as any).kraPin === kraPin);
                    if (empDoc && entryMap.has(empDoc.id)) {
                        const en = entryMap.get(empDoc.id)!;
                        m['OT Pay (read-only)'] = en.overtimePay || 0;
                        m['Absent Days (read-only)'] = en.absentDays || 0;
                        m['Late Days (read-only)'] = en.lateDays || 0;
                        m['Unpaid Leave Days (read-only)'] = en.unpaidLeaveDays || 0;
                        m['Bonus Pay (read-only)'] = en.bonusPay || (empDoc.data() as any).bonusPay || 0;
                    }
                }
            }
        }

        res.json({
            hasData: true,
            clientId,
            clientName: (client as any).name,
            preamble: {
                companyName: (client as any).name || '',
                companyPin: (client as any).pin || '',
                companyNssf: (client as any).nssfLogin || '',
                companyNssfPassword: '',
                companyShaLogin: (client as any).shaLogin || '',
                companyShaPassword: '',
            },
            headers,
            employees: mapped,
        });
    } catch (err) {
        console.error('[PayrollData] Error fetching payroll data from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/clients/:id/sync-master-csv — regenerate standardized master CSV from employees
router.post('/:id/sync-master-csv', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.id;

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        if (!clientDoc.exists || clientDoc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }
        const client = clientDoc.data() as any;

        // Fetch employees for this client
        const employeesSnapshot = await adminDb
            .collection('employees')
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .get();

        // If no employees in Firestore but a GCS master CSV exists, return its signed URL
        if (employeesSnapshot.empty) {
            if (client.masterFile?.gcsPath) {
                const url = await getSignedDownloadUrl(client.masterFile.gcsPath, 60);
                return res.json({ fileUrl: url, imported: 0, source: 'existing-gcs' });
            }
            return res.status(400).json({ message: 'No employees found and no master CSV uploaded.' });
        }

        // Build standardized CSV from Firestore employees
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

        const csvLines: string[] = [];
        csvLines.push(['COMPANY NAME:', client.name || ''].join(','));
        csvLines.push(['COMPANY KRA PIN:', client.pin || ''].join(','));
        csvLines.push(['COMPANY NSSF NO:', ''].join(','));
        csvLines.push(['COMPANY NSSF PASSWORD:', ''].join(','));
        csvLines.push(['COMPANY SHA LOGIN:', client.shaLogin || ''].join(','));
        csvLines.push(['COMPANY SHA PASSWORD:', ''].join(','));
        csvLines.push('');
        csvLines.push(headers.join(','));

        employeesSnapshot.docs.forEach((doc, i) => {
            const emp = doc.data() as any;
            const totalCashPay = emp.basicPay || 0;
            const grossSalary = totalCashPay + (emp.carBenefit || 0) + (emp.mealsBenefit || 0) + (emp.nonCashBenefits || 0) + (emp.housingBenefit || 0) + (emp.otherBenefits || 0);
            const sha = Math.round(grossSalary * 0.0275 * 100) / 100;
            const nssf = Math.round((Math.min(grossSalary, 9000) * 0.06 + Math.max(0, Math.min(grossSalary - 9000, 99000)) * 0.06) * 100) / 100;
            const ahl = Math.round(grossSalary * 0.015 * 100) / 100;
            const taxablePay = Math.round(Math.max(0, grossSalary - sha - nssf - ahl) * 100) / 100;
            const paye = Math.round(Math.max(0,
                Math.max(0, taxablePay * 0.1) + Math.max(0, (taxablePay - 24000) * 0.15) + Math.max(0, (taxablePay - 32333) * 0.05) + Math.max(0, (taxablePay - 500000) * 0.025) + Math.max(0, (taxablePay - 800000) * 0.025) - 2400
            ) * 100) / 100;

            const row = [
                emp.payrollNumber || String(i + 1),
                emp.kraPin || '',
                emp.idNumber || '',
                emp.identityType || 'National ID',
                emp.employeeName || '',
                emp.shaNo || '',
                emp.nssfNo || '',
                emp.residentialStatus || 'Resident',
                emp.typeOfEmployee || 'Primary Employee',
                emp.pwd || 'No',
                emp.exemptionCert || '',
                totalCashPay,
                emp.carBenefit || 0,
                emp.mealsBenefit || 0,
                emp.nonCashBenefits || 0,
                emp.typeOfHousing || 'Benefit not given',
                emp.housingBenefit || 0,
                emp.otherBenefits || 0,
                grossSalary,
                sha,
                nssf,
                emp.otherPension || 0,
                emp.postRetMedical || 0,
                emp.mortgageInterest || 0,
                ahl,
                taxablePay,
                2400,
                emp.insuranceRelief || 0,
                paye,
                paye,
            ];
            csvLines.push(row.join(','));
        });

        const csvContent = csvLines.join('\n');
        const safeName = String(client.name || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
        const destName = `users/${uid}/clients/${clientId}/master-csv/${safeName}_Standardized.csv`;

        await uploadBuffer(Buffer.from(csvContent, 'utf-8'), destName, {
            contentType: 'text/csv',
            metadata: { generatedAt: new Date().toISOString() },
        });

        const fileUrl = await getSignedDownloadUrl(destName, 60);

        // Update client doc with new master file reference
        await adminDb.collection('clients').doc(clientId).update({
            masterFile: { gcsPath: destName },
            masterFileLabel: `${safeName}_Standardized.csv`,
            masterFileUrl: fileUrl,
            updatedAt: Timestamp.now(),
        });

        res.json({ fileUrl, imported: employeesSnapshot.size, source: 'generated' });
    } catch (err) {
        console.error('[SyncMasterCsv] Error:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/clients/:id/payroll-data
router.put('/:id/payroll-data', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.id;
        const { employees } = req.body;

        const clientDoc = await adminDb.collection('clients').doc(clientId).get();
        if (!clientDoc.exists || clientDoc.data()?.ownerUid !== uid) {
            return res.status(404).json({ message: 'Client not found' });
        }
        const client = clientDoc.data()!;

        let csvContent = '';
        let relPath: string;
        const masterFile = client.masterFile;
        if (masterFile?.gcsPath) {
            try {
                const { downloadToTemp } = await import('../lib/cloudStorage');
                const tempPath = await downloadToTemp(masterFile.gcsPath);
                csvContent = await fs.readFile(tempPath, 'utf-8');
                await fs.unlink(tempPath).catch(() => {});
            } catch (e) {
                console.warn('Failed to download master CSV from GCS:', e);
            }
        } else if (masterFile?.url) {
            const decUrl = decodeURIComponent(masterFile.url);
            relPath = decUrl.replace(/^\/clients\//, '');
            const csvPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients', relPath);
            const fileExists = fsStandard.existsSync(csvPath);
            if (fileExists) {
                csvContent = await fs.readFile(csvPath, 'utf-8');
            }
        }

        const rawRows: string[][] = [];
        if (csvContent) {
            const fastCsv = require('fast-csv');
            await new Promise<void>((resolve, reject) => {
                const Readable = require('stream').Readable;
                const stream = new Readable();
                stream.push(csvContent);
                stream.push(null);
                stream.pipe(fastCsv.parse({ headers: false, ignoreEmpty: true, trim: true }))
                    .on('data', (row: string[]) => rawRows.push(row))
                    .on('error', reject)
                    .on('end', resolve);
            });
        }

        const headerRowIndex = rawRows.findIndex((row: string[]) =>
            row.some((c: string) => c.toLowerCase().includes('payroll number'))
        );

        const headers = rawRows[headerRowIndex] || [];

        const standardHeaders = [
            'Payroll Number', 'PIN of Employee', 'ID Number', 'Identity Type', 'Name of Employee',
            'SHA No', 'NSSF No', 'Residential Status', 'Type of Employee', 'Persons with Disability(PWD)',
            'Exemption Certificate', 'Total Cash Pay (A)', 'Value of Car Benefit (B)', 'Value of Meals (C)',
            'Non Cash Benefits (D)', 'Type of Housing', 'Housing Benefit (F)', 'Other Benefits (G)',
            'Total Gross Pay (Ksh) (H)', 'Social Health Insurance Fund (I)', 'NSSF Contribution (J)',
            'Other Pension Contribution (K)', 'Post Retirement Medical Fund (L)', 'Mortgage Interest (M)',
            'Affordable Housing Levy (N)', 'Taxable Pay(Ksh) (O)', 'Monthly Personal Relief (Ksh) (P)',
            'Amount of Insurance Relief (Q)', 'PAYE Tax (Ksh) (R)', 'Self Assessed PAYE Tax (Ksh) (S)',
        ];

        const preambleRows = rawRows.slice(0, headerRowIndex)
            .filter((row: string[]) => row.length > 0 && row[0]);
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

        const csvLines: string[] = [];
        preambleRows.forEach((row: string[]) => csvLines.push(row.join(',')));
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
            totalNita += calc.paye * 0.0175;
            totalHousingLevy += calc.ahl;

            csvLines.push(row.join(','));
        });

        const csvBuffer = Buffer.from('\ufeff' + csvLines.join('\n'), 'utf-8');
        const safeName = String(client.name || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
        const destName = `${safeName}_Standardized.csv`;
        const gcsPath = masterCsvPath(uid, clientId, destName);
        const { uploadBuffer } = await import('../lib/cloudStorage');
        await uploadBuffer(csvBuffer, gcsPath, { contentType: 'text/csv' });

        await adminDb.collection('clients').doc(clientId).update({
            masterFile: {
                gcsPath,
                uploadedAt: Timestamp.now(),
                label: destName,
            },
            'amounts.payeAmount': Math.round(totalPaye * 100) / 100,
            'amounts.nitaAmount': Math.round(totalNita * 100) / 100,
            'amounts.housingLevyAmount': Math.round(totalHousingLevy * 100) / 100,
            'amounts.nssfAmount': Math.round(totalNssf * 100) / 100,
            'amounts.shaAmount': Math.round(totalSha * 100) / 100,
            updatedAt: Timestamp.now(),
        });

        res.json({ success: true, message: 'Payroll data saved and recalculated.' });
    } catch (err) {
        console.error('Error saving payroll data to Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
