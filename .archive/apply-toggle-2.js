const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const targetFunction = `const renderMatrixGrid = () => {
        // Flatten clients into specific obligations for the VAT & Monthly Returns
        const obligations: { client: any; type: string; status: TaxStatus }[] = [];
        clients.forEach(c => {
            if (c.vat !== 'na') obligations.push({ client: c, type: 'VAT', status: c.vat });
            if (c.tot !== 'na') obligations.push({ client: c, type: 'TOT', status: c.tot });
            if (c.dst !== 'na') obligations.push({ client: c, type: 'DST', status: c.dst });
            if (c.mri !== 'na') obligations.push({ client: c, type: 'MRI', status: c.mri });
        });`;

const replaceWith = `const renderMatrixGrid = () => {
        // Flatten clients into specific obligations for the VAT & Monthly Returns
        let obligations: { client: any; type: string; status: TaxStatus }[] = [];
        clients.forEach(c => {
            if (c.vat !== 'na') obligations.push({ client: c, type: 'VAT', status: c.vat });
            if (c.tot !== 'na') obligations.push({ client: c, type: 'TOT', status: c.tot });
            if (c.dst !== 'na') obligations.push({ client: c, type: 'DST', status: c.dst });
            if (c.mri !== 'na') obligations.push({ client: c, type: 'MRI', status: c.mri });
        });

        // Filter obligations based on toggle
        if (monthlyReturnFilter !== 'ALL') {
            obligations = obligations.filter(ob => ob.type === monthlyReturnFilter);
        }

        const statsCount = {
            ALL: obligations.length,
            VAT: obligations.filter(ob => ob.type === 'VAT').length,
            TOT: obligations.filter(ob => ob.type === 'TOT').length,
            MRI: obligations.filter(ob => ob.type === 'MRI').length,
            DST: obligations.filter(ob => ob.type === 'DST').length,
        };`;

code = code.replace(targetFunction, replaceWith);

const renderTarget = `return (
            <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">`;

const renderReplace = `return (
            <div className="mt-8">
                {/* 1. The Toggle UI */}
                <div className="mb-6 flex flex-wrap gap-3 items-center">
                    {['VAT', 'TOT', 'MRI', 'DST', 'ALL'].map(t => (
                        <button
                            key={t}
                            onClick={() => setMonthlyReturnFilter(t as any)}
                            className={\`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition \${
                                monthlyReturnFilter === t
                                    ? 'bg-blue-500 text-white shadow-md shadow-blue-500/20'
                                    : 'border border-slate-700 bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                            }\`}
                        >
                            {t === 'ALL' ? 'All Returns' : \`\${t} Returns\`}
                        </button>
                    ))}
                </div>

            {/* 2. The Matrix Table Wrapper */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">`;

code = code.replace(renderTarget, renderReplace);

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('Matrix grid replaced with toggle');
