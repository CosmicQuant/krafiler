import { useState, useEffect } from 'react';
import { apiFetch } from '../../../services/api';
import { Clock, Eye } from 'lucide-react';

interface AuditEntry {
    id: number;
    action: string;
    entityType: string;
    entityId: number | null;
    oldValues: string | null;
    newValues: string | null;
    performedBy: string;
    createdAt: string;
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function actionColor(action: string) {
    switch (action) {
        case 'CREATE': return 'text-emerald-600 bg-emerald-50';
        case 'UPDATE': return 'text-amber-600 bg-amber-50';
        case 'DELETE': return 'text-red-600 bg-red-50';
        default: return 'text-slate-600 bg-slate-50';
    }
}

export function AuditView({ client }: { client: { id: number | string; name: string } }) {
    const [logs, setLogs] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<number | null>(null);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const r = await apiFetch(`/clients/${client.id}/audit-log`);
                if (r.ok) setLogs(await r.json());
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        })();
    }, [client.id]);

    const renderJson = (str: string | null) => {
        if (!str) return <span className="text-slate-300">—</span>;
        try {
            const obj = JSON.parse(str);
            return <pre className="text-[10px] whitespace-pre-wrap max-h-32 overflow-y-auto bg-slate-50 rounded p-1.5">{JSON.stringify(obj, null, 2)}</pre>;
        } catch {
            return <span className="text-xs">{str}</span>;
        }
    };

    if (loading) return <div className="p-6 text-sm text-slate-500">Loading audit log...</div>;

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-400" />
                <h3 className="text-lg font-bold text-slate-800">Audit Trail</h3>
                <span className="text-xs text-slate-400">({logs.length} entries)</span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-slate-50 text-left text-slate-500">
                            <th className="px-3 py-2.5 font-semibold">Date</th>
                            <th className="px-3 py-2.5 font-semibold">Action</th>
                            <th className="px-3 py-2.5 font-semibold">Entity</th>
                            <th className="px-3 py-2.5 font-semibold">Performed By</th>
                            <th className="px-3 py-2.5 font-semibold text-right">Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.map(entry => (
                            <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{formatDate(entry.createdAt)}</td>
                                <td className="px-3 py-2">
                                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${actionColor(entry.action)}`}>
                                        {entry.action}
                                    </span>
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                    {entry.entityType}{entry.entityId ? ` #${entry.entityId}` : ''}
                                </td>
                                <td className="px-3 py-2 text-slate-500">{entry.performedBy || 'system'}</td>
                                <td className="px-3 py-2 text-right">
                                    {(entry.oldValues || entry.newValues) && (
                                        <button
                                            onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                                            className="rounded p-1 text-slate-400 hover:bg-slate-100"
                                        >
                                            <Eye className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {logs.length === 0 && (
                            <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No audit entries yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {expandedId && (() => {
                const entry = logs.find(l => l.id === expandedId);
                if (!entry) return null;
                return (
                    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                        <h4 className="text-xs font-bold text-slate-700">Change Details</h4>
                        {entry.oldValues && (
                            <div>
                                <p className="text-[10px] font-semibold text-slate-500 mb-1">Old Values:</p>
                                {renderJson(entry.oldValues)}
                            </div>
                        )}
                        {entry.newValues && (
                            <div>
                                <p className="text-[10px] font-semibold text-slate-500 mb-1">New Values:</p>
                                {renderJson(entry.newValues)}
                            </div>
                        )}
                    </div>
                );
            })()}
        </div>
    );
}
