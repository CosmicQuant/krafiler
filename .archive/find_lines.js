const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');
const lines = code.split('\n');
lines.forEach((l, i) => {
    if(l.includes('client.masterFileUrl ?')) {
        console.log('Line ' + (i+1));
        console.log(lines.slice(i, i+15).join('\n'));
        console.log('---');
    }
});