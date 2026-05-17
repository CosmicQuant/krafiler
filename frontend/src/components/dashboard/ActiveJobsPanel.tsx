/**
 * ActiveJobsPanel.tsx
 *
 * Displays all active/queued jobs in a modern panel.
 * Used in dashboard views (Desk9th, Desk20th, etc.)
 */

import { useState } from 'react';
import {
    Activity,
    ChevronDown,
    ChevronUp,
    Zap,
} from 'lucide-react';
import JobTracker, { JobTrackerProps } from './JobTracker';

interface ActiveJobsPanelProps {
    jobs: JobTrackerProps[];
    title?: string;
    onCancelJob?: (jobId: string) => void;
    onRetryJob?: (jobId: string) => void;
}

export default function ActiveJobsPanel({
    jobs,
    title = 'Active Jobs',
    onCancelJob,
    onRetryJob,
}: ActiveJobsPanelProps) {
    const [collapsed, setCollapsed] = useState(false);

    const activeCount = jobs.filter(j =>
        j.status === 'queued' || j.status === 'preparing' || j.status === 'processing'
    ).length;

    const completedCount = jobs.filter(j => j.status === 'completed').length;
    const failedCount = jobs.filter(j => j.status === 'failed').length;

    if (jobs.length === 0) return null;

    return (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            {/* Panel Header */}
            <div
                className="flex items-center justify-between px-5 py-4 border-b border-slate-200 cursor-pointer hover:bg-slate-50 transition"
                onClick={() => setCollapsed(!collapsed)}
            >
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-[#ff0613]">
                        <Activity className="h-5 w-5" />
                    </div>
                    <div>
                        <div className="text-sm font-bold text-slate-900">{title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                            {activeCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-[#ff0613]">
                                    <Zap className="h-3 w-3" />
                                    {activeCount} active
                                </span>
                            )}
                            {completedCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                                    {completedCount} done
                                </span>
                            )}
                            {failedCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">
                                    {failedCount} failed
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {activeCount > 0 && (
                        <span className="flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-[#ff0613] opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ff0613]" />
                        </span>
                    )}
                    {collapsed ? (
                        <ChevronDown className="h-5 w-5 text-slate-500" />
                    ) : (
                        <ChevronUp className="h-5 w-5 text-slate-500" />
                    )}
                </div>
            </div>

            {/* Jobs List */}
            {!collapsed && (
                <div className="p-4 space-y-3">
                    {jobs.map((job) => (
                        <JobTracker
                            key={job.jobId}
                            {...job}
                            onCancel={onCancelJob ? () => onCancelJob(job.jobId) : undefined}
                            onRetry={onRetryJob ? () => onRetryJob(job.jobId) : undefined}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
