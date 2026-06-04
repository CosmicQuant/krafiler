import { useState, useEffect } from 'react';
import { Play, CheckCircle2, AlertCircle } from 'lucide-react';
import { Step5ReviewPreview } from '../steps/Step5ReviewPreview';
import { apiFetch } from '../../../services/api';
import type { ClientObligation } from '../../../types';

interface ReviewTabProps {
    client: ClientObligation;
    period: string;
    runId?: number;
    onRunCreated?: (runId: number) => void;
}

export function ReviewTab({ client, period, runId, onRunCreated }: ReviewTabProps) {
    const [effectiveRunId, setEffectiveRunId] = useState<number | null>(runId ?? null);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [genMessage, setGenMessage] = useState<string | null>(null);

    useEffect(() => {
        if (runId) setEffectiveRunId(runId);
    }, [runId]);

    const handleGenerate = async () => {
        setGenerating(true);
        setError(null);
        setGenMessage(null);
        try {
            const runsRes = await apiFetch(`/clients/${client.id}/payroll-runs`);
            let existingRunId: number | null = null;
            if (runsRes.ok) {
                const runs = await runsRes.json();
                const existing = runs.find((r: any) => r.period === period);
                if (existing) existingRunId = existing.id;
            }

            let newRunId: number;
            if (existingRunId) {
                const genRes = await apiFetch(`/clients/${client.id}/payroll-runs/${existingRunId}/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prorate: true }),
                });
                if (!genRes.ok) {
                    const errData = await genRes.json().catch(() => ({}));
                    throw new Error(errData.detail || errData.message || 'Failed to regenerate entries');
                }
                newRunId = existingRunId;
            } else {
                const createRes = await apiFetch(`/clients/${client.id}/payroll-runs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ period, notes: '', prorate: true }),
                });
                if (!createRes.ok) {
                    const errData = await createRes.json().catch(() => ({}));
                    throw new Error(errData.detail || errData.message || 'Failed to create run');
                }
                const data = await createRes.json();
                newRunId = data.run.id;
            }

            setEffectiveRunId(newRunId);
            onRunCreated?.(newRunId);
            setGenMessage('Payroll run generated successfully.');
        } catch (err: any) {
            setError(err.message || 'Failed to generate payroll run');
        } finally {
            setGenerating(false);
        }
    };

    // If no run exists, show manual generate UI (do NOT auto-generate in tab mode)
    if (!effectiveRunId) {
        return (
            <div className="space-y-6">
                {error && (
                    <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        <AlertCircle className="h-4 w-4" /> {error}
                    </div>
                )}
                {genMessage && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" /> {genMessage}
                    </div>
                )}
                <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900">Generate Payroll Run</h3>
                    <p className="text-xs text-slate-500">
                        No payroll run exists for <strong>{period}</strong>. Generate one to review and edit entries.
                    </p>
                    <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#ff0613] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#d80000] transition disabled:opacity-40"
                    >
                        {generating ? (
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        ) : (
                            <Play className="h-4 w-4" />
                        )}
                        Generate Payroll Run
                    </button>
                </div>
            </div>
        );
    }

    return (
        <Step5ReviewPreview
            clientId={client.id}
            runId={effectiveRunId}
            period={period}
            autoGenerate={false}
            onRunCreated={(id) => {
                setEffectiveRunId(id);
                onRunCreated?.(id);
            }}
        />
    );
}
