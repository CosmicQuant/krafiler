const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');
const search = '<table className="hidden lg:table w-full text-left text-sm text-slate-300">';
const tableStart = code.indexOf(search);
const coltd = code.indexOf('client.payeZipUrl && (', tableStart);
const tdBeg = code.lastIndexOf('<td', coltd);
const tdEnd = code.indexOf('</td>', coltd) + 5;
console.log(code.substring(tdBeg, Math.min(tdBeg + 1000, tdEnd)));