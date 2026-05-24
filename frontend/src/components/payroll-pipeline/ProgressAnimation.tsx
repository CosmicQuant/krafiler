import { Check, Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface ProgressStep {
    id: string;
    label: string;
    done: boolean;
    progress?: number;
    total?: number;
}

interface ProgressAnimationProps {
    steps: ProgressStep[];
    overallPercent: number;
    className?: string;
}

export function ProgressAnimation({ steps, overallPercent, className }: ProgressAnimationProps) {
    return (
        <div className={cn('space-y-4', className)}>
            {/* Overall progress bar */}
            <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">Overall Progress</span>
                    <span className="font-bold text-slate-900">{Math.round(overallPercent)}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out"
                        style={{ width: `${overallPercent}%` }}
                    />
                </div>
            </div>

            {/* Step list */}
            <div className="space-y-2">
                {steps.map((step, index) => (
                    <div
                        key={step.id}
                        className={cn(
                            'flex items-center gap-3 rounded-lg border px-3 py-2 text-xs transition-all',
                            step.done
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : index === steps.findIndex((s) => !s.done)
                                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                                    : 'border-slate-200 bg-slate-50 text-slate-400'
                        )}
                    >
                        <div className="shrink-0">
                            {step.done ? (
                                <Check className="h-4 w-4 text-emerald-600" />
                            ) : index === steps.findIndex((s) => !s.done) ? (
                                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                            ) : (
                                <div className="h-4 w-4 rounded-full border border-slate-300" />
                            )}
                        </div>
                        <div className="flex-1">
                            <span className="font-medium">{step.label}</span>
                            {step.progress !== undefined && step.total !== undefined && !step.done && (
                                <span className="ml-2 text-[10px] opacity-70">
                                    ({step.progress}/{step.total})
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
