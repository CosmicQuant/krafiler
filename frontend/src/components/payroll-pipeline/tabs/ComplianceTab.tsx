import { useState, useEffect, useCallback } from 'react';
import { Lock, ArrowRight, AlertCircle } from 'lucide-react';
import { Step7ComplianceOutput } from '../steps/Step7ComplianceOutput';
import { Step6Finalize } from '../steps/Step6Finalize';
import { apiFetch } from '../../../services/api';
import type { ClientObligation } from '../../../types';

interface ComplianceTabProps {
    client: ClientObligation;
    period: string;
    runId?: number;
    onNavigateTab?: (tab: string) => void;
}

interface PayrollRun {
    id: number;
    period: string;
    lockedAt: string | null;
    status: string;
}

export function ComplianceTab({ client, period, runId, onNavigateTab }: ComplianceTabProps) {
    const [runs, setRuns] = useState<PayrollRun[]>([]);
    const [_loading, setLoading] = useState(true);

    const fetchRuns = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetch(`/clients/${client.id}/payroll-runs`);
            if (res.ok) {
                const data = await res.json();
                setRuns(data);
            }
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, [client.id]);

    useEffect(() => {
        fetchRuns();
    }, [fetchRuns]);

    const currentRun = runs.find((r) => r.period === period) || (runId ? runs.find((r) => r.id === runId) : undefined);

    // If no run for period, prompt to go to Review
    if (!currentRun) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 mb-3">
                    <AlertCircle className="h-6 w-6 text-amber-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">No Payroll Run</h3>
                <p className="text-sm text-slate-500 mt-1 max-w-md">
                    Generate a payroll run for {period} in the Review tab first.
                </p>
                <button
                    onClick={() => onNavigateTab?.('review')}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#ff0613] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#d80000]"
                >
                    Go to Review <ArrowRight className="h-4 w-4" />
                </button>
            </div>
        );
    }

    // If run exists but not finalized, show "Finalize First" CTA
    if (!currentRun.lockedAt) {
        return (
            <div className="space-y-6">
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50/50 py-12 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 mb-3">
                        <Lock className="h-6 w-6 text-amber-600" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">Finalize Required</h3>
                    <p className="text-sm text-slate-500 mt-1 max-w-md">
                        The payroll run for <strong>{period}</strong> must be finalized before compliance files can be generated.
                    </p>
                    <button
                        onClick={() => onNavigateTab?.('review')}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#ff0613] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#d80000]"
                    >
                        Go to Review to Finalize <ArrowRight className="h-4 w-4" />
                    </button>
                </div>

                {/* Still show finalize component inline for convenience */}
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <h3 className="text-sm font-bold text-slate-900 mb-4">Finalize Run</h3>
                    <Step6Finalize
                        clientId={client.id}
                        runId={currentRun.id}
                        onContinue={() => fetchRuns()}
                    />
                </div>
            </div>
        );
    }

    return (
        <Step7ComplianceOutput
            clientId={client.id}
            runId={currentRun.id}
            period={period}
        />
    );
}
