const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

if (!code.includes('import CompanyDetails')) {
    code = code.replace(/import \{.*\} from 'react';/, "$&\nimport CompanyDetails from './CompanyDetails';");
}

if (!code.includes('selectedClient')) {
    code = code.replace(/const \[clients, setClients\] = useState<ClientObligation\[\]>\(\[\]\);/, 
        "$&\\n    const [selectedClient, setSelectedClient] = useState<ClientObligation | null>(null);");
    // Also, allow importing ClientObligation from index or just cast 
}

const tableClientRegistry = `                    {view === 'clients' && !selectedClient && (
                        <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
                            <div className="overflow-x-auto pb-8">
                                <table className="w-full text-left text-sm text-slate-300">
                                    <thead className="border-b border-slate-800 bg-slate-900/50">
                                        <tr>
                                            <th className="px-4 py-4 font-semibold uppercase tracking-wider">Firm / Client</th>
                                            <th className="px-4 py-4 font-semibold uppercase tracking-wider">KRA PIN</th>
                                            <th className="px-4 py-4 font-semibold uppercase tracking-wider">Active Obligations</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {clients.map(client => (
                                            <tr key={client.id} className="transition hover:bg-slate-800/50">
                                                <td className="px-4 py-4">
                                                    <button onClick={() => setSelectedClient(client)} className="flex items-center gap-3 text-left hover:opacity-80">
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400"><Building2 className="h-5 w-5" /></div>
                                                        <div className="font-bold text-white hover:text-emerald-400 hover:underline">{client.name}</div>
                                                    </button>
                                                </td>
                                                <td className="px-4 py-4 font-mono text-slate-400">{client.pin}</td>
                                                <td className="px-4 py-4">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {Object.entries({ vat: client.vat, tot: client.tot, mri: client.mri, paye: client.paye, nssf: client.nssf, sha: client.sha, eLevy: client.eLevy }).map(([obs, status]) => {
                                                            if (status !== 'na' && status) {
                                                                return <span key={obs} className="inline-flex rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-300">{obs}</span>;
                                                            }
                                                            return null;
                                                        })}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}`;

// Insert our block 
if (!code.includes('selectedClient && <CompanyDetails')) {
    code = code.replace(
        /{view === 'overview' && \(/,
        `{selectedClient && <div className="mt-10"><CompanyDetails client={selectedClient} onBack={() => setSelectedClient(null)} onSave={(updated) => { setClients(clients.map(c => c.id === updated.id ? updated : c)); setSelectedClient(null); }} /></div>}\n                    {!selectedClient && view === 'overview' && (`
    );
    code = code.replace(
        /{view === 'desk-9th' && \(/,
        `{!selectedClient && view === 'desk-9th' && (`
    );
    code = code.replace(
        /{view === 'desk-20th' && \(/,
        `{!selectedClient && view === 'desk-20th' && (`
    );
    code = code.replace(
        /{view === 'desk-elevy' && \(/,
        `{!selectedClient && view === 'desk-elevy' && (`
    );
}

// And finally inject our native client registry if view === 'clients' && !selectedClient
if (!code.includes('Firm / Client')) {
    // find showNewClientModal 
    code = code.replace(
        /{showNewClientModal && \(/,
        tableClientRegistry + "\n\n                    {showNewClientModal && ("
    );
}

// Update the renderMatrixGrid making company click open details
code = code.replace(
    /<p className="font-bold text-white">\{client\.name\}<\/p>/g,
    `<button onClick={() => setSelectedClient(client)} className="font-bold text-white hover:text-emerald-400 hover:underline text-left">{client.name}</button>`
);

// Update render9thDeskGrid
code = code.replace(
    /<div className="font-bold text-white">\{client\.name\}<\/div>/g,
    `<button onClick={() => setSelectedClient(client)} className="font-bold text-white hover:text-emerald-400 hover:underline text-left">{client.name}</button>`
);

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('Done!');
