const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

// 1. Let's fix LATEST FILES column to wrap items so it doesn't push the table rightward.
const tableStart = code.indexOf('<table className="hidden lg:table w-full text-left text-sm text-slate-300">');
if (tableStart !== -1) {
    const tdFind = code.indexOf('client.payeZipUrl &&', tableStart);
    if (tdFind !== -1) {
        const tdBeg = code.lastIndexOf('<td', tdFind);
        const tdEnd = code.indexOf('>', tdBeg) + 1;
        const currentTd = code.substring(tdBeg, tdEnd);
        
        // It's probably `<td className="px-2 py-3 sm:px-3 sm:py-4">`
        // Change it to `<td className="px-2 py-3 sm:px-3 sm:py-4"> <div className="flex flex-wrap gap-1">`
        if (currentTd.includes('<td')) {
            const nextTag = code.substring(tdEnd, tdEnd + 10);
            if (!code.substring(tdBeg, tdFind).includes('flex-wrap')) {
                code = code.substring(0, tdEnd) + '\n                                            <div className="flex flex-wrap gap-1">' + code.substring(tdEnd);
                const tdClose = code.indexOf('</td>', tdFind);
                code = code.substring(0, tdClose) + '</div>\n                                        ' + code.substring(tdClose);
                console.log('Wrapped LATEST FILES in a flex-wrap container on desktop!');
            }
        }
    }
}

// 2. Also apply for mobile cards latest files, just in case.
const mobileTableCards = code.indexOf('<div className="lg:hidden mx-auto max-w-full space-y-4">');
if (mobileTableCards !== -1) {
    const tdMobileFind = code.indexOf('client.payeZipUrl &&', mobileTableCards);
    if (tdMobileFind !== -1 && tdMobileFind < tableStart) {
        const divWrapperMobile = code.lastIndexOf('<div className="flex items-center gap-2">', tdMobileFind);
        if (divWrapperMobile !== -1) {
            code = code.substring(0, divWrapperMobile) + '<div className="flex flex-wrap gap-2">' + code.substring(divWrapperMobile + '<div className="flex items-center gap-2">'.length);
            console.log('Wrapped LATEST FILES in a flex-wrap container on mobile!');
        }
    }
}

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
