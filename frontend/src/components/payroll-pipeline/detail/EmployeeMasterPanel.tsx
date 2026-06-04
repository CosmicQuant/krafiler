import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
    X, ChevronDown, ChevronUp, Search, Eye
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
import { EmployeeDetailModal } from './EmployeeDetailModal';

interface Employee {
    id: string | number;
    payrollNumber: string;
    employeeName: string;
    idNumber: string;
    kraPin: string;
    nssfNo: string;
    shaNo: string;
    phone: string;
    email: string;
    bankName: string;
    bankAccount: string;
    bankCode: string;
    department: string;
    jobTitle: string;
    employmentType: string;
    employmentStatus: string;
    dateJoined: string;
    basicPay: number;
    hourlyRate: number;
    payStructure: string;
    identityType: string;
    residentialStatus: string;
    typeOfEmployee: string;
    pwd: string;
    exemptionCert: string;
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    typeOfHousing: string;
    housingBenefit: number;
    otherBenefits: number;
    otherPension: number;
    postRetMedical: number;
    mortgageInterest: number;
    insuranceRelief: number;
    bonusPay: number;
    standardCheckIn?: string;
    standardCheckOut?: string;
    offDay?: string;
    workScheduleId?: number;
}

interface PayrollEntry {
    employeeId: string | number;
    basicPay: number;
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
}

interface AttendanceSummary {
    employeeId: number;
    presentDays: number;
    absentDays: number;
    lateHours: number;
    halfDays: number;
    leaveDays: number;
    offDays: number;
    overtimeHours: number;
}

interface EmployeeMasterPanelProps {
    clientId: string;
    runId?: number;
    period?: string;
    onRefresh?: () => void;
}

