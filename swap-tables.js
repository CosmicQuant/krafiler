const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');
let restoredTbody = fs.readFileSync('restored-tbody.js', 'utf8');

const render9thDeskStart = code.indexOf('const render9thDeskGrid = () => {');
const firstTbodyStart = code.indexOf('<tbody className="divide-y divide-slate-800/50">', render9thDeskStart);
const firstTbodyEnd = code.indexOf('</tbody>', firstTbodyStart) + 8;

const shinyEtimsTbody = code.substring(firstTbodyStart, firstTbodyEnd);

// Restoring the original Payroll table back into render9thDeskGrid
code = code.substring(0, firstTbodyStart) + 
       `<tbody className="divide-y divide-slate-800/50">\n` + restoredTbody + 
       code.substring(firstTbodyEnd);

// Now finding renderMatrixGrid
const renderMatrixStart = code.indexOf('const renderMatrixGrid = () => {');
const secondTbodyStart = code.indexOf('<tbody className="divide-y divide-slate-800/50">', renderMatrixStart);
const secondTbodyEnd = code.indexOf('</tbody>', secondTbodyStart) + 8;

// Replacing the old Matrix Grid with the Shiny eTIMS Matrix grid
code = code.substring(0, secondTbodyStart) +
       shinyEtimsTbody +
       code.substring(secondTbodyEnd);

// Next: Fix user requests:
// 1. Rename "Payroll Desk" to "Payroll Only" or "Payroll Processing"
code = code.replace(/<span className="flex items-center gap-3"><Users className="h-4 w-4" \/> Payroll Desk<\/span>/g, '<span className="flex items-center gap-3"><Users className="h-4 w-4" /> Payroll Processing</span>');
code = code.replace(/>Payroll Desk</g, '>Payroll Processing<');

// 2. Remove "Verify KRA API" card in Monthly Returns desk
// Let's find "Verify KRA API"
const cardStart = code.indexOf('<div className="flex items-center justify-between">\\n                                <h3 className="text-sm font-semibold text-slate-400">Status Check</h3>');
// wait, let's just make it easier by Regex or substring
const cardStartRegex = /<div className="rounded-2xl border border-slate-800 bg-slate-900\/50 p-6">[\s\S]*?Verify KRA API[\s\S]*?<\/div>/;

if (code.match(cardStartRegex)) {
    code = code.replace(cardStartRegex, '');
    console.log('Removed Verify KRA API card');
}

// 3. Fix the right overflow on the LATEST FILES column in the newly restored payroll table.
// If I search the restoredTbody for `<td className="whitespace-normal min-w-0 px-2 py-3 sm:px-[0-9] sm:py-[0-9]">`
// I need to add `overflow-x-auto` to the container

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('Swapped tables back correctly!');
