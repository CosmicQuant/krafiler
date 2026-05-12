const fs = require('fs');
const content = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');
const lines = content.split('\n');
let inDesk20 = false;
let output = [];
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Monthly Returns Pipeline')) {
        inDesk20 = true;
    }
    if (inDesk20 && lines[i].includes('Desk Elevy')) {
        break;
    }
    if (inDesk20) {
        output.push(i + ': ' + lines[i]);
    }
}
fs.writeFileSync('desk20.txt', output.join('\n'));
