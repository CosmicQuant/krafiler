import { Check, Loader2, AlertTriangle, Lock, FileCheck } from 'lucide-react';
import { cn } from '../../utils/cn';

export type RunStatus =
    | 'draft'
    | 'generated'
    | 'adjusting'
    | 'readyForReview'
    | 'finalized'
    | 'rollingBack'
    | 'compliant';

interface SubStep {
    label: string;
    done: boolean;
    progress?: number;
    total?: number;
}

interface StepStatusBadgeProps {
    status: RunStatus;
    subSteps?: SubStep[];
    className?: string;
}

const statusConfig: Record<RunStatus, { label: string; color: string; icon: typeof Check }> = {
    draft: { label: 'Draft', color: 'bg-slate-100 text-slate-600 border-slate-200', icon: Check },
    generated: { label: 'Generated', color: 'bg-blue-50 text-blue-600 border-blue-200', icon: Loader2 },
    adjusting: { label: 'Adjusting', color: 'bg-amber-50 text-amber-600 border-amber-200', icon: Loader2 },
    readyForReview: { label: 'Review', color: 'bg-indigo-50 text-indigo-600 border-indigo-200', icon: AlertTriangle },
    finalized: { label: 'Finalized', color: 'bg-emerald-50 text-emerald-600 border-emerald-200', icon: Lock },
    rollingBack: { label: 'Rolling Back', color: 'bg-orange-50 text-orange-600 border-orange-200', icon: Loader2 },
    compliant: { label: 'Compliant', color: 'bg-emerald-50 text-emerald-600 border-emerald-200', icon: FileCheck },
};

export function StepStatusBadge({ status, subSteps, className }: StepStatusBadgeProps) {
    const config = statusConfig[status];
    const Icon = config.icon;

    return (
        <div className={cn('flex flex-col gap-1', className)}>
            <span
                className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold w-fit',
                    config.color
                )}
            >
                {status === 'generated' || status === 'adjusting' || status === 'rollingBack' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                    <Icon className="h-3 w-3" />
                )}
                {config.label}
            </span>

            {subSteps && subSteps.length > 0 && (
                <div className="pl-1 mt-1 space-y-1">
                    {subSteps.map((step, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px] text-slate-500">
                            <div
                                className={cn(
                                    'w-1.5 h-1.5 rounded-full',
                                    step.done ? 'bg-emerald-400' : 'bg-slate-300'
                                )}
                            />
                            <span className={step.done ? 'text-emerald-600' : ''}>
                                {step.label}
                                {step.progress !== undefined && step.total !== undefined &&
                                    !step.done &&
                                    ` (${step.progress}/${step.total})`}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
