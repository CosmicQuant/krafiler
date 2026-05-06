const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

// Ensure Cloud icon from lucide-react is imported
if (!code.includes('Cloud,')) {
    code = code.replace(/([\s\S]*?)import {([\s\S]*?)Upload,/m, `$1import {$2Cloud,\n    Upload,`);
}

// 1. In PracticeDashboard component, add state variables
const stateInsertionPoint = "const [mriInputVals, setMriInputVals] = useState<Record<string, string>>({});";
if (code.includes(stateInsertionPoint) && !code.includes('etimsConnections')) {
    code = code.replace(
        stateInsertionPoint,
        `${stateInsertionPoint}\n    const [etimsConnections, setEtimsConnections] = useState<Record<string, boolean>>({});\n    const [etimsModalClient, setEtimsModalClient] = useState<Client | null>(null);\n    const [etimsPassword, setEtimsPassword] = useState('');`
    );
}

// 2. Replace renderMatrixGrid thead and tbody
const theadRegex = /<thead className="border-b border-slate-800 bg-slate-900 rounded-t-2xl text-xs uppercase text-slate-400">[\s\S]*?<\/thead>/;
const newThead = `<thead className="border-b border-slate-800 bg-slate-900 rounded-t-2xl text-xs uppercase text-slate-400">
                            <tr>
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Client Info</th>
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Return Data / Source</th>
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Tax Calculation details</th>
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Status</th>
                                <th className="px-4 py-4 font-semibold text-right uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>`;
code = code.replace(theadRegex, newThead);

const tbodyRegex = /<tbody className="divide-y divide-slate-800\/50">[\s\S]*?<\/tbody>/;
const newTbody = `<tbody className="divide-y divide-slate-800/50">
                            {obligations.map((ob, idx) => {
                                const isEtimsConnected = etimsConnections[ob.client.id];
                                
                                return (
                                <tr key={\`\${ob.client.id}-\${ob.type}-\${idx}\`} className="transition hover:bg-slate-800/50 group">
                                    <td className="px-4 py-4">
                                        <div className="font-semibold text-white">{ob.client.name}</div>
                                        <div className="mt-1 flex items-center gap-2">
                                            <span className="text-xs text-slate-500">PIN: {ob.client.pin}</span>
                                            <span className="inline-flex rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
                                                {ob.type}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 align-top pt-5">
                                        {(ob.type === 'VAT' || ob.type === 'TOT') && (
                                            <div>
                                                {isEtimsConnected ? (
                                                    <div className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-4 py-2 mt-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                                                        <CheckCircle2 className="h-4 w-4" /> eTIMS Connected
                                                    </div>
                                                ) : (
                                                    <button 
                                                        onClick={() => setEtimsModalClient(ob.client)}
                                                        className="inline-flex items-center gap-2 rounded-xl bg-blue-500/10 px-4 py-2.5 mt-1 text-xs font-bold text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition shadow-sm border border-blue-500/20"
                                                    >
                                                        <Cloud className="h-4 w-4" /> Connect eTIMS Data
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                        {ob.type === 'DST' && (
                                            <button className="text-xs flex items-center justify-center gap-1.5 rounded-xl mt-1 bg-fuchsia-500/10 px-4 py-2.5 font-bold text-fuchsia-400 hover:bg-fuchsia-500/20 transition w-full max-w-[200px] border border-fuchsia-500/20">
                                                <Upload className="h-4 w-4" /> Upload Sales CSV
                                            </button>
                                        )}
                                        {ob.type === 'MRI' && (
                                            <div className="flex flex-col gap-1.5 max-w-[240px]">
                                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Monthly Rental Income</label>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-medium text-slate-500">KES</span>
                                                    <input
                                                        type="number"
                                                        placeholder="Rent Amount"
                                                        value={mriInputVals[ob.client.id] || ''}
                                                        onChange={e => setMriInputVals(prev => ({ ...prev, [ob.client.id]: e.target.value }))}
                                                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-rose-500 transition shadow-inner"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-4 min-w-[280px]">
                                        {ob.type === 'VAT' && (
                                            <div className="flex flex-col gap-2 rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 shadow-sm group-hover:border-slate-600 transition">
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-slate-400 font-medium">Input VAT <span className="font-normal text-[10px] ml-1 text-slate-500">(Purchases)</span></span>
                                                    <span className="text-slate-200 font-bold border-b border-transparent">KES {isEtimsConnected ? '68,400.00' : '0.00'}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-slate-400 font-medium">Output VAT <span className="font-normal text-[10px] ml-1 text-slate-500">(Sales)</span></span>
                                                    <span className="text-slate-200 font-bold border-b border-transparent">KES {isEtimsConnected ? '124,500.00' : '0.00'}</span>
                                                </div>
                                                <div className="border-t border-slate-700/80 my-1 pt-2.5 flex justify-between items-center text-xs">
                                                    <span className="font-bold text-blue-400">VAT Payable <span className="font-normal text-[10px] ml-1 opacity-70">(Remaining)</span></span>
                                                    <span className="font-black text-[13px] text-blue-400 drop-shadow-sm">KES {isEtimsConnected ? '56,100.00' : '0.00'}</span>
                                                </div>
                                            </div>
                                        )}
                                        {ob.type === 'TOT' && (
                                            <div className="flex flex-col gap-2 rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 shadow-sm group-hover:border-slate-600 transition">
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-slate-400 font-medium">Total Sales <span className="font-normal text-[10px] ml-1 text-slate-500">(eTIMS)</span></span>
                                                    <span className="text-slate-200 font-bold border-b border-transparent">KES {isEtimsConnected ? '450,000.00' : '0.00'}</span>
                                                </div>
                                                <div className="border-t border-slate-700/80 my-1 pt-2.5 flex justify-between items-center text-xs">
                                                    <span className="font-bold text-blue-400">1.5% Computed TOT</span>
                                                    <span className="font-black text-[13px] text-blue-400 drop-shadow-sm">KES {isEtimsConnected ? '6,750.00' : '0.00'}</span>
                                                </div>
                                            </div>
                                        )}
                                        {ob.type === 'MRI' && (
                                            <div className="flex flex-col rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 shadow-sm group-hover:border-rose-900/30 transition">
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="font-bold text-rose-400">7.5% Computed Tax</span>
                                                    <span className="font-black text-[13px] text-rose-400 drop-shadow-sm">
                                                        KES {mriInputVals[ob.client.id] && !isNaN(parseFloat(mriInputVals[ob.client.id])) 
                                                            ? (parseFloat(mriInputVals[ob.client.id]) * 0.075).toLocaleString(undefined, {minimumFractionDigits: 2}) 
                                                            : '0.00'}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        {ob.type === 'DST' && (
                                            <span className="text-slate-500 text-xs italic">Pending CSV Data</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-4 pt-5 align-top">
                                        <StatusBadge status={ob.status} />
                                    </td>
                                    <td className="px-4 py-4 pt-5 align-top text-right">
                                        <button className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition shadow-sm drop-shadow mt-1">
                                            Process Return
                                        </button>
                                    </td>
                                </tr>
                                );
                            })}
                            {obligations.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-4 py-12 text-center">
                                        <div className="flex flex-col items-center justify-center text-slate-500">
                                            <TerminalSquare className="h-8 w-8 mb-3 opacity-20" />
                                            <p>No returns found for this filter.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>`;
code = code.replace(tbodyRegex, newTbody);


// 3. Insert eTIMS Connect Modal at the bottom inside standard render block
const modalInsertPoint = "{/* Modal */}";  // Next to new client modal
if (code.includes(modalInsertPoint) && !code.includes('etimsModalClient &&')) {
    const etimsModal = `
            {/* eTIMS Connection Modal */}
            {etimsModalClient && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between border-b border-slate-800 p-6">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <Cloud className="h-5 w-5 text-blue-400" /> Connect eTIMS Data
                            </h2>
                            <button onClick={() => { setEtimsModalClient(null); setEtimsPassword(''); }} className="text-slate-400 hover:text-white transition">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <p className="text-sm text-slate-300">
                                Connecting to KRA eTIMS for <strong className="text-blue-400">{etimsModalClient.name}</strong> ({etimsModalClient.pin}).
                            </p>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-400">eTIMS Platform Password</label>
                                <input
                                    type="password"
                                    value={etimsPassword}
                                    onChange={(e) => setEtimsPassword(e.target.value)}
                                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                                    placeholder="Enter associated eTIMS password"
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-900/50 p-6 rounded-b-2xl">
                            <button onClick={() => { setEtimsModalClient(null); setEtimsPassword(''); }} className="rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition">
                                Cancel
                            </button>
                            <button 
                                onClick={() => { 
                                    setEtimsConnections(prev => ({ ...prev, [etimsModalClient.id]: true }));
                                    setEtimsModalClient(null);
                                    setEtimsPassword('');
                                    setDashboardNotice({ tone: 'success', message: \`Successfully connected eTIMS for \${etimsModalClient.name}.\` });
                                }} 
                                disabled={!etimsPassword}
                                className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <CheckCircle2 className="h-4 w-4" /> Save Connection
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Modal */}`;
    code = code.replace(modalInsertPoint, etimsModal);
}

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('eTIMS and VAT/TOT/MRI UI logic mapped to single view.');
