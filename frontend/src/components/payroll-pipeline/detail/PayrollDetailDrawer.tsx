import { useState, useEffect, useCallback } from 'react';
import {
  X, Save, CalendarCheck, Banknote, User, FileText, Eye, Mail, Download, FileSpreadsheet,
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';
import { calculatePayrollPreview } from '../../../utils/payrollEngine';
import { AttendanceCalendarGrid } from '../steps/AttendanceCalendarGrid';

interface PayrollDetailDrawerProps {
  entry: PayrollEntry;
  clientId: string;
  runId?: number;
  period?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface PayrollEntry {
  id: number;
  employeeId: number;
  employeeName: string;
  kraPin: string;
  basicPay: number;
  carBenefit: number;
  mealsBenefit: number;
  nonCashBenefits: number;
  housingBenefit: number;
  otherBenefits: number;
  bonusPay: number;
  overtimePay: number;
  grossPay: number;
  shaDeduction: number;
  nssfDeduction: number;
  ahlDeduction: number;
  taxablePay: number;
  payeTax: number;
  loanDeduction: number;
  otherDeductions: number;
  totalDeductions: number;
  netPay: number;
  daysWorked: number;
  personalRelief: number;
  otherPension?: number;
  postRetMedical?: number;
  mortgageInterest?: number;
  insuranceRelief?: number;
}

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

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseConfig(config: any) {
  if (!config) return null;
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return null; }
  }
  return config;
}

function isHoliday(config: any, year: number, month: number, day: number, offDay: string | null, holidays: Holiday[]) {
  const date = new Date(year, month - 1, day);
  const dayName = DAY_LABELS[date.getDay()];
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const monthDay = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  for (const h of holidays) {
    if (h.date === dateStr) return { isHoliday: true, label: h.name || 'Holiday' };
    if (h.isRecurring === 1) {
      const hd = h.date.substring(5);
      if (hd === monthDay) return { isHoliday: true, label: h.name || 'Holiday' };
    }
  }

  if (config && config[dayName] === 0) return { isHoliday: true, label: 'Off Day', isOffDay: true };
  if (!config && (date.getDay() === 0 || date.getDay() === 6)) return { isHoliday: true, label: 'Off Day', isOffDay: true };
  if (offDay && offDay.startsWith(FULL_DAY_NAMES[date.getDay()])) return { isHoliday: true, label: 'Off Day', isOffDay: true };

  return { isHoliday: false };
}

function isOnLeave(employeeId: number, dateStr: string, leaveRequests: LeaveRequest[]) {
  for (const lr of leaveRequests) {
    if (lr.employeeId !== employeeId) continue;
    if (lr.status !== 'Approved') continue;
    if (dateStr >= lr.startDate && dateStr <= lr.endDate) return lr;
  }
  return null;
}

