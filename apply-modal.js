const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

// Use an indexOf based approach to perfectly identify the place to insert the modal updates.
const s1 = code.indexOf('{/* PAYE CSV Upload Section */}');
if (s1 !== -1) {
    const s2 = code.indexOf('</div>', code.indexOf('</button>', s1 + 1000));
    // Let's find the save buttons to safely insert right above them.
    const searchString = `<div className="flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-900/50 p-6 rounded-b-2xl">
                                <button onClick={() => {`;
    
    const s3 = code.indexOf(searchString);
    if (s3 !== -1) {
        const replacementStr = `                            {/* Non-Payroll VAT/TOT/DST Modal Section */}
                            {newClientObligations.some(ob => ['vat', 'tot', 'dst'].includes(ob)) && (
                                <div className="pt-4 pb-4 px-6 animate-in fade-in slide-in-from-top-2 duration-300">
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
                                        <p className="text-xs text-rose-300">Proceed to the <strong>20th Desk</strong> to enter the real-time Rent Amount (KES) manually per client directly in the table before filing.</p>
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-end gap-3 border-t border-slate-800 bg-slate-900/50 p-6 rounded-b-2xl">
                                <button onClick={() => {`;
                                
        code = code.replace(searchString, replacementStr);
        fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
        console.log('Successfully added Modal non-payroll items.');
    } else {
        console.log('Could not find the Save button block string!');
    }
} else {
    console.log('Could not find PAYE section marker');
}
