/**
 * OverviewView.tsx
 *
 * Sleek, modern dashboard overview. Light theme.
 * Shows KPIs, compliance matrix, deadlines, and quick actions.
 */

import { useMemo, useState } from 'react';
import type { DashboardView } from '../../../types';
import {
  CalendarClock,
  CheckCircle2,
  Activity,
  Plus,
  UploadCloud,
  Upload,
  Building2,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  FileCheck2,
  Zap,
  ChevronRight,
  Users,
  Briefcase,
  Trash2,
  X,
} from 'lucide-react';
import { useDeleteClient } from '../../../hooks/useClients';

interface OverviewViewProps {
  clients: any[];
  activeJobs: Record<string, any>;
  payrollPendingCount: number;
  taxPendingCount: number;
  onOpenNewClientModal: () => void;
  onNavigateToView: (view: DashboardView) => void;
  onBulkCsvUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export function OverviewView({
  clients,
  activeJobs,
  payrollPendingCount,
  taxPendingCount,
  onOpenNewClientModal,
  onNavigateToView,
  onBulkCsvUpload,
}: OverviewViewProps) {
  const deleteClientMutation = useDeleteClient();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const total = clients.length;
    const active = clients.filter((c) => {
      const statusList = [c.paye, c.nssf, c.sha, c.vat, c.tot, c.mri];
      return statusList.some((s) => s && s !== 'na' && s !== 'done');
    }).length;

    const completedThisMonth = clients.filter((c) => {
      const dates = [
        c.payeLastFiledDate,
        c.nssfLastFiledDate,
        c.shaLastFiledDate,
        c.vatLastFiledDate,
        c.totLastFiledDate,
        c.mriLastFiledDate,
      ];
      const now = new Date();
      return dates.some((d) => {
        if (!d) return false;
        const date = new Date(d);
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      });
    }).length;

    const runningJobs = Object.values(activeJobs).filter(
      (j) => j && (j.state === 'waiting' || j.state === 'active')
    ).length;

    return { total, active, completedThisMonth, runningJobs };
  }, [clients, activeJobs]);

  const deadlines = useMemo(() => {
    const now = new Date();
    const daysUntil9th = () => {
      const d = new Date(now.getFullYear(), now.getMonth(), 9);
      if (d < now) d.setMonth(d.getMonth() + 1);
      return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    };
    const daysUntil20th = () => {
      const d = new Date(now.getFullYear(), now.getMonth(), 20);
      if (d < now) d.setMonth(d.getMonth() + 1);
      return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    };

    return [
      {
        title: 'Payroll Deadline',
        date: '9th of every month',
        days: daysUntil9th(),
        urgent: daysUntil9th() <= 3,
      },
      {
        title: 'VAT & Monthly Returns',
        date: '20th of every month',
        days: daysUntil20th(),
        urgent: daysUntil20th() <= 3,
      },
    ];
  }, []);

  const recentActivity = useMemo(() => {
    const items: { name: string; pin: string; action: string; time: string; tone: 'success' | 'warning' | 'info' }[] = [];

    clients.slice(0, 5).forEach((client) => {
      const job = activeJobs[client.id];
      if (job) {
        if (job.state === 'completed') {
          items.push({
            name: client.name,
            pin: client.pin,
            action: job.obligationType ? `${job.obligationType.toUpperCase()} filed` : 'Return filed',
            time: 'Recently',
            tone: 'success',
          });
        } else if (job.state === 'failed') {
          items.push({
            name: client.name,
            pin: client.pin,
            action: job.failedReason ? 'Filing failed' : 'Job failed',
            time: 'Recently',
            tone: 'warning',
          });
        } else if (job.state === 'active' || job.state === 'waiting') {
          items.push({
            name: client.name,
            pin: client.pin,
            action: job.message || 'In progress',
            time: 'Running',
            tone: 'info',
          });
        }
      }
    });

    if (items.length === 0 && clients.length > 0) {
      items.push({
        name: clients[0]?.name || 'System',
        pin: clients[0]?.pin || '',
        action: 'Dashboard initialized',
        time: 'Just now',
        tone: 'info',
      });
    }

    return items.slice(0, 5);
  }, [clients, activeJobs]);

  const getStatusDot = (status: string) => {
    if (status === 'done') return <span className="h-2 w-2 rounded-full bg-emerald-500" title="Filed" />;
    if (status === 'due') return <span className="h-2 w-2 rounded-full bg-[#ff0613] animate-pulse" title="Due" />;
    if (status === 'generated') return <span className="h-2 w-2 rounded-full bg-blue-500" title="Generated" />;
    return <span className="h-2 w-2 rounded-full bg-slate-200" title="N/A" />;
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteClientMutation.mutateAsync(id);
      setDeleteConfirmId(null);
    } catch {
      // error handled by mutation
    }
  };

  return (
    <div className="mt-8 space-y-8">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Clients', value: stats.total, icon: Users, color: 'text-slate-700', bg: 'bg-slate-100' },
          { label: 'Returns Due', value: stats.active, icon: AlertTriangle, color: 'text-[#ff0613]', bg: 'bg-red-50' },
          { label: 'Filed This Month', value: stats.completedThisMonth, icon: FileCheck2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Active Jobs', value: stats.runningJobs, icon: Zap, color: 'text-blue-600', bg: 'bg-blue-50' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{stat.label}</p>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${stat.bg}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </div>
            <p className="mt-3 text-3xl font-black text-slate-900">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Two Column Layout */}
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* Left Column */}
        <div className="space-y-8">
          {/* Compliance Matrix */}
          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-slate-900">Compliance Status</h3>
              <button
                onClick={() => onNavigateToView('clients')}
                className="text-xs font-semibold text-[#ff0613] hover:text-[#d80000] transition flex items-center gap-1"
              >
                View all <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            
            {clients.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">
                No clients yet. <button onClick={onOpenNewClientModal} className="text-[#ff0613] font-semibold hover:underline">Add your first client</button>.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2.5 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Client</th>
                      {['PAYE', 'NSSF', 'SHA', 'VAT', 'TOT', 'MRI'].map((h) => (
                        <th key={h} className="text-center py-2.5 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 w-12">{h}</th>
                      ))}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {clients.slice(0, 8).map((client) => (
                      <tr key={client.id} className="group">
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                              <Building2 className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{client.name}</p>
                              <p className="text-[10px] font-mono text-slate-400">{client.pin}</p>
                            </div>
                          </div>
                        </td>
                        {['paye', 'nssf', 'sha', 'vat', 'tot', 'mri'].map((obs) => (
                          <td key={obs} className="py-2.5 px-1 text-center">
                            {getStatusDot(client[obs])}
                          </td>
                        ))}
                        <td className="py-2.5 pl-2">
                          {deleteConfirmId === client.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(client.id)}
                                className="rounded-md bg-[#ff0613] px-2 py-1 text-[10px] font-bold text-white hover:bg-[#d80000]"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-200"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmId(client.id)}
                              className="opacity-0 group-hover:opacity-100 rounded-md p-1 text-slate-300 hover:text-[#ff0613] hover:bg-red-50 transition"
                              title="Delete client"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {clients.length > 8 && (
                  <button
                    onClick={() => onNavigateToView('clients')}
                    className="mt-3 w-full text-center text-xs font-semibold text-slate-400 hover:text-slate-600 transition py-2"
                  >
                    + {clients.length - 8} more clients
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Pending Work */}
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              onClick={() => onNavigateToView('payroll')}
              className="text-left rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-slate-200"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">Payroll Processing</p>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </div>
              </div>
              <p className="mt-3 text-3xl font-black text-slate-900">
                {payrollPendingCount} <span className="text-lg font-normal text-slate-400">packs</span>
              </p>
              <p className="mt-1 text-xs text-slate-400">Due before 9th</p>
              <div className="mt-3 flex items-center gap-1 text-xs font-bold text-[#ff0613]">
                Go to desk <ArrowRight className="h-3 w-3" />
              </div>
            </button>

            <button
              onClick={() => onNavigateToView('vat')}
              className="text-left rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-slate-200"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">Monthly Returns</p>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                  <CalendarClock className="h-4 w-4 text-blue-600" />
                </div>
              </div>
              <p className="mt-3 text-3xl font-black text-slate-900">
                {taxPendingCount} <span className="text-lg font-normal text-slate-400">remittances</span>
              </p>
              <p className="mt-1 text-xs text-slate-400">Due before 20th</p>
              <div className="mt-3 flex items-center gap-1 text-xs font-bold text-blue-600">
                Go to desk <ArrowRight className="h-3 w-3" />
              </div>
            </button>
          </div>

          {/* Recent Activity */}
          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900">Recent Activity</h3>
            <div className="mt-4 space-y-2">
              {recentActivity.length > 0 ? (
                recentActivity.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-xl border border-slate-50 bg-slate-50/50 px-4 py-2.5"
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      item.tone === 'success' ? 'bg-emerald-50 text-emerald-600' :
                      item.tone === 'warning' ? 'bg-amber-50 text-amber-600' :
                      'bg-blue-50 text-blue-600'
                    }`}>
                      {item.tone === 'success' ? <CheckCircle2 className="h-4 w-4" /> :
                       item.tone === 'warning' ? <AlertTriangle className="h-4 w-4" /> :
                       <Activity className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{item.name}</p>
                      <p className="text-xs text-slate-400">{item.pin} &bull; {item.action}</p>
                    </div>
                    <span className="text-[11px] font-medium text-slate-400 shrink-0">{item.time}</span>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-slate-400 text-sm">
                  No recent activity. Start by adding clients or queueing filings.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <h3 className="text-lg font-bold text-slate-900">Quick Actions</h3>
          <div className="grid gap-3">
            <button
              onClick={onOpenNewClientModal}
              className="group flex items-center justify-between rounded-2xl bg-[#ff0613] p-5 text-left shadow-sm transition-all hover:shadow-md hover:bg-[#d80000]"
            >
              <div>
                <p className="text-lg font-black text-white">Onboard Client</p>
                <p className="mt-1 text-xs font-semibold text-red-100">Add client & set obligations</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
                <Plus className="h-5 w-5 text-white" />
              </div>
            </button>

            <div className="space-y-2">
              <button
                onClick={() => document.getElementById('bulkCsvUpload')?.click()}
                className="group flex w-full items-center justify-between rounded-2xl bg-slate-900 p-5 text-left shadow-sm transition-all hover:shadow-md hover:bg-slate-800"
              >
                <div>
                  <p className="text-lg font-black text-white">Bulk Import</p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">Upload CSV template</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
                  <Upload className="h-5 w-5 text-white" />
                </div>
              </button>
              <button
                onClick={() => {
                  const csvContent =
                    'Company Name,PIN,Password,Obligations,Email,Phone,NSSF Login,NSSF Password,SHA Login,SHA Password\nExample Company Ltd,P051234567M,UserPass123!,"paye, nssf, mri",test@example.com,0700000000,NSSF001,NssfPass123,SHA001,ShaPass123';
                  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'Clients_Bulk_Upload_Template.csv';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-700 transition-colors underline"
              >
                Download CSV Template
              </button>
            </div>
            <input type="file" id="bulkCsvUpload" accept=".csv,.xlsx,.xls" className="hidden" onChange={onBulkCsvUpload} />

            <button
              onClick={() => onNavigateToView('payroll')}
              className="group flex items-center justify-between rounded-2xl border-2 border-[#ff0613]/20 bg-red-50 p-5 text-left transition-all hover:border-[#ff0613]/40 hover:bg-red-100/50"
            >
              <div>
                <p className="text-lg font-black text-[#ff0613]">Process Payroll</p>
                <p className="mt-1 text-xs font-medium text-red-400">Unified PAYE, NSSF, SHA</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ff0613]/10">
                <UploadCloud className="h-5 w-5 text-[#ff0613]" />
              </div>
            </button>

            <button
              onClick={() => onNavigateToView('nil-filing')}
              className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:shadow-md hover:border-slate-300"
            >
              <div>
                <p className="text-lg font-black text-slate-900">Nil Filing Run</p>
                <p className="mt-1 text-xs font-semibold text-slate-400">Auto-file empty returns</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                <Activity className="h-5 w-5 text-slate-600" />
              </div>
            </button>

            <button
              onClick={() => onNavigateToView('clients')}
              className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:shadow-md hover:border-slate-300"
            >
              <div>
                <p className="text-lg font-black text-slate-900">Client Registry</p>
                <p className="mt-1 text-xs font-medium text-slate-400">View portfolios matrix</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                <Briefcase className="h-5 w-5 text-slate-600" />
              </div>
            </button>
          </div>

          {/* Deadlines */}
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Upcoming Deadlines</h3>
            <div className="space-y-3">
              {deadlines.map((d) => (
                <button
                  key={d.title}
                  onClick={() => onNavigateToView(d.title.includes('Payroll') ? 'payroll' : 'vat')}
                  className={`w-full text-left rounded-xl border p-4 transition-all hover:shadow-sm ${
                    d.urgent
                      ? 'border-[#ff0613]/20 bg-red-50/50'
                      : 'border-slate-100 bg-slate-50/50 hover:border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-bold ${d.urgent ? 'text-[#ff0613]' : 'text-slate-700'}`}>{d.title}</p>
                    {d.urgent && <AlertTriangle className="h-4 w-4 text-[#ff0613]" />}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{d.date}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${d.urgent ? 'bg-[#ff0613] animate-pulse' : 'bg-emerald-500'}`} />
                    <span className={`text-xs font-bold ${d.urgent ? 'text-[#ff0613]' : 'text-emerald-600'}`}>
                      {d.days} days left
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Mini Tip */}
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-500">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Pro Tip</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Use the bulk CSV import to onboard multiple clients at once. Download the template, fill it in, and upload.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