export function PayrollDetailDrawer({ entry, clientId, runId, period, onClose, onSaved }: PayrollDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<'attendance' | 'payroll' | 'payslip' | 'employee'>('payroll');
  const [showFullGrid, setShowFullGrid] = useState(false);

  const [draft, setDraft] = useState<Partial<PayrollEntry>>({ ...entry });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const [employee, setEmployee] = useState<any>(null);
  const [employeeSaving, setEmployeeSaving] = useState(false);

  // Attendance sync data
  const [schedules, setSchedules] = useState<Map<number, WorkSchedule>>(new Map());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);

  const [workSchedulesList, setWorkSchedulesList] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);

  const fetchAttendance = useCallback(async () => {
    if (!period) return;
    try {
      const [year, month] = period.split('-');
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const res = await apiFetch(`/clients/${clientId}/attendance?dateFrom=${period}-01&dateTo=${period}-${String(lastDay).padStart(2, '0')}`);
      if (res.ok) {
        const data = await res.json();
        setAttendanceRecords(data.filter((r: any) => r.employeeId === entry.employeeId));
      }
    } catch { /* ignore */ }
  }, [clientId, entry.employeeId, period]);

  const fetchLoans = useCallback(async () => {
    try {
      const res = await apiFetch(`/clients/${clientId}/loans?employeeId=${entry.employeeId}`);
      if (res.ok) setLoans(await res.json());
    } catch { /* ignore */ }
  }, [clientId, entry.employeeId]);

  const fetchEmployee = useCallback(async () => {
    try {
      const res = await apiFetch(`/clients/${clientId}/employees/${entry.employeeId}`);
      if (res.ok) {
        setEmployee(await res.json());
        return;
      }
    } catch { /* ignore */ }
    try {
      const res = await apiFetch(`/clients/${clientId}/employees`);
      if (res.ok) {
        const list = await res.json();
        const match = list.find((e: any) => String(e.id) === String(entry.employeeId));
        if (match) setEmployee(match);
      }
    } catch { /* ignore */ }
  }, [clientId, entry.employeeId]);

  const fetchScheduleData = useCallback(async () => {
    if (!period) return;
    try {
      const [schedRes, holRes, leaveRes] = await Promise.all([
        apiFetch(`/clients/${clientId}/work-schedules`),
        apiFetch(`/clients/${clientId}/holidays`),
        apiFetch(`/clients/${clientId}/leave`),
      ]);
      const schedMap = new Map<number, WorkSchedule>();
      if (schedRes.ok) {
        const list: WorkSchedule[] = await schedRes.json();
        for (const s of list) schedMap.set(s.id, s);
      }
      setSchedules(schedMap);
      if (holRes.ok) setHolidays(await holRes.json());
      if (leaveRes.ok) setLeaveRequests(await leaveRes.json());
    } catch { /* ignore */ }
  }, [clientId, period]);

  useEffect(() => {
    fetchAttendance();
    fetchLoans();
    fetchEmployee();
    fetchScheduleData();
  }, [fetchAttendance, fetchLoans, fetchEmployee, fetchScheduleData]);

  useEffect(() => {
    if (activeTab === 'employee') {
      apiFetch(`/clients/${clientId}/work-schedules`).then(r => r.ok ? r.json() : []).then(setWorkSchedulesList).catch(() => setWorkSchedulesList([]));
      apiFetch(`/clients/${clientId}/departments`).then(r => r.ok ? r.json() : []).then(setDepartments).catch(() => setDepartments([]));
    }
  }, [activeTab, clientId]);

  const handleSavePayroll = async () => {
    if (!runId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/update-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: entry.employeeId,
          basicPay: draft.basicPay,
          carBenefit: draft.carBenefit,
          mealsBenefit: draft.mealsBenefit,
          nonCashBenefits: draft.nonCashBenefits,
          housingBenefit: draft.housingBenefit,
          otherBenefits: draft.otherBenefits,
          bonusPay: draft.bonusPay,
          overtimePay: draft.overtimePay,
          otherDeductions: draft.otherDeductions,
          loanDeduction: draft.loanDeduction,
        }),
      });
      if (res.ok) {
        onSaved();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.message || 'Save failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEmployee = async () => {
    if (!employee) return;
    setEmployeeSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/clients/${clientId}/employees/${employee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employee),
      });
      if (res.ok) {
        onSaved();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.message || 'Save failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setEmployeeSaving(false);
    }
  };

  const updateDraft = (field: keyof PayrollEntry, value: any) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateEmployee = (field: string, value: any) => {
    setEmployee((prev: any) => ({ ...prev, [field]: value }));
  };

  const preview = calculatePayrollPreview({
    employeeId: entry.employeeId,
    employeeName: entry.employeeName,
    kraPin: entry.kraPin,
    payrollNumber: '',
    basicPay: draft.basicPay ?? entry.basicPay,
    carBenefit: draft.carBenefit ?? entry.carBenefit,
    mealsBenefit: draft.mealsBenefit ?? entry.mealsBenefit,
    nonCashBenefits: draft.nonCashBenefits ?? entry.nonCashBenefits,
    housingBenefit: draft.housingBenefit ?? entry.housingBenefit,
    otherBenefits: draft.otherBenefits ?? entry.otherBenefits,
    dateJoined: employee?.dateJoined || '',
    dateLeft: null,
    employmentStatus: employee?.employmentStatus || 'Active',
    otherPension: draft.otherPension ?? 0,
    postRetMedical: draft.postRetMedical ?? 0,
    mortgageInterest: draft.mortgageInterest ?? 0,
    insuranceRelief: draft.insuranceRelief ?? 0,
    bonusPay: draft.bonusPay ?? entry.bonusPay,
    pwd: employee?.pwd || 'No',
  }, period || '2026-01', false);

  const attMap = new Map<string, any>();
  for (const r of attendanceRecords) attMap.set(r.date, r);

  const [year, month] = (period || '2026-01').split('-').map(Number);
  const daysInMonthCount = new Date(year, month, 0).getDate();

  // Compute synced attendance summary using the same logic as AttendanceCalendarGrid
  const computeSyncedSummary = () => {
    const ws = employee?.workScheduleId ? schedules.get(employee.workScheduleId) : null;
    const config = ws ? parseConfig(ws.config) : null;

    let present = 0;
    let absent = 0;
    let lateCount = 0;
    let half = 0;
    let leave = 0;
    let off = 0;
    let holiday = 0;

    for (let d = 1; d <= daysInMonthCount; d++) {
      const dateStr = `${period}-${String(d).padStart(2, '0')}`;
      const rec = attMap.get(dateStr);
      const leaveInfo = isOnLeave(entry.employeeId, dateStr, leaveRequests);
      const holInfo = isHoliday(config, year, month, d, employee?.offDay || null, holidays);

      if (holInfo.isHoliday && !holInfo.isOffDay) {
        holiday += 1;
        continue;
      }

      if (rec) {
        if (rec.status === 'Absent') { absent += 1; continue; }
        if (rec.status === 'Off Day') { off += 1; continue; }
        if (rec.status === 'On Leave') { leave += 1; continue; }
        if (rec.status === 'Half-Day') { half += 1; continue; }
        if (rec.status === 'Late') { lateCount += 1; present += 1; continue; }
        if (rec.status === 'Present') { present += 1; continue; }
      } else if (leaveInfo) {
        leave += 1;
        continue;
      }

      // Default: Present if it's a scheduled work day with no record
      if (!holInfo.isHoliday) {
        present += 1;
      } else {
        off += 1;
      }
    }

    return { present, absent, lateCount, half, leave, off, holiday };
  };

  const syncedSummary = computeSyncedSummary();

  const tabs = [
    { key: 'attendance' as const, label: 'Attendance', icon: CalendarCheck },
    { key: 'payroll' as const, label: 'Payroll', icon: Banknote },
    { key: 'payslip' as const, label: 'Payslip', icon: FileText },
    { key: 'employee' as const, label: 'Employee', icon: User },
  ];

  // Employee edit form fields
  const employeeTextFields = [
    { key: 'employeeName', label: 'Full Name' },
    { key: 'payrollNumber', label: 'Payroll No' },
    { key: 'idNumber', label: 'ID Number' },
    { key: 'kraPin', label: 'KRA PIN' },
    { key: 'nssfNo', label: 'NSSF No' },
    { key: 'shaNo', label: 'SHA No' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'bankName', label: 'Bank Name' },
    { key: 'bankAccount', label: 'Bank Account' },
    { key: 'bankCode', label: 'Bank Code' },
    { key: 'jobTitle', label: 'Job Title' },
    { key: 'dateJoined', label: 'Date Joined' },
  ];

  const downloadBlob = async (url: string, filename: string) => {
    try {
      const res = await apiFetch(url);
      if (!res.ok) { setError('Download failed'); return; }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch { setError('Download error'); }
  };

  const handleDownloadPayslip = () => {
    if (!employee?.kraPin) return;
    const [y, m] = (period || '').split('-');
    const periodParam = m && y ? `${m}${y}` : '';
    const url = `/clients/${clientId}/payslip/${employee.kraPin}${periodParam ? `?period=${periodParam}` : ''}`;
    downloadBlob(url, `payslip-${employee.kraPin}.pdf`);
  };

  const handleDownloadP9 = () => {
    if (!employee?.kraPin) return;
    const yearStr = period ? period.split('-')[0] : String(new Date().getFullYear());
    const url = `/clients/${clientId}/p9/${employee.kraPin}?year=${yearStr}`;
    downloadBlob(url, `P9-${employee.kraPin}-${yearStr}.pdf`);
  };

  const handleEmailPayslip = async () => {
    if (!employee?.id) return;
    setError(null);
    try {
      const res = await apiFetch(`/clients/${clientId}/email/send-payslips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds: [employee.id] }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.message || 'Failed to send payslip email');
      }
    } catch {
      setError('Network error sending email');
    }
  };

  return (
    <>
      <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg border-l border-slate-200 bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
              <User className="h-4 w-4 text-slate-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">{entry.employeeName}</h3>
              <p className="text-xs text-slate-500">{entry.kraPin}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleDownloadPayslip} title="Download Payslip" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 transition">
              <FileSpreadsheet className="h-4 w-4" />
            </button>
            <button onClick={handleDownloadP9} title="Download P9" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 transition">
              <Download className="h-4 w-4" />
            </button>
            <button onClick={handleEmailPayslip} title="Email Payslip" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 transition">
              <Mail className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold transition border-b-2',
                  activeTab === t.key ? 'text-[#ff0613] border-[#ff0613]' : 'text-slate-500 border-transparent hover:text-slate-700'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {activeTab === 'attendance' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">{period} Attendance</h4>
                <button
                  onClick={() => setShowFullGrid(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  <Eye className="h-3 w-3" /> Open Full Grid
                </button>
              </div>

              {/* Compact 31-day badges */}
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: daysInMonthCount }, (_, i) => i + 1).map((day) => {
                  const dateStr = `${period}-${String(day).padStart(2, '0')}`;
                  const rec = attMap.get(dateStr);
                  const status = rec?.status || 'Present';
                  const badge = (
                    status === 'Present' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    status === 'Absent' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                    status === 'Late' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    status === 'Half-Day' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    'bg-slate-50 text-slate-500 border-slate-200'
                  );
                  return (
                    <div key={day} className="flex flex-col items-center">
                      <span className="text-[9px] text-slate-400">{day}</span>
                      <button
                        className={cn('h-7 w-7 rounded border flex items-center justify-center text-[10px] font-bold transition hover:opacity-80', badge)}
                        title={status}
                      >
                        {status.charAt(0)}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Synced Summary */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Present', count: syncedSummary.present, color: 'text-emerald-700 bg-emerald-50' },
                  { label: 'Absent', count: syncedSummary.absent, color: 'text-rose-700 bg-rose-50' },
                  { label: 'Late', count: syncedSummary.lateCount, color: 'text-amber-700 bg-amber-50' },
                  { label: 'Half-Day', count: syncedSummary.half, color: 'text-blue-700 bg-blue-50' },
                  { label: 'Leave', count: syncedSummary.leave, color: 'text-violet-700 bg-violet-50' },
                  { label: 'Off', count: syncedSummary.off, color: 'text-slate-600 bg-slate-50' },
                  { label: 'Holiday', count: syncedSummary.holiday, color: 'text-pink-700 bg-pink-50' },
                ].map((s) => (
                  <div key={s.label} className={cn('rounded-lg border p-2 text-center', s.color)}>
                    <p className="text-lg font-bold">{s.count}</p>
                    <p className="text-[10px] font-semibold">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'payroll' && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Edit Payroll</h4>
              {[
                { key: 'basicPay', label: 'Basic Pay' },
                { key: 'carBenefit', label: 'Car Benefit' },
                { key: 'mealsBenefit', label: 'Meals' },
                { key: 'nonCashBenefits', label: 'Non-Cash' },
                { key: 'housingBenefit', label: 'Housing' },
                { key: 'otherBenefits', label: 'Other Benefits' },
                { key: 'bonusPay', label: 'Bonus Pay' },
                { key: 'overtimePay', label: 'Overtime' },
                { key: 'loanDeduction', label: 'Loan Deduction' },
                { key: 'otherDeductions', label: 'Other Deductions' },
              ].map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-slate-600">{f.label}</label>
                  <input
                    type="number"
                    value={(draft as any)[f.key] ?? (entry as any)[f.key] ?? 0}
                    onChange={(e) => updateDraft(f.key as keyof PayrollEntry, parseFloat(e.target.value) || 0)}
                    className="w-28 rounded border border-slate-200 bg-white px-2 py-1 text-right font-mono text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </div>
              ))}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button onClick={() => setDraft({ ...entry })} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Reset</button>
                <button onClick={handleSavePayroll} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40">
                  {saving ? 'Saving...' : <><Save className="h-3 w-3" /> Save</>}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'payslip' && (
            <div className="space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Payslip Preview</h4>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Basic Pay', value: (draft.basicPay ?? entry.basicPay) },
                  { label: 'Gross Pay', value: preview.grossPay },
                  { label: 'Taxable Pay', value: preview.taxablePay },
                  { label: 'Net Pay', value: preview.netPay },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase">{item.label}</p>
                    <p className={cn('text-sm font-mono font-bold', item.label === 'Net Pay' ? 'text-emerald-700' : 'text-slate-900')}>
                      {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {[
                  { label: 'SHA', value: preview.shaDeduction },
                  { label: 'NSSF', value: preview.nssfDeduction },
                  { label: 'AHL', value: preview.ahlDeduction },
                  { label: 'PAYE', value: preview.payeTax },
                  { label: 'Total Deductions', value: preview.totalDeductions },
                  { label: 'Days Worked', value: preview.daysWorked },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                    <span className="text-xs text-slate-500">{item.label}</span>
                    <span className="text-xs font-mono text-slate-700">{typeof item.value === 'number' ? item.value.toFixed(2) : item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'employee' && (
            <div className="space-y-3">
              {employee ? (
                <>
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Employee Details</h4>
                    <button
                      onClick={handleSaveEmployee}
                      disabled={employeeSaving}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40"
                    >
                      {employeeSaving ? 'Saving...' : <><Save className="h-3 w-3" /> Save</>}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {employeeTextFields.map(({ key, label }) => (
                      <div key={key}>
                        <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
                        <input
                          type="text"
                          value={employee[key] || ''}
                          onChange={(e) => updateEmployee(key, e.target.value)}
                          className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                        />
                      </div>
                    ))}
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Department</label>
                      {departments.length > 0 ? (
                        <select
                          value={employee.departmentId || ''}
                          onChange={(e) => {
                            const deptId = e.target.value ? parseInt(e.target.value, 10) : null;
                            const dept = departments.find((d: any) => d.id === deptId);
                            updateEmployee('departmentId', deptId);
                            updateEmployee('department', dept?.name || '');
                          }}
                          className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                        >
                          <option value="">None</option>
                          {departments.map((d: any) => (
                            <option key={d.id} value={String(d.id)}>{d.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={employee.department || ''}
                          onChange={(e) => updateEmployee('department', e.target.value)}
                          className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                        />
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Date Left</label>
                      <input type="text" value={employee.dateLeft || ''} onChange={(e) => updateEmployee('dateLeft', e.target.value)} placeholder="Leave blank if active" className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Employment Type</label>
                      <select value={employee.employmentType || 'Permanent'} onChange={(e) => updateEmployee('employmentType', e.target.value)} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none">
                        <option>Permanent</option><option>Contract</option><option>Casual</option><option>Intern</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</label>
                      <select value={employee.employmentStatus || 'Active'} onChange={(e) => updateEmployee('employmentStatus', e.target.value)} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none">
                        <option>Active</option><option>Terminated</option><option>Resigned</option><option>Suspended</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Basic Pay (KES)</label>
                      <input type="number" value={employee.basicPay || 0} onChange={(e) => updateEmployee('basicPay', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Bonus Pay (KES)</label>
                      <input type="number" value={employee.bonusPay || 0} onChange={(e) => updateEmployee('bonusPay', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Hourly Rate (KES)</label>
                      <input type="number" step="0.01" value={employee.hourlyRate || 0} onChange={(e) => updateEmployee('hourlyRate', parseFloat(e.target.value) || 0)} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Work Schedule</label>
                      <select
                        value={employee.workScheduleId || ''}
                        onChange={(e) => {
                          const wsId = e.target.value ? parseInt(e.target.value, 10) : '';
                          const ws = workSchedulesList.find((w: any) => String(w.id) === String(wsId));
                          updateEmployee('workScheduleId', wsId);
                          if (ws) {
                            updateEmployee('standardCheckIn', ws.standardCheckIn || '08:00');
                            updateEmployee('standardCheckOut', ws.standardCheckOut || '17:00');
                          }
                        }}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                      >
                        <option value="">None / Custom</option>
                        {workSchedulesList.map((ws: any) => (
                          <option key={ws.id} value={String(ws.id)}>{ws.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Std Check-In</label>
                      <input type="time" value={employee.standardCheckIn || '08:00'} onChange={(e) => updateEmployee('standardCheckIn', e.target.value)} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Std Check-Out</label>
                      <input type="time" value={employee.standardCheckOut || '17:00'} onChange={(e) => updateEmployee('standardCheckOut', e.target.value)} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Role</label>
                      <select value={employee.role || 'employee'} onChange={(e) => updateEmployee('role', e.target.value)} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none">
                        <option value="employee">Employee</option><option value="hr">HR</option><option value="manager">Manager</option><option value="admin">Admin</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Off Day</label>
                      <select value={employee.offDay || ''} onChange={(e) => updateEmployee('offDay', e.target.value)} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none">
                        <option value="">None</option>
                        {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400">Loading employee details...</p>
              )}

              {/* Loans */}
              <div className="pt-4 border-t border-slate-100">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-1.5">
                  <Banknote className="h-3.5 w-3.5" /> Active Loans
                </h4>
                {loans.length === 0 ? (
                  <p className="text-xs text-slate-400">No active loans.</p>
                ) : (
                  <div className="space-y-1.5">
                    {loans.map((loan: any) => (
                      <div key={loan.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                        <span className="text-xs font-medium text-slate-700">{loan.type || 'Loan'}</span>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span>KES {Number(loan.amount || 0).toLocaleString()}</span>
                          <span>{loan.remainingInstallments || 0} left</span>
                          <span className="font-mono">KES {Number(loan.monthlyDeduction || 0).toLocaleString()}/mo</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full attendance grid modal */}
      {showFullGrid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900">Attendance Calendar — {entry.employeeName}</h3>
              <button onClick={() => setShowFullGrid(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition">
                <X className="h-4 w-4" />
              </button>
            </div>
            <AttendanceCalendarGrid
              clientId={clientId}
              period={period}
              onPeriodChange={() => {}}
              onApproved={() => {}}
            />
          </div>
        </div>
      )}
    </>
  );
}
