import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search, ArrowUp, ArrowDown, Download, Eye, Plus, Mail, FileSpreadsheet, FileText,
} from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';
import { calculatePayrollPreview } from '../../../utils/payrollEngine';

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
  totalStdHours: number;
  personalRelief: number;
  _overrideKeys?: string[];
}

interface PayRegisterTableProps {
  clientId: string;
  runId?: number;
  period?: string;
  refreshToken?: number;
  onSelectEntry?: (entry: PayrollEntry) => void;
  onRefresh?: () => void;
  onAddEmployee?: () => void;
}

export function PayRegisterTable({ clientId, runId, period, refreshToken, onSelectEntry, onRefresh, onAddEmployee }: PayRegisterTableProps) {
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [unsavedIds, setUnsavedIds] = useState<Set<number>>(new Set());
  const [selectedDept, setSelectedDept] = useState('');
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState<string | null>(null);

  const debounceRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const fetchEntries = useCallback(async () => {
    if (!runId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [entriesRes, deptRes] = await Promise.all([
        apiFetch(`/clients/${clientId}/payroll-runs/${runId}/entries`),
        apiFetch(`/clients/${clientId}/departments`),
      ]);
      if (entriesRes.ok) {
        const data = await entriesRes.json();
        setEntries(data);
      }
      if (deptRes.ok) {
        setDepartments(await deptRes.json());
      }
    } catch {
      setError('Failed to load entries');
    } finally {
      setLoading(false);
    }
  }, [clientId, runId]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries, refreshToken]);

  const computeRow = useCallback((entry: PayrollEntry): PayrollEntry => {
    const preview = calculatePayrollPreview({
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      kraPin: entry.kraPin,
      payrollNumber: '',
      basicPay: entry.basicPay,
      carBenefit: entry.carBenefit,
      mealsBenefit: entry.mealsBenefit,
      nonCashBenefits: entry.nonCashBenefits,
      housingBenefit: entry.housingBenefit,
      otherBenefits: entry.otherBenefits,
      dateJoined: '',
      dateLeft: null,
      employmentStatus: 'Active',
      otherPension: 0,
      postRetMedical: 0,
      mortgageInterest: 0,
      insuranceRelief: 0,
      bonusPay: entry.bonusPay,
      pwd: 'No',
    }, period || '2026-01', false);

    return {
      ...entry,
      grossPay: preview.grossPay,
      shaDeduction: preview.shaDeduction,
      nssfDeduction: preview.nssfDeduction,
      ahlDeduction: preview.ahlDeduction,
      taxablePay: preview.taxablePay || 0,
      payeTax: preview.payeTax,
      totalDeductions: preview.totalDeductions || 0,
      netPay: preview.netPay,
    };
  }, [period]);

  const updateField = useCallback((entryId: number, field: keyof PayrollEntry, value: number) => {
    setEntries((prev) => {
      const next = prev.map((e) => {
        if (e.id !== entryId) return e;
        const updated = { ...e, [field]: value };
        return computeRow(updated);
      });
      return next;
    });
    setUnsavedIds((prev) => new Set(prev).add(entryId));

    if (debounceRef.current[entryId]) {
      clearTimeout(debounceRef.current[entryId]);
    }
    debounceRef.current[entryId] = setTimeout(() => {
      autoSave(entryId);
    }, 500);
  }, [computeRow]);

  const autoSave = async (entryId: number) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry || !runId) return;
    try {
      const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/update-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: entry.employeeId,
          basicPay: entry.basicPay,
          carBenefit: entry.carBenefit,
          mealsBenefit: entry.mealsBenefit,
          nonCashBenefits: entry.nonCashBenefits,
          housingBenefit: entry.housingBenefit,
          otherBenefits: entry.otherBenefits,
          bonusPay: entry.bonusPay,
          overtimePay: entry.overtimePay,
          absentDays: entry.daysWorked,
          lateHours: 0,
          unpaidLeaveDays: 0,
          insuranceRelief: 0,
          otherDeductions: entry.otherDeductions,
          loanDeduction: entry.loanDeduction,
        }),
      });
      if (res.ok) {
        setUnsavedIds((prev) => {
          const next = new Set(prev);
          next.delete(entryId);
          return next;
        });
        onRefresh?.();
      }
    } catch {
      // ignore
    }
  };

  const exportCSV = () => {
    const headers = [
      'employeeName', 'kraPin', 'basicPay', 'carBenefit', 'mealsBenefit',
      'nonCashBenefits', 'housingBenefit', 'otherBenefits', 'bonusPay', 'grossPay',
      'shaDeduction', 'nssfDeduction', 'ahlDeduction', 'taxablePay', 'payeTax',
      'loanDeduction', 'otherDeductions', 'totalDeductions', 'netPay',
    ];
    const csvRows = [
      headers.join(','),
      ...entries.map((e) => headers.map((h) => String((e as any)[h] ?? '')).join(',')),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${clientId}-${runId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadBlob = async (url: string, filename: string) => {
    try {
      const res = await apiFetch(url);
      if (!res.ok) { alert('Download failed'); return; }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch { alert('Download error'); }
  };

  const handleDownloadPayslip = (entry: PayrollEntry) => {
    const [y, m] = (period || '').split('-');
    const periodParam = m && y ? `${m}${y}` : '';
    const queryParams = new URLSearchParams();
    if (periodParam) queryParams.set('period', periodParam);
    if (runId) queryParams.set('runId', String(runId));
    const url = `/clients/${clientId}/payslip/${entry.kraPin}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    downloadBlob(url, `payslip-${entry.kraPin}.pdf`);
  };

  const handleDownloadP9 = (entry: PayrollEntry) => {
    const yearStr = period ? period.split('-')[0] : String(new Date().getFullYear());
    const params = new URLSearchParams({ year: yearStr });
    if (runId) params.set('runId', String(runId));
    const url = `/clients/${clientId}/p9/${entry.kraPin}?${params.toString()}`;
    downloadBlob(url, `P9-${entry.kraPin}-${yearStr}.pdf`);
  };

  const handleEmailPayslip = async (entry: PayrollEntry) => {
    try {
      await apiFetch(`/clients/${clientId}/email/send-payslips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds: [entry.employeeId] }),
      });
    } catch { /* ignore */ }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((e) => e.id)));
    }
  };

  const getSelectedEmployeeIds = () => {
    return entries.filter((e) => selectedIds.has(e.id)).map((e) => e.employeeId);
  };

  const handleBulkEmailPayslips = async () => {
    const ids = getSelectedEmployeeIds();
    if (ids.length === 0) return;
    setBulkActionLoading('payslip-email');
    try {
      await apiFetch(`/clients/${clientId}/email/send-payslips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds: ids }),
      });
    } catch { /* ignore */ }
    setBulkActionLoading(null);
  };

  const handleBulkEmailP9s = async () => {
    const ids = getSelectedEmployeeIds();
    if (ids.length === 0) return;
    setBulkActionLoading('p9-email');
    try {
      await apiFetch(`/clients/${clientId}/email/send-p9s`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds: ids }),
      });
    } catch { /* ignore */ }
    setBulkActionLoading(null);
  };

  const handleBulkDownloadPayslips = () => {
    if (!runId) return;
    downloadBlob(`/clients/${clientId}/payroll-runs/${runId}/payslips`, `payslips-${clientId}-${runId}.zip`);
  };

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, e) => ({
        basicPay: acc.basicPay + Number(e.basicPay),
        grossPay: acc.grossPay + Number(e.grossPay || 0),
        shaDeduction: acc.shaDeduction + Number(e.shaDeduction || 0),
        nssfDeduction: acc.nssfDeduction + Number(e.nssfDeduction || 0),
        ahlDeduction: acc.ahlDeduction + Number(e.ahlDeduction || 0),
        taxablePay: acc.taxablePay + Number(e.taxablePay || 0),
        payeTax: acc.payeTax + Number(e.payeTax || 0),
        loanDeduction: acc.loanDeduction + Number(e.loanDeduction || 0),
        otherDeductions: acc.otherDeductions + Number(e.otherDeductions || 0),
        totalDeductions: acc.totalDeductions + Number(e.totalDeductions || 0),
        netPay: acc.netPay + Number(e.netPay || 0),
      }),
      { basicPay: 0, grossPay: 0, shaDeduction: 0, nssfDeduction: 0, ahlDeduction: 0, taxablePay: 0, payeTax: 0, loanDeduction: 0, otherDeductions: 0, totalDeductions: 0, netPay: 0 }
    );
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries.filter((e) =>
      e.employeeName.toLowerCase().includes(search.toLowerCase()) ||
      e.kraPin.toLowerCase().includes(search.toLowerCase())
    );
    if (selectedDept) {
      list = list.filter(() => true);
    }
    return list;
  }, [entries, search, selectedDept]);

  const columns = useMemo<ColumnDef<PayrollEntry>[]>(() => [
    {
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          checked={filtered.length > 0 && selectedIds.size === filtered.length}
          onChange={toggleSelectAll}
          className="h-3.5 w-3.5 rounded border-slate-300 text-[#ff0613] focus:ring-[#ff0613]"
        />
      ),
      size: 36,
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.original.id)}
          onChange={() => toggleSelect(row.original.id)}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 rounded border-slate-300 text-[#ff0613] focus:ring-[#ff0613]"
        />
      ),
    },
    {
      accessorKey: 'employeeName',
      header: 'Employee',
      size: 140,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-slate-900">{row.original.employeeName}</span>
          {unsavedIds.has(row.original.id) && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Unsaved changes" />}
        </div>
      ),
    },
    {
      accessorKey: 'kraPin',
      header: 'KRA PIN',
      size: 90,
      cell: ({ getValue }) => <span className="font-mono text-[10px] text-slate-600">{String(getValue() || '')}</span>,
    },
    {
      accessorKey: 'totalStdHours',
      header: () => <span className="text-right block">Hrs</span>,
      size: 50,
      cell: ({ getValue }) => <span className="font-mono text-right block text-[10px] text-blue-600">{Number(getValue() || 0).toFixed(1)}</span>,
    },
    {
      accessorKey: 'basicPay',
      header: () => <span className="text-right block">Basic Pay</span>,
      size: 90,
      cell: ({ row }) => (
        <input
          type="number"
          value={row.original.basicPay}
          onChange={(e) => updateField(row.original.id, 'basicPay', parseFloat(e.target.value) || 0)}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[80px] rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
        />
      ),
    },
    {
      id: 'benefits',
      header: () => <span className="text-right block">Benefits</span>,
      size: 70,
      cell: ({ row }) => {
        const total = (row.original.carBenefit || 0) + (row.original.mealsBenefit || 0) + (row.original.nonCashBenefits || 0) + (row.original.housingBenefit || 0) + (row.original.otherBenefits || 0);
        return <span className="font-mono text-right block text-[10px] text-slate-600">{total.toLocaleString()}</span>;
      },
    },
    {
      accessorKey: 'bonusPay',
      header: () => <span className="text-right block">Bonus</span>,
      size: 70,
      cell: ({ row }) => (
        <input
          type="number"
          value={row.original.bonusPay || 0}
          onChange={(e) => updateField(row.original.id, 'bonusPay', parseFloat(e.target.value) || 0)}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[60px] rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
        />
      ),
    },
    {
      accessorKey: 'grossPay',
      header: () => <span className="text-right block">Gross</span>,
      size: 80,
      cell: ({ getValue }) => <span className="font-mono text-right block text-[10px] font-semibold text-slate-900">{Number(getValue() || 0).toLocaleString()}</span>,
    },
    {
      accessorKey: 'shaDeduction',
      header: () => <span className="text-right block">SHA</span>,
      size: 60,
      cell: ({ getValue }) => <span className="font-mono text-right block text-[10px] text-slate-600">{Number(getValue() || 0).toFixed(2)}</span>,
    },
    {
      accessorKey: 'nssfDeduction',
      header: () => <span className="text-right block">NSSF</span>,
      size: 60,
      cell: ({ getValue }) => <span className="font-mono text-right block text-[10px] text-slate-600">{Number(getValue() || 0).toFixed(2)}</span>,
    },
    {
      accessorKey: 'ahlDeduction',
      header: () => <span className="text-right block">AHL</span>,
      size: 60,
      cell: ({ getValue }) => <span className="font-mono text-right block text-[10px] text-slate-600">{Number(getValue() || 0).toFixed(2)}</span>,
    },
    {
      accessorKey: 'taxablePay',
      header: () => <span className="text-right block">Taxable</span>,
      size: 70,
      cell: ({ getValue }) => <span className="font-mono text-right block text-[10px] text-slate-600">{Number(getValue() || 0).toFixed(2)}</span>,
    },
    {
      accessorKey: 'payeTax',
      header: () => <span className="text-right block">PAYE</span>,
      size: 60,
      cell: ({ getValue }) => <span className="font-mono text-right block text-[10px] text-slate-600">{Number(getValue() || 0).toFixed(2)}</span>,
    },
    {
      accessorKey: 'loanDeduction',
      header: () => <span className="text-right block">Loan</span>,
      size: 60,
      cell: ({ row }) => (
        <input
          type="number"
          value={row.original.loanDeduction || 0}
          onChange={(e) => updateField(row.original.id, 'loanDeduction', parseFloat(e.target.value) || 0)}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[60px] rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
        />
      ),
    },
    {
      accessorKey: 'otherDeductions',
      header: () => <span className="text-right block">Other Ded.</span>,
      size: 70,
      cell: ({ row }) => (
        <input
          type="number"
          value={row.original.otherDeductions || 0}
          onChange={(e) => updateField(row.original.id, 'otherDeductions', parseFloat(e.target.value) || 0)}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[60px] rounded border border-slate-200 bg-white px-1 py-0.5 text-right font-mono text-[10px] text-slate-900 focus:border-slate-400 focus:outline-none"
        />
      ),
    },
    {
      accessorKey: 'totalDeductions',
      header: () => <span className="text-right block">Total Ded.</span>,
      size: 70,
      cell: ({ getValue }) => <span className="font-mono text-right block text-[10px] text-slate-600">{Number(getValue() || 0).toFixed(2)}</span>,
    },
    {
      accessorKey: 'netPay',
      header: () => <span className="text-right block">Net Pay</span>,
      size: 80,
      cell: ({ getValue }) => <span className="font-mono text-right block text-[10px] font-semibold text-emerald-700">{Number(getValue() || 0).toLocaleString()}</span>,
    },
    {
      id: 'actions',
      header: '',
      size: 100,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); handleDownloadPayslip(row.original); }}
            className="rounded p-1 text-emerald-600 hover:bg-emerald-50 transition"
            title="Payslip"
          >
            <FileSpreadsheet className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDownloadP9(row.original); }}
            className="rounded p-1 text-blue-600 hover:bg-blue-50 transition"
            title="P9"
          >
            <FileText className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleEmailPayslip(row.original); }}
            className="rounded p-1 text-amber-600 hover:bg-amber-50 transition"
            title="Email Payslip"
          >
            <Mail className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSelectEntry?.(row.original); }}
            className="rounded p-1 text-blue-500 hover:bg-blue-50 transition"
            title="View details"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ], [updateField, unsavedIds, onSelectEntry, selectedIds]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { globalFilter: search, sorting },
    onGlobalFilterChange: setSearch,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search entries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900"
          >
            <option value="">All Departments</option>
            {departments.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
          </select>
          <button onClick={exportCSV} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
            <Download className="h-3 w-3" /> CSV
          </button>
          {onAddEmployee && (
            <button onClick={onAddEmployee} className="inline-flex items-center gap-1 rounded-lg bg-[#ff0613] px-2.5 py-1.5 text-xs font-bold text-white hover:bg-[#d80000] transition">
              <Plus className="h-3 w-3" /> Add
            </button>
          )}
          {unsavedIds.size > 0 && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
              {unsavedIds.size} unsaved
            </span>
          )}
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-xs font-semibold text-slate-700">{selectedIds.size} selected</span>
          <div className="h-3 w-px bg-slate-300" />
          <button
            onClick={handleBulkDownloadPayslips}
            disabled={!runId || bulkActionLoading === 'payslip-zip'}
            className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-bold text-emerald-700 border border-slate-200 hover:bg-emerald-50 transition disabled:opacity-40"
          >
            <FileSpreadsheet className="h-3 w-3" /> Bulk Payslips
          </button>
          <button
            onClick={handleBulkEmailPayslips}
            disabled={bulkActionLoading === 'payslip-email'}
            className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-bold text-amber-700 border border-slate-200 hover:bg-amber-50 transition disabled:opacity-40"
          >
            <Mail className="h-3 w-3" /> Email Payslips
          </button>
          <button
            onClick={handleBulkEmailP9s}
            disabled={bulkActionLoading === 'p9-email'}
            className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-bold text-blue-700 border border-slate-200 hover:bg-blue-50 transition disabled:opacity-40"
          >
            <Mail className="h-3 w-3" /> Email P9s
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      {!runId ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-12 text-center">
          <p className="text-sm font-medium text-slate-600">No payroll run for this period</p>
          <p className="text-xs text-slate-400 mt-1">Create a run to see the pay register</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs table-fixed">
              <colgroup>
                {columns.map((col, i) => (
                  <col key={i} style={{ width: col.size ? `${col.size}px` : 'auto' }} />
                ))}
              </colgroup>
              <thead className="bg-slate-50">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id} className="border-b border-slate-100 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    {hg.headers.map((h) => (
                      <th
                        key={h.id}
                        className={cn('px-2 py-2 cursor-pointer select-none hover:bg-slate-100 transition whitespace-nowrap', h.column.getIsSorted() && 'bg-slate-100')}
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getIsSorted() === 'asc' && <ArrowUp className="inline h-2.5 w-2.5 ml-0.5" />}
                        {h.column.getIsSorted() === 'desc' && <ArrowDown className="inline h-2.5 w-2.5 ml-0.5" />}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr><td colSpan={columns.length} className="py-6 text-center text-slate-400">Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={columns.length} className="py-6 text-center text-slate-400">No entries found.</td></tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      className={cn(
                        'hover:bg-slate-50/50 transition cursor-pointer',
                        selectedIds.has(row.original.id) && 'bg-slate-50'
                      )}
                      onClick={() => onSelectEntry?.(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-2 py-2 whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Totals row */}
          <div className="border-t border-slate-200 bg-slate-50 px-2 py-2 text-[10px]">
            <div className="flex items-center gap-x-4 gap-y-1 overflow-x-auto">
              <span className="font-bold uppercase tracking-wider text-slate-500">Totals</span>
              <span className="text-slate-700">Basic: <span className="font-mono font-semibold">{totals.basicPay.toLocaleString()}</span></span>
              <span className="text-slate-700">Gross: <span className="font-mono font-semibold">{totals.grossPay.toLocaleString()}</span></span>
              <span className="text-slate-700">SHA: <span className="font-mono">{totals.shaDeduction.toFixed(2)}</span></span>
              <span className="text-slate-700">NSSF: <span className="font-mono">{totals.nssfDeduction.toFixed(2)}</span></span>
              <span className="text-slate-700">AHL: <span className="font-mono">{totals.ahlDeduction.toFixed(2)}</span></span>
              <span className="text-slate-700">Taxable: <span className="font-mono">{totals.taxablePay.toFixed(2)}</span></span>
              <span className="text-slate-700">PAYE: <span className="font-mono">{totals.payeTax.toFixed(2)}</span></span>
              <span className="text-slate-700">Total Ded: <span className="font-mono">{totals.totalDeductions.toFixed(2)}</span></span>
              <span className="text-slate-700">Net: <span className="font-mono font-semibold text-emerald-700">{totals.netPay.toLocaleString()}</span></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
