import { useState, useRef, useCallback } from 'react';
import { CalendarCheck, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { AttendanceCalendarGrid } from '../steps/AttendanceCalendarGrid';
import { LeaveManager } from '../steps/LeaveManager';

interface AttendancePanelProps {
    clientId: string;
    period: string;
    onApproved: () => void;
}

export function AttendancePanel({ clientId, period, onApproved }: AttendancePanelProps) {
    const [approved, setApproved] = useState(false);
    const [approving, setApproving] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const approveRef = useRef<(() => Promise<boolean>) | null>(null);

    const handleApproved = useCallback(() => {
        setApproved(true);
        onApproved();
    }, [onApproved]);

    const handleRegisterApprove = useCallback((fn: () => Promise<boolean>) => {
        approveRef.current = fn;
    }, []);

    const handleApproveClick = async () => {
        if (!approveRef.current) return;
        setApproving(true);
        try {
            const success = await approveRef.current();
            if (success) {
                setApproved(true);
                onApproved();
            }
        } finally {
            setApproving(false);
        }
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
            <button
                onClick={() => setExpanded((e) => !e)}
                className="flex w-full items-center justify-between"
            >
                <div className="flex items-center gap-2">
                    <CalendarCheck className="h-4 w-4 text-slate-500" />
                    <h3 className="text-sm font-bold text-slate-900">Attendance</h3>
                </div>
                <div className="flex items-center gap-2">
                    {!approved ? (
                        <button
                            onClick={(e) => { e.stopPropagation(); handleApproveClick(); }}
                            disabled={approving}
                            className="inline-flex items-center gap-1 rounded bg-slate-950 px-2 py-1 text-[10px] font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                        >
                            {approving ? (
                                <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            ) : (
                                <CheckCircle2 className="h-3 w-3" />
                            )}
                            Approve
                        </button>
                    ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" /> Approved
                        </span>
                    )}
                    {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </div>
            </button>

            {expanded && (
                <div className="mt-3 space-y-3">
                    <AttendanceCalendarGrid
                        clientId={clientId}
                        period={period}
                        onApproved={handleApproved}
                        onRegisterApprove={handleRegisterApprove}
                    />
                    <LeaveManager clientId={clientId} period={period || undefined} />
                </div>
            )}
        </div>
    );
}
