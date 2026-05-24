import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';

export type PipelineStep = {
    id: number;
    label: string;
    shortLabel: string;
};

const STEPS: PipelineStep[] = [
    { id: 1, label: 'Setup & Attendance', shortLabel: 'Setup' },
    { id: 2, label: 'Review & Generate', shortLabel: 'Review' },
    { id: 3, label: 'Finalize', shortLabel: 'Fin' },
    { id: 4, label: 'Compliance', shortLabel: 'Com' },
];

interface StepIndicatorProps {
    currentStep: number;
    completedSteps: number[];
    onStepClick?: (step: number) => void;
    className?: string;
}

export function StepIndicator({ currentStep, completedSteps, onStepClick, className }: StepIndicatorProps) {
    const isCompleted = (step: number) => completedSteps.includes(step);
    const isActive = (step: number) => step === currentStep;
    const isFuture = (step: number) => step > currentStep && !isCompleted(step);
    const isClickable = (step: number) => isCompleted(step) || step === currentStep;

    return (
        <div className={cn('w-full', className)}>
            {/* Desktop: horizontal stepper with labels */}
            <div className="hidden md:flex items-center justify-between w-full">
                {STEPS.map((step, index) => (
                    <div key={step.id} className="flex items-center flex-1">
                        {/* Step circle + label */}
                        <div className="flex flex-col items-center">
                            <button
                                type="button"
                                onClick={() => isClickable(step.id) && onStepClick?.(step.id)}
                                disabled={!isClickable(step.id)}
                                className={cn(
                                    'w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-200 border-2',
                                    isCompleted(step.id) && 'bg-emerald-500 border-emerald-500 text-white',
                                    isActive(step.id) && 'bg-[#ff0613] border-[#ff0613] text-white shadow-lg ring-4 ring-red-100',
                                    isFuture(step.id) && 'bg-white border-slate-300 text-slate-400',
                                    isClickable(step.id) && 'cursor-pointer hover:scale-105',
                                    !isClickable(step.id) && 'cursor-not-allowed opacity-60'
                                )}
                                aria-current={isActive(step.id) ? 'step' : undefined}
                            >
                                {isCompleted(step.id) ? (
                                    <Check className="h-5 w-5" />
                                ) : (
                                    step.id
                                )}
                            </button>
                            <span
                                className={cn(
                                    'mt-2 text-xs font-semibold text-center whitespace-nowrap',
                                    isActive(step.id) && 'text-[#ff0613]',
                                    isCompleted(step.id) && 'text-emerald-600',
                                    isFuture(step.id) && 'text-slate-400'
                                )}
                            >
                                {step.label}
                            </span>
                        </div>

                        {/* Connector line */}
                        {index < STEPS.length - 1 && (
                            <div className="flex-1 mx-2 h-0.5 bg-slate-200 relative">
                                <div
                                    className={cn(
                                        'absolute top-0 left-0 h-full transition-all duration-500',
                                        isCompleted(step.id) ? 'bg-emerald-400 w-full' : 'w-0'
                                    )}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Mobile: compact stepper */}
            <div className="flex md:hidden items-center justify-center gap-2">
                <span className="text-sm font-bold text-slate-700">
                    Step {currentStep} of {STEPS.length}
                </span>
                <div className="flex gap-1">
                    {STEPS.map((step) => (
                        <button
                            key={step.id}
                            type="button"
                            onClick={() => isClickable(step.id) && onStepClick?.(step.id)}
                            disabled={!isClickable(step.id)}
                            className={cn(
                                'w-2.5 h-2.5 rounded-full transition-all',
                                isCompleted(step.id) && 'bg-emerald-500',
                                isActive(step.id) && 'bg-[#ff0613] w-6',
                                isFuture(step.id) && 'bg-slate-300',
                                isClickable(step.id) && 'cursor-pointer'
                            )}
                            aria-current={isActive(step.id) ? 'step' : undefined}
                        />
                    ))}
                </div>
            </div>

            {/* Mobile step label */}
            <div className="md:hidden text-center mt-2">
                <span className="text-xs font-medium text-slate-500">
                    {STEPS.find((s) => s.id === currentStep)?.label}
                </span>
            </div>
        </div>
    );
}
