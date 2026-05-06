const fs = require('fs');
const path = require('path');
let c = fs.readFileSync('backend/src/api/tax.routes.ts', 'utf8');
c = c.replace(
  "import { fileNssfReturn } from '../scripts/file-nssf-return';", 
  "import { fileNssfReturn } from '../scripts/file-nssf-return';\nimport { packageToTZip } from '../scripts/kra-tot-generator';\nimport { ensureDir } from '../utils/fs';\nimport { TMP_DIR } from '../config';"
);

const zipRoute = \

router.post('/generate-tot-zip', async (req: Request, res: Response): Promise<void> => {
    try {
        const { kraPin, year, month, turnover, returnType } = req.body;
        
        if (!kraPin || !year || !month || turnover === undefined) {
             res.status(400).json({ success: false, error: 'Missing req fields: kraPin, year, month, turnover' });
             return;
        }

        await ensureDir(path.join(TMP_DIR, 'generated-zips'));
        const outputDir = path.join(TMP_DIR, 'generated-zips');
        
        const zipFile = await packageToTZip({
            taxPayerPin: kraPin.toUpperCase(),
            returnPeriod: { year: parseInt(year), month: parseInt(month) },
            turnover: parseFloat(turnover),
            returnType: returnType || 'Original'
        }, outputDir);
        
        const friendlyName = \\\\$\\\{kraPin.toUpperCase()\\}_TOT_\\$\{year\\}_\\$\{month\}.zip\\\;
        res.download(zipFile, friendlyName);
    } catch (err) {
        console.error('Error generating TOT zip:', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to generate zip' });
    }
});

export default router;
\;

c = c.replace(/export default router;[\s]*$/, zipRoute);
fs.writeFileSync('backend/src/api/tax.routes.ts', c);
