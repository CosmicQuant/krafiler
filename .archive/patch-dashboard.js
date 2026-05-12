const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf-8');

// 1. Add state for TOT inputs
code = code.replace(
    'const [mriInputVals, setMriInputVals] = useState<Record<string, string>>({});',
    `const [mriInputVals, setMriInputVals] = useState<Record<string, string>>({});\n    const [totInputVals, setTotInputVals] = useState<Record<string, string>>({});`
);

// 2. Add handleFileTot below handleFileMri
const handleMriRegex = /const handleFileMri = async.*?};/s;
const handleTotFn = `
    const handleFileTot = async (client: ClientObligation) => {
        const amountStr = totInputVals[client.id];
        const amount = amountStr ? parseFloat(amountStr) : 0;
        if (isNaN(amount) || amount <= 0) {
            setDashboardNotice({ tone: 'error', message: \`Please enter a valid TOT sales amount for \${client.name}.\` });
            return;
        }

        // Calculate previous month dynamically
        const now = new Date();
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const totYear = lastMonthDate.getFullYear();
        const totMonth = lastMonthDate.getMonth() + 1; // 1-indexed

        try {
            if (isPendingFilingJob(activeJobs[client.id])) {
                setDashboardNotice({
                    tone: 'info',
                    message: \`A filing is already \${activeJobs[client.id].state === 'active' ? 'in progress' : 'queued'} for \${client.name}.\`,
                });
                return;
            }

            setDashboardNotice({ tone: 'info', message: \`Queueing TOT return for \${client.name} (\${totMonth}/\${totYear})...\` });

            const payload = {
                kraPin: client.pin,
                kraPassword: (client as any).password || client.iTaxPassword || client.pin,
                periodFrom: \`\${totYear}-01-01\`, // Mock, unneeded for TOT
                periodTo: \`\${totYear}-01-31\`, // Mock, unneeded for TOT
                taxObligationType: "turnover_tax",
                totYear,
                totMonth,
                totTurnover: amount
            };

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const dataResp = await res.json().catch(() => ({}));

            if (!res.ok) {
                 setDashboardNotice({ tone: 'error', message: dataResp.error || 'Failed to queue TOT return.' });
                 return;
            }

            setActiveJobs((prev) => ({
                ...prev,
                [client.id]: { id: dataResp.jobId, state: dataResp.jobState || 'waiting', progress: 0, message: 'Queued TOT Filing...' }
            }));
            
            setDashboardNotice({ tone: 'success', message: \`TOT Filing job queued successfully for \${client.name}.\` });
        } catch (error: any) {
            console.error('TOT filing dispatch error', error);
            setDashboardNotice({ tone: 'error', message: error.message || 'An error occurred trying to queue the TOT return.' });
        }
    };
`;

code = code.replace(handleMriRegex, match => match + '\n\n' + handleTotFn);

// 3. Fix the UI for TOT to be an input instead of fake eTIMS
const oldTotUi = `                                        {ob.type === 'TOT' && (
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
                                        )}`;

const newTotUi = `                                        {ob.type === 'TOT' && (
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
                                                        KES {totInputVals[ob.client.id] && !isNaN(parseFloat(totInputVals[ob.client.id])) 
                                                            ? (parseFloat(totInputVals[ob.client.id]) * 0.015).toLocaleString(undefined, {minimumFractionDigits: 2}) 
                                                            : '0.00'}
                                                    </span>
                                                </div>
                                            </div>
                                        )}`;

code = code.replace(oldTotUi, newTotUi);

// 4. Update the "File Return" action button to trigger handleFileTot
const fileActionRegex = /<button[^>]+onClick=\{\(\) => \{[^}]*if \(ob\.type === 'VAT'\)[^}]*handleAutoFile[^}]*\} else if \(ob\.type === 'MRI'\)[^}]*handleFileMri[^}]*\}\}[^>]*>.*?<\/button>/s;

if (code.match(fileActionRegex)) {
    const replacement = `<button
                                                                    onClick={() => {
                                                                        if (ob.type === 'VAT') {
                                                                            handleAutoFile(ob.client);
                                                                        } else if (ob.type === 'MRI') {
                                                                            handleFileMri(ob.client);
                                                                        } else if (ob.type === 'TOT') {
                                                                            handleFileTot(ob.client);
                                                                        }
                                                                    }}
                                                                    disabled={isActionDisabled}
                                                                    className={\`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition shadow-sm \${isActionDisabled ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400'}\`}
                                                                >
                                                                    {isActionDisabled ? (
                                                                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing</>
                                                                    ) : (
                                                                        <><CheckCircle2 className="h-3.5 w-3.5" /> File {ob.type}</>
                                                                    )}
                                                                </button>`;
                                                                
    code = code.replace(fileActionRegex, replacement);
}

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('Patched dashboard!');
