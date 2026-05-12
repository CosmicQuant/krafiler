const fs = require('fs');
let code = fs.readFileSync('src/components/PracticeDashboard.tsx', 'utf-8');

// 1. Add TOT input UI
const regexTot = /\{ob\.type === 'TOT' && \(\s*<div className="flex flex-col gap-2 rounded-xl bg-slate-900\/50 border border-slate-700\/50 p-4 shadow-sm group-hover:border-slate-600 transition">\s*<div className="flex justify-between items-center text-xs">\s*<span className="text-slate-400 font-medium">Total Sales <span className="font-normal text-\[10px\] ml-1 text-slate-500">\(eTIMS\)<\/span><\/span>\s*<span className="text-slate-200 font-bold border-b border-transparent">KES \{isEtimsConnected \? '450,000\.00' : '0\.00'\}<\/span>\s*<\/div>\s*<div className="border-t border-slate-700\/80 my-1 pt-2\.5 flex justify-between items-center text-xs">\s*<span className="font-bold text-blue-400">1\.5% Computed TOT<\/span>\s*<span className="font-black text-\[13px\] text-blue-400 drop-shadow-sm">KES \{isEtimsConnected \? '6,750\.00' : '0\.00'\}<\/span>\s*<\/div>\s*<\/div>\s*\)\}/;

const newTotUi = `{ob.type === 'TOT' && (
                                            <div className="flex flex-col gap-3 rounded-xl bg-blue-900/5 border border-blue-500/20 p-4 shadow-sm group-hover:border-blue-500/30 transition">
                                                <div>
                                                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Gross Sales / Turnover</label>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-xs font-medium text-slate-500">KES</span>
                                                        <input
                                                            type="number"
                                                            placeholder="Sales Amount"
                                                            value={totInputVals[ob.client.id] || ''}
                                                            onChange={e => setTotInputVals(prev => ({ ...prev, [ob.client.id]: e.target.value }))}
                                                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-blue-500 transition shadow-inner"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="border-t border-slate-700/80 pt-2 flex justify-between items-center text-xs">
                                                    <span className="font-bold text-blue-400">1.5% Computed TOT</span>
                                                    <span className="font-black text-[13px] text-blue-400 drop-shadow-sm">
                                                        KES {totInputVals[ob.client.id] && !isNaN(parseFloat(totInputVals[ob.client.id])) ? (parseFloat(totInputVals[ob.client.id]) * 0.015).toLocaleString(undefined, {minimumFractionDigits: 2}) : '0.00'}
                                                    </span>
                                                </div>
                                            </div>
                                        )}`;

if (regexTot.test(code)) {
    code = code.replace(regexTot, newTotUi);
}

// 2. Add PRN Download button
const oldActionButtonsSearch = `<td className="px-4 py-4 pt-5 align-top text-right">\n                                        <button \n                                            onClick={() => {\n                                                if (ob.type === 'MRI') handleFileMri(ob.client);\n                                                else if (ob.type === 'PAYE') handleAutoFile(ob.client);\n                                                else if (ob.type === 'NSSF') handleAutoFileNssf(ob.client);\n                                                // SHA, ETIMS, etc. can be queued if logic exists\n                                            }}\n                                            disabled={isPendingFilingJob(activeJobs[ob.client.id])}\n                                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition shadow-sm drop-shadow mt-1 disabled:opacity-50">\n                                            Process Return\n                                        </button>\n                                    </td>`;

