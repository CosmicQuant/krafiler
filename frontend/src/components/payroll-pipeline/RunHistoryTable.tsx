import { useState } from 'react';
import { Eye, Trash2, RotateCcw, ClipboardList, Plus } from 'lucide-react';
import { cn } from '../../utils/cn';
import { StepStatusBadge, type RunStatus } from './StepStatusBadge';

interface PayrollRun {
    id: number;
    period: string;
    periodLabel: string;
    status: string;
    totalEmployees: number;
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
    lockedAt: string | null;
    createdAt: string;
    updatedAt: string;
    subSteps?: { label: string; done: boolean; progress?: number; total?: number }[];
}

interface RunHistoryTableProps {
    runs: PayrollRun[];
    onViewRun: (runId: number) => void;
    onDeleteRun?: (runId: number) => void;
    onRollbackRun?: (runId: number) => void;
    onNewRun?: () => void;
    className?: string;
}

function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatMoney(amount: number) {
    return `KES ${Number(amount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function mapStatusToRunStatus(status: string): RunStatus {
    switch (status) {
        case 'draft':
            return 'draft';
        case 'completed':
            return 'generated';
        case 'closed':
            return 'finalized';
        case 'compliant':
            return 'compliant';
        default:
            return 'draft';
    }
}

export function RunHistoryTable({
    runs,
    onViewRun,
    onDeleteRun,
    onRollbackRun,
    onNewRun,
    className,
}: RunHistoryTableProps) {
    const [deletingId, setDeletingId] = useState<number | null>(null);

    const handleDelete = (runId: number) => {
        if (!window.confirm('Delete this payroll run? This cannot be undone.')) return;
        setDeletingId(runId);
        onDeleteRun?.(runId);
        setDeletingId(null);
    };

    if (runs.length === 0) {
        return (
            <div className={cn('rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center', className)}>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 mb-3">
                    <ClipboardList className="h-6 w-6 text-slate-400" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">No payroll runs yet</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                    Create your first run to start processing payroll for this client.
                </p>
                {onNewRun && (
                    <button
                        onClick={onNewRun}
                        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#ff0613] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#d80000]"
                    >
                        <Plus className="h-3.5 w-3.5" /> New Payroll Run
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className={cn('overflow-x-auto', className)}>
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="pb-3 pt-2 pl-2">Period</th>
                        <th className="pb-3 pt-2">Status</th>
                        <th className="pb-3 pt-2">Employees</th>
                        <th className="pb-3 pt-2 text-right">Gross Pay</th>
                        <th className="pb-3 pt-2 text-right">Net Pay</th>
                        <th className="pb-3 pt-2 text-center">Created</th>
                        <th className="pb-3 pt-2 pr-2 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {runs.map((run) => (
                        <tr
                            key={run.id}
                            className="border-b border-slate-100 hover:bg-slate-50 transition-colors group"
                        >
                            <td className="py-3 pl-2">
                                <div className="font-semibold text-slate-900">{run.periodLabel || run.period}</div>
                                <div className="text-[10px] text-slate-400">ID: {run.id}</div>
                            </td>
                            <td className="py-3">
                                <StepStatusBadge
                                    status={mapStatusToRunStatus(run.status)}
                                    subSteps={run.subSteps}
                                />
                            </td>
                            <td className="py-3">
                                <span className="font-medium text-slate-700">{run.totalEmployees}</span>
                            </td>
                            <td className="py-3 text-right font-medium text-slate-700">
                                {formatMoney(run.totalGross)}
                            </td>
                            <td className="py-3 text-right font-bold text-slate-900">
                                {formatMoney(run.totalNet)}
                            </td>
                            <td className="py-3 text-center text-xs text-slate-500">
                                {formatDate(run.createdAt)}
                            </td>
                            <td className="py-3 pr-2">
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => onViewRun(run.id)}
                                        className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition"
                                        title="View Run"
                                    >
                                        <Eye className="h-4 w-4" />
                                    </button>
                                    {run.lockedAt && onRollbackRun && (
                                        <button
                                            onClick={() => onRollbackRun(run.id)}
                                            className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 transition"
                                            title="Rollback"
                                        >
                                            <RotateCcw className="h-4 w-4" />
                                        </button>
                                    )}
                                    {!run.lockedAt && onDeleteRun && (
                                        <button
                                            onClick={() => handleDelete(run.id)}
                                            disabled={deletingId === run.id}
                                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition disabled:opacity-50"
                                            title="Delete"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
