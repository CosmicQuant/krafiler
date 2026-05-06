const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const rx = /\{\/\* PAYE CSV Upload Section \*\/\}[\s\S]*?<\/div>[\r\n\s]*<\/div>[\r\n\s]*\)\}[\r\n\s]*<\/div>[\r\n\s]*<\/div>[\r\n\s]*<div className="flex items-center justify-end gap-3/m;

const match = code.match(rx);
if(match) {
    const chunk = match[0];
    const replacement = chunk.replace(/<\/div>[\r\n\s]*<\/div>[\r\n\s]*<div className="flex items-center justify-end gap-3/m, `
                                </div>
                            </div>
                            
                            {/* Non-Payroll VAT/TOT/DST Modal Section */}
                            {newClientObligations.some(ob => ['vat', 'tot', 'dst'].includes(ob)) && (
                                <div className="pt-2 pb-4 px-6 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-5">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                                <h3 className="flex items-center gap-2 text-sm font-bold text-blue-400">
                                                    <Activity className="h-4 w-4" /> Non-Payroll Return Obligations
                                                </h3>
                                            </div>
                                        </div>
                                        <p className="text-xs text-blue-300">For VAT, TOT, and DST Setup, proceed to the <strong>20th Desk</strong> after saving. There, you can upload the specific Sales & Purchases CSV datasets dynamically per period.</p>
                                    </div>
                                </div>
                            )}

                            {/* Non-Payroll MRI Modal Section */}
                            {newClientObligations.includes('mri') && (
                                <div className="pt-2 pb-4 px-6 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                                <h3 className="flex items-center gap-2 text-sm font-bold text-rose-400">
                                                    <Building2 className="h-4 w-4" /> Monthly Rental Income Setup
                                                </h3>
                                            </div>
                                        </div>
                                        <p className="text-xs text-rose-300">Proceed to the <strong>20th Desk</strong> to enter the real-time Rent Amount (KES) manually per client directly in the desk interface before filing.</p>
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-end gap-3`);
    fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code.replace(rx, replacement));
    console.log('Fixed Modal');
} else {
    console.log('Not matched');
}