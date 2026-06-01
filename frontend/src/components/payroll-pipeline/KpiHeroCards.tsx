import { Users, Banknote, Clock, AlertCircle } from 'lucide-react';
import { cn } from '../../utils/cn';

interface KpiData {
    totalEmployees: number;
    totalPayroll: number;
    activeRuns: number;
    pendingApprovals: number;
}

interface KpiHeroCardsProps {
    data: KpiData;
    className?: string;
}

export function KpiHeroCards({ data, className }: KpiHeroCardsProps) {
    const cards = [
        {
            label: 'Total Employees',
            value: data.totalEmployees,
            sub: 'Active this month',
            icon: Users,
            color: 'bg-blue-50 text-blue-600 border-blue-200',
            iconBg: 'bg-blue-100',
        },
        {
            label: 'Total Payroll',
            value: `KES ${Number(data.totalPayroll || 0).toLocaleString()}`,
            sub: 'Current period',
            icon: Banknote,
            color: 'bg-emerald-50 text-emerald-600 border-emerald-200',
            iconBg: 'bg-emerald-100',
        },
        {
            label: 'Active Runs',
            value: data.activeRuns,
            sub: 'In progress',
            icon: Clock,
            color: 'bg-amber-50 text-amber-600 border-amber-200',
            iconBg: 'bg-amber-100',
        },
        {
            label: 'Pending Approvals',
            value: data.pendingApprovals,
            sub: 'Require attention',
            icon: AlertCircle,
            color: 'bg-red-50 text-red-600 border-red-200',
            iconBg: 'bg-red-100',
        },
    ];

    return (
        <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-4', className)}>
            {cards.map((card) => (
                <div
                    key={card.label}
                    className={cn(
                        'rounded-xl border p-4 flex items-start gap-3 transition-shadow hover:shadow-md',
                        card.color
                    )}
                >
                    <div className={cn('rounded-lg p-2', card.iconBg)}>
                        <card.icon className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                            {card.label}
                        </p>
                        <p className="text-lg font-bold mt-1">{card.value}</p>
                        <p className="text-[10px] opacity-60 mt-0.5">{card.sub}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}
