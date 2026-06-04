import { useState, useRef, useCallback } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { AttendanceCalendarGrid } from '../steps/AttendanceCalendarGrid';
import { LeaveManager } from '../steps/LeaveManager';
import type { ClientObligation } from '../../../types';

interface AttendanceTabProps {
    client: ClientObligation;
    period: string;
    onChangePeriod: (period: string) => void;
}

export function AttendanceTab({ client, period, onChangePeriod }: AttendanceTabProps) {
    const [approved, setApproved] = useState(false);
    const [approving, setApproving] = useState(false);
    const approveRef = useRef<(() => Promise<boolean>) | null>(null);

    const handleApproved = useCallback(() => {
        setApproved(true);
    }, []);

    const handleRegisterApprove = useCallback((fn: () => Promise<boolean>) => {
        approveRef.current = fn;
    }, []);

    const handleApproveClick = async () => {
        if (!approveRef.current) return;
        setApproving(true);
        try {
            const success = await approveRef.current();
            if (success) setApproved(true);
        } finally {
            setApproving(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Period + Approve */}
            <div className="flex items-center justify-end gap-3">
                <label className="text-xs font-semibold text-slate-500">Period:</label>
                <input
                    type="month"
                    value={period}
                    onChange={(e) => onChangePeriod(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                {!approved ? (
                    <button
                        onClick={handleApproveClick}
                        disabled={approving}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                    >
                        {approving ? (
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Approve Attendance
                    </button>
                ) : (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approved
                    </span>
                )}
            </div>

            {/* Attendance Grid */}
            <AttendanceCalendarGrid
                clientId={client.id}
                onPeriodChange={onChangePeriod}
                onApproved={handleApproved}
                onRegisterApprove={handleRegisterApprove}
            />

            {/* Leave Manager */}
            <LeaveManager clientId={client.id} period={period || undefined} />
        </div>
    );
}
