const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/api/tax.routes.ts');
let content = fs.readFileSync(file, 'utf8');

// Replace the old route block
const oldRouteRegex = /\/\/ ─── POST \/api\/tax\/file-nssf-return ─────────────────────────────[\s\S]*?(?=\nexport default router;)/m;

const newRoute = `// ─── POST /api/tax/file-nssf-return ─────────────────────────────
router.post('/file-nssf-return', async (req: Request, res: Response): Promise<void> => {
    try {
        const { nssfFileUrl, masterFileUrl, period } = req.body;
        if (!nssfFileUrl || !masterFileUrl) {
            res.status(400).json({ success: false, message: 'Missing NSSF file URL or Master CSV URL.' });
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

        let nssfUsername = '';
        let nssfPassword = '';
        
        const csvParser = require('csv-parser');
        await new Promise((resolve, reject) => {
            let rowCount = 0;
            fs.createReadStream(localMasterPath)
                .pipe(csvParser({ headers: false, skipLines: 0 }))
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
            res.status(400).json({ success: false, message: 'Could not extract NSSF Username or Password from the Master CSV. Please ensure they are on rows 3 and 4.' });
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

if (oldRouteRegex.test(content)) {
    content = content.replace(oldRouteRegex, newRoute);
}

if (!content.includes("require('csv-parser')") && !content.includes("from 'csv-parser'")) {
    content = "import csvParser from 'csv-parser';\n" + content;
}

fs.writeFileSync(file, content);
console.log('Patched correctly');
