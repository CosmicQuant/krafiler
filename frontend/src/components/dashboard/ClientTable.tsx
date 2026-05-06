import { Building2 } from 'lucide-react';
import { ClientObligation } from '../../types';

type ClientTableProps = {
    clients: ClientObligation[];
    onSelectClient: (client: ClientObligation) => void;
    onEditClient: (client: ClientObligation) => void;
};

export function ClientTable({ clients, onSelectClient, onEditClient }: ClientTableProps) {
    return (
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
                                    <button onClick={() => onSelectClient(client)} className="flex items-center gap-3 text-left hover:opacity-80">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400"><Building2 className="h-5 w-5" /></div>
                                        <div className="font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer" onClick={() => onEditClient(client)} title="Edit client details">{client.name}</div>
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
    );
}
