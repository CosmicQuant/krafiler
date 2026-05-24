import { useState, useEffect, useCallback } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../../services/api';

interface WorkSchedule {
    id: number;
    name: string;
    config: string; // JSON
    standardCheckIn: string;
    standardCheckOut: string;
    saturdayCheckOut: string | null;
    createdAt: string;
    updatedAt: string;
}

interface WorkScheduleManagerProps {
    clientId: string;
}

export function WorkScheduleManager({ clientId }: WorkScheduleManagerProps) {
    const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchSchedules = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetch(`/clients/${clientId}/work-schedules`);
            if (res.ok) setSchedules(await res.json());
        } catch { /* ignore */ }
        setLoading(false);
    }, [clientId]);

    useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

    const parseConfig = (config: string) => {
        try {
            return typeof config === 'string' ? JSON.parse(config) : config;
        } catch {
            return {};
        }
    };

    const dayLabels: Record<string, string> = {
        Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
        Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <Clock className="h-4 w-4" /> Work Schedules
                </h3>
                <button
                    onClick={fetchSchedules}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition"
                    title="Refresh"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                </button>
            </div>

            {loading ? (
                <div className="text-xs text-slate-400 py-4">Loading schedules...</div>
            ) : schedules.length === 0 ? (
                <div className="text-xs text-slate-500 py-4">No work schedules configured.</div>
            ) : (
                <div className="space-y-3">
                    {schedules.map((ws) => {
                        const config = parseConfig(ws.config);
                        return (
                            <div key={ws.id} className="rounded-xl border border-slate-200 bg-white p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="font-bold text-sm text-slate-900">{ws.name}</h4>
                                    <span className="text-[10px] text-slate-400">
                                        {ws.standardCheckIn} – {ws.standardCheckOut}
                                    </span>
                                </div>
                                <div className="grid grid-cols-7 gap-2">
                                    {Object.entries(dayLabels).map(([short]) => (
                                        <div key={short} className="text-center">
                                            <div className="text-[10px] text-slate-400">{short}</div>
                                            <div className={`text-xs font-semibold ${
                                                config[short] > 0 ? 'text-slate-900' : 'text-slate-300'
                                            }`}>
                                                {config[short] || 0}h
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
