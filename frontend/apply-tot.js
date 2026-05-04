const fs = require('fs');
let code = fs.readFileSync('src/components/PracticeDashboard.tsx', 'utf-8');

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
    console.log('Replaced via Regex successfully!');
} else {
    console.log('Not found via RegExp either.');
}

fs.writeFileSync('src/components/PracticeDashboard.tsx', code);
