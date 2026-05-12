const fs = require('fs');
let code = fs.readFileSync('src/components/PracticeDashboard.tsx', 'utf-8');

const regexProcessReturn = /<td className="px-4 py-4 pt-5 align-top text-right">\s*<button\s*onClick=\{\(\) => \{\s*if \(ob\.type === 'MRI'\) handleFileMri\(ob\.client\);\s*else if \(ob\.type === 'PAYE'\) handleAutoFile\(ob\.client\);\s*else if \(ob\.type === 'NSSF'\) handleAutoFileNssf\(ob\.client\);\s*\/\/ SHA, ETIMS, etc\. can be queued if logic exists\s*\}\}\s*disabled=\{isPendingFilingJob\(activeJobs\[ob\.client\.id\]\)\}\s*className="inline-flex items-center gap-2 rounded-xl bg-emerald-500\/10 border border-emerald-500\/20 px-4 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500\/20 hover:text-emerald-300 transition shadow-sm drop-shadow mt-1 disabled:opacity-50">\s*Process Return\s*<\/button>\s*<\/td>/;

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

if (regexProcessReturn.test(code)) {
    code = code.replace(regexProcessReturn, newActionButtonsObj);
    console.log('PRN Button injected');
} else {
    console.log('PRN Button NOT found for replace');
}

fs.writeFileSync('src/components/PracticeDashboard.tsx', code);
