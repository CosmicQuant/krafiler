import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../services/api';
import type { ClientObligation } from '../../../types';
import { LoanManager } from './LoanManager';
import { LeaveManager } from './LeaveManager';
import { AttendanceCalendarGrid } from './AttendanceCalendarGrid';

interface Employee {
    employmentStatus: string;
    basicPay: number;
}

interface Step1SetupProps {
    client: ClientObligation;
    onValidationChange?: (valid: boolean) => void;
    onPeriodChange?: (period: string) => void;
    onRegisterApprove?: (trigger: () => Promise<boolean>) => void;
}

export function Step1Setup({ client, onValidationChange, onPeriodChange, onRegisterApprove }: Step1SetupProps) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [period, setPeriod] = useState<string>('');

    const fetchEmployees = useCallback(async () => {
        try {
            const res = await apiFetch(`/clients/${client.id}/employees`);
            if (res.ok) {
                const data = await res.json();
                setEmployees(data);
            }
        } catch {
            /* ignore */
        }
    }, [client.id]);

    useEffect(() => {
        fetchEmployees();
    }, [fetchEmployees]);

    useEffect(() => {
        const hasActive = employees.some((e) => e.employmentStatus === 'Active' && e.basicPay > 0);
        onValidationChange?.(hasActive);
    }, [employees, onValidationChange]);

    const handlePeriodChange = (p: string) => {
        setPeriod(p);
        onPeriodChange?.(p);
    };

    return (
        <div className="space-y-8">
            {/* Attendance Recording */}
            <AttendanceCalendarGrid
                clientId={client.id}
                onPeriodChange={handlePeriodChange}
                onRegisterApprove={onRegisterApprove}
            />

            {/* Loan & Leave */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <LoanManager clientId={client.id} period={period || undefined} />
                <LeaveManager clientId={client.id} period={period || undefined} />
            </div>
        </div>
    );
}
