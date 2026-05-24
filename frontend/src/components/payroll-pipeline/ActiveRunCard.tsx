import { useNavigate } from 'react-router-dom';
import { Play, Trash2, ArrowRight, ClipboardList } from 'lucide-react';
import { cn } from '../../utils/cn';
import { StepStatusBadge } from './StepStatusBadge';

interface ActiveRun {
    id: number;
    periodLabel: string;
    status: string;
    totalEmployees: number;
    createdAt: string;
}

interface ActiveRunCardProps {
    clientId: string;
    run: ActiveRun;
    onDelete: (runId: number) => void;
}

export function ActiveRunCard({ clientId, run, onDelete }: ActiveRunCardProps) {
    const navigate = useNavigate();

    const mapStatus = (status: string) => {
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
    };

    return (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-amber-100 p-2.5 text-amber-600">
                        <ClipboardList className="h-5 w-5" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-bold text-slate-900">{run.periodLabel}</h3>
                            <StepStatusBadge status={mapStatus(run.status)} />
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                            {run.totalEmployees} employee{run.totalEmployees === 1 ? '' : 's'} · Created{' '}
                            {new Date(run.createdAt).toLocaleDateString('en-GB', {
                                day: '2-digit',
                                month: 'short',
                            })}
                        </p>
                        <div className="mt-3 w-full sm:w-48">
                            <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                                <div
                                    className={cn(
                                        'h-full rounded-full transition-all',
                                        run.status === 'draft'
                                            ? 'bg-slate-400 w-1/4'
                                            : run.status === 'completed'
                                              ? 'bg-emerald-500 w-3/4'
                                              : 'bg-amber-500 w-1/2'
                                    )}
                                />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider font-medium">
                                {run.status === 'draft'
                                    ? 'Step 1 — Setup'
                                    : run.status === 'completed'
                                      ? 'Step 6 — Ready to Finalize'
                                      : 'In Progress'}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                        onClick={() => navigate(`/dashboard/client/${clientId}/payroll/run/${run.id}`)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff0613] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#d80000]"
                    >
                        <Play className="h-3.5 w-3.5" /> Continue
                    </button>
                    <button
                        onClick={() => onDelete(run.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
}

interface NoActiveRunProps {
    onNewRun: () => void;
}

export function NoActiveRun({ onNewRun }: NoActiveRunProps) {
    return (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-5">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-slate-100 p-2 text-slate-400">
                        <ClipboardList className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-slate-700">No active runs</p>
                        <p className="text-xs text-slate-500">Start a new payroll run to get started.</p>
                    </div>
                </div>
                <button
                    onClick={onNewRun}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff0613] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#d80000]"
                >
                    New Run <ArrowRight className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}
