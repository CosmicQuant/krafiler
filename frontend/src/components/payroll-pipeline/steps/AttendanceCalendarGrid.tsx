import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CalendarCheck, CheckCircle2, Pencil, Trash2, X, Plus, CalendarDays, Upload } from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { EmployeeEditModal, type Employee } from './EmployeeEditModal';
import { getCurrentFilingPeriod } from '../../../utils/taxPeriods';

interface AttendanceRecord {
    id: number;
    employeeId: number;
    date: string;
    status: string;
    checkIn: string;
    checkOut: string;
    notes: string;
}

interface WorkSchedule {
    id: number;
    name: string;
    config: string;
    standardCheckIn: string;
    standardCheckOut: string;
}

interface Holiday {
    id: number;
    date: string;
    isRecurring: number;
    name: string;
}

interface LeaveRequest {
    id: number;
    employeeId: number;
    startDate: string;
    endDate: string;
    status: string;
    leaveType: string;
    isPaid: number;
    hours: number;
}

interface AttendanceSummary {
    employeeId: number;
    absentDays: number;
    absentHours: number;
    lateHours: number;
    halfDays: number;
    presentDays: number;
    leaveDays: number;
    offDays: number;
    overtimeHours: number;
    overtimeRate: number;
    overtimeMultiplier: number;
    overtimeAmount: number;
    hourlyRate: number;
    totalStdHours: number;
    totalScheduledHours: number;
    holidayHours: number;
    paidLeaveHours: number;
    totalPaidStdHours: number;
    stdPay: number;
    unpaidLeaveHours: number;
    paidLeaveAmount: number;
    // Pay breakdown (monetary)
    basicPay: number;
    stdPayAmount: number;
    holidayPayAmount: number;
    paidLeavePayAmount: number;
    absentDedAmount: number;
    lateDedAmount: number;
    unpaidLeaveDedAmount: number;
}

