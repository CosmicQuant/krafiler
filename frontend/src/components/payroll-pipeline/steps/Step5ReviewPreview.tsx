import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    RefreshCw,
    AlertCircle,
    Search,
    Save,
    ChevronDown,
    ChevronUp,
    ChevronRight,
    Download,
    ArrowUp,
    ArrowDown,
    GitCompare,
    Play,
    CheckCircle2,
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';
import { getCurrentFilingPeriod } from '../../../utils/taxPeriods';

interface PayrollEntry {
    id: number;
    employeeId: number;
    employeeName: string;
    kraPin: string;
    daysWorked: number;
    totalStdHours: number;
    basicPay: number;
    carBenefit: number;
    mealsBenefit: number;
    nonCashBenefits: number;
    housingBenefit: number;
    otherBenefits: number;
    overtimePay: number;
    grossPay: number;
    payeTax: number;
    shaDeduction: number;
    nssfDeduction: number;
    ahlDeduction: number;
    absentDays: number;
    lateDays: number;
    netPay: number;
    insuranceRelief: number;
    bonusPay: number;
    unpaidLeaveDays: number;
    taxablePay?: number;
    loanDeduction?: number;
    totalDeductions?: number;
    personalRelief?: number;
    _overrideKeys?: string[];
}

interface ComputedPreview {
    grossPay: number;
    shaDeduction: number;
    nssfDeduction: number;
    ahlDeduction: number;
    payeTax: number;
    netPay: number;
    daysWorked: number;
    taxablePay?: number;
}

interface Department {
    id: number;
    name: string;
}

interface Step5ReviewPreviewProps {
    clientId: string;
    runId?: number;
    onRunCreated?: (runId: number) => void;
    period?: string;
    autoGenerate?: boolean;
}

