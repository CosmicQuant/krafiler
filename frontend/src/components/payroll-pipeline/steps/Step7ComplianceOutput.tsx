import { useState, useEffect, useCallback } from 'react';
import {
    RefreshCw,
    AlertCircle,
    CheckCircle2,
    Download,
    Mail,
    FileText,
    FileSpreadsheet,
    FileArchive,
    Send,
    Search,
    ChevronDown,
    ChevronUp,
    Play,
    Info,
} from 'lucide-react';
import { apiFetch } from '../../../services/api';
import { cn } from '../../../utils/cn';
import { downloadPdf } from '../../../utils/downloadPdf';

/* ─── Types ─── */

interface ComplianceResult {
    payeZipUrl?: string;
    payeZipLabel?: string;
    nssfFileUrl?: string;
    nssfFileLabel?: string;
    shaFileUrl?: string;
    shaFileLabel?: string;
    summaryAmounts?: {
        payeAmount: number;
        nitaAmount: number;
        housingLevyAmount: number;
        nssfAmount: number;
        shaAmount: number;
    };
}

interface EmailHistoryItem {
    id: number;
    employeeName: string;
    emailAddress: string;
    documentType: string;
    status: string;
    sentAt: string;
    errorMessage?: string;
}

interface P10Employee {
    employeeName: string;
    kraPin: string;
    monthsWorked: number;
    totalGross: number;
    totalPaye: number;
}

interface P10Data {
    totalEmployees: number;
    totalGross: number;
    totalPaye: number;
    employeeDetails: P10Employee[];
}

interface P11Month {
    periodLabel?: string;
    period: string;
    grossPay: number;
    payeTax: number;
    shaDeduction: number;
    nssfDeduction: number;
    ahlDeduction: number;
    netPay: number;
}

interface P11Data {
    employeeName: string;
    kraPin: string;
    monthly: P11Month[];
    totals: {
        totalGross: number;
        totalPaye: number;
        totalSha: number;
        totalNssf: number;
        totalAhl: number;
        totalNet: number;
    };
}

interface PayrollEntry {
    employeeId: number;
    employeeName: string;
    kraPin: string;
}

interface Step7ComplianceOutputProps {
    clientId: string;
    runId: number;
    period?: string; // YYYY-MM
}

/* ─── Component ─── */

