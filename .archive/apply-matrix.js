const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const rx = /const renderMatrixGrid = \(\) => \([\s\S]*?<\/tbody>\s*<\/table>\s*<\/div>\s*<\/div>\s*\);/m;

const replacement = `const renderMatrixGrid = () => {
        // Flatten clients into specific obligations for the 20th Desk
        const obligations: { client: any; type: string; status: TaxStatus }[] = [];
        clients.forEach(c => {
            if (c.vat !== 'na') obligations.push({ client: c, type: 'VAT', status: c.vat });
            if (c.tot !== 'na') obligations.push({ client: c, type: 'TOT', status: c.tot });
            if (c.dst !== 'na') obligations.push({ client: c, type: 'DST', status: c.dst });
            if (c.mri !== 'na') obligations.push({ client: c, type: 'MRI', status: c.mri });
        });

        return (
            <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
                <div className="pb-16 sm:pb-32 overflow-x-auto lg:overflow-visible">
                    <table className="w-full text-left text-sm text-slate-300">
                        <thead className="border-b border-slate-800 bg-slate-900 rounded-t-2xl text-xs uppercase text-slate-400">
                            <tr>
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Client Info</th>
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Obligation</th>
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Required Data</th>
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Computed Tax</th>
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Status</th>
                                <th className="px-4 py-4 font-semibold text-right uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {obligations.map((ob, idx) => (
                                <tr key={\`\${ob.client.id}-\${ob.type}-\${idx}\`} className="transition hover:bg-slate-800/50">
                                    <td className="px-4 py-4">
                                        <div className="font-semibold text-white">{ob.client.name}</div>
                                        <div className="mt-1 text-xs text-slate-500">PIN: {ob.client.pin}</div>
                                    </td>
                                    <td className="px-4 py-4">
                                        <span className="inline-flex rounded-full bg-slate-800 px-3 py-1 text-xs font-bold text-slate-300">
                                            {ob.type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4">
                                        {ob.type === 'VAT' && (
                                            <div className="flex flex-col gap-2">
                                                <button className="text-xs flex items-center justify-center gap-1.5 rounded bg-blue-500/10 px-2 py-1.5 font-medium text-blue-400 hover:bg-blue-500/20 transition">
                                                    <Upload className="h-3.5 w-3.5" /> Upload Sales CSV
                                                </button>
                                                <button className="text-xs flex items-center justify-center gap-1.5 rounded bg-rose-500/10 px-2 py-1.5 font-medium text-rose-400 hover:bg-rose-500/20 transition">
                                                    <Upload className="h-3.5 w-3.5" /> Upload Purchases CSV
                                                </button>
                                            </div>
                                        )}
                                        {(ob.type === 'TOT' || ob.type === 'DST') && (
                                            <button className="text-xs flex items-center justify-center gap-1.5 rounded bg-blue-500/10 px-3 py-1.5 font-medium text-blue-400 hover:bg-blue-500/20 transition w-full max-w-[160px]">
                                                <Upload className="h-3.5 w-3.5" /> Upload Sales CSV
                                            </button>
                                        )}
                                        {ob.type === 'MRI' && (
                                            <div className="flex items-center gap-2 max-w-[200px]">
                                                <span className="text-xs font-medium text-slate-500">KES</span>
                                                <input
                                                    type="text"
                                                    placeholder="Rent Amount"
                                                    value={mriInputVals[ob.client.id] || ''}
                                                    onChange={e => setMriInputVals(prev => ({ ...prev, [ob.client.id]: e.target.value }))}
                                                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-emerald-500"
                                                />
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-4">
                                        <span className="text-slate-500 text-xs italic">Pending Data</span>
                                    </td>
                                    <td className="px-4 py-4">
                                        <StatusBadge status={ob.status} />
                                    </td>
                                    <td className="px-4 py-4 text-right">
                                        <button className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition">
                                            Process Return
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {obligations.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-12 text-center">
                                        <div className="flex flex-col items-center justify-center text-slate-500">
                                            <TerminalSquare className="h-8 w-8 mb-3 opacity-20" />
                                            <p>No active 20th deadline obligations configured for any clients.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };`;

if(rx.test(code)) {
    code = code.replace(rx, replacement);
    fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
    console.log('Successfully replaced renderMatrixGrid!');
} else {
    console.log('Could not find renderMatrixGrid with regex.');
}
