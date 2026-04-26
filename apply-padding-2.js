const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const s = code.indexOf('<table className="hidden lg:table w-full text-left text-sm text-slate-300">');
if (s !== -1) {
    const tableContainerEnd = code.indexOf('</table>', s) + 8;
    const tableCode = code.substring(s, tableContainerEnd);

    // Let's wrap the desktop table in overflow-x-auto padding
    if (!code.substring(s - 50, s).includes('overflow-x-auto')) {
        code = code.replace(tableCode, `<div className="overflow-x-auto">\n` + tableCode + `\n                </div>`);
        console.log('Wrapped table in overflow-x-auto');
    }
}

// And Action column widths for LATEST FILES and ACTION
const actionColRegex = /<th className="px-2 py-3 sm:px-4 sm:py-4 font-semibold text-right uppercase tracking-wider">Action<\/th>/;
const newActionColRegex = '<th className="px-2 py-3 sm:px-4 sm:py-4 font-semibold text-right uppercase tracking-wider w-32 min-w-[120px]">Action</th>';
code = code.replace(actionColRegex, newActionColRegex);

// Make the text size for data columns smaller to save real-estate.
const smPx3 = /sm:px-3 sm:py-4/g;
code = code.replace(smPx3, "sm:px-2 sm:py-2");  

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('Completed table UI compression.');