export function Step7ComplianceOutput({ clientId, runId, period }: Step7ComplianceOutputProps) {
    const periodMMYYYY = period ? `${period.split('-')[1]}${period.split('-')[0]}` : '';
    /* Shared state */
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    /* ── Section: Compliance Generator ── */
    const [generatePaye, setGeneratePaye] = useState(true);
    const [generateNssf, setGenerateNssf] = useState(true);
    const [generateSha, setGenerateSha] = useState(true);
    const [complianceLoading, setComplianceLoading] = useState(false);
    const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null);
    const [complianceProgress, setComplianceProgress] = useState<string | null>(null);

    /* ── Auto-filing state ── */
    const [filingType, setFilingType] = useState<string | null>(null);
    const [filingLoading, setFilingLoading] = useState(false);
    const [showShaInfo, setShowShaInfo] = useState(false);

    const handleGenerateCompliance = async () => {
        setComplianceLoading(true);
        setError(null);
        setSuccess(null);
        setComplianceProgress('Generating PAYE ZIP...');
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/generate-compliance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ generatePaye, generateNssf, generateSha }),
            });
            const data = await res.json();
            if (res.ok) {
                setComplianceProgress('PAYE ✓  NSSF ✓  SHA ✓  Done');
                setComplianceResult(data);
                setSuccess('Compliance files generated successfully.');
            } else {
                setComplianceProgress(null);
                setError(data.message || 'Failed to generate compliance files');
            }
        } catch {
            setComplianceProgress(null);
            setError('Network error during compliance generation');
        } finally {
            setComplianceLoading(false);
        }
    };

    /* ── Section: Payslip Downloader ── */
    const [entries, setEntries] = useState<PayrollEntry[]>([]);
    const [entriesLoading, setEntriesLoading] = useState(true);

    const fetchEntries = useCallback(async () => {
        setEntriesLoading(true);
        try {
            const res = await apiFetch(`/clients/${clientId}/payroll-runs/${runId}/entries`);
            if (res.ok) {
                const data = await res.json();
                setEntries(data.map((e: any) => ({ employeeId: e.employeeId, employeeName: e.employeeName, kraPin: e.kraPin })));
            }
        } catch {
            setEntries([]);
        } finally {
            setEntriesLoading(false);
        }
    }, [clientId, runId]);

    useEffect(() => {
        fetchEntries();
    }, [fetchEntries]);

    /* ── Section: Email Sender ── */
    const [emailHistory, setEmailHistory] = useState<EmailHistoryItem[]>([]);
    const [emailLoading, setEmailLoading] = useState(false);
    const [sendingEmail, setSendingEmail] = useState(false);
    const [emailResult, setEmailResult] = useState<{ sent: number; failed: number; total: number } | null>(null);

    const fetchEmailHistory = useCallback(async () => {
        setEmailLoading(true);
        try {
            const res = await apiFetch(`/clients/${clientId}/email/history`);
            if (res.ok) setEmailHistory(await res.json());
        } catch {
            setEmailHistory([]);
        } finally {
            setEmailLoading(false);
        }
    }, [clientId]);

    useEffect(() => {
        fetchEmailHistory();
    }, [fetchEmailHistory]);

    const handleSendPayslips = async () => {
        setSendingEmail(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/email/send-payslips`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setEmailResult({ sent: data.sent, failed: data.failed, total: data.total });
                setSuccess(`Sent ${data.sent} payslips, ${data.failed} failed.`);
                await fetchEmailHistory();
            } else {
                setError(data.message || 'Failed to send payslips');
            }
        } catch {
            setError('Network error sending payslips');
        } finally {
            setSendingEmail(false);
        }
    };

    const handleAutoFile = async (type: string, printPrnOnly = false) => {
        setFilingLoading(true);
        setFilingType(type);
        setError(null);
        setSuccess(null);
        try {
            if (type === 'nssf') {
                const res = await apiFetch(`/tax/file-nssf-return`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId, period: '' }),
                });
                const data = await res.json();
                if (res.ok) {
                    setSuccess(`NSSF filing job queued. Job ID: ${data.jobId || 'N/A'}`);
                } else {
                    setError(data.message || 'Failed to queue NSSF filing');
                }
            } else if (type === 'paye') {
                const res = await apiFetch(`/tax/file-return`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId, taxObligationType: 'paye', period: '', printPrnOnly }),
                });
                const data = await res.json();
                if (res.ok) {
                    setSuccess(printPrnOnly ? `PAYE PRN generation queued. Job ID: ${data.jobId || 'N/A'}` : `PAYE filing job queued. Job ID: ${data.jobId || 'N/A'}`);
                } else {
                    setError(data.message || `Failed to queue PAYE ${printPrnOnly ? 'PRN' : 'filing'}`);
                }
            } else if (type === 'sha') {
                setShowShaInfo(true);
            }
        } catch {
            setError(`Network error during ${type.toUpperCase()} ${printPrnOnly ? 'PRN' : 'auto-filing'}`);
        } finally {
            setFilingLoading(false);
            setFilingType(null);
        }
    };

    const handleSendP9s = async () => {
        setSendingEmail(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/email/send-p9s`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setEmailResult({ sent: data.sent, failed: data.failed, total: data.total });
                setSuccess(`Sent ${data.sent} P9s, ${data.failed} failed.`);
                await fetchEmailHistory();
            } else {
                setError(data.message || 'Failed to send P9s');
            }
        } catch {
            setError('Network error sending P9s');
        } finally {
            setSendingEmail(false);
        }
    };

    /* ── Section: P10 / P11 ── */
    const [p10Year, setP10Year] = useState(new Date().getFullYear().toString());
    const [p10Data, setP10Data] = useState<P10Data | null>(null);
    const [p11Data, setP11Data] = useState<P11Data | null>(null);
    const [loadingP10, setLoadingP10] = useState(false);
    const [loadingP11, setLoadingP11] = useState(false);
    const [expandedP11, setExpandedP11] = useState<string | null>(null);

    const handleLoadP10 = async () => {
        setLoadingP10(true);
        setError(null);
        setP11Data(null);
        setExpandedP11(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/p10?year=${p10Year}`);
            if (res.ok) {
                setP10Data(await res.json());
            } else {
                setError('Failed to load P10');
            }
        } catch {
            setError('Network error loading P10');
        } finally {
            setLoadingP10(false);
        }
    };

    const handleLoadP11 = async (kraPin: string) => {
        if (expandedP11 === kraPin) {
            setExpandedP11(null);
            setP11Data(null);
            return;
        }
        setLoadingP11(true);
        setError(null);
        try {
            const res = await apiFetch(`/clients/${clientId}/p11/${kraPin}?year=${p10Year}`);
            if (res.ok) {
                setP11Data(await res.json());
                setExpandedP11(kraPin);
            } else {
                setError('Failed to load P11');
            }
        } catch {
            setError('Network error loading P11');
        } finally {
            setLoadingP11(false);
        }
    };

    /* ── Render ── */
    return (
        <div className="space-y-6">
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <AlertCircle className="h-4 w-4" /> {error}
                </div>
            )}
            {success && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> {success}
                </div>
            )}

            {/* ── 1. Compliance Generator ── */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <FileArchive className="h-4 w-4 text-slate-500" /> Compliance Files
                </h3>
                <div className="flex flex-wrap items-center gap-4 mb-4">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                            type="checkbox"
                            checked={generatePaye}
                            onChange={(e) => setGeneratePaye(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-[#ff0613] focus:ring-[#ff0613]"
                        />
                        PAYE ZIP
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                            type="checkbox"
                            checked={generateNssf}
                            onChange={(e) => setGenerateNssf(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-[#ff0613] focus:ring-[#ff0613]"
                        />
                        NSSF XLSX
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                            type="checkbox"
                            checked={generateSha}
                            onChange={(e) => setGenerateSha(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-[#ff0613] focus:ring-[#ff0613]"
                        />
                        SHA XLSX
                    </label>
                    <button
                        disabled={complianceLoading || (!generatePaye && !generateNssf && !generateSha)}
                        onClick={handleGenerateCompliance}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                    >
                        {complianceLoading ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                        )}
                        Generate
                    </button>
                </div>

                {complianceProgress && (
                    <div className="mb-3 text-xs font-medium text-slate-600">
                        {complianceProgress}
                    </div>
                )}

                {complianceResult && (
                    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4 space-y-3">
                        {complianceResult.payeZipUrl && (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs">
                                    <FileArchive className="h-3.5 w-3.5 text-slate-400" />
                                    <span className="font-medium text-slate-900">PAYE ZIP</span>
                                    <span className="text-slate-400">{complianceResult.payeZipLabel}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <a
                                        href={complianceResult.payeZipUrl}
                                        download
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 transition"
                                    >
                                        <Download className="h-3 w-3" /> Download
                                    </a>
                                    <button
                                        onClick={() => handleAutoFile('paye')}
                                        disabled={filingLoading}
                                        className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-40"
                                    >
                                        {filingLoading && filingType === 'paye' ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                        Auto-File
                                    </button>
                                    <button
                                        onClick={() => handleAutoFile('paye', true)}
                                        disabled={filingLoading}
                                        className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100 transition disabled:opacity-40"
                                    >
                                        {filingLoading && filingType === 'paye' ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                        Print PRN
                                    </button>
                                </div>
                            </div>
                        )}
                        {complianceResult.nssfFileUrl && (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs">
                                    <FileSpreadsheet className="h-3.5 w-3.5 text-slate-400" />
                                    <span className="font-medium text-slate-900">NSSF XLSX</span>
                                    <span className="text-slate-400">{complianceResult.nssfFileLabel}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <a
                                        href={complianceResult.nssfFileUrl}
                                        download
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 transition"
                                    >
                                        <Download className="h-3 w-3" /> Download
                                    </a>
                                    <button
                                        onClick={() => handleAutoFile('nssf')}
                                        disabled={filingLoading}
                                        className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-40"
                                    >
                                        {filingLoading && filingType === 'nssf' ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                        Auto-File
                                    </button>
                                </div>
                            </div>
                        )}
                        {complianceResult.shaFileUrl && (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs">
                                    <FileSpreadsheet className="h-3.5 w-3.5 text-slate-400" />
                                    <span className="font-medium text-slate-900">SHA XLSX</span>
                                    <span className="text-slate-400">{complianceResult.shaFileLabel}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <a
                                        href={complianceResult.shaFileUrl}
                                        download
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 transition"
                                    >
                                        <Download className="h-3 w-3" /> Download
                                    </a>
                                    <button
                                        onClick={() => handleAutoFile('sha')}
                                        className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 transition"
                                    >
                                        <Info className="h-3 w-3" /> Info
                                    </button>
                                </div>
                            </div>
                        )}
                        {complianceResult.summaryAmounts && (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500 border-t border-slate-100 pt-2">
                                <span>PAYE: {Number(complianceResult.summaryAmounts.payeAmount).toLocaleString()}</span>
                                <span>NITA: {Number(complianceResult.summaryAmounts.nitaAmount).toLocaleString()}</span>
                                <span>AHL: {Number(complianceResult.summaryAmounts.housingLevyAmount).toLocaleString()}</span>
                                <span>NSSF: {Number(complianceResult.summaryAmounts.nssfAmount).toLocaleString()}</span>
                                <span>SHA: {Number(complianceResult.summaryAmounts.shaAmount).toLocaleString()}</span>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* ── 2. Payslip Downloader ── */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-500" /> Payslips
                </h3>
                <div className="mb-4">
                    <button
                        onClick={handleSendPayslips}
                        disabled={sendingEmail}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
                    >
                        {sendingEmail ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        Send All Payslips via Email
                    </button>
                </div>
                {entriesLoading ? (
                    <div className="flex items-center justify-center py-6">
                        <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
                    </div>
                ) : entries.length === 0 ? (
                    <p className="text-xs text-slate-400">No entries found for this run.</p>
                ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-100">
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50">
                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">KRA PIN</th>
                                    <th className="px-3 py-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {entries.map((emp) => (
                                    <tr key={emp.employeeId} className="hover:bg-slate-50/50 transition">
                                        <td className="px-3 py-2 font-medium text-slate-900">{emp.employeeName}</td>
                                        <td className="px-3 py-2 font-mono text-slate-700">{emp.kraPin}</td>
                                        <td className="px-3 py-2 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => downloadPdf(`/clients/${clientId}/payslip/${emp.kraPin}${periodMMYYYY ? `?period=${periodMMYYYY}` : ''}`, `Payslip_${emp.employeeName.replace(/\s+/g, '_')}.pdf`, setError)}
                                                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 transition"
                                                >
                                                    <Download className="h-3 w-3" /> Payslip
                                                </button>
                                                <button
                                                    onClick={() => downloadPdf(`/clients/${clientId}/p9/${emp.kraPin}`, `P9_${emp.employeeName.replace(/\s+/g, '_')}.pdf`, setError)}
                                                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 transition"
                                                >
                                                    <Download className="h-3 w-3" /> P9
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* ── 3. Email Sender ── */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Mail className="h-4 w-4 text-slate-500" /> Email Distribution
                    </h3>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleSendPayslips}
                            disabled={sendingEmail}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
                        >
                            {sendingEmail ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Send className="h-3.5 w-3.5" />
                            )}
                            Send Payslips
                        </button>
                        <button
                            onClick={handleSendP9s}
                            disabled={sendingEmail}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition disabled:opacity-40"
                        >
                            {sendingEmail ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <FileText className="h-3.5 w-3.5" />
                            )}
                            Send P9s
                        </button>
                    </div>
                </div>

                {emailResult && (
                    <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                        Sent: {emailResult.sent} | Failed: {emailResult.failed} | Total: {emailResult.total}
                    </div>
                )}

                {emailLoading ? (
                    <div className="flex items-center justify-center py-6">
                        <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
                    </div>
                ) : emailHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 py-8 text-center">
                        <Mail className="h-6 w-6 text-slate-300 mb-2" />
                        <p className="text-xs font-medium text-slate-600">No email history</p>
                        <p className="text-[10px] text-slate-400 mt-1">Send payslips or P9s to employees.</p>
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-100">
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50">
                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Email</th>
                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Doc</th>
                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Status</th>
                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Sent</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {emailHistory.map((h) => (
                                    <tr key={h.id} className="hover:bg-slate-50/50 transition">
                                        <td className="px-3 py-2 font-medium text-slate-900">{h.employeeName}</td>
                                        <td className="px-3 py-2 text-slate-700">{h.emailAddress}</td>
                                        <td className="px-3 py-2">
                                            <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 uppercase">
                                                {h.documentType}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={cn(
                                                    'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                                    h.status === 'sent'
                                                        ? 'bg-emerald-50 text-emerald-700'
                                                        : 'bg-rose-50 text-rose-700'
                                                )}
                                            >
                                                {h.status}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-slate-500">
                                            {h.sentAt ? new Date(h.sentAt).toLocaleString() : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* ── 4. P10 / P11 ── */}
            {/* ── 4. P10 / P11 ── */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Search className="h-4 w-4 text-slate-500" /> P10 / P11 — Annual Reconciliation
                </h3>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                    <input
                        type="text"
                        value={p10Year}
                        onChange={(e) => setP10Year(e.target.value)}
                        placeholder="YYYY"
                        className="w-20 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <button
                        disabled={loadingP10}
                        onClick={handleLoadP10}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40"
                    >
                        {loadingP10 ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Load P10'}
                    </button>
                </div>

                {p10Data ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="rounded-lg bg-slate-50 p-3">
                                <span className="text-xs text-slate-500">Employees</span>
                                <p className="text-lg font-bold text-slate-900">{p10Data.totalEmployees}</p>
                            </div>
                            <div className="rounded-lg bg-slate-50 p-3">
                                <span className="text-xs text-slate-500">Total Gross</span>
                                <p className="text-lg font-bold text-slate-900">KES {Number(p10Data.totalGross).toLocaleString()}</p>
                            </div>
                            <div className="rounded-lg bg-slate-50 p-3">
                                <span className="text-xs text-slate-500">Total PAYE</span>
                                <p className="text-lg font-bold text-slate-900">KES {Number(p10Data.totalPaye).toLocaleString()}</p>
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-lg border border-slate-100">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50">
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">KRA PIN</th>
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Months</th>
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Gross</th>
                                        <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">PAYE</th>
                                        <th className="px-3 py-2" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {p10Data.employeeDetails?.map((emp) => (
                                        <tr key={emp.kraPin} className="hover:bg-slate-50/50 transition">
                                            <td className="px-3 py-2 font-medium text-slate-900">{emp.employeeName}</td>
                                            <td className="px-3 py-2 font-mono text-slate-700">{emp.kraPin}</td>
                                            <td className="px-3 py-2 text-right font-mono text-slate-900">{emp.monthsWorked}</td>
                                            <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(emp.totalGross).toLocaleString()}</td>
                                            <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(emp.totalPaye).toFixed(2)}</td>
                                            <td className="px-3 py-2 text-right">
                                                <button
                                                    onClick={() => handleLoadP11(emp.kraPin)}
                                                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 transition"
                                                >
                                                    {expandedP11 === emp.kraPin ? (
                                                        <ChevronUp className="h-3 w-3" />
                                                    ) : (
                                                        <ChevronDown className="h-3 w-3" />
                                                    )}
                                                    P11
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </div>
                        </div>

                        {expandedP11 && p11Data && (
                            <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-xs font-bold text-slate-900">
                                        P11 — {p11Data.employeeName} ({p11Data.kraPin})
                                    </h4>
                                    <button
                                        onClick={() => downloadPdf(`/clients/${clientId}/p11/${p11Data.kraPin}/pdf?year=${p10Year}`, `P11_${p11Data.kraPin}_${p10Year}.pdf`, setError)}
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 transition"
                                    >
                                        <Download className="h-3 w-3" /> PDF
                                    </button>
                                </div>
                                {loadingP11 ? (
                                    <div className="flex items-center justify-center py-4">
                                        <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                            <thead>
                                                <tr className="border-b border-slate-200 bg-slate-50">
                                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500">Month</th>
                                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Gross</th>
                                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">PAYE</th>
                                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">SHA</th>
                                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">NSSF</th>
                                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">AHL</th>
                                                    <th className="px-3 py-2 font-semibold uppercase tracking-wider text-slate-500 text-right">Net</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {p11Data.monthly?.map((m, i) => (
                                                    <tr key={i} className="hover:bg-slate-50/50">
                                                        <td className="px-3 py-2 font-medium text-slate-900">{m.periodLabel || m.period}</td>
                                                        <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(m.grossPay).toLocaleString()}</td>
                                                        <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(m.payeTax).toFixed(2)}</td>
                                                        <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(m.shaDeduction).toFixed(2)}</td>
                                                        <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(m.nssfDeduction).toFixed(2)}</td>
                                                        <td className="px-3 py-2 text-right font-mono text-slate-900">{Number(m.ahlDeduction).toFixed(2)}</td>
                                                        <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{Number(m.netPay).toLocaleString()}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="border-t border-slate-200 bg-slate-50">
                                                    <td className="px-3 py-2 font-bold text-slate-900">TOTAL</td>
                                                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalGross || 0).toLocaleString()}</td>
                                                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalPaye || 0).toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalSha || 0).toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalNssf || 0).toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalAhl || 0).toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{Number(p11Data.totals?.totalNet || 0).toLocaleString()}</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-xs text-slate-400">Enter a year and click Load P10 to view annual reconciliation.</p>
                )}
            </section>

            {/* SHA Info Modal */}
            {showShaInfo && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
                        <div className="flex items-center gap-2 mb-3">
                            <Info className="h-5 w-5 text-amber-500" />
                            <h3 className="text-sm font-bold text-slate-900">SHA Auto-Filing</h3>
                        </div>
                        <p className="text-xs text-slate-600 mb-4">
                            SHA (Social Health Authority) auto-filing is not yet implemented. You can download the SHA XLSX compliance file and upload it manually to the SHA portal.
                        </p>
                        <div className="flex justify-end">
                            <button
                                onClick={() => setShowShaInfo(false)}
                                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 transition"
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
