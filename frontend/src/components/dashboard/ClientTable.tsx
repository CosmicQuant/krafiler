import { useState } from 'react';
import { Building2, Trash2, X, Pencil } from 'lucide-react';
import { ClientObligation } from '../../types';
import { useDeleteClient } from '../../hooks/useClients';

type ClientTableProps = {
    clients: ClientObligation[];
    onSelectClient: (client: ClientObligation) => void;
    onEditClient: (client: ClientObligation) => void;
};

const statusMeta: Record<string, { label: string; className: string }> = {
    done: { label: 'Filed', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    due: { label: 'Due', className: 'bg-red-50 text-[#ff0613] border-red-200' },
    generated: { label: 'Ready', className: 'bg-blue-50 text-blue-700 border-blue-200' },
    na: { label: 'N/A', className: 'bg-slate-50 text-slate-400 border-slate-200' },
};

export function ClientTable({ clients, onSelectClient, onEditClient }: ClientTableProps) {
    const deleteClientMutation = useDeleteClient();
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const getStatusBadge = (status: string) => {
        const meta = statusMeta[status] || statusMeta.na;
        return (
            <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${meta.className}`}>
                {meta.label}
            </span>
        );
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteClientMutation.mutateAsync(id);
            setDeleteConfirmId(null);
        } catch {
            // handled by mutation
        }
    };

    return (
        <div className="mt-10 rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50/50">
                        <tr>
                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Firm / Client</th>
                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">KRA PIN</th>
                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">PAYE</th>
                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">NSSF</th>
                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">SHA</th>
                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">VAT</th>
                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">TOT</th>
                            <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">MRI</th>
                            <th className="px-5 py-4 w-20" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {clients.map(client => (
                            <tr key={client.id} className="group transition hover:bg-slate-50/50">
                                <td className="px-5 py-4">
                                    <button onClick={() => onSelectClient(client)} className="flex items-center gap-3 text-left">
                                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                                            <Building2 className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-slate-900">{client.name}</div>
                                            <div className="text-[11px] text-slate-400">{client.sector || 'General'}</div>
                                        </div>
                                    </button>
                                </td>
                                <td className="px-5 py-4 font-mono text-xs text-slate-500">{client.pin}</td>
                                <td className="px-5 py-4">{getStatusBadge(client.paye)}</td>
                                <td className="px-5 py-4">{getStatusBadge(client.nssf)}</td>
                                <td className="px-5 py-4">{getStatusBadge(client.sha)}</td>
                                <td className="px-5 py-4">{getStatusBadge(client.vat)}</td>
                                <td className="px-5 py-4">{getStatusBadge(client.tot)}</td>
                                <td className="px-5 py-4">{getStatusBadge(client.mri)}</td>
                                <td className="px-5 py-4">
                                    {deleteConfirmId === client.id ? (
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => handleDelete(client.id)}
                                                disabled={deleteClientMutation.isPending}
                                                className="rounded-md bg-[#ff0613] px-2 py-1 text-[10px] font-bold text-white hover:bg-[#d80000] disabled:opacity-50"
                                            >
                                                {deleteClientMutation.isPending ? '...' : 'Yes'}
                                            </button>
                                            <button
                                                onClick={() => setDeleteConfirmId(null)}
                                                className="rounded-md bg-slate-100 px-1.5 py-1 text-slate-600 hover:bg-slate-200"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                                            <button
                                                onClick={() => onEditClient(client)}
                                                className="rounded-md p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition"
                                                title="Edit"
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                onClick={() => setDeleteConfirmId(client.id)}
                                                className="rounded-md p-1.5 text-slate-300 hover:text-[#ff0613] hover:bg-red-50 transition"
                                                title="Delete"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