export function EmployeeMasterPanel({ clientId, runId, period, onRefresh: _onRefresh }: EmployeeMasterPanelProps) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [entries, setEntries] = useState<Map<string | number, PayrollEntry>>(new Map());
    const [attendanceSummaries, setAttendanceSummaries] = useState<Map<number, AttendanceSummary>>(new Map());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [globalFilter, setGlobalFilter] = useState('');
    const [sorting, setSorting] = useState<SortingState>([]);

    const [viewEmployee, setViewEmployee] = useState<Employee | null>(null);
    const [modalOpen, setModalOpen] = useState(false);

    const parentRef = useRef<HTMLDivElement>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const empsRes = await apiFetch(`/clients/${clientId}/employees`);
            let emps: Employee[] = [];
            if (empsRes.ok) {
                emps = await empsRes.json();
                setEmployees(emps);
            }

            if (runId) {
                const entriesRes = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/entries`);
                const entryMap = new Map<string | number, PayrollEntry>();
                if (entriesRes.ok) {
                    const data: PayrollEntry[] = await entriesRes.json();
                    for (const e of data) {
                        entryMap.set(e.employeeId, e);
                    }
                }
                setEntries(entryMap);
            }

            const attRes = await apiFetch(`/clients/${clientId}/attendance/summary?period=${period || ''}`);
            const attMap = new Map<number, AttendanceSummary>();
            if (attRes.ok) {
                const data: AttendanceSummary[] = await attRes.json();
                for (const s of data) {
                    attMap.set(s.employeeId, s);
                }
            }
            setAttendanceSummaries(attMap);
        } catch {
            setError('Failed to load data');
        } finally {
            setLoading(false);
        }
    }, [clientId, runId, period]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleView = (emp: Employee) => {
        setViewEmployee(emp);
        setModalOpen(true);
    };

    const columns = useMemo<ColumnDef<Employee>[]>(() => [
        {
            accessorKey: 'employeeName',
            header: 'Employee',
            cell: ({ row }) => {
                const emp = row.original;
                const summary = attendanceSummaries.get(Number(emp.id));
                const present = summary?.presentDays ?? 0;
                const absent = summary?.absentDays ?? 0;
                const late = summary?.lateHours ?? 0;
                return (
                    <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">{emp.employeeName}</span>
                            {emp.employmentStatus !== 'Active' && (
                                <span className="inline-flex rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{emp.employmentStatus}</span>
                            )}
                        </div>
                        {summary && (
                            <div className="flex items-center gap-1.5 text-[10px]">
                                <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-0.5 text-emerald-700 font-semibold">P{present}</span>
                                {absent > 0 && <span className="inline-flex items-center gap-0.5 rounded bg-rose-50 px-1 py-0.5 text-rose-700 font-semibold">A{absent}</span>}
                                {late > 0 && <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 py-0.5 text-amber-700 font-semibold">L{Number(late).toFixed(1)}</span>}
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            accessorKey: 'kraPin',
            header: 'KRA PIN',
            cell: ({ getValue }) => <span className="font-mono text-[10px] text-slate-600">{String(getValue() || '')}</span>,
        },
        {
            accessorKey: 'basicPay',
            header: () => <span className="text-right block">Basic</span>,
            cell: ({ getValue }) => <span className="font-mono text-right block text-[10px]">{Number(getValue() || 0).toLocaleString()}</span>,
        },
        {
            id: 'daysWorked',
            header: () => <span className="text-right block">Days</span>,
            cell: ({ row }) => {
                const entry = entries.get(row.original.id);
                return <span className="font-mono text-right block text-[10px] text-slate-600">{entry?.daysWorked ?? '-'}</span>;
            },
        },
        {
            id: 'grossPay',
            header: () => <span className="text-right block">Gross</span>,
            cell: ({ row }) => {
                const entry = entries.get(row.original.id);
                return <span className="font-mono text-right block text-[10px] font-semibold">{entry ? entry.grossPay.toLocaleString() : '-'}</span>;
            },
        },
        {
            id: 'payeTax',
            header: () => <span className="text-right block">PAYE</span>,
            cell: ({ row }) => {
                const entry = entries.get(row.original.id);
                return <span className="font-mono text-right block text-[10px] text-slate-600">{entry ? entry.payeTax.toFixed(2) : '-'}</span>;
            },
        },
        {
            id: 'netPay',
            header: () => <span className="text-right block">Net Pay</span>,
            cell: ({ row }) => {
                const entry = entries.get(row.original.id);
                return <span className="font-mono text-right block text-[10px] font-semibold text-emerald-700">{entry ? entry.netPay.toLocaleString() : '-'}</span>;
            },
        },
        {
            accessorKey: 'employmentStatus',
            header: 'Status',
            cell: ({ getValue }) => {
                const status = String(getValue());
                return (
                    <span className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold',
                        status === 'Active' ? 'bg-emerald-50 text-emerald-700' :
                        status === 'Terminated' ? 'bg-rose-50 text-rose-700' :
                        'bg-amber-50 text-amber-700'
                    )}>{status}</span>
                );
            },
        },
        {
            id: 'actions',
            header: '',
            cell: ({ row }) => (
                <div className="flex items-center justify-end gap-1">
                    <button
                        onClick={(e) => { e.stopPropagation(); handleView(row.original); }}
                        className="rounded p-1 text-blue-500 hover:bg-blue-50 hover:text-blue-700 transition"
                        title="View details"
                    >
                        <Eye className="h-3.5 w-3.5" />
                    </button>
                </div>
            ),
        },
    ], [entries, attendanceSummaries]);

    const table = useReactTable({
        data: employees,
        columns,
        state: { globalFilter, sorting },
        onGlobalFilterChange: setGlobalFilter,
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    const rows = table.getRowModel().rows;

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 52,
        overscan: 10,
    });

    const virtualItems = virtualizer.getVirtualItems();

    return (
        <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="relative w-full sm:w-56">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search employees..."
                        value={globalFilter}
                        onChange={(e) => setGlobalFilter(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">
                        {employees.length} employee{employees.length !== 1 ? 's' : ''}
                    </span>
                    {runId && (
                        <span className="text-xs text-slate-400">Run: #{runId}</span>
                    )}
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto rounded p-1 hover:bg-red-100"><X className="h-3 w-3" /></button>
                </div>
            )}

            {/* Table */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <tr key={headerGroup.id} className="border-b border-slate-100 bg-slate-50 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                {headerGroup.headers.map((header) => (
                                    <th
                                        key={header.id}
                                        className={cn('px-2 py-2 cursor-pointer select-none hover:bg-slate-100 transition', header.column.getIsSorted() && 'bg-slate-100')}
                                        onClick={header.column.getToggleSortingHandler()}
                                    >
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                        {header.column.getIsSorted() === 'asc' && <ChevronUp className="inline h-2.5 w-2.5 ml-0.5" />}
                                        {header.column.getIsSorted() === 'desc' && <ChevronDown className="inline h-2.5 w-2.5 ml-0.5" />}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                </table>
                <div ref={parentRef} className="overflow-auto" style={{ height: Math.min(520, rows.length * 52) }}>
                    <table className="w-full text-xs">
                        <tbody className="divide-y divide-slate-50">
                            {loading ? (
                                <tr><td colSpan={columns.length} className="py-6 text-center text-slate-400">Loading...</td></tr>
                            ) : rows.length === 0 ? (
                                <tr><td colSpan={columns.length} className="py-6 text-center text-slate-400">No employees found.</td></tr>
                            ) : (
                                <tr style={{ height: virtualizer.getTotalSize() }}>
                                    <td colSpan={columns.length} className="p-0">
                                        <div style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
                                            {virtualItems.map((virtualRow) => {
                                                const row = rows[virtualRow.index];
                                                return (
                                                    <div
                                                        key={row.id}
                                                        style={{
                                                            position: 'absolute',
                                                            top: 0,
                                                            left: 0,
                                                            width: '100%',
                                                            transform: `translateY(${virtualRow.start}px)`,
                                                        }}
                                                        className="flex items-center border-b border-slate-50 hover:bg-slate-50/50 transition cursor-pointer"
                                                        onClick={() => handleView(row.original)}
                                                    >
                                                        {row.getVisibleCells().map((cell) => (
                                                            <div
                                                                key={cell.id}
                                                                className="px-2 py-2.5 flex-1"
                                                                style={{ minWidth: cell.column.getSize(), width: cell.column.getSize() }}
                                                            >
                                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Employee Detail Modal */}
            {modalOpen && viewEmployee && (
                <EmployeeDetailModal
                    employee={viewEmployee}
                    clientId={clientId}
                    runId={runId}
                    period={period}
                    onClose={() => { setModalOpen(false); setViewEmployee(null); }}
                    onSaved={fetchData}
                />
            )}
        </div>
    );
}
