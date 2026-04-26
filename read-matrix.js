const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const s = code.indexOf('const renderMatrixGrid = (client: Client, obligations: string[]) => {');
if (s !== -1) {
    const e = code.indexOf('};', s);
    console.log(code.substring(s, e + 1500));
}
