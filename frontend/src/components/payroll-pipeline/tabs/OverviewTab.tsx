import { useState, useEffect, useCallback } from 'react';
import {
    Plus, ChevronDown, ChevronUp,
    CalendarCheck, FileSearch, Lock, FileCheck
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { RunHistoryTable } from '../RunHistoryTable';
import { ActiveRunCard, NoActiveRun } from '../ActiveRunCard';
import type { ClientObligation } from '../../../types';

interface OverviewTabProps {
    client: ClientObligation;
    period: string;
    onChangePeriod: (_period: string) => void;
    onNavigateTab: (tab: string) => void;
    onNewRun: () => void;
    onSetRunId?: (runId: number) => void;
}

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
}

export function OverviewTab({ client, period, onChangePeriod: _onChangePeriod, onNavigateTab, onNewRun, onSetRunId }: OverviewTabProps) {
    const [runs, setRuns] = useState<PayrollRun[]>([]);
    const [runsLoading, setRunsLoading] = useState(true);
    const [_runsError, setRunsError] = useState<string | null>(null);
    const [showAllRuns, setShowAllRuns] = useState(false);
    const [pipelineStatus, setPipelineStatus] = useState({
        attendance: { label: 'Attendance', status: 'pending', detail: '' },
        review: { label: 'Review', status: 'pending', detail: '' },
        finalize: { label: 'Finalize', status: 'pending', detail: '' },
        compliance: { label: 'Compliance', status: 'pending', detail: '' },
    });

    const fetchRuns = useCallback(async () => {
        setRunsLoading(true);
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs`);
            if (res.ok) {
                const data = await res.json();
                setRuns(data);

                // Derive pipeline status from runs
                const currentRun = data.find((r: PayrollRun) => r.period === period);
                if (currentRun) {
                    setPipelineStatus({
                        attendance: { label: 'Attendance', status: 'completed', detail: 'Approved' },
                        review: { label: 'Review', status: currentRun.status !== 'draft' ? 'completed' : 'active', detail: `${currentRun.totalEmployees} entries` },
                        finalize: { label: 'Finalize', status: currentRun.lockedAt ? 'completed' : 'active', detail: currentRun.lockedAt ? 'Locked' : 'Open' },
                        compliance: { label: 'Compliance', status: currentRun.lockedAt ? 'active' : 'pending', detail: currentRun.lockedAt ? 'Ready' : 'Waiting' },
                    });
                } else {
                    setPipelineStatus({
                        attendance: { label: 'Attendance', status: 'active', detail: 'Pending approval' },
                        review: { label: 'Review', status: 'pending', detail: '' },
                        finalize: { label: 'Finalize', status: 'pending', detail: '' },
                        compliance: { label: 'Compliance', status: 'pending', detail: '' },
                    });
                }
            } else {
                setRunsError('Failed to load payroll runs');
            }
        } catch {
            setRunsError('Network error loading runs');
        } finally {
            setRunsLoading(false);
        }
    }, [client.id, period]);

    useEffect(() => {
        fetchRuns();
    }, [fetchRuns]);

    const activeRuns = runs.filter((r) => !r.lockedAt);
    const mostRecent = activeRuns.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];

    const displayRuns = showAllRuns ? runs : runs.slice(0, 3);

    const pipelineSteps = [
        { key: 'attendance', icon: CalendarCheck },
        { key: 'review', icon: FileSearch },
        { key: 'finalize', icon: Lock },
        { key: 'compliance', icon: FileCheck },
    ] as const;

    return (
        <div className="space-y-6">
            {/* Pipeline Status — compact horizontal step bar */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-900">Payroll Pipeline Status</h3>
                    <span className="text-xs text-slate-400">{period}</span>
                </div>
                <div className="flex items-center">
                    {pipelineSteps.map((step, idx) => {
                        const s = (pipelineStatus as any)[step.key];
                        const Icon = step.icon;
                        const isLast = idx === pipelineSteps.length - 1;
                        return (
                            <div key={step.key} className="flex items-center flex-1">
                                <button
                                    onClick={() => onNavigateTab(step.key === 'attendance' ? 'attendance' : step.key === 'review' ? 'review' : step.key === 'finalize' ? 'review' : 'compliance')}
                                    className="flex items-center gap-2 group"
                                >
                                    <div className="flex flex-col items-center">
                                        <div className="flex items-center justify-center h-8 w-8 rounded-full border-2 bg-white transition group-hover:shadow-sm"
                                            style={{
                                                borderColor: s.status === 'completed' ? '#10b981' : s.status === 'active' ? '#f59e0b' : '#e2e8f0'
                                            }}
                                        >
                                            <Icon className="h-3.5 w-3.5" style={{
                                                color: s.status === 'completed' ? '#10b981' : s.status === 'active' ? '#f59e0b' : '#cbd5e1'
                                            }} />
                                        </div>
                                        <span className="text-[10px] font-bold uppercase tracking-wider mt-1"
                                            style={{
                                                color: s.status === 'completed' ? '#059669' : s.status === 'active' ? '#d97706' : '#94a3b8'
                                            }}
                                        >
                                            {s.label}
                                        </span>
                                    </div>
                                </button>
                                {!isLast && (
                                    <div className="flex-1 h-0.5 mx-2 rounded-full" style={{ backgroundColor: s.status === 'completed' ? '#10b981' : '#e2e8f0' }} />
                                )}
                            </div>
                        );
                    })}
                </div>
                {/* Status details row */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                    {pipelineSteps.map((step) => {
                        const s = (pipelineStatus as any)[step.key];
                        return (
                            <div key={step.key} className="text-center flex-1">
                                <span className="text-xs font-semibold"
                                    style={{
                                        color: s.status === 'completed' ? '#059669' : s.status === 'active' ? '#d97706' : '#94a3b8'
                                    }}
                                >
                                    {s.status === 'completed' ? 'Done' : s.status === 'active' ? 'In Progress' : 'Pending'}
                                </span>
                                {s.detail && <p className="text-[10px] text-slate-400 mt-0.5">{s.detail}</p>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Active Run */}
            {runsLoading ? (
                <div className="rounded-xl border border-slate-200 bg-white p-5 animate-pulse">
                    <div className="h-10 w-full rounded bg-slate-200" />
                </div>
            ) : mostRecent ? (
                <ActiveRunCard
                    clientId={String(client.id)}
                    run={mostRecent}
                    onDelete={(id) => {
                        apiFetch(`/clients/${client.id}/payroll-runs/${id}`, { method: 'DELETE' }).then(fetchRuns);
                    }}
                />
            ) : (
                <NoActiveRun onNewRun={onNewRun} />
            )}

            {/* Run History */}
            <div className="rounded-xl border border-slate-200 bg-white">
                <div className="px-4 py-4 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Payroll Run History</h3>
                    <button
                        onClick={() => setShowAllRuns((prev) => !prev)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 transition"
                    >
                        {showAllRuns ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {showAllRuns ? 'Show less' : 'Show all'}
                    </button>
                </div>
                <div className="p-2">
                    {runsLoading ? (
                        <div className="space-y-3 p-4">
                            <div className="h-8 w-full rounded bg-slate-200 animate-pulse" />
                            <div className="h-8 w-full rounded bg-slate-200 animate-pulse" />
                        </div>
                    ) : (
                        <RunHistoryTable
                            runs={displayRuns}
                            onViewRun={(runId) => {
                                onSetRunId?.(runId);
                                onNavigateTab('review');
                            }}
                            onDeleteRun={(runId) => {
                                apiFetch(`/clients/${client.id}/payroll-runs/${runId}`, { method: 'DELETE' }).then(fetchRuns);
                            }}
                            onRollbackRun={(runId) => {
                                apiFetch(`/clients/${client.id}/payroll-runs/${runId}/rollback`, { method: 'POST' }).then(fetchRuns);
                            }}
                            onNewRun={onNewRun}
                        />
                    )}
                </div>
            </div>

            {/* Quick Actions */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-bold text-slate-900 mb-3">Quick Actions</h3>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        onClick={onNewRun}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#ff0613] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#d80000]"
                    >
                        <Plus className="h-4 w-4" /> New Payroll Run
                    </button>
                </div>
            </div>
        </div>
    );
}
