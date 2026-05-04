const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf-8');

// Add Import
code = code.replace(
    "import { Link } from 'react-router-dom';",
    "import { Link } from 'react-router-dom';\nimport { TAX_OBLIGATION_OPTIONS, TaxObligationType } from '../types';"
);

// Add FileMinus to lucide-react if needed, or we can just use FileArchive. Wait, let's just use FileArchive.
code = code.replace(
    "'overview' | 'desk-9th' | 'desk-20th' | 'desk-elevy' | 'clients' | 'settings'",
    "'overview' | 'desk-9th' | 'desk-20th' | 'desk-elevy' | 'desk-nil' | 'clients' | 'settings'"
);

// Add state for nil filings
code = code.replace(
    "const [totInputVals, setTotInputVals] = useState<Record<string, string>>({});",
    "const [totInputVals, setTotInputVals] = useState<Record<string, string>>({});\n    const [nilSelections, setNilSelections] = useState<Record<string, { type: string, periodFrom: string, periodTo: string }>>({});"
);

// Add Nil sidebar Nav
const sideNavRegex = /<button onClick=\{\(\) => \{ setView\('desk-elevy'\);.*?\n.*?<\/button>/s;
const navReplacement = `$&
                        <button onClick={() => { setView('desk-nil'); setIsSidebarOpen(false); }} className={\`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition \${view === 'desk-nil' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-slate-400 hover:bg-slate-900 border border-transparent'}\`}>
                            <span className="flex items-center gap-3"><FileArchive className="h-4 w-4" /> Nil & ITR Returns</span>
                        </button>`;
code = code.replace(sideNavRegex, navReplacement);

// Add Nil Handle
const handleTotRegex = /const handleFileTot = async.*?catch \(error: any\) \{.*?\n.*?\n.*?\};/s;

const handleNilFn = `
    const handleFileNil = async (client: ClientObligation) => {
        const selection = nilSelections[client.id];
        if (!selection || !selection.type) {
            setDashboardNotice({ tone: 'error', message: \`Please select a tax obligation for \${client.name}.\` });
            return;
        }

        try {
            if (isPendingFilingJob(activeJobs[client.id])) {
                setDashboardNotice({ tone: 'info', message: \`A filing is already queued for \${client.name}.\` });
                return;
            }

            setDashboardNotice({ tone: 'info', message: \`Queueing Nil filing (\${selection.type}) for \${client.name}...\` });

            const payload = {
                kraPin: client.pin,
                kraPassword: (client as any).password || client.iTaxPassword || client.pin,
                periodFrom: selection.periodFrom || "2026-01-01",
                periodTo: selection.periodTo || "2026-12-31",
                taxObligationType: selection.type
            };

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const dataResp = await res.json().catch(() => ({}));

            if (!res.ok) {
                 setDashboardNotice({ tone: 'error', message: dataResp.error || 'Failed to queue Nil return.' });
                 return;
            }

            setActiveJobs((prev) => ({
                ...prev,
                [client.id]: { id: dataResp.jobId, state: dataResp.jobState || 'waiting', progress: 0, message: 'Queued Nil Filing...' }
            }));
            
            setDashboardNotice({ tone: 'success', message: \`Nil filing queued successfully for \${client.name}.\` });
        } catch (error: any) {
            console.error('Nil filing dispatch error', error);
            setDashboardNotice({ tone: 'error', message: error.message || 'An error occurred trying to queue the Nil return.' });
        }
    };
`;

code = code.replace(handleTotRegex, match => match + '\n\n' + handleNilFn);

// Add desk-nil view rendering
const endOfElevyRegex = /\{\!selectedClient && view === 'clients'.*?\(/s;
const nilDeskRender = `
                    {!selectedClient && view === 'desk-nil' && (
                        <div className="mt-10">
                            <div className="mb-6 flex flex-col gap-2 border-b border-slate-800 pb-5">
                                <h2 className="text-xl font-bold text-white">Nil & ITR Filing Desk</h2>
                                <p className="text-sm text-slate-400">File Nil returns and Annual Income Tax Returns for your clients.</p>
                            </div>
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
                                <div className="overflow-x-auto pb-16">
                                    <table className="w-full text-left text-sm text-slate-300">
                                        <thead className="border-b border-slate-800 bg-slate-900 text-xs uppercase text-slate-400">
                                            <tr>
                                                <th className="px-6 py-4 font-semibold tracking-wider w-1/3">Client & PIN</th>
                                                <th className="px-6 py-4 font-semibold tracking-wider">Tax Obligation</th>
                                                <th className="px-6 py-4 font-semibold tracking-wider">Period (From - To)</th>
                                                <th className="px-6 py-4 font-semibold tracking-wider text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800/50">
                                            {clients.map(client => {
                                                const sel = nilSelections[client.id] || { type: '', periodFrom: '2026-01-01', periodTo: '2026-12-31' };
                                                const job = activeJobs[client.id];
                                                const isProcessing = job && !isTerminalFilingJob(job);
                                                
                                                return (
                                                    <tr key={client.id} className="group transition hover:bg-slate-800/30">
                                                        <td className="px-6 py-4">
                                                            <div className="font-bold text-white">{client.name}</div>
                                                            <div className="text-xs text-slate-500 font-mono mt-0.5">{client.pin}</div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <select 
                                                                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                                                                value={sel.type}
                                                                onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, type: e.target.value } }))}
                                                            >
                                                                <option value="" disabled>Choose Obligation</option>
                                                                {TAX_OBLIGATION_OPTIONS.filter(o => o.filingMode === 'nil').map(o => (
                                                                    <option key={o.value} value={o.value}>{o.label}</option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex gap-2">
                                                                <input 
                                                                    type="date"
                                                                    value={sel.periodFrom}
                                                                    onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, periodFrom: e.target.value } }))}
                                                                    className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-amber-500"
                                                                />
                                                                <input 
                                                                    type="date"
                                                                    value={sel.periodTo}
                                                                    onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, periodTo: e.target.value } }))}
                                                                    className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-amber-500"
                                                                />
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <button
                                                                onClick={() => handleFileNil(client)}
                                                                disabled={isProcessing}
                                                                className={\`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition \${isProcessing ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-amber-500 hover:bg-amber-400 text-amber-950 shadow-lg'}\`}
                                                            >
                                                                {isProcessing ? 'Processing' : 'File Nil'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                    
`;
code = code.replace(endOfElevyRegex, match => nilDeskRender + match);

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('Patched nil desk!');
