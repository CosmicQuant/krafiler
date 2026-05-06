const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/api/tax.routes.ts');
let content = fs.readFileSync(file, 'utf8');

const importStatement = "import { fileNssfReturn } from '../scripts/file-nssf-return';\nimport { AxonDataExtractionEngine } from '../scripts/axon-extraction-engine';";
content = content.replace("import fs from 'fs';", importStatement + "\nimport fs from 'fs';");

const newRoute = `
// ─── POST /api/tax/file-nssf-return ─────────────────────────────
router.post('/file-nssf-return', async (req: Request, res: Response): Promise<void> => {
    try {
        const { nssfUsername, nssfPassword, nssfFileUrl, period } = req.body;
        if (!nssfUsername || !nssfPassword || !nssfFileUrl) {
            res.status(400).json({ success: false, message: 'Missing NSSF credentials or file.' });
            return;
        }

        const relativePath = typeof nssfFileUrl === 'string' ? nssfFileUrl.replace(/^\\/clients/, 'clients') : '';
        const localPath = path.join(__dirname, '../../../frontend/public', relativePath);
        
        if (!fs.existsSync(localPath)) {
            res.status(404).json({ success: false, message: 'NSSF Excel file not found on disk: ' + localPath });
            return;
        }

        await fileNssfReturn(nssfUsername, nssfPassword, localPath, period || '04/2026');

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
    console.log("Patched tax.routes.ts");
}
