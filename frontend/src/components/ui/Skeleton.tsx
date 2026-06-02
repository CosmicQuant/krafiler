/**
 * Skeleton.tsx
 *
 * Loading skeleton components that match the zani design system.
 * Used as fallback UI while async data is fetching.
 */

import { cn } from '../../utils/cn';

function SkeletonBase({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                'animate-pulse rounded-lg bg-slate-200',
                className
            )}
        />
    );
}

/* ------------------------------------------------------------------ */
/*  Table Skeleton                                                     */
/* ------------------------------------------------------------------ */

export function TableSkeleton({ rows = 5, cols = 8 }: { rows?: number; cols?: number }) {
    return (
        <div className="mt-10 rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50/50">
                        <tr>
                            {Array.from({ length: cols }).map((_, i) => (
                                <th key={i} className="px-5 py-4">
                                    <SkeletonBase className="h-3 w-16" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {Array.from({ length: rows }).map((_, r) => (
                            <tr key={r}>
                                <td className="px-5 py-4">
                                    <div className="flex items-center gap-3">
                                        <SkeletonBase className="h-9 w-9 rounded-xl" />
                                        <div className="space-y-1.5">
                                            <SkeletonBase className="h-3 w-28" />
                                            <SkeletonBase className="h-2.5 w-16" />
                                        </div>
                                    </div>
                                </td>
                                {Array.from({ length: cols - 1 }).map((_, c) => (
                                    <td key={c} className="px-5 py-4">
                                        <SkeletonBase className="h-3 w-12" />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Card Skeleton                                                      */
/* ------------------------------------------------------------------ */

export function CardSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn('rounded-2xl border border-slate-100 bg-white p-6 shadow-sm', className)}>
            <div className="flex items-center gap-3">
                <SkeletonBase className="h-10 w-10 rounded-xl" />
                <div className="space-y-2">
                    <SkeletonBase className="h-3 w-24" />
                    <SkeletonBase className="h-5 w-16" />
                </div>
            </div>
            <div className="mt-4 space-y-2">
                <SkeletonBase className="h-2 w-full" />
                <SkeletonBase className="h-2 w-3/4" />
            </div>
        </div>
    );
}

export function CardGridSkeleton({ count = 4 }: { count?: number }) {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: count }).map((_, i) => (
                <CardSkeleton key={i} />
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Page Skeleton                                                      */
/* ------------------------------------------------------------------ */

export function PageSkeleton() {
    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <SkeletonBase className="h-8 w-48" />
                <SkeletonBase className="h-10 w-32 rounded-xl" />
            </div>
            <CardGridSkeleton count={4} />
            <TableSkeleton rows={5} cols={8} />
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Form Field Skeleton                                                */
/* ------------------------------------------------------------------ */

export function FormFieldSkeleton({ count = 4 }: { count?: number }) {
    return (
        <div className="space-y-4">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                    <SkeletonBase className="h-3 w-24" />
                    <SkeletonBase className="h-10 w-full rounded-xl" />
                </div>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Sidebar Skeleton                                                   */
/* ------------------------------------------------------------------ */

export function SidebarSkeleton() {
    return (
        <div className="flex h-screen w-72 flex-col border-r border-slate-200 bg-white/95 p-4">
            <SkeletonBase className="h-8 w-32" />
            <div className="mt-8 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                    <SkeletonBase key={i} className="h-10 w-full rounded-xl" />
                ))}
            </div>
            <div className="mt-auto space-y-3">
                <SkeletonBase className="h-10 w-full rounded-xl" />
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Inline Text Skeleton                                               */
/* ------------------------------------------------------------------ */

export function TextSkeleton({ width = 'w-24', className }: { width?: string; className?: string }) {
    return <SkeletonBase className={cn('h-3', width, className)} />;
}

export function CircleSkeleton({ size = 'h-10 w-10' }: { size?: string }) {
    return <SkeletonBase className={cn('rounded-full', size)} />;
}
