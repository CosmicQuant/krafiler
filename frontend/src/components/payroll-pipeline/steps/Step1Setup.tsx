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
}

export function Step1Setup({ client, onValidationChange }: Step1SetupProps) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [attendanceApproved, setAttendanceApproved] = useState(false);

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
        onValidationChange?.(hasActive && attendanceApproved);
    }, [employees, attendanceApproved, onValidationChange]);

    return (
        <div className="space-y-8">
            {/* Attendance Recording */}
            <AttendanceCalendarGrid
                clientId={client.id}
                onApproved={() => setAttendanceApproved(true)}
            />

            {/* Loan & Leave */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <LoanManager clientId={client.id} />
                <LeaveManager clientId={client.id} />
            </div>
        </div>
    );
}
