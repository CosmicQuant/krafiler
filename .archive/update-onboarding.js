const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const saveClientIdx = code.indexOf('const handleSaveClient');
const endSaveClientIdx = code.indexOf('const computeTaxSummary', saveClientIdx);
console.log(code.substring(saveClientIdx, endSaveClientIdx));

