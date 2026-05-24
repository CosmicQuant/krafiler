import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, AlertCircle } from 'lucide-react';
import type { ClientObligation } from '../../types';
import { StepIndicator } from './StepIndicator';
import { cn } from '../../utils/cn';
import { apiFetch } from '../../services/api';

import { Step1Setup } from './steps/Step1Setup';
import { Step5ReviewPreview } from './steps/Step5ReviewPreview';
import { Step6Finalize } from './steps/Step6Finalize';
import { Step7ComplianceOutput } from './steps/Step7ComplianceOutput';

interface PipelineWizardProps {
    client: ClientObligation;
    onBack: () => void;
}

export function PipelineWizard({ client, onBack }: PipelineWizardProps) {
    const { runId } = useParams<{ runId: string }>();

    const [currentStep, setCurrentStep] = useState(1);
    const [completedSteps, setCompletedSteps] = useState<number[]>([]);
    const [currentRunId, setCurrentRunId] = useState<number | null>(null);
    const [step1Valid, setStep1Valid] = useState(false);

    // Resume existing run when runId is present in URL
    useEffect(() => {
        if (!runId || runId === 'new') return;
        const parsedRunId = parseInt(runId, 10);
        if (isNaN(parsedRunId)) return;

        let mounted = true;
        (async () => {
            try {
                const res = await apiFetch(`/clients/${client.id}/payroll-runs`);
                if (!res.ok || !mounted) return;
                const runs = await res.json();
                const run = runs.find((r: any) => r.id === parsedRunId);
                if (!run || !mounted) return;

                setCurrentRunId(parsedRunId);

                let targetStep = 2;
                let completed: number[] = [1];

                if (run.lockedAt) {
                    targetStep = 3;
                    completed = [1, 2];
                } else if (run.status === 'completed' || run.status === 'draft') {
                    targetStep = 2;
                    completed = [1];
                }

                if (mounted) {
                    setCompletedSteps(completed);
                    setCurrentStep(targetStep);
                }
            } catch {
                // ignore
            }
        })();
        return () => { mounted = false; };
    }, [runId, client.id]);

    const handleNext = () => {
        if (currentStep < 4) {
            setCompletedSteps((prev) => [...new Set([...prev, currentStep])]);
            setCurrentStep((prev) => prev + 1);
        }
    };

    const handlePrevious = () => {
        if (currentStep > 1) {
            setCurrentStep((prev) => prev - 1);
        }
    };

    const handleStepClick = (step: number) => {
        if (completedSteps.includes(step) || step === currentStep) {
            setCurrentStep(step);
        }
    };

    const renderStepContent = () => {
        switch (currentStep) {
            case 1:
                return <Step1Setup client={client} onValidationChange={setStep1Valid} />;
            case 2:
                return (
                    <Step5ReviewPreview
                        clientId={client.id}
                        runId={currentRunId ?? undefined}
                        onRunCreated={(id) => {
                            setCurrentRunId(id);
                        }}
                    />
                );
            case 3:
                return currentRunId ? (
                    <Step6Finalize
                        clientId={client.id}
                        runId={currentRunId}
                        onContinue={() => setCurrentStep(4)}
                        onBack={onBack}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 mb-3">
                            <AlertCircle className="h-6 w-6 text-amber-400" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">Run Required</h3>
                        <p className="text-sm text-slate-500 mt-1 max-w-md">
                            Please generate a payroll run in Step 2 to finalize.
                        </p>
                    </div>
                );
            case 4:
                return currentRunId ? (
                    <Step7ComplianceOutput clientId={client.id} runId={currentRunId} />
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 mb-3">
                            <AlertCircle className="h-6 w-6 text-amber-400" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">Run Required</h3>
                        <p className="text-sm text-slate-500 mt-1 max-w-md">
                            Please generate a payroll run in Step 2 to generate compliance output.
                        </p>
                    </div>
                );
            default:
                return (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 mb-3">
                            <span className="text-lg font-bold text-slate-400">{currentStep}</span>
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">Step {currentStep}</h3>
                        <p className="text-sm text-slate-500 mt-1 max-w-md">
                            This step will be implemented in the next phase.
                        </p>
                    </div>
                );
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
                        <h2 className="text-2xl font-bold text-slate-900">
                            {runId === 'new' ? 'New Payroll Run' : 'Payroll Run'}
                        </h2>
                        <p className="text-sm text-slate-500">{client.name}</p>
                    </div>
                </div>
            </div>

            {/* Step Indicator */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6">
                <StepIndicator
                    currentStep={currentStep}
                    completedSteps={completedSteps}
                    onStepClick={handleStepClick}
                />
            </div>

            {/* Step Content */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 min-h-[400px]">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={currentStep}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.2 }}
                    >
                        {renderStepContent()}
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* Navigation Buttons */}
            <div className="space-y-2">
                {currentStep === 1 && !step1Valid && (
                    <p className="text-xs text-amber-600 text-right">
                        At least 1 active employee with basic pay &gt; 0 is required, and attendance must be approved
                    </p>
                )}
                <div className="flex items-center justify-between">
                    <button
                        onClick={handlePrevious}
                        disabled={currentStep === 1}
                        className={cn(
                            'inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold transition',
                            currentStep === 1
                                ? 'opacity-40 cursor-not-allowed text-slate-400'
                                : 'text-slate-700 hover:bg-slate-50'
                        )}
                    >
                        <ArrowLeft className="h-4 w-4" /> Previous
                    </button>

                    <button
                        onClick={currentStep === 4 ? onBack : handleNext}
                        disabled={
                            currentStep !== 4 &&
                            (currentStep === 1 && !step1Valid)
                        }
                        className={cn(
                            'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition',
                            currentStep !== 4 && (currentStep === 1 && !step1Valid)
                                ? 'bg-slate-300 cursor-not-allowed'
                                : 'bg-[#ff0613] hover:bg-[#d80000]'
                        )}
                    >
                        {currentStep === 4
                            ? 'Back to Dashboard'
                            : currentStep === 3
                              ? 'Continue to Compliance'
                              : 'Next'}
                        {currentStep !== 4 && <ArrowRight className="h-4 w-4" />}
                    </button>
                </div>
            </div>
        </div>
    );
}
