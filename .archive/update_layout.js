const fs = require('fs');
const filepath = 'C:/Users/ADMIN/Desktop/KRAFILER/frontend/src/components/PracticeDashboard.tsx';
let txt = fs.readFileSync(filepath, 'utf8');

// 1. Make Modal Scrollable
txt = txt.replace(
    '<div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">',
    '<div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">'
);

txt = txt.replace(
    '<div className="flex items-center justify-between border-b border-slate-800 p-6">',
    '<div className="flex items-center justify-between border-b border-slate-800 p-6 shrink-0">'
);

txt = txt.replace(
    '<div className="p-6">\\n                            <div className="space-y-4">',
    '<div className="p-6 overflow-y-auto flex-1">\\n                            <div className="space-y-4">'
);

txt = txt.replace(
    '<div className="flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-900/50 p-6 rounded-b-2xl">',
    '<div className="flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-900/50 p-6 rounded-b-2xl shrink-0">'
);

// 2. Expand PAYE optional logic and NSSF/SHA triggers
const oldPayeSection = \{/* PAYE CSV Upload Section */}
                                    {newClientObligations.includes('paye') && (
                                        <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                                                        <Building2 className="h-4 w-4" /> PAYE / Unified Payroll Master
                                                    </h3>\;

const newPayeSection = \{/* PAYE CSV Upload Section */}
                                    {newClientObligations.some(ob => ['paye', 'nssf', 'sha'].includes(ob)) && (
                                        <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                                                <div className="flex items-center justify-between mb-4">
                                                    <div className="flex items-center gap-3">
                                                        <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                                                            <Building2 className="h-4 w-4" /> Unified Payroll Master
                                                        </h3>
                                                        <span className="rounded-full bg-emerald-500/20 px-2 flex items-center h-5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">Optional</span>
                                                    </div>\;

txt = txt.replace(oldPayeSection, newPayeSection);


const newConnectionsStr = \
                                    {/* eLevy Connection Section */}
                                    {newClientObligations.includes('elevy') && (
                                        <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-5">
                                                <h3 className="text-sm font-bold text-blue-400">Connect Sales Data (eLevy)</h3>
                                                <p className="mt-2 text-xs text-blue-200/70">Connect external POS systems or upload sales registry to automate eLevy estimations.</p>
                                                <button className="mt-4 w-full py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 text-sm font-bold hover:bg-blue-500/20 transition">Connect Data Source</button>
                                            </div>
                                        </div>
                                    )}

                                    {/* VAT Connection Section */}
                                    {newClientObligations.includes('vat') && (
                                        <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-5">
                                                <h3 className="text-sm font-bold text-indigo-400">VAT & eTIMS Integration</h3>
                                                <p className="mt-2 text-xs text-indigo-200/70">Connect sales and purchases data securely from eTIMS or map local software.</p>
                                                <div className="mt-4 grid grid-cols-2 gap-3">
                                                    <button className="py-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-bold hover:bg-indigo-500/20 transition">Connect to eTIMS</button>
                                                    <button className="py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-700 transition">Connect Local Data</button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* TOT Connection Section */}
                                    {newClientObligations.includes('tot') && (
                                        <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-5">
                                                <h3 className="text-sm font-bold text-cyan-400">Turnover Tax (TOT) Mapping</h3>
                                                <p className="mt-2 text-xs text-cyan-200/70">Map your gross monthly sales logs for accurate 1.5% TOT calculations.</p>
                                                <button className="mt-4 px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-sm font-bold hover:bg-cyan-500/20 transition">Connect Sales Tracker</button>
                                            </div>
                                        </div>
                                    )}

                                    {/* MRI Connection Section */}
                                    {newClientObligations.includes('mri') && (
                                        <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
                                                <h3 className="text-sm font-bold text-amber-400">Monthly Rental Income</h3>
                                                <p className="mt-2 text-xs text-amber-200/70">Connect to property management software to auto-pull tenant rent rolls.</p>
                                                <button className="mt-4 px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-bold hover:bg-amber-500/20 transition">Connect Property Data</button>
                                            </div>
                                        </div>
                                    )}

                                    {/* DST Connection Section */}
                                    {newClientObligations.includes('dst') && (
                                        <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-5">
                                                <h3 className="text-sm font-bold text-fuchsia-400">Digital Service Tax</h3>
                                                <p className="mt-2 text-xs text-fuchsia-200/70">Integrate with digital platforms to verify and consolidate cross-border digital sales.</p>
                                                <button className="mt-4 px-4 py-2 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-400 text-sm font-bold hover:bg-fuchsia-500/20 transition">Connect Digital Sales</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-900/50 p-6 rounded-b-2xl shrink-0">\;

txt = txt.replace(
    '                                </div>\\n                            </div>\\n                            <div className="flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-900/50 p-6 rounded-b-2xl shrink-0">',
    newConnectionsStr
);

fs.writeFileSync(filepath, txt, 'utf8');
console.log('Update scripts executed successfully');
