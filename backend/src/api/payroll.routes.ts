import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import archiver from 'archiver';
import * as ExcelJS from 'exceljs';
import { generateComplianceFiles } from '../scripts/axon-extraction-engine';
import { processAndStandardizePayroll } from '../scripts/ai-mapper';
import { openDb } from '../db/database';
import { computePayrollEntry } from '../services/payrollEngine';

const router = Router();

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `payroll_${Date.now()}.csv`)
});

const upload = multer({ storage });

function getClientWorkspaceDir(clientName?: string) {
    const safeClientName = (clientName ?? 'Generated Client')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .trim() || 'Generated Client';

    return path.join(__dirname, '../../../frontend/public/clients', safeClientName);
}

function copyToWorkspace(sourcePath: string | undefined | null, workspaceDir: string): { url: string, label: string } | null {
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;
    const filename = path.basename(sourcePath);
    const destPath = path.join(workspaceDir, filename);
    fs.copyFileSync(sourcePath, destPath);
    
    // Extract client name for the URL
    const clientName = path.basename(workspaceDir);
    return {
        url: `/clients/${encodeURIComponent(clientName)}/${filename}`,
        label: filename
    };
}

router.post('/generate-unified', upload.single('payrollFile'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No CSV file uploaded.' });
        }

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        const currentDay = now.getDate();
        let defaultMonth = currentMonth;
        let defaultYear = currentYear;
        if (currentDay <= 9) {
            defaultMonth = currentMonth - 1;
            if (defaultMonth === 0) { defaultMonth = 12; defaultYear = currentYear - 1; }
        }
        const defaultPeriod = `${String(defaultMonth).padStart(2, '0')}${defaultYear}`;

        const periodMMYYYY = req.body.periodMMYYYY || defaultPeriod;

        const config = {
            employerPin: 'P000000000A',
            nssfEmployerNo: 'N00000000',
            employerName: 'TEST COMPANY LTD',
            periodMMYYYY,
        };

        const options = {
            generatePaye: req.body.generatePaye !== 'false',
            generateNssf: req.body.generateNssf !== 'false',
            generateSha: req.body.generateSha !== 'false'
        };

        let inputCsvPath = req.file.path;

        const buffer = fs.readFileSync(inputCsvPath);
        if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.readFile(inputCsvPath);
            const csvPath = `${inputCsvPath}.converted.csv`;
            await wb.csv.writeFile(csvPath);
            inputCsvPath = csvPath;
        }

        // Try to standardize the payroll file via AI mapper before processing
        const clientName = typeof req.body.clientName === 'string' ? req.body.clientName : undefined;
        const clientWorkspaceDir = getClientWorkspaceDir(clientName);
        await fs.promises.mkdir(clientWorkspaceDir, { recursive: true });

        const dummyClient = {
            name: clientName || 'Demo Client',
            pin: '',
            nssfNo: '',
            nssfPassword: '',
            shaNo: '',
            shaPassword: ''
        };

        try {
            const stdResult = await processAndStandardizePayroll(inputCsvPath, dummyClient, clientWorkspaceDir, req.file.originalname || 'payroll.csv');
            if (stdResult.success) {
                inputCsvPath = stdResult.mappedFile;
            }
        } catch (stdErr: any) {
            console.warn('[Payroll] AI standardization failed, using raw file:', stdErr.message);
        }

        const outputPaths = await generateComplianceFiles(inputCsvPath, config, options);
        fs.mkdirSync(clientWorkspaceDir, { recursive: true });

        // Copy files directly to workspace
        const payeInfo = copyToWorkspace(outputPaths.payeZipPath, clientWorkspaceDir);
        const nssfInfo = copyToWorkspace(outputPaths.nssfFilePath, clientWorkspaceDir);
        const shaInfo  = copyToWorkspace(outputPaths.shaFilePath, clientWorkspaceDir);

        // Bundle everything into a single master ZIP to return back
        const masterZipName = `${clientName || outputPaths.companyConfig?.employerName?.replace(/\s+/g, '_') || 'Payroll'}_Generated_Files.zip`;
        const masterZipPath = path.join(clientWorkspaceDir, masterZipName);
        let masterZipUrl: string | null = null;

        try {
            await new Promise<void>((resolve, reject) => {
                const output = fs.createWriteStream(masterZipPath);
                const archive = archiver('zip', { zlib: { level: 9 } });

                output.on('close', () => resolve());
                archive.on('error', (err: any) => reject(err));

                archive.pipe(output);

                if (payeInfo && fs.existsSync(path.join(clientWorkspaceDir, payeInfo.label))) {
                    archive.file(path.join(clientWorkspaceDir, payeInfo.label), { name: payeInfo.label });
                }
                if (nssfInfo && fs.existsSync(path.join(clientWorkspaceDir, nssfInfo.label))) {
                    archive.file(path.join(clientWorkspaceDir, nssfInfo.label), { name: nssfInfo.label });
                }
                if (shaInfo && fs.existsSync(path.join(clientWorkspaceDir, shaInfo.label))) {
                    archive.file(path.join(clientWorkspaceDir, shaInfo.label), { name: shaInfo.label });
                }

                archive.finalize();
            });
            
            const urlClientName = path.basename(clientWorkspaceDir);
            masterZipUrl = `/clients/${encodeURIComponent(urlClientName)}/${masterZipName}`;
        } catch (zipErr) {
            console.error('Error creating master ZIP:', zipErr);
        }

        // Clean up temporary generated files
        try {
            if (fs.existsSync(inputCsvPath)) fs.unlinkSync(inputCsvPath);
            if (outputPaths.shaFilePath && fs.existsSync(outputPaths.shaFilePath)) fs.unlinkSync(outputPaths.shaFilePath);
            if (outputPaths.nssfFilePath && fs.existsSync(outputPaths.nssfFilePath)) fs.unlinkSync(outputPaths.nssfFilePath);
            if (outputPaths.payeZipPath && fs.existsSync(outputPaths.payeZipPath)) fs.unlinkSync(outputPaths.payeZipPath);
        } catch (cleanupError) {
            console.warn('Cleanup warning after payroll generation:', cleanupError);
        }
        
        let clientId = req.body.clientId;
        const db = await openDb();

        if (clientId) {
            await db.run(`
                UPDATE clients 
                SET payeZipUrl = COALESCE(?, payeZipUrl),
                    payeZipLabel = COALESCE(?, payeZipLabel),
                    nssfFileUrl = COALESCE(?, nssfFileUrl),
                    nssfFileLabel = COALESCE(?, nssfFileLabel),
                    shaFileUrl = COALESCE(?, shaFileUrl),
                    shaFileLabel = COALESCE(?, shaFileLabel),
                    payeAmount = COALESCE(?, payeAmount),
                    nitaAmount = COALESCE(?, nitaAmount),
                    housingLevyAmount = COALESCE(?, housingLevyAmount),
                    nssfAmount = COALESCE(?, nssfAmount),
                    shaAmount = COALESCE(?, shaAmount)
                WHERE id = ?
            `, [
                payeInfo?.url || null, payeInfo?.label || null,
                nssfInfo?.url || null, nssfInfo?.label || null,
                shaInfo?.url || null,  shaInfo?.label || null,
                outputPaths.summaryAmounts?.payeAmount || null,
                outputPaths.summaryAmounts?.nitaAmount || null,
                outputPaths.summaryAmounts?.housingLevyAmount || null,
                outputPaths.summaryAmounts?.nssfAmount || null,
                outputPaths.summaryAmounts?.shaAmount || null,
                clientId
            ]);
        }

        const updatedClient = clientId ? await db.get(`SELECT * FROM clients WHERE id = ?`, [clientId]) : null;

        return res.json({
            success: true,
            paye: payeInfo,
            nssf: nssfInfo,
            sha: shaInfo,
            masterZipUrl,
            client: updatedClient
        });

    } catch (error: any) {
        console.error('Error generating payroll files:', error, error.stack);
        res.status(500).json({ error: error.message || 'Failed to generate unified payroll files.' });
    }
});

