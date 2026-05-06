const fs = require('fs');
const filepath = 'C:\\Users\\ADMIN\\Desktop\\KRAFILER\\frontend\\src\\components\\PracticeDashboard.tsx';
let content = fs.readFileSync(filepath, 'utf8');

const targetStr =                                                 {obs.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>;

const replacement =                                                 {obs.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                {/* PAYE CSV Upload Section */}
                                {newClientObligations.includes('paye') && (
                                    <div className="pt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                                            <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                                                <Building2 className="h-4 w-4" /> PAYE / Unified Payroll Master
                                            </h3>
                                            <p className="mt-2 text-xs text-emerald-200/70">
                                                Upload any master payroll spreadsheet containing employee details (Name, ID, PIN, NHIF, NSSF). 
                                                The system will automatically ingest the data, format it to the KRA Unified Payroll standard, 
                                                and generate the Master CSV for you according to PAYE guidelines and simplified returns.
                                            </p>
                                            <div className="mt-4 flex items-center justify-center w-full">
                                                <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-24 border-2 border-emerald-500/30 border-dashed rounded-xl cursor-pointer bg-slate-900/50 hover:bg-emerald-500/10 hover:border-emerald-500/50 transition">
                                                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                                        <p className="mb-1 text-sm text-slate-400 font-bold">
                                                            {newClientMasterCsv ? (
                                                                <span className="text-emerald-400">Selected: {newClientMasterCsv.name}</span>
                                                            ) : (
                                                                <>Click to upload <span className="font-normal text-slate-500">or drag and drop</span></>
                                                            )}
                                                        </p>
                                                        <p className="text-xs text-slate-500">.CSV or .XLSX</p>
                                                    </div>
                                                    <input id="dropzone-file" type="file" accept=".csv, .xlsx, .xls" className="hidden" onChange={(e) => {
                                                        if (e.target.files && e.target.files.length > 0) {
                                                            setNewClientMasterCsv(e.target.files[0]);
                                                        }
                                                    }} />
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                )};

content = content.replace(targetStr, replacement);
const cancelTargetStr = <button onClick={() => setShowNewClientModal(false)} className="rounded-xl px-5 py-2.5 text-sm font-bold text-slate-400 hover:text-white transition">Cancel</button>;
const cancelRepStr = <button onClick={() => {
                                setShowNewClientModal(false);
                                setNewClientName('');
                                setNewClientPin('');
                                setNewClientPassword('');
                                setNewClientObligations([]);
                                setNewClientMasterCsv(null);
                            }} className="rounded-xl px-5 py-2.5 text-sm font-bold text-slate-400 hover:text-white transition">Cancel</button>;

content = content.replace(cancelTargetStr, cancelRepStr);
fs.writeFileSync(filepath, content);
console.log('Update applied');
