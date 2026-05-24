import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { getCurrentFilingPeriod } from '../../../utils/taxPeriods';
import { ProgressAnimation, type ProgressStep } from '../ProgressAnimation';

interface Step3RunGenerationProps {
    clientId: string;
    onGenerated?: (runId: number) => void;
}

export function Step3RunGeneration({ clientId, onGenerated }: Step3RunGenerationProps) {
    const [period, setPeriod] = useState(getCurrentFilingPeriod().period);
    const [notes, setNotes] = useState('');
    const [generating, setGenerating] = useState(false);
    const [runId, setRunId] = useState<number | null>(null);
    const [overallPercent, setOverallPercent] = useState(0);
    const [steps, setSteps] = useState<ProgressStep[]>([]);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const generationSteps: ProgressStep[] = [
        { id: 'creating', label: 'Creating payroll run', done: false },
        { id: 'employees', label: 'Fetching employees', done: false, progress: 0, total: 1 },
        { id: 'benefits', label: 'Computing benefits', done: false },
        { id: 'sha', label: 'Computing SHA', done: false, progress: 0, total: 1 },
        { id: 'nssf', label: 'Computing NSSF', done: false, progress: 0, total: 1 },
        { id: 'ahl', label: 'Computing AHL', done: false, progress: 0, total: 1 },
        { id: 'loans', label: 'Applying loan deductions', done: false, progress: 0, total: 1 },
        { id: 'paye', label: 'Computing PAYE', done: false, progress: 0, total: 1 },
        { id: 'done', label: 'Done — entries generated', done: false },
    ];

    const startGeneration = async () => {
        setGenerating(true);
        setError(null);
        setMessage(null);
        setSteps(generationSteps.map((s) => ({ ...s })));
        setOverallPercent(0);

        try {
            // Check if a run already exists for this period
            const existingRes = await apiFetch(`/clients/${clientId}/payroll-runs`);
            let existingRunId: number | null = null;
            if (existingRes.ok) {
                const runs = await existingRes.json();
                const existing = runs.find((r: any) => r.period === period);
                if (existing) {
                    existingRunId = existing.id;
                }
            }

            let newRunId: number;

            if (existingRunId) {
                // Regenerate existing run
                const res = await apiFetch(`/clients/${clientId}/payroll-runs/${existingRunId}/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prorate: true }),
                });
                if (!res.ok) throw new Error('Failed to regenerate run');
                newRunId = existingRunId;
            } else {
                // Create new run
                const res = await apiFetch(`/clients/${clientId}/payroll-runs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ period, notes, prorate: true }),
                });
                if (!res.ok) throw new Error('Failed to create run');
                const data = await res.json();
                newRunId = data.run.id;
            }

            setRunId(newRunId);
            simulateProgress(newRunId);
        } catch (err: any) {
            setError(err.message || 'Failed to start generation');
            setGenerating(false);
        }
    };

    const simulateProgress = useCallback(
        (targetRunId: number) => {
            let stepIndex = 0;
            const totalSteps = generationSteps.length;

            // Update steps visually with simulated progress
            const interval = setInterval(() => {
                setSteps((prev) => {
                    const updated = [...prev];
                    if (stepIndex < updated.length) {
                        updated[stepIndex] = { ...updated[stepIndex], done: true };
                    }
                    return updated;
                });
                setOverallPercent(Math.round(((stepIndex + 1) / totalSteps) * 100));
                stepIndex++;

                if (stepIndex >= totalSteps) {
                    clearInterval(interval);
                    // Poll backend to confirm completion
                    pollForCompletion(targetRunId);
                }
            }, 400); // 400ms per step = ~3.6s total
        },
        []
    );

    const pollForCompletion = useCallback(
        (targetRunId: number) => {
            let attempts = 0;
            const maxAttempts = 30; // 30 seconds

            pollIntervalRef.current = setInterval(async () => {
                attempts++;
                try {
                    const res = await apiFetch(`/clients/${clientId}/payroll-runs/${targetRunId}/entries`);
                    if (res.ok) {
                        const entries = await res.json();
                        if (entries.length > 0) {
                            // Generation complete
                            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                            setSteps((prev) =>
                                prev.map((s, i) => (i === prev.length - 1 ? { ...s, done: true } : s))
                            );
                            setOverallPercent(100);
                            setMessage(`Payroll run generated successfully with ${entries.length} entries.`);
                            setGenerating(false);
                            onGenerated?.(targetRunId);
                            return;
                        }
                    }
                } catch {
                    // ignore poll errors
                }

                if (attempts >= maxAttempts) {
                    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                    setError('Generation is taking longer than expected. Please check the run status.');
                    setGenerating(false);
                }
            }, 1000);
        },
        [clientId, onGenerated]
    );

    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        };
    }, []);

    return (
        <div className="space-y-6">
            {!generating && !message ? (
                <>
                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-slate-900">Generate Payroll Run</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    Period
                                </label>
                                <input
                                    type="month"
                                    value={period}
                                    onChange={(e) => setPeriod(e.target.value)}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    Notes (optional)
                                </label>
                                <input
                                    type="text"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="e.g. November 2024 payroll"
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                />
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
                            <AlertCircle className="h-4 w-4" /> {error}
                        </div>
                    )}

                    <button
                        onClick={startGeneration}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#ff0613] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#d80000] transition"
                    >
                        <Play className="h-4 w-4" /> Generate Payroll Run
                    </button>
                </>
            ) : message ? (
                <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">Payroll Run Generated</h3>
                    <p className="text-sm text-slate-500">{message}</p>
                    <p className="text-xs text-slate-400">Run ID: {runId}</p>
                </div>
            ) : (
                <ProgressAnimation steps={steps} overallPercent={overallPercent} />
            )}
        </div>
    );
}
