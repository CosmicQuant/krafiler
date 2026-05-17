import { useState, useEffect } from 'react';
import { apiFetch } from '../../services/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Users, Briefcase, Banknote, CalendarCheck, FileText, TrendingUp } from 'lucide-react';

interface KpiData {
    employeeCount: number;
    activeEmployees: number;
    departmentCount: number;
    totalMonthlyLoanDeductions: number;
    pendingLeaveRequests: number;
    approvedLeaveThisMonth: number;
    payrollRunCount: number;
    latestRunPeriod: string | null;
    totalPayrollGross: number;
    documentCount: number;
    recentRunData: { period: string; totalGross: number; totalNet: number; totalEmployees: number }[];
}

const COLORS = ['#ff0613', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];

function KpiCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string | number; sub?: string; color?: string }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-start gap-3">
            <div className={`rounded-lg p-2.5 ${color || 'bg-slate-100'}`}>
                <Icon className={`h-5 w-5 ${color ? 'text-white' : 'text-slate-600'}`} />
            </div>
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
                <p className="text-xl font-bold text-slate-900">{typeof value === 'number' ? value.toLocaleString() : value}</p>
                {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
            </div>
        </div>
    );
}

export function KpiCharts({ clientId }: { clientId: number | string }) {
    const [data, setData] = useState<KpiData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const r = await apiFetch(`/clients/${clientId}/kpi`);
                if (r.ok) setData(await r.json());
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        })();
    }, [clientId]);

    if (loading) return <div className="p-6 text-sm text-slate-500">Loading KPIs...</div>;
    if (!data) return <div className="p-6 text-sm text-red-500">Failed to load KPIs.</div>;

    const pieData = [
        { name: 'Active', value: data.activeEmployees },
        { name: 'Inactive', value: data.employeeCount - data.activeEmployees },
    ].filter(d => d.value > 0);

    return (
        <div className="space-y-6">
            <h3 className="text-lg font-bold text-slate-800">Dashboard KPIs</h3>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <KpiCard icon={Users} label="Total Employees" value={data.employeeCount} sub={`${data.activeEmployees} active`} color="bg-blue-600" />
                <KpiCard icon={Briefcase} label="Departments" value={data.departmentCount} color="bg-purple-600" />
                <KpiCard icon={Banknote} label="Loan Deductions" value={`KES ${data.totalMonthlyLoanDeductions.toLocaleString()}`} sub="monthly total" color="bg-amber-600" />
                <KpiCard icon={CalendarCheck} label="Pending Leave" value={data.pendingLeaveRequests} sub={`${data.approvedLeaveThisMonth} approved`} color="bg-emerald-600" />
                <KpiCard icon={FileText} label="Documents" value={data.documentCount} color="bg-slate-600" />
                <KpiCard icon={TrendingUp} label="Payroll Runs" value={data.payrollRunCount} sub={data.latestRunPeriod ? `Latest: ${data.latestRunPeriod}` : 'No runs'} color="bg-red-600" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Payroll Trend Bar Chart */}
                {data.recentRunData.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <h4 className="text-xs font-bold text-slate-700 mb-3">Payroll Trend (Gross Pay per Period)</h4>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={data.recentRunData}>
                                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 10 }} />
                                <Tooltip contentStyle={{ fontSize: 12 }} />
                                <Bar dataKey="totalGross" fill="#ff0613" radius={[4, 4, 0, 0]} name="Gross Pay" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Employee Status Pie Chart */}
                {pieData.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <h4 className="text-xs font-bold text-slate-700 mb-3">Employee Status</h4>
                        <ResponsiveContainer width="100%" height={250}>
                            <PieChart>
                                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                                    {pieData.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                                </Pie>
                                <Tooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
}
