const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const s = code.indexOf('<tbody className="divide-y divide-slate-800/50">');
if (s !== -1) {
    console.log(code.substring(s, s + 3500));
} else {
    console.log('Not found');
}