const newActionButtonsObj = `<td className="px-4 py-4 pt-5 align-top text-right">
                                        <div className="flex flex-col gap-2 w-full max-w-[140px] ml-auto">
                                            <button 
                                                onClick={() => {
                                                    if (ob.type === 'MRI') handleFileMri(ob.client);
                                                    else if (ob.type === 'TOT') handleFileTot(ob.client);
                                                    else if (ob.type === 'VAT') handleAutoFile(ob.client);
                                                    else if (ob.type === 'PAYE') handleAutoFile(ob.client);
                                                    else if (ob.type === 'NSSF') handleAutoFileNssf(ob.client);
                                                }}
                                                disabled={isPendingFilingJob(activeJobs[ob.client.id])}
                                                className="flex w-full justify-center items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition shadow-sm drop-shadow disabled:opacity-50">
                                                Process Return
                                            </button>
                                            {isTerminalFilingJob(activeJobs[ob.client.id]) && activeJobs[ob.client.id].state === 'completed' && (
                                                <button className="flex w-full justify-center items-center gap-2 rounded-xl bg-blue-500/10 border border-blue-500/20 px-4 py-2 text-xs font-bold text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition shadow-sm disabled:opacity-50">
                                                    Download PRN
                                                </button>
                                            )}
                                        </div>
                                    </td>`;

// Using string replace instead, it's safer
code = code.replace(oldActionButtonsSearch, newActionButtonsObj);

// 3. desk-nil render
// Insert right BEFORE: {view === 'clients' && !selectedClient && (
const targetString = `{view === 'clients' && !selectedClient && (`

const nilDeskRender = `{!selectedClient && view === 'desk-nil' && (
                        <div className="mt-10">
                            <div className="mb-6 flex flex-col gap-2 border-b border-slate-800 pb-5">
                                <h2 className="text-xl font-bold text-white">Nil & ITR Filing Desk</h2>
                                <p className="text-sm text-slate-400">File Nil returns and Annual Income Tax Returns for your clients.</p>
                            </div>
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
                                <div className="overflow-x-auto pb-16">
                                    <table className="w-full text-left text-sm text-slate-300">
                                        <thead className="border-b border-slate-800 bg-slate-900 text-xs uppercase text-slate-400">
                                            <tr>
                                                <th className="px-6 py-4 font-semibold tracking-wider w-1/3">Client & PIN</th>
                                                <th className="px-6 py-4 font-semibold tracking-wider">Tax Obligation</th>
                                                <th className="px-6 py-4 font-semibold tracking-wider">Period (From - To)</th>
                                                <th className="px-6 py-4 font-semibold tracking-wider text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/50">
                                            {clients.map(client => {
                                                const sel = nilSelections[client.id] || { type: '', periodFrom: '2026-01-01', periodTo: '2026-12-31' };
                                                const job = activeJobs[client.id];
                                                const isProcessing = job && !isTerminalFilingJob(job);
                                                
                                                return (
                                                    <tr key={client.id} className="group transition hover:bg-slate-800/30">
                                                        <td className="px-6 py-4">
                                                            <div className="font-bold text-white">{client.name}</div>
                                                            <div className="text-xs text-slate-500 font-mono mt-0.5">{client.pin}</div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <select 
                                                                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                                                                value={sel.type}
                                                                onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, type: e.target.value } }))}
                                                            >
                                                                <option value="" disabled>Choose Obligation</option>
                                                                {TAX_OBLIGATION_OPTIONS.filter(o => o.filingMode === 'nil').map(o => (
                                                                    <option key={o.value} value={o.value}>{o.label}</option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex gap-2">
                                                                <input
                                                                    type="date"
                                                                    value={sel.periodFrom}
                                                                    onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, periodFrom: e.target.value } }))}
                                                                    className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-amber-500"
                                                                />
                                                                <span className="flex items-center text-slate-500">-</span>
                                                                <input
                                                                    type="date"
                                                                    value={sel.periodTo}
                                                                    onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, periodTo: e.target.value } }))}
                                                                    className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-amber-500"
                                                                />
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <button
                                                                onClick={() => handleFileNil(client)}
                                                                disabled={isProcessing}
                                                                className={\`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition \${isProcessing ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-amber-500 hover:bg-amber-400 text-amber-950 shadow-lg'}\`}
                                                            >
                                                                {isProcessing ? 'Processing' : 'File Nil'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    `;

code = code.replace(targetString, nilDeskRender + targetString);

fs.writeFileSync('src/components/PracticeDashboard.tsx', code);
console.log('Script built successfully!');
