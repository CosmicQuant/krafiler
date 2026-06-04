import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Plus, Pencil, Trash2, Download, RefreshCw, CheckCircle2, XCircle, Save,
    ChevronDown, ChevronUp, Search
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
import type { ClientObligation } from '../../../types';
import { calculatePayrollPreview } from '../../../utils/payrollEngine';
import { LoanManager } from '../steps/LoanManager';

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
}

const dropdownOptions: Record<string, string[]> = {
    identityType: ['National ID', 'Passport', 'Alien ID', 'Military ID'],
    residentialStatus: ['Resident', 'Non-Resident'],
    typeOfEmployee: ['Primary Employee', 'Secondary Employee', 'Casual'],
    pwd: ['No', 'Yes'],
    employmentStatus: ['Active', 'Terminated', 'Resigned', 'Suspended'],
    employmentType: ['Permanent', 'Contract', 'Casual', 'Intern'],
    typeOfHousing: ['Benefit not given', 'Own House', 'Rented', 'Company Provided', 'Living with Parents'],
    payStructure: ['fixed', 'prorated'],
};

const emptyEmployee: Partial<Employee> = {
    payrollNumber: '', employeeName: '', idNumber: '', kraPin: '', nssfNo: '', shaNo: '',
    phone: '', email: '', bankName: '', bankAccount: '', bankCode: '',
    department: '', jobTitle: '', employmentType: 'Permanent', employmentStatus: 'Active',
    dateJoined: '', identityType: 'National ID', residentialStatus: 'Resident',
    typeOfEmployee: 'Primary Employee', pwd: 'No', exemptionCert: '',
    typeOfHousing: 'Benefit not given', payStructure: 'fixed',
    basicPay: 0, carBenefit: 0, mealsBenefit: 0, nonCashBenefits: 0,
    housingBenefit: 0, otherBenefits: 0, otherPension: 0,
    postRetMedical: 0, mortgageInterest: 0, insuranceRelief: 0, bonusPay: 0,
};

interface EmployeesTabProps {
    client: ClientObligation;
    period?: string;
}

