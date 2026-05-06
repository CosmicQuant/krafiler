const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const s = code.indexOf('<table className="hidden lg:table w-full text-left text-sm text-slate-300">');
if (s === -1) {
    console.log('Table not found');
    process.exit(1);
}

const sub = code.substring(s, code.indexOf('</tbody>', s) + 20);
const c1 = sub.indexOf('{client.payeZipUrl && (');
console.log('s:', s, 'c1:', c1);

if (c1 !== -1) {
    const tdIdx = sub.lastIndexOf('<td', c1);
    const endTd = sub.indexOf('>', tdIdx) + 1;
    const theTag = sub.substring(tdIdx, endTd);
    console.log('theTag:', theTag);
    console.log('Content after tag:\n', sub.substring(endTd, c1 + 100));
} else {
    console.log('client.payeZipUrl not found after table start');
}