// POST /api/payroll/calculate-preview — Preview payroll calculations for a single row
// Accepts all raw input fields from the master grid and returns computed statutory values.
router.post('/calculate-preview', async (req: Request, res: Response) => {
    try {
        const {
            basicPay = 0,
            carBenefit = 0,
            meals = 0,
            nonCash = 0,
            housingBenefit = 0,
            otherBenefits = 0,
            overtimePay = 0,
            absentDays = 0,
            lateHours = 0,
            bonusPay = 0,
            loanDeduction = 0,
            unpaidLeaveDays = 0,
            otherPension = 0,
            postRetMedical = 0,
            mortgage = 0,
            insuranceRelief = 0,
            pwd = false,
            standardCheckIn = '08:00',
            standardCheckOut = '17:00',
            payStructure = 'fixed',
            period = '2026-01',
        } = req.body;

        const preview = computePayrollEntry(
            {
                employeeId: 0,
                employeeName: 'Preview',
                kraPin: '',
                payrollNumber: '',
                basicPay,
                // Individual benefits (new — passed separately, not combined)
                carBenefit,
                mealsBenefit: meals,
                nonCashBenefits: nonCash,
                housingBenefit,
                otherBenefits,
                dateJoined: '',
                dateLeft: null,
                employmentStatus: 'Active',
                loanDeduction,
                unpaidLeaveDays,
                payStructure: payStructure as 'fixed' | 'prorated',
                overtimePay,
                attendanceAbsentDays: absentDays,
                attendanceLateDays: lateHours,
                pwd: pwd ? 'Yes' : 'No',
                otherPension,
                postRetMedical,
                mortgageInterest: mortgage,
                insuranceRelief,
                bonusPay,
                standardCheckIn,
                standardCheckOut,
            },
            period,
            false, // no prorating for preview
        );

        res.json(preview);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Preview calculation failed.' });
    }
});

export default router;