export function Step5ReviewPreview({ clientId, runId, onRunCreated, period: periodProp, autoGenerate }: Step5ReviewPreviewProps) {
    const [entries, setEntries] = useState<PayrollEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [expandedBenefits, setExpandedBenefits] = useState<Set<number>>(new Set());
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
    const [savingEntryId, setSavingEntryId] = useState<number | null>(null);
    const [previewCache, setPreviewCache] = useState<Record<number, ComputedPreview>>({});
    const [unsavedChanges, setUnsavedChanges] = useState<Set<number>>(new Set());
    const [effectiveRunId, setEffectiveRunId] = useState<number | null>(runId ?? null);

    const [departments, setDepartments] = useState<Department[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [selectedDept, setSelectedDept] = useState('');
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);
    const [compareMode, setCompareMode] = useState(false);
    const [prevEntries, setPrevEntries] = useState<PayrollEntry[]>([]);
    const [prevLoading, setPrevLoading] = useState(false);
    const [prevRunFound, setPrevRunFound] = useState(true);

    const debounceRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
    const entriesRef = useRef<PayrollEntry[]>(entries);
    const autoGenTriggered = useRef(false);
    useEffect(() => { entriesRef.current = entries; }, [entries]);

    const [generating, setGenerating] = useState(false);
    const [genMessage, setGenMessage] = useState<string | null>(null);
    const [period, setPeriod] = useState(periodProp || getCurrentFilingPeriod().period);

    useEffect(() => {
        if (periodProp) setPeriod(periodProp);
    }, [periodProp]);

    useEffect(() => {
        if (autoGenerate && !autoGenTriggered.current && !generating) {
            autoGenTriggered.current = true;
            handleGenerate();
        }
    }, [autoGenerate]);

    const fetchEntries = useCallback(async () => {
        if (!effectiveRunId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${effectiveRunId}/entries`);
            if (!res.ok) throw new Error('Failed to load entries');
            const data = await res.json();
            setEntries(data);
        } catch (err: any) {
            setError(err.message || 'Failed to load payroll entries');
        } finally {
            setLoading(false);
        }
    }, [clientId, effectiveRunId]);

    const fetchMeta = useCallback(async () => {
        try {
            const [deptsRes, empsRes] = await Promise.all([
                apiFetch(`/clients/${clientId}/departments`),
                apiFetch(`/clients/${clientId}/employees`),
            ]);
            if (deptsRes.ok) setDepartments(await deptsRes.json());
            if (empsRes.ok) setEmployees(await empsRes.json());
        } catch {
            /* ignore */
        }
    }, [clientId]);

    const handleGenerate = async () => {
        setGenerating(true);
        setError(null);
        setGenMessage(null);
        try {
            const runsRes = await apiFetch(`/clients/${clientId}/payroll-runs`);
            let existingRunId: number | null = null;
            if (runsRes.ok) {
                const runs = await runsRes.json();
                const existing = runs.find((r: any) => r.period === period);
                if (existing) existingRunId = existing.id;
            }

            let newRunId: number;
            if (existingRunId) {
                const genRes = await apiFetch(`/clients/${clientId}/payroll-runs/${existingRunId}/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prorate: true }),
                });
                if (!genRes.ok) {
                    const errData = await genRes.json().catch(() => ({}));
                    throw new Error(errData.detail || errData.message || 'Failed to regenerate entries');
                }
                newRunId = existingRunId;
            } else {
                const createRes = await apiFetch(`/clients/${clientId}/payroll-runs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ period, notes: '', prorate: true }),
                });
                if (!createRes.ok) {
                    const errData = await createRes.json().catch(() => ({}));
                    throw new Error(errData.detail || errData.message || 'Failed to create run');
                }
                const data = await createRes.json();
                newRunId = data.run.id;
            }

            setEffectiveRunId(newRunId);
            onRunCreated?.(newRunId);
            setGenMessage('Payroll run generated successfully.');
        } catch (err: any) {
            setError(err.message || 'Failed to generate payroll run');
        } finally {
            setGenerating(false);
        }
    };

    useEffect(() => {
        fetchEntries();
        fetchMeta();
    }, [fetchEntries, fetchMeta]);

    const calculatePreview = useCallback(
        async (entry: PayrollEntry, updates: Partial<PayrollEntry>) => {
            try {
                const payload = {
                    basicPay: updates.basicPay ?? entry.basicPay,
                    carBenefit: updates.carBenefit ?? entry.carBenefit,
                    meals: updates.mealsBenefit ?? entry.mealsBenefit,
                    nonCash: updates.nonCashBenefits ?? entry.nonCashBenefits,
                    housingBenefit: updates.housingBenefit ?? entry.housingBenefit,
                    otherBenefits: updates.otherBenefits ?? entry.otherBenefits,
                    bonusPay: updates.bonusPay ?? entry.bonusPay,
                    overtimePay: updates.overtimePay ?? entry.overtimePay,
                    absentDays: updates.absentDays ?? entry.absentDays,
                    lateHours: updates.lateDays ?? entry.lateDays,
                    unpaidLeaveDays: updates.unpaidLeaveDays ?? entry.unpaidLeaveDays,
                    insuranceRelief: updates.insuranceRelief ?? entry.insuranceRelief,
                    payStructure: 'fixed',
                    period: '2026-01',
                };
                const res = await apiFetch('/payroll/calculate-preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) return null;
                return (await res.json()) as ComputedPreview;
            } catch {
                return null;
            }
        },
        []
    );

    const updateEntryField = useCallback(
        (entryId: number, field: keyof PayrollEntry, value: number) => {
            setEntries((prev) =>
                prev.map((e) => {
                    if (e.id !== entryId) return e;
                    return { ...e, [field]: value };
                })
            );
            setUnsavedChanges((prev) => new Set(prev).add(entryId));

            // Debounce preview calculation — read from ref to avoid stale closure
            if (debounceRef.current[entryId]) {
                clearTimeout(debounceRef.current[entryId]);
            }
            debounceRef.current[entryId] = setTimeout(async () => {
                const entry = entriesRef.current.find((e) => e.id === entryId);
                if (!entry) return;
                const preview = await calculatePreview(entry, { [field]: value });
                if (preview) {
                    setPreviewCache((prev) => ({ ...prev, [entryId]: preview }));
                }
            }, 150);
        },
        [calculatePreview]
    );

    const saveEntry = async (entryId: number) => {
        const entry = entries.find((e) => e.id === entryId);
        if (!entry) return;
        setSavingEntryId(entryId);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${effectiveRunId}/update-entry`, {
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
                    absentDays: entry.absentDays,
                    lateHours: entry.lateDays,
                    unpaidLeaveDays: entry.unpaidLeaveDays,
                    insuranceRelief: entry.insuranceRelief,
                }),
            });
            if (res.ok) {
                setUnsavedChanges((prev) => {
                    const next = new Set(prev);
                    next.delete(entryId);
                    return next;
                });
                setPreviewCache((prev) => {
                    const next = { ...prev };
                    delete next[entryId];
                    return next;
                });
                await fetchEntries();
            } else {
                const d = await res.json();
                setError(d.message || 'Failed to save entry');
            }
        } catch {
            setError('Network error while saving');
        } finally {
            setSavingEntryId(null);
        }
    };

    const toggleBenefits = (entryId: number) => {
        setExpandedBenefits((prev) => {
            const next = new Set(prev);
            if (next.has(entryId)) next.delete(entryId);
            else next.add(entryId);
            return next;
        });
    };

    const toggleRow = (entryId: number) => {
        setExpandedRows((prev) => {
            const next = new Set(prev);
            if (next.has(entryId)) next.delete(entryId);
            else next.add(entryId);
            return next;
        });
    };

    const handleSort = (column: string) => {
        if (sortColumn !== column) {
            setSortColumn(column);
            setSortDirection('asc');
        } else if (sortDirection === 'asc') {
            setSortDirection('desc');
        } else {
            setSortColumn(null);
            setSortDirection(null);
        }
    };

    const exportCSV = () => {
        const headers = [
            'employeeName', 'kraPin', 'totalStdHours', 'basicPay', 'carBenefit', 'mealsBenefit',
            'nonCashBenefits', 'housingBenefit', 'otherBenefits', 'overtimePay', 'grossPay',
            'payeTax', 'shaDeduction', 'nssfDeduction', 'ahlDeduction', 'absentDays', 'lateDays', 'netPay',
        ];
        const escapeCsv = (val: any) => {
            const str = String(val ?? '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };
        const csvRows = [
            headers.join(','),
            ...entries.map((e) => headers.map((h) => escapeCsv((e as any)[h])).join(',')),
        ];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `payroll-${clientId}-${effectiveRunId}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const toggleCompare = async () => {
        if (!compareMode) {
            setPrevLoading(true);
            try {
                const res = await apiFetch(`/clients/${clientId}/payroll-runs`);
                if (!res.ok) {
                    setPrevRunFound(false);
                    setPrevEntries([]);
                    setCompareMode(true);
                    return;
                }
                const runs = await res.json();
                const currentRun = runs.find((r: any) => r.id === effectiveRunId);
                if (!currentRun || !currentRun.period) {
                    setPrevRunFound(false);
                    setPrevEntries([]);
                    setCompareMode(true);
                    return;
                }
                const sortedRuns = runs
                    .filter((r: any) => r.period && r.id !== effectiveRunId)
                    .sort((a: any, b: any) => (a.period > b.period ? -1 : a.period < b.period ? 1 : 0));
                const prevRun = sortedRuns.find((r: any) => r.period < currentRun.period);
                if (!prevRun) {
                    setPrevRunFound(false);
                    setPrevEntries([]);
                } else {
                    const entriesRes = await apiFetch(`/clients/${clientId}/payroll-runs/${prevRun.id}/entries`);
                    if (entriesRes.ok) {
                        setPrevEntries(await entriesRes.json());
                        setPrevRunFound(true);
                    } else {
                        setPrevRunFound(false);
                        setPrevEntries([]);
                    }
                }
            } catch {
                setPrevRunFound(false);
                setPrevEntries([]);
            } finally {
                setPrevLoading(false);
            }
            setCompareMode(true);
        } else {
            setCompareMode(false);
        }
    };

    const prevEntryMap = useMemo(() => {
        const map = new Map<number, PayrollEntry>();
        for (const pe of prevEntries) {
            map.set(pe.employeeId, pe);
        }
        return map;
    }, [prevEntries]);

    let filteredEntries = entries.filter((e) =>
        e.employeeName.toLowerCase().includes(search.toLowerCase()) ||
        e.kraPin.toLowerCase().includes(search.toLowerCase())
    );

    if (selectedDept) {
        filteredEntries = filteredEntries.filter((e) => {
            const emp = employees.find((emp) => emp.id === e.employeeId);
            return emp && String(emp.departmentId) === selectedDept;
        });
    }

    if (sortColumn && sortDirection) {
        const dir = sortDirection === 'asc' ? 1 : -1;
        filteredEntries = [...filteredEntries].sort((a, b) => {
            const aVal = (a as any)[sortColumn] ?? 0;
            const bVal = (b as any)[sortColumn] ?? 0;
            if (typeof aVal === 'string') {
                return aVal.localeCompare(bVal) * dir;
            }
            return (aVal - bVal) * dir;
        });
    }

    const displayEntry = (entry: PayrollEntry): PayrollEntry & Partial<ComputedPreview> => {
        const preview = previewCache[entry.id];
        if (preview) {
            return { ...entry, ...preview };
        }
        return entry;
    };

    const totals = filteredEntries.reduce(
        (acc, e) => {
            const d = displayEntry(e);
            return {
                basicPay: acc.basicPay + Number(d.basicPay),
                grossPay: acc.grossPay + Number(d.grossPay || 0),
                payeTax: acc.payeTax + Number(d.payeTax || 0),
                shaDeduction: acc.shaDeduction + Number(d.shaDeduction || 0),
                nssfDeduction: acc.nssfDeduction + Number(d.nssfDeduction || 0),
                ahlDeduction: acc.ahlDeduction + Number(d.ahlDeduction || 0),
                netPay: acc.netPay + Number(d.netPay || 0),
                loanDeduction: acc.loanDeduction + Number(d.loanDeduction || 0),
                totalDeductions: acc.totalDeductions + Number(d.totalDeductions || 0),
                taxablePay: acc.taxablePay + Number(d.taxablePay || 0),
            };
        },
        { basicPay: 0, grossPay: 0, payeTax: 0, shaDeduction: 0, nssfDeduction: 0, ahlDeduction: 0, netPay: 0, loanDeduction: 0, totalDeductions: 0, taxablePay: 0 }
    );

    const colCount = compareMode ? 22 : 20;
    const sortableHeaderClass = 'cursor-pointer select-none hover:bg-slate-100 transition';

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
            </div>
        );
    }

    // Show loading when auto-generating; otherwise show manual Generate UI
    if (!effectiveRunId) {
        if (autoGenerate) {
            return (
                <div className="flex flex-col items-center justify-center py-12">
                    <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
                    <span className="mt-2 text-sm text-slate-500">Generating payroll for {period}...</span>
                    {error && (
                        <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            <AlertCircle className="h-4 w-4" /> {error}
                        </div>
                    )}
                </div>
            );
        }
        return (
            <div className="space-y-6">
                {error && (
                    <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        <AlertCircle className="h-4 w-4" /> {error}
                    </div>
                )}
                {genMessage && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" /> {genMessage}
                    </div>
                )}
                <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900">Generate Payroll Run</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
                        <div>
                            <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wider">Period</label>
                            <input
                                type="month"
                                value={period}
                                onChange={(e) => setPeriod(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            />
                        </div>
                    </div>
                    <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#ff0613] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#d80000] transition disabled:opacity-40"
                    >
                        {generating ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                            <Play className="h-4 w-4" />
                        )}
                        Generate Payroll Run
                    </button>
                    <p className="text-xs text-slate-500">
                        This will create a new payroll run for {period} and compute all statutory deductions.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <AlertCircle className="h-4 w-4" /> {error}
                </div>
            )}

            {/* Regenerate Button */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
                    >
                        {generating ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        Re-generate
                    </button>
                    {genMessage && (
                        <span className="text-xs text-emerald-600">{genMessage}</span>
                    )}
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search by name or KRA PIN..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-64 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                    </div>
                    <select
                        value={selectedDept}
                        onChange={(e) => setSelectedDept(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    >
                        <option value="">All Departments</option>
                        {departments.map((d) => (
                            <option key={d.id} value={String(d.id)}>{d.name}</option>
                        ))}
                    </select>
                    <button
                        onClick={toggleCompare}
                        disabled={prevLoading}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition',
                            compareMode
                                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        )}
                    >
                        {prevLoading ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                            <GitCompare className="h-3 w-3" />
                        )}
                        Compare with Previous Run
                    </button>
                    {compareMode && !prevLoading && !prevRunFound && (
                        <span className="text-xs text-amber-600">No previous run</span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={exportCSV}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                        <Download className="h-3 w-3" />
                        Export CSV
                    </button>
                    <div className="text-xs text-slate-500">
                        {filteredEntries.length} of {entries.length} entries
                        {unsavedChanges.size > 0 && (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 font-medium">
                                {unsavedChanges.size} unsaved
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Table */}
            {filteredEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-12 text-center">
                    <Search className="h-8 w-8 text-slate-300 mb-3" />
                    <p className="text-sm font-medium text-slate-600">No entries match your search</p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50">
                                    <th className="sticky top-0 px-3 py-2.5 w-8" />
                                    <th
                                        className={cn("sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500", sortableHeaderClass)}
                                        onClick={() => handleSort('employeeName')}
                                    >
                                        Employee {sortColumn === 'employeeName' && (sortDirection === 'asc' ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)}
                                    </th>
                                    <th
                                        className={cn("sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500", sortableHeaderClass)}
                                        onClick={() => handleSort('kraPin')}
                                    >
                                        KRA PIN {sortColumn === 'kraPin' && (sortDirection === 'asc' ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)}
                                    </th>
                                     <th
                                         className={cn("sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right", sortableHeaderClass)}
                                         onClick={() => handleSort('totalStdHours')}
                                     >
                                         Total Std Hrs {sortColumn === 'totalStdHours' && (sortDirection === 'asc' ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)}
                                     </th>
                                    <th
                                        className={cn("sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right", sortableHeaderClass)}
                                        onClick={() => handleSort('basicPay')}
                                    >
                                        Basic Pay {sortColumn === 'basicPay' && (sortDirection === 'asc' ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)}
                                    </th>
                                     <th className="sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">
                                         Benefits
                                     </th>
                                     <th
                                         className={cn("sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right", sortableHeaderClass)}
                                         onClick={() => handleSort('bonusPay')}
                                     >
                                        Bonus Pay {sortColumn === 'bonusPay' && (sortDirection === 'asc' ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)}
                                    </th>
                                    <th
                                        className={cn("sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right", sortableHeaderClass)}
                                        onClick={() => handleSort('grossPay')}
                                    >
                                        Gross {sortColumn === 'grossPay' && (sortDirection === 'asc' ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)}
                                    </th>
                                    <th
                                        className={cn("sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right", sortableHeaderClass)}
                                        onClick={() => handleSort('payeTax')}
                                    >
                                        PAYE {sortColumn === 'payeTax' && (sortDirection === 'asc' ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)}
                                    </th>
                                    <th className="sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">
                                        Loan Deduction
                                    </th>
                                    <th className="sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">
                                        Total Deductions
                                    </th>
                                    <th className="sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">
                                        SHA
                                    </th>
                                    <th className="sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">
                                        NSSF
                                    </th>
                                    <th className="sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">
                                        AHL
                                    </th>
                                    <th
                                        className={cn("sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right", sortableHeaderClass)}
                                        onClick={() => handleSort('taxablePay')}
                                    >
                                        Taxable Pay {sortColumn === 'taxablePay' && (sortDirection === 'asc' ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)}
                                    </th>
                                    <th className="sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">
                                        Personal Relief
                                    </th>
                                    <th
                                        className={cn("sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right", sortableHeaderClass)}
                                        onClick={() => handleSort('absentDays')}
                                    >
                                        Abs {sortColumn === 'absentDays' && (sortDirection === 'asc' ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)}
                                    </th>
                                    <th
                                        className={cn("sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right", sortableHeaderClass)}
                                        onClick={() => handleSort('lateDays')}
                                    >
                                        Late {sortColumn === 'lateDays' && (sortDirection === 'asc' ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)}
                                    </th>
                                    <th
                                        className={cn("sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right", sortableHeaderClass)}
                                        onClick={() => handleSort('netPay')}
                                    >
                                        Net {sortColumn === 'netPay' && (sortDirection === 'asc' ? <ArrowUp className="inline h-3 w-3 ml-0.5" /> : <ArrowDown className="inline h-3 w-3 ml-0.5" />)}
                                    </th>
                                    {compareMode && (
                                        <>
                                            <th className="sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">
                                                Δ Gross
                                            </th>
                                            <th className="sticky top-0 px-3 py-2.5 font-semibold uppercase tracking-wider text-slate-500 text-right">
                                                Δ Net
                                            </th>
                                        </>
                                    )}
                                    <th className="sticky top-0 px-3 py-2.5" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredEntries.map((entry) => {
                                    const d = displayEntry(entry);
                                    const isPreview = !!previewCache[entry.id];
                                    const isUnsaved = unsavedChanges.has(entry.id);
                                    const prev = prevEntryMap.get(entry.employeeId);
                                    const deltaGross = prev ? (d.grossPay || 0) - (prev.grossPay || 0) : null;
                                    const deltaNet = prev ? (d.netPay || 0) - (prev.netPay || 0) : null;

                                    return (
                                        <>
                                            <tr
                                                key={entry.id}
                                                className={cn(
                                                    'transition',
                                                    isPreview || isUnsaved ? 'bg-amber-50/30' : 'hover:bg-slate-50/50'
                                                )}
                                            >
                                                <td className="px-3 py-2">
                                                    <button
                                                        onClick={() => toggleRow(entry.id)}
                                                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                                                    >
                                                        {expandedRows.has(entry.id) ? (
                                                            <ChevronDown className="h-4 w-4" />
                                                        ) : (
                                                            <ChevronRight className="h-4 w-4" />
                                                        )}
                                                    </button>
                                                </td>
                                                <td className="px-3 py-2 font-medium text-slate-900 whitespace-nowrap">
                                                    {entry.employeeName}
                                                    {isUnsaved && (
                                                        <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                                                    )}
                                                    {entry._overrideKeys && entry._overrideKeys.length > 0 && !isUnsaved && (
                                                        <span className="ml-1.5 inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Modified</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap">
                                                    {entry.kraPin}
                                                </td>
                                                 <td className="px-3 py-2 text-right font-mono text-blue-600">
                                                     {(entry.totalStdHours ?? entry.daysWorked).toFixed(1)}
                                                 </td>
                                                <td className="px-3 py-2 text-right">
                                                    <input
                                                        type="number"
                                                        value={entry.basicPay}
                                                        onChange={(e) =>
                                                            updateEntryField(entry.id, 'basicPay', parseFloat(e.target.value) || 0)
                                                        }
                                                        className={cn(
                                                            'w-20 rounded border bg-white px-1.5 py-1 text-right font-mono text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400',
                                                            entry._overrideKeys?.includes('basicPay')
                                                                ? 'border-amber-300'
                                                                : 'border-slate-200'
                                                        )}
                                                    />
                                                </td>
                                                 <td className="px-3 py-2 text-right bg-amber-50/50">
                                                     <button
                                                         onClick={() => toggleBenefits(entry.id)}
                                                         className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700 hover:bg-slate-200 transition"
                                                     >
                                                         {(entry.carBenefit + entry.mealsBenefit + entry.nonCashBenefits + entry.housingBenefit + entry.otherBenefits).toLocaleString()}
                                                         {expandedBenefits.has(entry.id) ? (
                                                             <ChevronUp className="h-3 w-3" />
                                                         ) : (
                                                             <ChevronDown className="h-3 w-3" />
                                                         )}
                                                     </button>
                                                 </td>
                                                <td className="px-3 py-2 text-right">
                                                    <input
                                                        type="number"
                                                        value={entry.bonusPay}
                                                        onChange={(e) =>
                                                            updateEntryField(entry.id, 'bonusPay', parseFloat(e.target.value) || 0)
                                                        }
                                                        className="w-20 rounded border border-slate-200 bg-white px-1.5 py-1 text-right font-mono text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                                    />
                                                </td>
                                                <td className={cn('px-3 py-2 text-right font-mono font-semibold bg-slate-50', isPreview ? 'text-amber-700' : 'text-slate-900')}>
                                                    {Number(d.grossPay).toLocaleString()}
                                                </td>
                                                <td className={cn('px-3 py-2 text-right font-mono bg-slate-50', isPreview ? 'text-amber-700' : 'text-slate-900')}>
                                                    {Number(d.payeTax).toFixed(2)}
                                                </td>
                                                <td className={cn('px-3 py-2 text-right font-mono bg-slate-50', isPreview ? 'text-amber-700' : 'text-slate-900')}>
                                                    {Number(entry.loanDeduction ?? 0).toFixed(2)}
                                                </td>
                                                <td className={cn('px-3 py-2 text-right font-mono bg-slate-50', isPreview ? 'text-amber-700' : 'text-slate-900')}>
                                                    {Number(entry.totalDeductions ?? 0).toFixed(2)}
                                                </td>
                                                <td className={cn('px-3 py-2 text-right font-mono bg-slate-50', isPreview ? 'text-amber-700' : 'text-slate-900')}>
                                                    {Number(d.shaDeduction).toFixed(2)}
                                                </td>
                                                <td className={cn('px-3 py-2 text-right font-mono bg-slate-50', isPreview ? 'text-amber-700' : 'text-slate-900')}>
                                                    {Number(d.nssfDeduction).toFixed(2)}
                                                </td>
                                                <td className={cn('px-3 py-2 text-right font-mono bg-slate-50', isPreview ? 'text-amber-700' : 'text-slate-900')}>
                                                    {Number(d.ahlDeduction).toFixed(2)}
                                                </td>
                                                <td className={cn('px-3 py-2 text-right font-mono bg-slate-50', isPreview ? 'text-amber-700' : 'text-slate-900')}>
                                                    {Number(d.taxablePay ?? 0).toFixed(2)}
                                                </td>
                                                <td className={cn('px-3 py-2 text-right font-mono bg-slate-50', isPreview ? 'text-amber-700' : 'text-slate-900')}>
                                                    {entry.personalRelief ?? 2400}
                                                </td>
                                                <td className="px-3 py-2 text-right font-mono text-rose-600">
                                                    {entry.absentDays}
                                                </td>
                                                <td className="px-3 py-2 text-right font-mono text-amber-600">
                                                    {entry.lateDays}
                                                </td>
                                                <td className={cn('px-3 py-2 text-right font-mono font-semibold bg-slate-50', isPreview ? 'text-amber-700' : 'text-slate-900')}>
                                                    {Number(d.netPay).toLocaleString()}
                                                </td>
                                                {compareMode && (
                                                    <>
                                                        <td className="px-3 py-2 text-right font-mono">
                                                            {deltaGross !== null ? (
                                                                <span className={deltaGross >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                                                                    {deltaGross >= 0 ? '↑' : '↓'} {Math.abs(deltaGross).toLocaleString()}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400">—</span>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2 text-right font-mono">
                                                            {deltaNet !== null ? (
                                                                <span className={deltaNet >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                                                                    {deltaNet >= 0 ? '↑' : '↓'} {Math.abs(deltaNet).toLocaleString()}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400">—</span>
                                                            )}
                                                        </td>
                                                    </>
                                                )}
                                                <td className="px-3 py-2 text-right">
                                                    <button
                                                        disabled={!isUnsaved || savingEntryId === entry.id}
                                                        onClick={() => saveEntry(entry.id)}
                                                        className={cn(
                                                            'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold transition',
                                                            isUnsaved
                                                                ? 'bg-slate-950 text-white hover:bg-slate-800'
                                                                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                                        )}
                                                    >
                                                        {savingEntryId === entry.id ? (
                                                            <RefreshCw className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                            <Save className="h-3 w-3" />
                                                        )}
                                                        Save
                                                    </button>
                                                </td>
                                            </tr>
                                            {expandedRows.has(entry.id) && (
                                                <tr className="bg-slate-50/50">
                                                    <td colSpan={colCount} className="px-3 py-3">
                                                        <div className="grid grid-cols-2 gap-4 text-xs">
                                                            <div className="space-y-2">
                                                                <p className="font-semibold text-slate-500 uppercase tracking-wider">Inputs</p>
                                                                {[
                                                                    { key: 'basicPay', label: 'Basic Pay' },
                                                                    { key: 'carBenefit', label: 'Car Benefit' },
                                                                    { key: 'mealsBenefit', label: 'Meals' },
                                                                    { key: 'nonCashBenefits', label: 'Non-Cash' },
                                                                    { key: 'housingBenefit', label: 'Housing' },
                                                                    { key: 'otherBenefits', label: 'Other Benefits' },
                                                                    { key: 'bonusPay', label: 'Bonus Pay' },
                                                                    { key: 'unpaidLeaveDays', label: 'Unpaid Leave Days' },
                                                                    { key: 'absentDays', label: 'Absent Days' },
                                                                    { key: 'lateDays', label: 'Late Hours' },
                                                                    { key: 'insuranceRelief', label: 'Insurance Relief' },
                                                                ].map((f) => (
                                                                    <div key={f.key} className="flex items-center justify-between gap-2">
                                                                        <span className="text-slate-500">{f.label}</span>
                                                                        <input
                                                                            type="number"
                                                                            value={(entry as any)[f.key]}
                                                                            onChange={(e) =>
                                                                                updateEntryField(entry.id, f.key as keyof PayrollEntry, parseFloat(e.target.value) || 0)
                                                                            }
                                                                            className="w-24 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-right font-mono text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                                                        />
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            <div className="space-y-2">
                                                                <p className="font-semibold text-slate-500 uppercase tracking-wider">Computed</p>
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-slate-500">Gross Pay</span>
                                                                    <span className="font-mono font-semibold text-slate-900">{Number(d.grossPay).toLocaleString()}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-slate-500">SHA</span>
                                                                    <span className="font-mono text-slate-900">{Number(d.shaDeduction).toFixed(2)}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-slate-500">NSSF</span>
                                                                    <span className="font-mono text-slate-900">{Number(d.nssfDeduction).toFixed(2)}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-slate-500">AHL</span>
                                                                    <span className="font-mono text-slate-900">{Number(d.ahlDeduction).toFixed(2)}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-slate-500">Personal Relief</span>
                                                                    <span className="font-mono text-slate-900">{2400}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-slate-500">Loan Deduction</span>
                                                                    <span className="font-mono text-slate-900">{Number(entry.loanDeduction ?? 0).toFixed(2)}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-slate-500">Total Deductions</span>
                                                                    <span className="font-mono text-slate-900">{Number(entry.totalDeductions ?? 0).toFixed(2)}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-slate-500">Taxable Pay</span>
                                                                    <span className="font-mono text-slate-900">{Number(d.taxablePay ?? 0).toFixed(2)}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-slate-500">PAYE</span>
                                                                    <span className="font-mono text-slate-900">{Number(d.payeTax).toFixed(2)}</span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-slate-500">Net Pay</span>
                                                                    <span className="font-mono font-semibold text-emerald-700">{Number(d.netPay).toLocaleString()}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                            {expandedBenefits.has(entry.id) && (
                                                <tr className="bg-slate-50/50">
                                                    <td colSpan={colCount} className="px-3 py-2">
                                                        <div className="flex flex-wrap items-center gap-4 text-xs">
                                                            <span className="font-semibold text-slate-500">Benefits breakdown:</span>
                                                            {[
                                                                { key: 'carBenefit', label: 'Car' },
                                                                { key: 'mealsBenefit', label: 'Meals' },
                                                                { key: 'nonCashBenefits', label: 'Non-Cash' },
                                                                { key: 'housingBenefit', label: 'Housing' },
                                                                { key: 'otherBenefits', label: 'Other' },
                                                            ].map((b) => (
                                                                <div key={b.key} className="flex items-center gap-1.5">
                                                                    <span className="text-slate-500">{b.label}:</span>
                                                                    <input
                                                                        type="number"
                                                                        value={(entry as any)[b.key]}
                                                                        onChange={(e) =>
                                                                            updateEntryField(entry.id, b.key as keyof PayrollEntry, parseFloat(e.target.value) || 0)
                                                                        }
                                                                        className="w-16 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-right font-mono text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                                                    />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Totals Bar */}
                    <div className="sticky bottom-0 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs">
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                            <span className="font-semibold text-slate-500 uppercase tracking-wider">Totals</span>
                            <span className="text-slate-700">
                                Basic: <span className="font-mono font-semibold text-slate-900">{totals.basicPay.toLocaleString()}</span>
                            </span>
                            <span className="text-slate-700">
                                Gross: <span className="font-mono font-semibold text-slate-900">{totals.grossPay.toLocaleString()}</span>
                            </span>
                            <span className="text-slate-700">
                                PAYE: <span className="font-mono font-semibold text-slate-900">{totals.payeTax.toFixed(2)}</span>
                            </span>
                            <span className="text-slate-700">
                                SHA: <span className="font-mono font-semibold text-slate-900">{totals.shaDeduction.toFixed(2)}</span>
                            </span>
                            <span className="text-slate-700">
                                NSSF: <span className="font-mono font-semibold text-slate-900">{totals.nssfDeduction.toFixed(2)}</span>
                            </span>
                            <span className="text-slate-700">
                                AHL: <span className="font-mono font-semibold text-slate-900">{totals.ahlDeduction.toFixed(2)}</span>
                            </span>
                            <span className="text-slate-700">
                                Taxable Pay: <span className="font-mono font-semibold text-slate-900">{totals.taxablePay.toFixed(2)}</span>
                            </span>
                            <span className="text-slate-700">
                                Loan Deduction: <span className="font-mono font-semibold text-slate-900">{totals.loanDeduction.toFixed(2)}</span>
                            </span>
                            <span className="text-slate-700">
                                Total Deductions: <span className="font-mono font-semibold text-slate-900">{totals.totalDeductions.toFixed(2)}</span>
                            </span>
                            <span className="text-slate-700">
                                Net: <span className="font-mono font-semibold text-emerald-700">{totals.netPay.toLocaleString()}</span>
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
