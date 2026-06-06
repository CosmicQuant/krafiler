import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../../../services/api';
import { getCurrentFilingPeriod } from '../../../utils/taxPeriods';
import { RunHeader } from './RunHeader';
import { PayRegisterTable } from './PayRegisterTable';
import { PayrollDetailDrawer } from './PayrollDetailDrawer';
import { ComplianceTabs } from './ComplianceTabs';
import { RightSidebar } from './RightSidebar';
import { EmployeeEditModal, type Employee } from '../steps/EmployeeEditModal';
import type { ClientObligation } from '../../../types';

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

interface PayrollRunDetailPageProps {
    client: ClientObligation;
}

type RunStatus = 'draft' | 'approved' | 'finalized' | 'filed';

function deriveRunStatus(run: PayrollRun | null): RunStatus {
    if (!run) return 'draft';
    if (run.status === 'filed') return 'filed';
    if (run.lockedAt) return 'finalized';
    if (run.status === 'completed' || run.totalEmployees > 0) return 'approved';
    return 'draft';
}

export function PayrollRunDetailPage({ client }: PayrollRunDetailPageProps) {
    const { runId: urlRunId } = useParams<{ runId: string }>();
    const [period, setPeriod] = useState(getCurrentFilingPeriod().period);
    const [runs, setRuns] = useState<PayrollRun[]>([]);
    const [currentRun, setCurrentRun] = useState<PayrollRun | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshToken, setRefreshToken] = useState(0);
    const [selectedEntry, setSelectedEntry] = useState<any>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [entries, setEntries] = useState<any[]>([]);

    const fetchRuns = useCallback(async () => {
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs`);
            if (res.ok) {
                const data = await res.json();
                setRuns(data);
                return data;
            }
        } catch {
            setError('Failed to load payroll runs');
        }
        return [];
    }, [client.id]);

    useEffect(() => {
        setLoading(true);
        fetchRuns().then((data) => {
            const runsList: PayrollRun[] = data || [];
            let target = runsList.find((r: PayrollRun) => r.period === period);
            if (!target && urlRunId && urlRunId !== 'new') {
                const parsed = parseInt(urlRunId, 10);
                target = runsList.find((r: PayrollRun) => r.id === parsed);
            }
            if (!target && runsList.length > 0) {
                target = runsList.sort((a: PayrollRun, b: PayrollRun) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                )[0];
            }
            setCurrentRun(target || null);
            setLoading(false);
        });
    }, [fetchRuns, period, urlRunId, refreshToken]);

    const runStatus = deriveRunStatus(currentRun);

    const fetchEntries = useCallback(async () => {
        if (!currentRun?.id) {
            setEntries([]);
            return;
        }
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs/${currentRun.id}/entries`);
            if (res.ok) {
                setEntries(await res.json());
            }
        } catch { /* ignore */ }
    }, [client.id, currentRun?.id]);

    useEffect(() => {
        fetchEntries();
    }, [fetchEntries]);

    const handleCreateRun = async () => {
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ period, notes: '', prorate: true }),
            });
            if (res.ok) {
                const data = await res.json();
                setCurrentRun(data.run);
                setRefreshToken((t) => t + 1);
            } else {
                const err = await res.json().catch(() => ({}));
                setError(err.message || 'Failed to create run');
            }
        } catch {
            setError('Network error creating run');
        }
    };

    const handleGenerateEntries = async () => {
        if (!currentRun) return;
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs/${currentRun.id}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prorate: true }),
            });
            if (res.ok) {
                setRefreshToken((t) => t + 1);
            } else {
                const err = await res.json().catch(() => ({}));
                setError(err.message || 'Failed to generate entries');
            }
        } catch {
            setError('Network error generating entries');
        }
    };

    const handleFinalize = async () => {
        if (!currentRun) return;
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs/${currentRun.id}/finalize`, {
                method: 'POST',
            });
            if (res.ok) {
                try {
                    await apiFetch(`/clients/${client.id}/payroll-runs/${currentRun.id}/generate-compliance`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ generatePaye: true, generateNssf: true, generateSha: true }),
                    });
                } catch {
                    // Non-blocking
                }
                setRefreshToken((t) => t + 1);
            } else {
                const err = await res.json().catch(() => ({}));
                setError(err.message || 'Failed to finalize');
            }
        } catch {
            setError('Network error finalizing');
        }
    };

    const handleRollback = async () => {
        if (!currentRun) return;
        if (!window.confirm('Rollback this finalized payroll run?')) return;
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs/${currentRun.id}/rollback`, {
                method: 'POST',
            });
            if (res.ok) {
                setRefreshToken((t) => t + 1);
            } else {
                const err = await res.json().catch(() => ({}));
                setError(err.message || 'Failed to rollback');
            }
        } catch {
            setError('Network error rolling back');
        }
    };

    const handleDelete = async () => {
        if (!currentRun) return;
        if (!window.confirm('Delete this payroll run? This cannot be undone.')) return;
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs/${currentRun.id}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                setCurrentRun(null);
                setRefreshToken((t) => t + 1);
            } else {
                const err = await res.json().catch(() => ({}));
                setError(err.message || 'Failed to delete run');
            }
        } catch {
            setError('Network error deleting run');
        }
    };

    const handleSelectEntry = (entry: any) => {
        setSelectedEntry(entry);
        setDrawerOpen(true);
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <RunHeader
                client={client}
                period={period}
                onChangePeriod={setPeriod}
                currentRun={currentRun}
                runStatus={runStatus}
                runs={runs}
                onSelectRun={setCurrentRun}
                onCreateRun={handleCreateRun}
                onGenerateEntries={handleGenerateEntries}
                onFinalize={handleFinalize}
                onRollback={handleRollback}
                onDelete={handleDelete}
                loading={loading}
                error={error}
                onClearError={() => setError(null)}
            />

            {/* Main layout: Pay Register + Compliance left, Loans/Leaves sticky right */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
                <div className="xl:col-span-2 space-y-4">
                    <PayRegisterTable
                        clientId={client.id}
                        runId={currentRun?.id}
                        period={period}
                        onSelectEntry={handleSelectEntry}
                        onRefresh={() => setRefreshToken((t) => t + 1)}
                        onAddEmployee={() => { setEditingEmployee(null); setEmployeeModalOpen(true); }}
                    />
                    <ComplianceTabs
                        client={client}
                        runId={currentRun?.id}
                        period={period}
                        runStatus={runStatus}
                        entries={entries}
                        onRefresh={() => setRefreshToken((t) => t + 1)}
                    />
                </div>
                <div className="sticky top-4 self-start">
                    <RightSidebar
                        clientId={client.id}
                        period={period}
                        onRefresh={() => setRefreshToken((t) => t + 1)}
                    />
                </div>
            </div>

            {/* Detail Drawer */}
            {drawerOpen && selectedEntry && (
                <PayrollDetailDrawer
                    entry={selectedEntry}
                    clientId={client.id}
                    runId={currentRun?.id}
                    period={period}
                    onClose={() => { setDrawerOpen(false); setSelectedEntry(null); }}
                    onSaved={() => setRefreshToken((t) => t + 1)}
                />
            )}

            {/* Add/Edit Employee Modal */}
            <EmployeeEditModal
                clientId={client.id}
                employee={editingEmployee}
                open={employeeModalOpen}
                onClose={() => setEmployeeModalOpen(false)}
                onSaved={() => {
                    setEmployeeModalOpen(false);
                    setEditingEmployee(null);
                    setRefreshToken((t) => t + 1);
                }}
            />
        </div>
    );
}
