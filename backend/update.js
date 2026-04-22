const fs = require('fs');
const content = fs.readFileSync('backend/src/scripts/axon-extraction-engine.ts', 'utf8');
const newContent = content.replace(/import \* as fastCsv/g, 'import * as ExcelJS from \'exceljs\';\nimport * as fastCsv');
fs.writeFileSync('backend/src/scripts/axon-extraction-engine.ts', newContent);
console.log('Added ExcelJS import');

