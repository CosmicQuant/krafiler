const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/api/tax.routes.ts');
let content = fs.readFileSync(file, 'utf8');

const importStatement = "import { fileNssfReturn } from '../scripts/file-nssf-return';\nimport csvParser from 'csv-parser';";

if (!content.includes('fileNssfReturn')) {
    content = content.replace("import fs from 'fs';", importStatement + "\nimport fs from 'fs';");
}

const newRoute = `
// ─── POST /api/tax/file-nssf-return ─────────────────────────────
router.post('/file-nssf-return', async (req: Request, res: Response): Promise<void> => {
    try {
        const { nssfFileUrl, masterFileUrl, period } = req.body;
        if (!nssfFileUrl || !masterFileUrl) {
            res.status(400).json({ success: false, message: 'Missing NSSF credentials/master CSV or NSSF file URL.' });
            return;
        }

        const relativeNssfPath = typeof nssfFileUrl === 'string' ? nssfFileUrl.replace(/^\\/clients/, 'clients') : '';
        const localNssfPath = path.join(__dirname, '../../../frontend/public', relativeNssfPath);
        
        if (!fs.existsSync(localNssfPath)) {
            res.status(404).json({ success: false, message: 'NSSF Excel file not found on disk: ' + localNssfPath });
            return;
        }

        const relativeMasterPath = typeof masterFileUrl === 'string' ? masterFileUrl.replace(/^\\/clients/, 'clients') : '';
        const localMasterPath = path.join(__dirname, '../../../frontend/public', relativeMasterPath);

        if (!fs.existsSync(localMasterPath)) {
            res.status(404).json({ success: false, message: 'Master CSV file not found on disk: ' + localMasterPath });
            return;
        }

        // Extract credentials from Master CSV (Rows 2 and 3 usually)
        let nssfUsername = '';
        let nssfPassword = '';
        
        await new Promise((resolve, reject) => {
            let rowCount = 0;
            fs.createReadStream(localMasterPath)
                .pipe((csvParser as any)({ headers: false, skipLines: 0 }))
                .on('data', (row: any) => {
                    const values = Object.values(row);
                    if (rowCount === 2) nssfUsername = values[1] ? String(values[1]).replace(/^\\uFEFF/, '').replace(/\\u0000/g, '').replace(/^'/, '').trim() : '';
                    if (rowCount === 3) nssfPassword = values[1] ? String(values[1]).replace(/^\\uFEFF/, '').replace(/\\u0000/g, '').replace(/^'/, '').trim() : '';
                    rowCount++;
                })
                .on('end', resolve)
                .on('error', reject);
        });

        if (!nssfUsername || !nssfPassword) {
            res.status(400).json({ success: false, message: 'Could not extract NSSF Username or Password from the Master CSV.' });
            return;
        }

        await fileNssfReturn(nssfUsername, nssfPassword, localNssfPath, period || '04/2026');

        res.json({ success: true, message: 'NSSF auto-filing script executed successfully.' });
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ success: false, message: e.message || 'Error occurred during NSSF filing.' });
    }
});

`;

if (!content.includes('/file-nssf-return')) {
    content = content.replace("export default router;", newRoute + "\nexport default router;");
    fs.writeFileSync(file, content);
    console.log('Patched tax.routes.ts for NSSF return');
}
