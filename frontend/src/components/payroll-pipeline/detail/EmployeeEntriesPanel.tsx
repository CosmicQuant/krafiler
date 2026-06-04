import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Search, RefreshCw, Pencil, Save, X, ChevronDown, ChevronUp,
    AlertCircle, Lock
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
// import { calculatePayrollPreview } from '../../../utils/payrollEngine';

type RunStatus = 'draft' | 'approved' | 'finalized' | 'filed';

interface PayrollEntry {
    id: string | number;
    employeeId: string | number;
    employeeName: string;
    kraPin: string;
    payrollNumber: string;
    basicPay: number;
    benefits: number;
    grossPay: number;
    shaDeduction: number;
    nssfDeduction: number;
    ahlDeduction: number;
    taxablePay: number;
    payeTax: number;
    netPay: number;
    daysWorked: number;
    loanDeduction: number;
    overtimePay: number;
    absentDays: number;
    lateDays: number;
    bonusPay: number;
    lockedAt: string | null;
    status: string;
}

interface EmployeeEntriesPanelProps {
    clientId: string;
    runId?: number;
    period: string;
    runStatus: RunStatus;
    onRefresh: () => void;
    onSelectEmployee: (id: string | number | null) => void;
    selectedEmployeeId: string | number | null;
}

export function EmployeeEntriesPanel({
    clientId,
    runId,
    period,
    runStatus,
    onRefresh,
    onSelectEmployee,
    selectedEmployeeId,
}: EmployeeEntriesPanelProps) {
    const [entries, setEntries] = useState<PayrollEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [globalFilter, setGlobalFilter] = useState('');
    const [sorting, setSorting] = useState<SortingState>([]);
    const [editingId, setEditingId] = useState<string | number | null>(null);
    const [editDraft, setEditDraft] = useState<Partial<PayrollEntry>>({});
    const [saving, setSaving] = useState(false);

    const isLocked = runStatus === 'finalized' || runStatus === 'filed';

    const fetchEntries = useCallback(async () => {
        if (!runId) {
            setEntries([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/entries`);
            if (res.ok) {
                const data = await res.json();
                setEntries(data);
            } else {
                setError('Failed to load entries');
            }
        } catch {
            setError('Network error loading entries');
        } finally {
            setLoading(false);
        }
    }, [clientId, runId]);

    useEffect(() => {
        fetchEntries();
    }, [fetchEntries]);

    const handleSaveRow = async (entryId: string | number) => {
        setSaving(true);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/entries/${entryId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editDraft),
            });
            if (res.ok) {
                setEditingId(null);
                setEditDraft({});
                await fetchEntries();
                onRefresh();
            } else {
                const err = await res.json().catch(() => ({}));
                setError(err.message || 'Save failed');
            }
        } catch {
            setError('Network error saving entry');
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (entry: PayrollEntry) => {
        if (isLocked) return;
        setEditingId(entry.id);
        setEditDraft({
            basicPay: entry.basicPay,
            overtimePay: entry.overtimePay,
            bonusPay: entry.bonusPay,
            absentDays: entry.absentDays,
            lateDays: entry.lateDays,
        });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditDraft({});
    };

    const updateDraft = (field: keyof PayrollEntry, value: any) => {
        setEditDraft((prev) => ({ ...prev, [field]: value }));
    };

    const columns = useMemo<ColumnDef<PayrollEntry>[]>(() => [
        {
            accessorKey: 'employeeName',
            header: 'Employee',
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onSelectEmployee(row.original.employeeId === selectedEmployeeId ? null : row.original.employeeId)}
                        className={cn(
                            'h-2 w-2 rounded-full transition',
                            row.original.employeeId === selectedEmployeeId ? 'bg-[#ff0613]' : 'bg-slate-300 hover:bg-slate-400'
                        )}
                    />
                    <span className="font-medium text-slate-900">{row.original.employeeName}</span>
                </div>
            ),
        },
        {
            accessorKey: 'kraPin',
            header: 'KRA PIN',
            cell: ({ getValue }) => <span className="font-mono text-xs text-slate-600">{String(getValue() || '')}</span>,
        },
        {
            accessorKey: 'basicPay',
            header: () => <span className="text-right block">Basic</span>,
            cell: ({ row, getValue }) => {
                const val = Number(getValue() || 0);
                const isEditing = editingId === row.original.id;
                if (isEditing) {
                    return (
                        <input
                            type="number"
                            value={editDraft.basicPay ?? val}
                            onChange={(e) => updateDraft('basicPay', parseFloat(e.target.value) || 0)}
                            className="w-20 rounded border border-slate-200 bg-white px-1 py-0.5 text-right text-xs"
                        />
                    );
                }
                return <span className="font-mono text-right block text-xs">{val.toLocaleString()}</span>;
            },
        },
        {
            accessorKey: 'grossPay',
            header: () => <span className="text-right block">Gross</span>,
            cell: ({ getValue }) => <span className="font-mono text-right block text-xs font-semibold">{Number(getValue() || 0).toLocaleString()}</span>,
        },
        {
            accessorKey: 'shaDeduction',
            header: () => <span className="text-right block">SHA</span>,
            cell: ({ getValue }) => <span className="font-mono text-right block text-xs text-slate-600">{Number(getValue() || 0).toFixed(2)}</span>,
        },
        {
            accessorKey: 'nssfDeduction',
            header: () => <span className="text-right block">NSSF</span>,
            cell: ({ getValue }) => <span className="font-mono text-right block text-xs text-slate-600">{Number(getValue() || 0).toFixed(2)}</span>,
        },
        {
            accessorKey: 'ahlDeduction',
            header: () => <span className="text-right block">AHL</span>,
            cell: ({ getValue }) => <span className="font-mono text-right block text-xs text-slate-600">{Number(getValue() || 0).toFixed(2)}</span>,
        },
        {
            accessorKey: 'payeTax',
            header: () => <span className="text-right block">PAYE</span>,
            cell: ({ getValue }) => <span className="font-mono text-right block text-xs text-slate-600">{Number(getValue() || 0).toFixed(2)}</span>,
        },
        {
            accessorKey: 'netPay',
            header: () => <span className="text-right block">Net</span>,
            cell: ({ getValue }) => <span className="font-mono text-right block text-xs font-semibold text-emerald-700">{Number(getValue() || 0).toLocaleString()}</span>,
        },
        {
            id: 'actions',
            header: '',
            cell: ({ row }) => {
                const isEditing = editingId === row.original.id;
                if (isLocked) return null;
                if (isEditing) {
                    return (
                        <div className="flex items-center justify-end gap-1">
                            <button onClick={() => handleSaveRow(row.original.id)} disabled={saving} className="rounded p-1 text-emerald-600 hover:bg-emerald-50">
                                <Save className="h-3 w-3" />
                            </button>
                            <button onClick={cancelEdit} className="rounded p-1 text-slate-500 hover:bg-slate-100">
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                    );
                }
                return (
                    <button
                        onClick={() => startEdit(row.original)}
                        className="rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                    >
                        <Pencil className="h-3 w-3" />
                    </button>
                );
            },
        },
    ], [editingId, editDraft, isLocked, saving, selectedEmployeeId]);

    const table = useReactTable({
        data: entries,
        columns,
        state: { globalFilter, sorting },
        onGlobalFilterChange: setGlobalFilter,
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    if (!runId) {
        return (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center">
                <p className="text-sm text-slate-500">No payroll run for {period}.</p>
                <p className="text-xs text-slate-400 mt-1">Create a new run to see employee entries.</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="relative w-full sm:w-56">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search entries..."
                        value={globalFilter}
                        onChange={(e) => setGlobalFilter(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                </div>
                <div className="flex items-center gap-2">
                    {isLocked && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                            <Lock className="h-3 w-3" /> Locked
                        </span>
                    )}
                    <button
                        onClick={fetchEntries}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                        <RefreshCw className="h-3 w-3" /> Refresh
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    <AlertCircle className="h-3.5 w-3.5" /> {error}
                </div>
            )}

            {/* Table */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <table className="w-full text-xs">
                    <thead>
                        {table.getHeaderGroups().map((hg) => (
                            <tr key={hg.id} className="border-b border-slate-100 bg-slate-50 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                {hg.headers.map((h) => (
                                    <th
                                        key={h.id}
                                        className="px-2 py-2 cursor-pointer select-none hover:bg-slate-100"
                                        onClick={h.column.getToggleSortingHandler()}
                                    >
                                        {flexRender(h.column.columnDef.header, h.getContext())}
                                        {h.column.getIsSorted() === 'asc' && <ChevronUp className="inline h-2.5 w-2.5 ml-0.5" />}
                                        {h.column.getIsSorted() === 'desc' && <ChevronDown className="inline h-2.5 w-2.5 ml-0.5" />}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            <tr><td colSpan={columns.length} className="py-6 text-center text-slate-400">Loading...</td></tr>
                        ) : table.getRowModel().rows.length === 0 ? (
                            <tr><td colSpan={columns.length} className="py-6 text-center text-slate-400">No entries found.</td></tr>
                        ) : (
                            table.getRowModel().rows.map((row) => (
                                <tr
                                    key={row.id}
                                    className={cn(
                                        'transition',
                                        row.original.employeeId === selectedEmployeeId ? 'bg-red-50/30' : 'hover:bg-slate-50/50'
                                    )}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <td key={cell.id} className="px-2 py-1.5">
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
