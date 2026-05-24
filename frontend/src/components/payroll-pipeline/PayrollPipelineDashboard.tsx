import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ArrowLeft } from 'lucide-react';
import { apiFetch } from '../../services/api';
import type { ClientObligation } from '../../types';
import { KpiHeroCards } from './KpiHeroCards';
import { RunHistoryTable } from './RunHistoryTable';
import { ActiveRunCard, NoActiveRun } from './ActiveRunCard';

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

interface PayrollPipelineDashboardProps {
    client: ClientObligation;
    onBack: () => void;
}

export function PayrollPipelineDashboard({ client, onBack }: PayrollPipelineDashboardProps) {
    const navigate = useNavigate();
    const [runs, setRuns] = useState<PayrollRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [kpiData, setKpiData] = useState({
        totalEmployees: 0,
        totalPayroll: 0,
        activeRuns: 0,
        pendingApprovals: 0,
    });

    const fetchRuns = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs`);
            if (res.ok) {
                const data = await res.json();
                setRuns(data);

                // Compute KPIs from runs
                const totalPayroll = data.reduce((s: number, r: PayrollRun) => s + r.totalGross, 0);
                const activeRuns = data.filter((r: PayrollRun) => !r.lockedAt).length;
                setKpiData((prev) => ({
                    ...prev,
                    totalPayroll,
                    activeRuns,
                }));
            } else {
                setError('Failed to load payroll runs');
            }
        } catch {
            setError('Network error loading runs');
        } finally {
            setLoading(false);
        }
    }, [client.id]);

    const fetchEmployees = useCallback(async () => {
        try {
            const res = await apiFetch(`/clients/${client.id}/employees`);
            if (res.ok) {
                const data = await res.json();
                const active = data.filter((e: any) => e.employmentStatus === 'Active');
                setKpiData((prev) => ({
                    ...prev,
                    totalEmployees: active.length,
                }));
            }
        } catch {
            // ignore
        }
    }, [client.id]);

    useEffect(() => {
        fetchRuns();
        fetchEmployees();
    }, [fetchRuns, fetchEmployees]);

    const handleNewRun = () => {
        navigate(`/dashboard/client/${client.id}/payroll/new`);
    };

    const handleViewRun = (runId: number) => {
        navigate(`/dashboard/client/${client.id}/payroll/run/${runId}`);
    };

    const handleDeleteRun = async (runId: number) => {
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                fetchRuns();
            }
        } catch {
            // ignore
        }
    };

    const handleRollbackRun = async (runId: number) => {
        if (!window.confirm('Rollback this finalized payroll run? All loan transactions will be reversed.')) return;
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs/${runId}/rollback`, {
                method: 'POST',
            });
            if (res.ok) {
                fetchRuns();
            }
        } catch {
            // ignore
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900">Payroll Pipeline</h2>
                        <p className="text-sm text-slate-500">{client.name}</p>
                    </div>
                </div>
                <button
                    onClick={handleNewRun}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#ff0613] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#d80000]"
                >
                    <Plus className="h-4 w-4" /> New Payroll Run
                </button>
            </div>

            {/* KPI Cards */}
            <KpiHeroCards data={kpiData} />

            {/* Active Run */}
            {loading ? (
                <div className="rounded-xl border border-slate-200 bg-white p-5 animate-pulse">
                    <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-lg bg-slate-200" />
                        <div className="space-y-2 flex-1">
                            <div className="h-4 w-32 rounded bg-slate-200" />
                            <div className="h-3 w-48 rounded bg-slate-200" />
                        </div>
                        <div className="h-9 w-24 rounded-lg bg-slate-200" />
                    </div>
                </div>
            ) : (
                (() => {
                    const activeRuns = runs.filter((r) => !r.lockedAt);
                    const mostRecent = activeRuns.sort(
                        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    )[0];
                    return mostRecent ? (
                        <ActiveRunCard
                            clientId={String(client.id)}
                            run={mostRecent}
                            onDelete={handleDeleteRun}
                        />
                    ) : (
                        <NoActiveRun onNewRun={handleNewRun} />
                    );
                })()
            )}

            {/* Error */}
            {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {/* Run History */}
            <div className="rounded-xl border border-slate-200 bg-white">
                <div className="px-4 py-4 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                        Payroll Run History
                    </h3>
                </div>
                <div className="p-2">
                    {loading ? (
                        <div className="space-y-3 p-4">
                            <div className="h-8 w-full rounded bg-slate-200 animate-pulse" />
                            <div className="h-8 w-full rounded bg-slate-200 animate-pulse" />
                            <div className="h-8 w-full rounded bg-slate-200 animate-pulse" />
                            <div className="h-8 w-full rounded bg-slate-200 animate-pulse" />
                        </div>
                    ) : (
                        <RunHistoryTable
                            runs={runs}
                            onViewRun={handleViewRun}
                            onDeleteRun={handleDeleteRun}
                            onRollbackRun={handleRollbackRun}
                            onNewRun={handleNewRun}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
