const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const s = code.indexOf('<thead className="border-b border-slate-800 bg-slate-900 rounded-t-2xl text-xs uppercase text-slate-400">');
if (s !== -1) {
    const sub = code.substring(s, s + 3500);
    console.log(code.substring(s, s + 3500));
} else {
    console.log('Not found');
}