interface AttendanceCalendarGridProps {
    clientId: string;
    period?: string;
    onApproved?: () => void;
    onPeriodChange?: (period: string) => void;
    onRegisterApprove?: (trigger: () => Promise<boolean>) => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUS_OPTIONS = ['Present', 'Absent', 'Late', 'Half-Day', 'On Leave', 'Off Day'];

function daysInMonth(year: number, month: number) {
    return new Date(year, month, 0).getDate();
}

function parseConfig(config: any) {
    if (!config) return null;
    if (typeof config === 'string') {
        try { return JSON.parse(config); } catch { return null; }
    }
    return config;
}

/**
 * Sum scheduled hours for the month from the work schedule config.
 * Each day contributes its config hours (e.g. Saturday 4 hrs, Mon-Fri 9 hrs).
 * Holidays are included because they are paid days off.
 */
function getTotalScheduledHours(config: any, year: number, month: number): number {
    if (!config || Object.keys(config).length === 0) return 240; // Legacy: 30 × 8

    const total = daysInMonth(year, month);
    let totalHours = 0;
    for (let d = 1; d <= total; d++) {
        const date = new Date(year, month - 1, d);
        const dayName = DAY_LABELS[date.getDay()];
        const hours = config[dayName] || 0;
        if (hours > 0) {
            totalHours += hours;
        }
    }
    return totalHours || 240;
}

function isScheduledWorkDay(config: any, year: number, month: number, day: number, offDay: string | null, holidays: Holiday[]): boolean {
    const date = new Date(year, month - 1, day);
    const dayName = DAY_LABELS[date.getDay()];
    if (config && config[dayName] === 0) return false;
    if (!config && (date.getDay() === 0 || date.getDay() === 6)) return false;
    if (offDay && offDay.startsWith(FULL_DAY_NAMES[date.getDay()])) return false;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const monthDay = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    for (const h of holidays) {
        if (h.date === dateStr) return false;
        if (h.isRecurring === 1) {
            const hd = h.date.substring(5);
            if (hd === monthDay) return false;
        }
    }
    return true;
}

function isHoliday(config: any, year: number, month: number, day: number, offDay: string | null, holidays: Holiday[]): { isHoliday: boolean; label?: string; isOffDay?: boolean } {
    const date = new Date(year, month - 1, day);
    const dayName = DAY_LABELS[date.getDay()];
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const monthDay = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Check holidays FIRST (priority over off-days)
    for (const h of holidays) {
        if (h.date === dateStr) return { isHoliday: true, label: h.name || 'Holiday' };
        if (h.isRecurring === 1) {
            const hd = h.date.substring(5);
            if (hd === monthDay) return { isHoliday: true, label: h.name || 'Holiday' };
        }
    }

    // Then check off-days
    if (config && config[dayName] === 0) return { isHoliday: true, label: 'Off Day', isOffDay: true };
    if (!config && (date.getDay() === 0 || date.getDay() === 6)) return { isHoliday: true, label: 'Off Day', isOffDay: true };
    if (offDay && offDay.startsWith(FULL_DAY_NAMES[date.getDay()])) return { isHoliday: true, label: 'Off Day', isOffDay: true };

    return { isHoliday: false };
}

function getStandardWorkingHours(checkIn: string, checkOut: string) {
    const [siH, siM] = (checkIn || '08:00').split(':').map(Number);
    const [soH, soM] = (checkOut || '17:00').split(':').map(Number);
    const mins = (soH * 60 + (soM || 0)) - (siH * 60 + (siM || 0));
    return Math.max(1, mins / 60);
}

function isLateRecord(rec: AttendanceRecord | undefined, standardCheckIn: string): boolean {
    if (!rec || !rec.checkIn) return false;
    const [cH, cM] = rec.checkIn.split(':').map(Number);
    const [sH, sM] = standardCheckIn.split(':').map(Number);
    if (isNaN(cH) || isNaN(sH)) return false;
    const checkInMins = cH * 60 + (cM || 0);
    const standardMins = sH * 60 + (sM || 0);
    return checkInMins > standardMins;
}

function isOnLeave(employeeId: number, dateStr: string, leaveRequests: LeaveRequest[]): LeaveRequest | null {
    for (const lr of leaveRequests) {
        if (lr.employeeId !== employeeId) continue;
        if (lr.status !== 'Approved') continue;
        if (dateStr >= lr.startDate && dateStr <= lr.endDate) return lr;
    }
    return null;
}

export function AttendanceCalendarGrid({ clientId, period: propPeriod, onApproved, onPeriodChange: _onPeriodChange, onRegisterApprove }: AttendanceCalendarGridProps) {
    const defaultPeriod = getCurrentFilingPeriod().period;
    const period = propPeriod || defaultPeriod;
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [attendanceMap, setAttendanceMap] = useState<Map<string, AttendanceRecord>>(new Map());
    const [schedules, setSchedules] = useState<Map<number, WorkSchedule>>(new Map());
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
    const [summaries, setSummaries] = useState<Map<number, AttendanceSummary>>(new Map());
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [approved, setApproved] = useState(false);
    const [payStructure, setPayStructure] = useState<'fixed' | 'prorated'>('fixed');
    const [importing, setImporting] = useState(false);

    // Modals
    const [modalEmployee, setModalEmployee] = useState<Employee | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [cellModal, setCellModal] = useState<{ employeeId: number; day: number; record?: AttendanceRecord } | null>(null);
    const [cellForm, setCellForm] = useState({ status: 'Present', checkIn: '', checkOut: '', notes: '' });

    const [year, month] = period.split('-').map(Number);
    const totalDays = daysInMonth(year, month);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [empsRes, attRes, schedRes, holRes, leaveRes] = await Promise.all([
                apiFetch(`/clients/${clientId}/employees`),
                apiFetch(`/clients/${clientId}/attendance?dateFrom=${period}-01&dateTo=${period}-${String(totalDays).padStart(2, '0')}`),
                apiFetch(`/clients/${clientId}/work-schedules`),
                apiFetch(`/clients/${clientId}/holidays`),
                apiFetch(`/clients/${clientId}/leave`),
            ]);

            let emps: Employee[] = [];
            if (empsRes.ok) {
                emps = (await empsRes.json()).filter((e: any) => e.employmentStatus === 'Active');
                setEmployees(emps);
            }

            const attMap = new Map<string, AttendanceRecord>();
            if (attRes.ok) {
                const records: AttendanceRecord[] = await attRes.json();
                for (const r of records) {
                    attMap.set(`${r.employeeId}-${r.date}`, r);
                }
            }
            setAttendanceMap(attMap);

            const schedMap = new Map<number, WorkSchedule>();
            if (schedRes.ok) {
                const list: WorkSchedule[] = await schedRes.json();
                for (const s of list) schedMap.set(s.id, s);
            }
            setSchedules(schedMap);

            let hols: Holiday[] = [];
            if (holRes.ok) hols = await holRes.json();
            setHolidays(hols);

            let leaves: LeaveRequest[] = [];
            if (leaveRes.ok) leaves = await leaveRes.json();
            setLeaveRequests(leaves);

            // Build summaries from attendance data using actual hours worked
            const sumMap = new Map<number, AttendanceSummary>();
            for (const emp of emps) {
                let absent = 0;
                let absentHours = 0;
                let late = 0;
                let lateCount = 0;
                let half = 0;
                let present = 0;
                let leave = 0;
                let off = 0;
                let totalStdHours = 0;
                let otHours = 0;
                let paidLeaveHours = 0;
                let unpaidLeaveHours = 0;
                let holidayHours = 0;
                const dailyHours = getStandardWorkingHours(emp.standardCheckIn, emp.standardCheckOut);
                const ws = emp.workScheduleId ? schedMap.get(emp.workScheduleId) : null;
                const config = ws ? parseConfig(ws.config) : null;
                for (let d = 1; d <= totalDays; d++) {
                    const dateStr = `${period}-${String(d).padStart(2, '0')}`;
                    const rec = attMap.get(`${emp.id}-${dateStr}`);
                    const leaveInfo = isOnLeave(emp.id, dateStr, leaves);
                    const holInfo = isHoliday(config, year, month, d, emp.offDay, hols);

                    // Count real holiday hours (paid days off from the holidays table)
                    if (holInfo.isHoliday && !holInfo.isOffDay) {
                        const date = new Date(year, month - 1, d);
                        const dayName = DAY_LABELS[date.getDay()];
                        holidayHours += config ? (config[dayName] || 0) : dailyHours;
                        continue;
                    }

                    if (rec) {
                        // Status counters (informational)
                        if (rec.status === 'Absent') {
                            const date = new Date(year, month - 1, d);
                            const dayName = DAY_LABELS[date.getDay()];
                            absentHours += config ? (config[dayName] || 0) : dailyHours;
                            absent += 1;
                            continue;
                        }
                        if (rec.status === 'Off Day') { off += 1; continue; }
                        if (rec.status === 'On Leave') {
                            leave += 1;
                            if (leaveInfo && leaveInfo.isPaid === 1) {
                                paidLeaveHours += leaveInfo.hours || dailyHours;
                            } else {
                                unpaidLeaveHours += leaveInfo ? (leaveInfo.hours || dailyHours) : dailyHours;
                            }
                            continue;
                        }

                        // Compute actual hours from check-in / check-out
                        const [ciH, ciM] = (rec.checkIn || emp.standardCheckIn || '08:00').split(':').map(Number);
                        const [coH, coM] = (rec.checkOut || emp.standardCheckOut || '17:00').split(':').map(Number);
                        const actualMins = Math.max(0, (coH * 60 + (coM || 0)) - (ciH * 60 + (ciM || 0)));
                        const actualHours = actualMins / 60;

                        // Compute late hours for ANY working day (not just status === 'Late')
                        const [sH, sM] = (emp.standardCheckIn || '08:00').split(':').map(Number);
                        if (!isNaN(ciH) && !isNaN(sH)) {
                            const lateMins = Math.max(0, (ciH * 60 + (ciM || 0)) - (sH * 60 + (sM || 0)));
                            if (lateMins > 0) late += lateMins / 60;
                        }

                        if (rec.status === 'Half-Day') {
                            half += 1;
                            totalStdHours += Math.min(actualHours, dailyHours * 0.5);
                        } else if (rec.status === 'Late') {
                            lateCount += 1;
                            totalStdHours += Math.min(actualHours, dailyHours);
                            otHours += Math.max(0, actualHours - dailyHours);
                        } else if (rec.status === 'Present') {
                            present += 1;
                            totalStdHours += Math.min(actualHours, dailyHours);
                            otHours += Math.max(0, actualHours - dailyHours);
                        }
                    } else if (leaveInfo) {
                        // Approved leave without attendance record
                        leave += 1;
                        if (leaveInfo.isPaid === 1) {
                            paidLeaveHours += leaveInfo.hours || dailyHours;
                        } else {
                            unpaidLeaveHours += leaveInfo.hours || dailyHours;
                        }
                    }
                }
                const totalScheduledHours = getTotalScheduledHours(config, year, month);
                const computedRate = Math.round(((emp.basicPay || 0) / Math.max(1, totalScheduledHours)) * 100000000) / 100000000;
                const hourlyRate = (emp.hourlyRate || computedRate) || 0;
                const mult = 1.5;
                const otRate = Math.round(hourlyRate * mult * 100) / 100;
                const totalPaidStdHours = totalStdHours + holidayHours + paidLeaveHours;
                const stdPay = payStructure === 'fixed'
                    ? Math.round((emp.basicPay || 0) * 100) / 100
                    : Math.round(totalPaidStdHours * hourlyRate * 100) / 100;
                const paidLeaveAmount = payStructure === 'fixed'
                    ? 0
                    : Math.round(paidLeaveHours * hourlyRate * 100) / 100;
                // Pay breakdown amounts
                const basicPay = Math.round((emp.basicPay || 0) * 100) / 100;
                // For fixed employees with no deductions, stdPayAmount should equal basicPay exactly
                // to avoid rounding errors from hourlyRate precision
                const hasDeductions = absentHours > 0 || late > 0 || unpaidLeaveHours > 0;
                const stdPayAmount = (payStructure === 'fixed' && !hasDeductions)
                    ? basicPay
                    : Math.round(totalStdHours * hourlyRate * 100) / 100;
                const holidayPayAmount = Math.round(holidayHours * hourlyRate * 100) / 100;
                const paidLeavePayAmount = Math.round(paidLeaveHours * hourlyRate * 100) / 100;
                const absentDedAmount = Math.round(absentHours * hourlyRate * 100) / 100;
                const lateDedAmount = Math.round(late * hourlyRate * 100) / 100;
                const unpaidLeaveDedAmount = Math.round(unpaidLeaveHours * hourlyRate * 100) / 100;
                sumMap.set(emp.id, {
                    employeeId: emp.id,
                    absentDays: absent,
                    absentHours: Math.round(absentHours * 100) / 100,
                    lateHours: Math.round(late * 100) / 100,
                    halfDays: half,
                    presentDays: present + lateCount,
                    leaveDays: leave,
                    offDays: off,
                    overtimeHours: Math.round(otHours * 100) / 100,
                    overtimeRate: otRate,
                    overtimeMultiplier: mult,
                    overtimeAmount: Math.round(otHours * otRate * 100) / 100,
                    hourlyRate,
                    totalStdHours: Math.round(totalStdHours * 100) / 100,
                    totalScheduledHours,
                    holidayHours: Math.round(holidayHours * 100) / 100,
                    paidLeaveHours: Math.round(paidLeaveHours * 100) / 100,
                    totalPaidStdHours: Math.round(totalPaidStdHours * 100) / 100,
                    stdPay,
                    unpaidLeaveHours: Math.round(unpaidLeaveHours * 100) / 100,
                    paidLeaveAmount,
                    basicPay,
                    stdPayAmount,
                    holidayPayAmount,
                    paidLeavePayAmount,
                    absentDedAmount,
                    lateDedAmount,
                    unpaidLeaveDedAmount,
                });
            }
            setSummaries(sumMap);
            setApproved(false);
        } catch {
            setError('Failed to load attendance data');
        } finally {
            setLoading(false);
        }
    }, [clientId, period, totalDays, payStructure]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleImportEmployees = async () => {
        setImporting(true);
        setError(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/employees/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setMessage(`Imported ${data.imported || 0} employees from Master CSV.`);
                await loadData();
            } else {
                setError(data.message || 'Failed to import employees from Master CSV.');
            }
        } catch {
            setError('Network error during employee import.');
        } finally {
            setImporting(false);
        }
    };

    // Set payStructure from first active employee when data loads
    useEffect(() => {
        if (employees.length > 0) {
            const firstWithStructure = employees.find(e => e.payStructure === 'fixed' || e.payStructure === 'prorated');
            if (firstWithStructure) {
                setPayStructure(firstWithStructure.payStructure as 'fixed' | 'prorated');
            }
        }
    }, [employees]);

    const openCellModal = (employeeId: number, day: number) => {
        const dateStr = `${period}-${String(day).padStart(2, '0')}`;
        const key = `${employeeId}-${dateStr}`;
        const existing = attendanceMap.get(key);
        const leaveInfo = isOnLeave(employeeId, dateStr, leaveRequests);
        const emp = employees.find(e => e.id === employeeId);
        const defaultStatus = existing?.status || (leaveInfo ? 'On Leave' : 'Present');
        setCellModal({ employeeId, day, record: existing });
        setCellForm({
            status: defaultStatus,
            checkIn: existing?.checkIn || (emp?.standardCheckIn || '08:00'),
            checkOut: existing?.checkOut || (emp?.standardCheckOut || '17:00'),
            notes: existing?.notes || (leaveInfo ? `${leaveInfo.leaveType} leave` : ''),
        });
    };

    const deleteCell = async () => {
        if (!cellModal?.record?.id) return;
        const { employeeId, day, record } = cellModal;
        const dateStr = `${period}-${String(day).padStart(2, '0')}`;
        const key = `${employeeId}-${dateStr}`;

        const updatedMap = new Map([...attendanceMap].filter(([k]) => k !== key));
        setAttendanceMap(updatedMap);
        recomputeAllSummaries(updatedMap);
        setCellModal(null);

        try {
            await apiFetch(`/clients/${clientId}/attendance/${record.id}`, { method: 'DELETE' });
            const attRes = await apiFetch(`/clients/${clientId}/attendance?dateFrom=${period}-01&dateTo=${period}-${String(totalDays).padStart(2, '0')}`);
            if (attRes.ok) {
                const records: AttendanceRecord[] = await attRes.json();
                const newMap = new Map<string, AttendanceRecord>();
                for (const r of records) newMap.set(`${r.employeeId}-${r.date}`, r);
                setAttendanceMap(newMap);
                recomputeAllSummaries(newMap);
            }
        } catch {
            setError('Failed to delete attendance record');
        }
    };

    const saveCell = async () => {
        if (!cellModal) return;
        const { employeeId, day, record } = cellModal;
        const dateStr = `${period}-${String(day).padStart(2, '0')}`;
        const key = `${employeeId}-${dateStr}`;
        const emp = employees.find(e => e.id === employeeId);

        const optimisticRecord: AttendanceRecord = {
            id: record?.id ?? -1,
            employeeId,
            date: dateStr,
            status: cellForm.status,
            checkIn: cellForm.checkIn,
            checkOut: cellForm.checkOut,
            notes: cellForm.notes,
        };

        const updatedMap = new Map([...attendanceMap, [key, optimisticRecord]]);
        setAttendanceMap(updatedMap);
        recomputeAllSummaries(updatedMap);
        setCellModal(null);

        try {
            if (record && record.id > 0) {
                await apiFetch(`/clients/${clientId}/attendance/${record.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        status: cellForm.status,
                        checkIn: cellForm.checkIn,
                        checkOut: cellForm.checkOut,
                        notes: cellForm.notes,
                    }),
                });
            } else {
                const res = await apiFetch(`/clients/${clientId}/attendance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        employeeId,
                        employeeName: emp?.employeeName || '',
                        kraPin: emp?.kraPin || '',
                        date: dateStr,
                        status: cellForm.status,
                        checkIn: cellForm.checkIn,
                        checkOut: cellForm.checkOut,
                        notes: cellForm.notes,
                    }),
                });
                if (res.ok) {
                    const created = await res.json();
                    setAttendanceMap(prev => {
                        const updated = new Map(prev);
                        updated.set(key, created);
                        return updated;
                    });
                }
            }
            const attRes = await apiFetch(`/clients/${clientId}/attendance?dateFrom=${period}-01&dateTo=${period}-${String(totalDays).padStart(2, '0')}`);
            if (attRes.ok) {
                const records: AttendanceRecord[] = await attRes.json();
                const newMap = new Map<string, AttendanceRecord>();
                for (const r of records) newMap.set(`${r.employeeId}-${r.date}`, r);
                setAttendanceMap(newMap);
                recomputeAllSummaries(newMap);
            }
        } catch {
            setError('Failed to save attendance record (sync error)');
        }
    };

    const bulkMarkScheduledDays = async () => {
        const records: any[] = [];
        for (const emp of employees) {
            const ws = emp.workScheduleId ? schedules.get(emp.workScheduleId) : null;
            const config = ws ? parseConfig(ws.config) : null;
            for (let d = 1; d <= totalDays; d++) {
                const dateStr = `${period}-${String(d).padStart(2, '0')}`;
                const key = `${emp.id}-${dateStr}`;
                const existing = attendanceMap.get(key);
                if (existing) continue;
                const isWork = isScheduledWorkDay(config, year, month, d, emp.offDay, holidays);
                if (!isWork) continue;
                records.push({
                    employeeId: emp.id,
                    employeeName: emp.employeeName,
                    kraPin: emp.kraPin,
                    date: dateStr,
                    status: 'Present',
                    checkIn: ws?.standardCheckIn || emp.standardCheckIn || '08:00',
                    checkOut: ws?.standardCheckOut || emp.standardCheckOut || '17:00',
                    notes: 'Auto-marked scheduled day',
                });
            }
        }
        if (records.length === 0) {
            setMessage('All scheduled days are already marked for all employees.');
            return;
        }
        try {
            const res = await apiFetch(`/clients/${clientId}/attendance/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ records }),
            });
            if (res.ok) {
                setMessage(`Marked ${records.length} scheduled days as Present across ${employees.length} employees.`);
                const attRes = await apiFetch(`/clients/${clientId}/attendance?dateFrom=${period}-01&dateTo=${period}-${String(totalDays).padStart(2, '0')}`);
                if (attRes.ok) {
                    const recs: AttendanceRecord[] = await attRes.json();
                    const newMap = new Map<string, AttendanceRecord>();
                    for (const r of recs) newMap.set(`${r.employeeId}-${r.date}`, r);
                    setAttendanceMap(newMap);
                    recomputeAllSummaries(newMap);
                }
            } else {
                setError('Bulk mark failed');
            }
        } catch {
            setError('Network error during bulk mark');
        }
    };

    const recomputeAllSummaries = (map: Map<string, AttendanceRecord>) => {
        setSummaries(prev => {
            const next = new Map(prev);
            for (const emp of employees) {
                let absent = 0;
                let absentHours = 0;
                let late = 0;
                let lateCount = 0;
                let half = 0;
                let present = 0;
                let leave = 0;
                let off = 0;
                let totalStdHours = 0;
                let otHours = 0;
                let paidLeaveHours = 0;
                let unpaidLeaveHours = 0;
                const dailyHours = getStandardWorkingHours(emp.standardCheckIn, emp.standardCheckOut);
                const ws = emp.workScheduleId ? schedules.get(emp.workScheduleId) : null;
                const config = ws ? parseConfig(ws.config) : null;
                for (let d = 1; d <= totalDays; d++) {
                    const dateStr = `${period}-${String(d).padStart(2, '0')}`;
                    const rec = map.get(`${emp.id}-${dateStr}`);
                    const leaveInfo = isOnLeave(emp.id, dateStr, leaveRequests);

                    if (rec) {
                        if (rec.status === 'Absent') {
                            const date = new Date(year, month - 1, d);
                            const dayName = DAY_LABELS[date.getDay()];
                            absentHours += config ? (config[dayName] || 0) : dailyHours;
                            absent += 1;
                            continue;
                        }
                        if (rec.status === 'Off Day') { off += 1; continue; }
                        if (rec.status === 'On Leave') {
                            leave += 1;
                            if (leaveInfo && leaveInfo.isPaid === 1) {
                                paidLeaveHours += leaveInfo.hours || dailyHours;
                            } else {
                                unpaidLeaveHours += leaveInfo ? (leaveInfo.hours || dailyHours) : dailyHours;
                            }
                            continue;
                        }

                        const [ciH, ciM] = (rec.checkIn || emp.standardCheckIn || '08:00').split(':').map(Number);
                        const [coH, coM] = (rec.checkOut || emp.standardCheckOut || '17:00').split(':').map(Number);
                        const actualMins = Math.max(0, (coH * 60 + (coM || 0)) - (ciH * 60 + (ciM || 0)));
                        const actualHours = actualMins / 60;

                        // Compute late hours for ANY working day (not just status === 'Late')
                        const [sH, sM] = (emp.standardCheckIn || '08:00').split(':').map(Number);
                        if (!isNaN(ciH) && !isNaN(sH)) {
                            const lateMins = Math.max(0, (ciH * 60 + (ciM || 0)) - (sH * 60 + (sM || 0)));
                            if (lateMins > 0) late += lateMins / 60;
                        }

                        if (rec.status === 'Half-Day') {
                            half += 1;
                            totalStdHours += Math.min(actualHours, dailyHours * 0.5);
                        } else if (rec.status === 'Late') {
                            lateCount += 1;
                            totalStdHours += Math.min(actualHours, dailyHours);
                            otHours += Math.max(0, actualHours - dailyHours);
                        } else if (rec.status === 'Present') {
                            present += 1;
                            totalStdHours += Math.min(actualHours, dailyHours);
                            otHours += Math.max(0, actualHours - dailyHours);
                        }
                    } else if (leaveInfo) {
                        leave += 1;
                        if (leaveInfo.isPaid === 1) {
                            paidLeaveHours += leaveInfo.hours || dailyHours;
                        } else {
                            unpaidLeaveHours += leaveInfo.hours || dailyHours;
                        }
                    }
                }
                const existing = next.get(emp.id);
                if (existing) {
                    const otRate = Math.round(existing.hourlyRate * existing.overtimeMultiplier * 100) / 100;
                    const stdPay = payStructure === 'fixed'
                        ? Math.round((emp.basicPay || 0) * 100) / 100
                        : Math.round(totalStdHours * existing.hourlyRate * 100) / 100;
                    const paidLeaveAmount = payStructure === 'fixed'
                        ? 0
                        : Math.round(paidLeaveHours * existing.hourlyRate * 100) / 100;
                    const hr = existing.hourlyRate;
                    next.set(emp.id, {
                        ...existing,
                        absentDays: absent,
                        absentHours: Math.round(absentHours * 100) / 100,
                        lateHours: Math.round(late * 100) / 100,
                        halfDays: half,
                        presentDays: present + lateCount,
                        leaveDays: leave,
                        offDays: off,
                        overtimeHours: Math.round(otHours * 100) / 100,
                        totalStdHours: Math.round(totalStdHours * 100) / 100,
                        stdPay,
                        paidLeaveHours: Math.round(paidLeaveHours * 100) / 100,
                        unpaidLeaveHours: Math.round(unpaidLeaveHours * 100) / 100,
                        paidLeaveAmount,
                        overtimeRate: otRate,
                        overtimeAmount: Math.round(otHours * otRate * 100) / 100,
                        basicPay: Math.round((emp.basicPay || 0) * 100) / 100,
                        stdPayAmount: Math.round(totalStdHours * hr * 100) / 100,
                        holidayPayAmount: Math.round(existing.holidayHours * hr * 100) / 100,
                        paidLeavePayAmount: Math.round(paidLeaveHours * hr * 100) / 100,
                        absentDedAmount: Math.round(absentHours * hr * 100) / 100,
                        lateDedAmount: Math.round(late * hr * 100) / 100,
                        unpaidLeaveDedAmount: Math.round(unpaidLeaveHours * hr * 100) / 100,
                    });
                }
            }
            return next;
        });
    };

    const computedBasicPay = (emp: Employee): number => {
        const s = summaries.get(emp.id);
        if (!s) return emp.basicPay;
        const structure = emp.payStructure || 'fixed';
        if (structure === 'prorated') {
            // Prorated: earnings from hours worked + holiday + paid leave + overtime
            const computed = s.stdPayAmount + s.holidayPayAmount + s.paidLeavePayAmount + s.overtimeAmount;
            return Math.max(0, Math.round(computed * 100) / 100);
        }
        // Fixed: contractual basic minus deductions plus overtime
        const computed = s.basicPay - s.absentDedAmount - s.lateDedAmount - s.unpaidLeaveDedAmount + s.overtimeAmount;
        return Math.max(0, Math.round(computed * 100) / 100);
    };

    const handleDeleteEmployee = async (id: number) => {
        if (!window.confirm('Delete this employee?')) return;
        try {
            const res = await apiFetch(`/clients/${clientId}/employees/${id}`, { method: 'DELETE' });
            if (res.ok) loadData();
        } catch { /* ignore */ }
    };

    const handleApprove = useCallback(async (): Promise<boolean> => {
        if (employees.length === 0) return true;
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            const payload = employees.map(emp => {
                const s = summaries.get(emp.id);
                // Collect the exact dates marked Absent in the calendar so the backend
                // creates attendance records for those specific days instead of guessing
                // the last N work days.
                const absentDates: string[] = [];
                for (const [key, rec] of attendanceMap.entries()) {
                    if (key.startsWith(`${emp.id}-`) && rec.status === 'Absent') {
                        absentDates.push(rec.date);
                    }
                }
                return {
                    employeeId: emp.id,
                    employeeName: emp.employeeName,
                    absentDays: absentDates.length,
                    absentDates,
                    absentHours: s?.absentHours || 0,
                    absentDedAmount: s?.absentDedAmount || 0,
                    lateHours: s?.lateHours || 0,
                    lateDedAmount: s?.lateDedAmount || 0,
                    unpaidLeaveDays: 0, // populated by backend from leave requests
                    unpaidLeaveHours: s?.unpaidLeaveHours || 0,
                    unpaidLeaveDedAmount: s?.unpaidLeaveDedAmount || 0,
                    overtimeHours: s?.overtimeHours || 0,
                    overtimeRate: s?.hourlyRate || 0,
                    overtimeMultiplier: s?.overtimeMultiplier || 1.5,
                    overtimeAmount: s?.overtimeAmount || 0,
                    totalStdHours: s?.totalStdHours || 0,
                    totalScheduledHours: s?.totalScheduledHours || 0,
                    hourlyRate: s?.hourlyRate || 0,
                    computedBasicPay: computedBasicPay(emp),
                };
            });
            const res = await apiFetch(`/clients/${clientId}/attendance-payroll-approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ period, employees: payload, approvedBy: 'admin' }),
            });
            if (res.ok) {
                setMessage('Attendance approved and saved.');
                setApproved(true);
                onApproved?.();
                return true;
            } else {
                const d = await res.json();
                setError(d.message || 'Failed to save approval');
                return false;
            }
        } catch {
            setError('Network error during approval');
            return false;
        } finally {
            setSaving(false);
        }
    }, [employees, summaries, period, clientId, onApproved]);

    useEffect(() => {
        if (onRegisterApprove) {
            onRegisterApprove(handleApprove);
        }
    }, [onRegisterApprove, handleApprove]);

    const cellClass = (status: string | undefined, holInfo: { isHoliday: boolean; label?: string; isOffDay?: boolean }, leaveInfo: LeaveRequest | null) => {
        if (leaveInfo) {
            return leaveInfo.isPaid === 1
                ? 'bg-purple-50 text-purple-700 border-purple-200'
                : 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200';
        }
        if (status) {
            switch (status) {
                case 'Present': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
                case 'Absent': return 'bg-rose-50 text-rose-700 border-rose-200';
                case 'Late': return 'bg-amber-50 text-amber-700 border-amber-200';
                case 'Half-Day': return 'bg-blue-50 text-blue-700 border-blue-200';
                case 'On Leave': return 'bg-purple-50 text-purple-700 border-purple-200';
                case 'Off Day': return 'bg-slate-100 text-slate-400 border-slate-200';
            }
        }
        if (holInfo.isHoliday) {
            if (holInfo.isOffDay) return 'bg-slate-100 text-slate-400 border-slate-200';
            return 'bg-orange-50 text-orange-600 border-orange-200';
        }
        return 'bg-white text-slate-300 border-slate-100';
    };

    const cellLabel = (status: string | undefined, holInfo: { isHoliday: boolean; label?: string; isOffDay?: boolean }, leaveInfo: LeaveRequest | null) => {
        if (leaveInfo) return leaveInfo.isPaid === 1 ? 'Vp' : 'Vu';
        if (status) {
            const map: Record<string, string> = { 'Present': 'P', 'Absent': 'A', 'Late': 'L', 'Half-Day': 'H', 'On Leave': 'V', 'Off Day': 'O' };
            return map[status] || '·';
        }
        if (holInfo.isHoliday) {
            return holInfo.isOffDay ? 'O' : 'H';
        }
        return '·';
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <CalendarCheck className="h-5 w-5 text-slate-500" />
                    <div>
                        <h3 className="text-sm font-bold text-slate-900">Attendance Calendar</h3>
                        <p className="text-xs text-slate-500">Click a day cell to record attendance details</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => { setModalEmployee(null); setModalOpen(true); }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff0613] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#d80000] transition"
                    >
                        <Plus className="h-3.5 w-3.5" /> Add Employee
                    </button>
                    <button
                        onClick={bulkMarkScheduledDays}
                        disabled={loading || employees.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
                    >
                        <CalendarDays className="h-3.5 w-3.5" /> Mark All Scheduled Days
                    </button>
                    <div className="flex items-center rounded-lg border border-slate-200 bg-white overflow-hidden">
                        <button
                            onClick={() => {
                                setPayStructure('fixed');
                                employees.forEach(emp => {
                                    if (emp.employmentStatus === 'Active') {
                                        apiFetch(`/clients/${clientId}/employees/${emp.id}`, {
                                            method: 'PUT',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ payStructure: 'fixed' }),
                                        }).catch(() => {});
                                    }
                                });
                            }}
                            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
                                payStructure === 'fixed'
                                    ? 'bg-slate-900 text-white'
                                    : 'text-slate-500 hover:bg-slate-50'
                            }`}
                        >
                            Fixed Monthly
                        </button>
                        <button
                            onClick={() => {
                                setPayStructure('prorated');
                                employees.forEach(emp => {
                                    if (emp.employmentStatus === 'Active') {
                                        apiFetch(`/clients/${clientId}/employees/${emp.id}`, {
                                            method: 'PUT',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ payStructure: 'prorated' }),
                                        }).catch(() => {});
                                    }
                                });
                            }}
                            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
                                payStructure === 'prorated'
                                    ? 'bg-slate-900 text-white'
                                    : 'text-slate-500 hover:bg-slate-50'
                            }`}
                        >
                            Pro-rated
                        </button>
                    </div>
                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition disabled:opacity-40"
                        title="Reload"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center font-bold text-[10px]">P</span> <span className="text-emerald-700">Present</span></span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center font-bold text-[10px]">A</span> <span className="text-rose-700">Absent</span></span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center font-bold text-[10px]">L</span> <span className="text-amber-700">Late</span></span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center font-bold text-[10px]">H</span> <span className="text-blue-700">Half-Day</span></span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-purple-50 border border-purple-200 text-purple-700 flex items-center justify-center font-bold text-[10px]">Vp</span> <span className="text-purple-700">Paid Leave</span></span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 flex items-center justify-center font-bold text-[10px]">Vu</span> <span className="text-fuchsia-700">Unpaid Leave</span></span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center font-bold text-[10px]">O</span> <span className="text-slate-500">Off Day</span></span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-orange-50 border border-orange-200 text-orange-600 flex items-center justify-center font-bold text-[10px]">H</span> <span className="text-orange-600">Holiday</span></span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-white border border-slate-200 text-slate-300 flex items-center justify-center font-bold text-[10px]">·</span> <span className="text-slate-400">Not Recorded</span></span>
                <span className="inline-flex items-center gap-1.5"><span className="relative w-5 h-5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center font-bold text-[10px]">P<span className="absolute bottom-0 right-0 block h-1.5 w-1.5 rounded-full bg-amber-500 ring-1 ring-white" /></span> <span className="text-slate-500">Present + Late</span></span>
            </div>

            {message && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> {message}
                </div>
            )}
            {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
                </div>
            ) : employees.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                    <div className="text-sm text-slate-500">No active employees found.</div>
                    <button
                        onClick={handleImportEmployees}
                        disabled={importing}
                        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                        {importing ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Upload className="h-3.5 w-3.5" />
                        )}
                        Import Employees from Master CSV
                    </button>
                    <p className="text-[10px] text-slate-400">Upload a Master CSV on the Company Details page first, then click here.</p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                    <table className="w-full text-left text-[10px]">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                                <th className="px-2 py-1.5 font-semibold uppercase tracking-wider text-slate-500 sticky left-0 bg-slate-50 z-10 min-w-[140px]">Employee</th>
                                {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => {
                                    const date = new Date(year, month - 1, d);
                                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                                    return (
                                        <th key={d} className={`px-1 py-1.5 font-semibold text-center w-7 ${isWeekend ? 'text-slate-300' : 'text-slate-400'}`}>{d}</th>
                                    );
                                })}
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Std Hourly</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Total Sched Hrs</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Total Std Hrs</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Holiday Hrs</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Paid Lve Hrs</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Absent Hrs</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Late Hrs</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Unpd Lve Hrs</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">OT Hrs</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">OT Mult</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Basic Pay</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Std Pay</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Holiday Pay</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Paid Lve Pay</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">OT Amt</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Absent Ded</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Late Ded</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Unpd Lve Ded</th>
                                <th className="px-2 py-1.5 font-semibold text-right text-slate-500">Computed Pay</th>
                                <th className="px-2 py-1.5 font-semibold text-center text-slate-500">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {employees.map((emp) => {
                                const s = summaries.get(emp.id);
                                const cbp = computedBasicPay(emp);
                                const ws = emp.workScheduleId ? schedules.get(emp.workScheduleId) : null;
                                const config = ws ? parseConfig(ws.config) : null;
                                return (
                                    <tr key={emp.id} className="hover:bg-slate-50/50 transition">
                                        <td className="px-2 py-1 sticky left-0 bg-white z-10 border-r border-slate-100">
                                            <button
                                                onClick={() => { setModalEmployee(emp); setModalOpen(true); }}
                                                className="font-medium text-slate-900 hover:text-[#ff0613] transition text-left whitespace-nowrap truncate"
                                            >
                                                {emp.employeeName}
                                            </button>
                                        </td>
                                        {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => {
                                            const dateStr = `${period}-${String(d).padStart(2, '0')}`;
                                            const rec = attendanceMap.get(`${emp.id}-${dateStr}`);
                                            const date = new Date(year, month - 1, d);
                                            const holInfo = isHoliday(config, year, month, d, emp.offDay, holidays);
                                            const leaveInfo = isOnLeave(emp.id, dateStr, leaveRequests);
                                            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                                            const isLate = isLateRecord(rec, emp.standardCheckIn || '08:00');
                                            const lateMins = rec && isLate
                                                ? ((rec.checkIn.split(':').map(Number)[0] * 60 + (rec.checkIn.split(':').map(Number)[1] || 0)) - ((emp.standardCheckIn || '08:00').split(':').map(Number)[0] * 60 + ((emp.standardCheckIn || '08:00').split(':').map(Number)[1] || 0)))
                                                : 0;
                                            const tooltip = rec
                                                ? `${rec.status} (${rec.checkIn || '--:--'} - ${rec.checkOut || '--:--'})${isLate ? ` — Late by ${Math.round(lateMins)} min` : ''}`
                                                : leaveInfo
                                                    ? `${leaveInfo.isPaid === 1 ? 'Paid' : 'Unpaid'} Leave: ${leaveInfo.leaveType}${leaveInfo.hours ? ` (${leaveInfo.hours}h)` : ''}`
                                                    : holInfo.label || 'Not recorded';
                                            return (
                                                <td key={d} className="px-0.5 py-1 text-center">
                                                    <button
                                                        onClick={() => openCellModal(emp.id, d)}
                                                        className={`relative w-6 h-6 rounded border text-[9px] font-bold transition ${cellClass(rec?.status, holInfo, leaveInfo)} ${isWeekend && !rec && !leaveInfo ? 'opacity-50' : ''}`}
                                                        title={tooltip}
                                                    >
                                                        {cellLabel(rec?.status, holInfo, leaveInfo)}
                                                        {isLate && (
                                                            <span className="absolute bottom-0 right-0 block h-1.5 w-1.5 rounded-full bg-amber-500 ring-1 ring-white" />
                                                        )}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                        <td className="px-2 py-1 text-right">
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={s?.hourlyRate ?? 0}
                                                onChange={async (e) => {
                                                    const rate = parseFloat(e.target.value) || 0;
                                                    setSummaries(prev => {
                                                        const next = new Map(prev);
                                                        const existing = next.get(emp.id);
                                                        if (existing) {
                                                            const newBasicPay = Math.round(rate * existing.totalScheduledHours * 100) / 100;
                                                            const newOtRate = Math.round(rate * existing.overtimeMultiplier * 100) / 100;
                                                            const newStdPay = payStructure === 'fixed'
                                                                ? existing.stdPay
                                                                : Math.round(existing.totalPaidStdHours * rate * 100) / 100;
                                                            const newPaidLeaveAmount = payStructure === 'fixed'
                                                                ? 0
                                                                : Math.round(existing.paidLeaveHours * rate * 100) / 100;
                                                            next.set(emp.id, {
                                                                ...existing,
                                                                basicPay: newBasicPay,
                                                                hourlyRate: rate,
                                                                stdPay: newStdPay,
                                                                paidLeaveAmount: newPaidLeaveAmount,
                                                                overtimeRate: newOtRate,
                                                                overtimeAmount: Math.round(existing.overtimeHours * newOtRate * 100) / 100,
                                                                stdPayAmount: Math.round(existing.totalStdHours * rate * 100) / 100,
                                                                holidayPayAmount: Math.round(existing.holidayHours * rate * 100) / 100,
                                                                paidLeavePayAmount: Math.round(existing.paidLeaveHours * rate * 100) / 100,
                                                                absentDedAmount: Math.round(existing.absentHours * rate * 100) / 100,
                                                                lateDedAmount: Math.round(existing.lateHours * rate * 100) / 100,
                                                                unpaidLeaveDedAmount: Math.round(existing.unpaidLeaveHours * rate * 100) / 100,
                                                            });
                                                        }
                                                        return next;
                                                    });
                                                    try {
                                                        const existing = summaries.get(emp.id);
                                                        const newBasicPay = existing ? Math.round(rate * existing.totalScheduledHours * 100) / 100 : 0;
                                                        await apiFetch(`/clients/${clientId}/employees/${emp.id}`, {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ hourlyRate: rate, basicPay: newBasicPay }),
                                                        });
                                                    } catch { /* ignore */ }
                                                }}
                                                className="w-14 rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
                                            />
                                        </td>
                                        <td className="px-2 py-1 text-right font-mono text-slate-700">{s?.totalScheduledHours?.toFixed(1) ?? '0.0'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-blue-600">{s?.totalStdHours?.toFixed(1) ?? '0.0'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-emerald-600">{s?.holidayHours?.toFixed(1) ?? '0.0'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-purple-600">{s?.paidLeaveHours?.toFixed(1) ?? '0.0'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-rose-600">{s?.absentHours?.toFixed(1) ?? '0.0'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-amber-600">{s?.lateHours?.toFixed(1) ?? '0.0'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-fuchsia-600">{s?.unpaidLeaveHours?.toFixed(1) ?? '0.0'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-slate-900">{s?.overtimeHours?.toFixed(1) ?? '0.0'}</td>
                                        <td className="px-2 py-1 text-right">
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={s?.overtimeMultiplier ?? 1.5}
                                                onChange={(e) => {
                                                    const mult = parseFloat(e.target.value) || 1;
                                                    setSummaries(prev => {
                                                        const next = new Map(prev);
                                                        const existing = next.get(emp.id);
                                                        if (existing) {
                                                            const newOtRate = Math.round(existing.hourlyRate * mult * 100) / 100;
                                                            next.set(emp.id, {
                                                                ...existing,
                                                                overtimeMultiplier: mult,
                                                                overtimeRate: newOtRate,
                                                                overtimeAmount: Math.round(existing.overtimeHours * newOtRate * 100) / 100,
                                                            });
                                                        }
                                                        return next;
                                                    });
                                                }}
                                                className="w-10 rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
                                            />
                                        </td>
                                        <td className="px-2 py-1 text-right font-mono font-semibold text-slate-900">{s?.basicPay?.toFixed(2) ?? '0.00'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-slate-900">{s?.stdPayAmount?.toFixed(2) ?? '0.00'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-emerald-700">{s?.holidayPayAmount?.toFixed(2) ?? '0.00'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-purple-700">{s?.paidLeavePayAmount?.toFixed(2) ?? '0.00'}</td>
                                        <td className="px-2 py-1 text-right font-mono font-semibold text-slate-900">{s?.overtimeAmount?.toFixed(2) ?? '0.00'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-rose-600">{s?.absentDedAmount?.toFixed(2) ?? '0.00'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-amber-700">{s?.lateDedAmount?.toFixed(2) ?? '0.00'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-fuchsia-700">{s?.unpaidLeaveDedAmount?.toFixed(2) ?? '0.00'}</td>
                                        <td className="px-2 py-1 text-right font-mono font-bold text-emerald-700">{cbp.toLocaleString()}</td>
                                        <td className="px-2 py-1 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() => { setModalEmployee(emp); setModalOpen(true); }}
                                                    className="p-1 rounded hover:bg-blue-50 text-blue-600 transition"
                                                    title="Edit employee"
                                                >
                                                    <Pencil className="h-3 w-3" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteEmployee(emp.id)}
                                                    className="p-1 rounded hover:bg-red-50 text-red-500 transition"
                                                    title="Delete employee"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-400">
                    {employees.length} employees
                    {approved && <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 font-semibold"><CheckCircle2 className="h-3 w-3" /> Approved</span>}
                </p>
                {saving && (
                    <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
                        <RefreshCw className="h-3 w-3 animate-spin" /> Saving...
                    </span>
                )}
            </div>

            {/* Employee Edit Modal */}
            <EmployeeEditModal
                clientId={clientId}
                employee={modalEmployee}
                open={modalOpen}
                onClose={() => { setModalOpen(false); setModalEmployee(null); }}
                onSaved={loadData}
            />

            {/* Cell Detail Modal */}
            {cellModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                            <h3 className="text-sm font-bold text-slate-900">
                                {employees.find(e => e.id === cellModal.employeeId)?.employeeName} — {period}-{String(cellModal.day).padStart(2, '0')}
                            </h3>
                            <button onClick={() => setCellModal(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 transition">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="px-5 py-4 space-y-3">
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</label>
                                <select
                                    value={cellForm.status}
                                    onChange={(e) => setCellForm(f => ({ ...f, status: e.target.value }))}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                                >
                                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Check-In</label>
                                    <input
                                        type="time"
                                        value={cellForm.checkIn}
                                        onChange={(e) => setCellForm(f => ({ ...f, checkIn: e.target.value }))}
                                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Check-Out</label>
                                    <input
                                        type="time"
                                        value={cellForm.checkOut}
                                        onChange={(e) => setCellForm(f => ({ ...f, checkOut: e.target.value }))}
                                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Notes</label>
                                <textarea
                                    value={cellForm.notes}
                                    onChange={(e) => setCellForm(f => ({ ...f, notes: e.target.value }))}
                                    rows={2}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none resize-none"
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
                            {cellModal.record?.id && cellModal.record.id > 0 && (
                                <button
                                    onClick={deleteCell}
                                    className="mr-auto rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition"
                                >
                                    Delete
                                </button>
                            )}
                            <button onClick={() => setCellModal(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">Cancel</button>
                            <button onClick={saveCell} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition">Save</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
