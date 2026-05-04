const fs = require('fs');
let code = fs.readFileSync('backend/src/workers/kraFilingWorker.ts', 'utf-8');
code = code.replace(/totTurnover && totTurnover > 0/g, 'payload.totTurnover && payload.totTurnover > 0');
fs.writeFileSync('backend/src/workers/kraFilingWorker.ts', code);
console.log('Fixed totTurnover!');
