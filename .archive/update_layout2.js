const fs = require('fs');
const filepath = 'C:/Users/ADMIN/Desktop/KRAFILER/frontend/src/components/PracticeDashboard.tsx';
let txt = fs.readFileSync(filepath, 'utf8');

const base64str = 'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICkKfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgPC9kaXY+';

const searchStr = Buffer.from(base64str, 'base64').toString('utf8');

const replaceStr = \                                            </div>
                                        </div>
                                    )}

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
                            </div>\;

txt = txt.replace(searchStr, replaceStr);

fs.writeFileSync(filepath, txt, 'utf8');
console.log('Update 3 injected layout extensions');