export function EmployeesTab({ client, period }: EmployeesTabProps) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [globalFilter, setGlobalFilter] = useState('');
    const [sorting, setSorting] = useState<SortingState>([]);

    const [expandedId, setExpandedId] = useState<string | number | null>(null);
    const [editingId, setEditingId] = useState<string | number | null>(null);
    const [draft, setDraft] = useState<Partial<Employee>>({ ...emptyEmployee });
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [masterUrl, setMasterUrl] = useState<string | null>(client.masterFileUrl || null);

    const fetchEmployees = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetch(`/clients/${client.id}/employees`);
            if (res.ok) {
                const data = await res.json();
                setEmployees(data);
            } else {
                setError('Failed to load employees');
            }
        } catch {
            setError('Network error loading employees');
        } finally {
            setLoading(false);
        }
    }, [client.id]);

    useEffect(() => {
        fetchEmployees();
    }, [fetchEmployees]);

    const handleSyncCsv = async () => {
        setSyncing(true);
        try {
            const res = await apiFetch(`/clients/${client.id}/sync-master-csv`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                setMasterUrl(data.fileUrl);
                setMessage((prev) => (prev ? `${prev} · Master CSV synced` : 'Master CSV synced'));
            }
        } catch {
            setError('Failed to sync master CSV');
        } finally {
            setSyncing(false);
        }
    };

    const handleSave = async () => {
        if (!draft.employeeName) {
            setError('Employee name is required');
            return;
        }
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            const url = editingId != null
                ? `/clients/${client.id}/employees/${editingId}`
                : `/clients/${client.id}/employees`;
            const method = editingId != null ? 'PUT' : 'POST';
            const payload = { ...draft, clientId: client.id };
            const res = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                setMessage(editingId != null ? 'Employee updated' : 'Employee created');
                setEditingId(null);
                setExpandedId(null);
                setDraft({ ...emptyEmployee });
                await fetchEmployees();
                await handleSyncCsv();
            } else {
                const d = await res.json().catch(() => ({}));
                setError(d.message || 'Save failed');
            }
        } catch {
            setError('Network error saving employee');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string | number) => {
        if (!window.confirm('Delete this employee?')) return;
        try {
            const res = await apiFetch(`/clients/${client.id}/employees/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setMessage('Employee deleted');
                await fetchEmployees();
                await handleSyncCsv();
            }
        } catch {
            setError('Delete failed');
        }
    };

    const startEdit = (emp: Employee) => {
        setEditingId(emp.id);
        setExpandedId(emp.id);
        setDraft({ ...emp });
    };

    const startAdd = () => {
        const newId = '__new__';
        setEditingId(newId);
        setExpandedId(newId);
        setDraft({ ...emptyEmployee });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setExpandedId(null);
        setDraft({ ...emptyEmployee });
        setError(null);
    };

    const updateDraft = (field: keyof Employee, value: any) => {
        setDraft((prev) => ({ ...prev, [field]: value }));
    };

    void editingId; // editingId controls expanded row state

    const columns = useMemo<ColumnDef<Employee>[]>(() => [
        {
            accessorKey: 'employeeName',
            header: 'Name',
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{row.original.employeeName}</span>
                    {row.original.employmentStatus !== 'Active' && (
                        <span className="inline-flex rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{row.original.employmentStatus}</span>
                    )}
                </div>
            ),
        },
        {
            accessorKey: 'kraPin',
            header: 'KRA PIN',
            cell: ({ getValue }) => <span className="font-mono text-slate-700">{String(getValue() || '')}</span>,
        },
        {
            accessorKey: 'basicPay',
            header: () => <span className="text-right block">Basic Pay</span>,
            cell: ({ getValue }) => <span className="font-mono text-right block">{Number(getValue() || 0).toLocaleString()}</span>,
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
                        onClick={(e) => { e.stopPropagation(); startEdit(row.original); }}
                        className="rounded p-1 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition"
                        title="Edit"
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(row.original.id); }}
                        className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 transition"
                        title="Delete"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            ),
        },
    ], []);

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

    // Build field groups for the expanded drawer
    const fieldGroups = [
        {
            title: 'Personal',
            fields: [
                { key: 'employeeName', label: 'Full Name', type: 'text' },
                { key: 'idNumber', label: 'ID Number', type: 'text' },
                { key: 'kraPin', label: 'KRA PIN', type: 'text' },
                { key: 'phone', label: 'Phone', type: 'text' },
                { key: 'email', label: 'Email', type: 'text' },
                { key: 'identityType', label: 'Identity Type', type: 'select', options: dropdownOptions.identityType },
                { key: 'residentialStatus', label: 'Residential Status', type: 'select', options: dropdownOptions.residentialStatus },
                { key: 'pwd', label: 'PWD', type: 'select', options: dropdownOptions.pwd },
            ],
        },
        {
            title: 'Employment',
            fields: [
                { key: 'payrollNumber', label: 'Payroll #', type: 'text' },
                { key: 'department', label: 'Department', type: 'text' },
                { key: 'jobTitle', label: 'Job Title', type: 'text' },
                { key: 'employmentType', label: 'Employment Type', type: 'select', options: dropdownOptions.employmentType },
                { key: 'employmentStatus', label: 'Status', type: 'select', options: dropdownOptions.employmentStatus },
                { key: 'dateJoined', label: 'Date Joined', type: 'text' },
                { key: 'typeOfEmployee', label: 'Employee Type', type: 'select', options: dropdownOptions.typeOfEmployee },
                { key: 'payStructure', label: 'Pay Structure', type: 'select', options: dropdownOptions.payStructure },
            ],
        },
        {
            title: 'Compensation',
            fields: [
                { key: 'basicPay', label: 'Basic Pay', type: 'number' },
                { key: 'carBenefit', label: 'Car Benefit', type: 'number' },
                { key: 'mealsBenefit', label: 'Meals', type: 'number' },
                { key: 'nonCashBenefits', label: 'Non-Cash', type: 'number' },
                { key: 'typeOfHousing', label: 'Housing Type', type: 'select', options: dropdownOptions.typeOfHousing },
                { key: 'housingBenefit', label: 'Housing Benefit', type: 'number' },
                { key: 'otherBenefits', label: 'Other Benefits', type: 'number' },
                { key: 'otherPension', label: 'Other Pension', type: 'number' },
                { key: 'postRetMedical', label: 'Post-Ret Medical', type: 'number' },
                { key: 'mortgageInterest', label: 'Mortgage Interest', type: 'number' },
                { key: 'insuranceRelief', label: 'Insurance Relief', type: 'number' },
                { key: 'bonusPay', label: 'Bonus Pay', type: 'number' },
            ],
        },
        {
            title: 'Banking',
            fields: [
                { key: 'bankName', label: 'Bank Name', type: 'text' },
                { key: 'bankAccount', label: 'Account Number', type: 'text' },
                { key: 'bankCode', label: 'Bank Code', type: 'text' },
            ],
        },
        {
            title: 'Statutory',
            fields: [
                { key: 'nssfNo', label: 'NSSF No', type: 'text' },
                { key: 'shaNo', label: 'SHA No', type: 'text' },
                { key: 'exemptionCert', label: 'Exemption Cert', type: 'text' },
            ],
        },
    ];

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search employees..."
                        value={globalFilter}
                        onChange={(e) => setGlobalFilter(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                </div>
                <div className="flex items-center gap-2">
                    {masterUrl && (
                        <a
                            href={masterUrl}
                            download
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                        >
                            <Download className="h-3.5 w-3.5" /> Master CSV
                        </a>
                    )}
                    <button
                        onClick={handleSyncCsv}
                        disabled={syncing}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                    >
                        {syncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Sync CSV
                    </button>
                    <button
                        onClick={startAdd}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#ff0613] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#d80000]"
                    >
                        <Plus className="h-3.5 w-3.5" /> Add Employee
                    </button>
                </div>
            </div>

            {/* Messages */}
            {message && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> {message}
                    <button onClick={() => setMessage(null)} className="ml-auto rounded p-1 hover:bg-emerald-100"><XCircle className="h-3.5 w-3.5" /></button>
                </div>
            )}
            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    <XCircle className="h-4 w-4" /> {error}
                    <button onClick={() => setError(null)} className="ml-auto rounded p-1 hover:bg-red-100"><XCircle className="h-3.5 w-3.5" /></button>
                </div>
            )}

            {/* Loan Manager */}
            <LoanManager clientId={client.id} period={period || undefined} />

            {/* Table */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <tr key={headerGroup.id} className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                <th className="px-3 py-2.5 w-8" />
                                {headerGroup.headers.map((header) => (
                                    <th
                                        key={header.id}
                                        className={cn(
                                            'px-3 py-2.5 cursor-pointer select-none hover:bg-slate-100 transition',
                                            header.column.getIsSorted() && 'bg-slate-100'
                                        )}
                                        onClick={header.column.getToggleSortingHandler()}
                                    >
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                        {header.column.getIsSorted() === 'asc' && <ChevronUp className="inline h-3 w-3 ml-0.5" />}
                                        {header.column.getIsSorted() === 'desc' && <ChevronDown className="inline h-3 w-3 ml-0.5" />}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            <tr><td colSpan={columns.length + 1} className="py-8 text-center text-slate-400">Loading...</td></tr>
                        ) : table.getRowModel().rows.length === 0 ? (
                            <tr><td colSpan={columns.length + 1} className="py-8 text-center text-slate-400">No employees found.</td></tr>
                        ) : (
                            table.getRowModel().rows.map((row) => {
                                const isExpanded = expandedId === row.original.id;
                                const isRowEditing = editingId === row.original.id;
                                return (
                                    <>
                                        <tr
                                            key={row.id}
                                            className={cn('transition cursor-pointer', isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/50')}
                                            onClick={() => {
                                                if (isRowEditing) return;
                                                setExpandedId(isExpanded ? null : row.original.id);
                                            }}
                                        >
                                            <td className="px-3 py-2">
                                                {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronUp className="h-3.5 w-3.5 text-slate-400 rotate-90" />}
                                            </td>
                                            {row.getVisibleCells().map((cell) => (
                                                <td key={cell.id} className="px-3 py-2">
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </td>
                                            ))}
                                        </tr>
                                        {isExpanded && (
                                            <tr className="bg-slate-50/50">
                                                <td colSpan={columns.length + 1} className="px-3 py-4">
                                                    <div className="space-y-4">
                                                        {/* Drawer content */}
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                                                            {fieldGroups.map((group) => (
                                                                <div key={group.title} className="space-y-2">
                                                                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{group.title}</h4>
                                                                    {group.fields.map((field) => (
                                                                        <div key={field.key}>
                                                                            <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">{field.label}</label>
                                                                            {isRowEditing ? (
                                                                                field.type === 'select' ? (
                                                                                    <select
                                                                                        value={(draft as any)[field.key] ?? ''}
                                                                                        onChange={(e) => updateDraft(field.key as keyof Employee, e.target.value)}
                                                                                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                                                                                    >
                                                                                        {field.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                                                                                    </select>
                                                                                ) : (
                                                                                    <input
                                                                                        type={field.type}
                                                                                        value={(draft as any)[field.key] ?? (field.type === 'number' ? 0 : '')}
                                                                                        onChange={(e) => updateDraft(field.key as keyof Employee, field.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                                                                                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                                                                                    />
                                                                                )
                                                                            ) : (
                                                                                <p className="text-xs font-mono text-slate-700">
                                                                                    {typeof (row.original as any)[field.key] === 'number'
                                                                                        ? Number((row.original as any)[field.key]).toLocaleString()
                                                                                        : ((row.original as any)[field.key] || '-')}
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {/* Computed preview */}
                                                        {(() => {
                                                            const preview = calculatePayrollPreview({
                                                                employeeId: Number(row.original.id),
                                                                employeeName: row.original.employeeName,
                                                                kraPin: row.original.kraPin,
                                                                payrollNumber: row.original.payrollNumber,
                                                                basicPay: row.original.basicPay,
                                                                carBenefit: row.original.carBenefit,
                                                                mealsBenefit: row.original.mealsBenefit,
                                                                nonCashBenefits: row.original.nonCashBenefits,
                                                                housingBenefit: row.original.housingBenefit,
                                                                otherBenefits: row.original.otherBenefits,
                                                                dateJoined: row.original.dateJoined,
                                                                dateLeft: null,
                                                                employmentStatus: row.original.employmentStatus,
                                                                otherPension: row.original.otherPension,
                                                                postRetMedical: row.original.postRetMedical,
                                                                mortgageInterest: row.original.mortgageInterest,
                                                                insuranceRelief: row.original.insuranceRelief,
                                                                bonusPay: row.original.bonusPay,
                                                                pwd: row.original.pwd,
                                                            }, period || '2026-01', false);
                                                            return (
                                                                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 pt-2 border-t border-slate-200">
                                                                    <div><span className="text-[10px] text-slate-400">Gross</span><p className="text-xs font-mono font-semibold">{preview.grossPay.toLocaleString()}</p></div>
                                                                    <div><span className="text-[10px] text-slate-400">SHA</span><p className="text-xs font-mono">{preview.shaDeduction.toFixed(2)}</p></div>
                                                                    <div><span className="text-[10px] text-slate-400">NSSF</span><p className="text-xs font-mono">{preview.nssfDeduction.toFixed(2)}</p></div>
                                                                    <div><span className="text-[10px] text-slate-400">AHL</span><p className="text-xs font-mono">{preview.ahlDeduction.toFixed(2)}</p></div>
                                                                    <div><span className="text-[10px] text-slate-400">Taxable</span><p className="text-xs font-mono">{preview.taxablePay?.toFixed(2)}</p></div>
                                                                    <div><span className="text-[10px] text-slate-400">PAYE</span><p className="text-xs font-mono">{preview.payeTax.toFixed(2)}</p></div>
                                                                    <div><span className="text-[10px] text-slate-400">Deductions</span><p className="text-xs font-mono">{preview.totalDeductions?.toFixed(2)}</p></div>
                                                                    <div><span className="text-[10px] text-slate-400">Net Pay</span><p className="text-xs font-mono font-semibold text-emerald-700">{preview.netPay.toLocaleString()}</p></div>
                                                                </div>
                                                            );
                                                        })()}
                                                        {isRowEditing && (
                                                            <div className="flex items-center justify-end gap-2 pt-2">
                                                                <button onClick={cancelEdit} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">Cancel</button>
                                                                <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40">
                                                                    {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
