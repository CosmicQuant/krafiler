/**
 * OverviewView.tsx
 *
 * Modern, functional dashboard overview with real data,
 * compliance calendar, and actionable quick stats.
 */

import { useMemo } from 'react';
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
  Clock,
  FileCheck2,
  Zap,
  ChevronRight,
} from 'lucide-react';

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
        color: 'emerald',
      },
      {
        title: 'VAT & Monthly Returns',
        date: '20th of every month',
        days: daysUntil20th(),
        urgent: daysUntil20th() <= 3,
        color: 'blue',
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

    // Fallback if no real activity
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

  const getToneIcon = (tone: string) => {
    switch (tone) {
      case 'success':
        return <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400"><CheckCircle2 className="h-5 w-5" /></div>;
      case 'warning':
        return <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/10 text-amber-400"><AlertTriangle className="h-5 w-5" /></div>;
      default:
        return <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/10 text-blue-400"><Activity className="h-5 w-5" /></div>;
    }
  };

  return (
    <div className="mt-8 space-y-8">
      {/* Stats Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Clients', value: stats.total, icon: Building2, color: 'text-white', bg: 'bg-slate-800' },
          { label: 'Active Filings', value: stats.active, icon: Zap, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Completed This Month', value: stats.completedThisMonth, icon: FileCheck2, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Running Jobs', value: stats.runningJobs, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-400">{stat.label}</p>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${stat.bg}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </div>
            <p className="mt-3 text-3xl font-black text-white">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        {/* Left Column */}
        <div className="space-y-8">
          {/* Compliance Calendar */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Compliance Calendar</h3>
              <CalendarClock className="h-5 w-5 text-slate-500" />
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {deadlines.map((d) => (
                <button
                  key={d.title}
                  onClick={() => onNavigateToView(d.title.includes('Payroll') ? 'desk-9th' : 'desk-20th')}
                  className={`text-left rounded-2xl border p-5 transition-all hover:scale-[1.02] ${
                    d.urgent
                      ? 'border-amber-500/30 bg-amber-500/5'
                      : 'border-slate-800 bg-slate-800/30 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-bold ${d.urgent ? 'text-amber-400' : 'text-slate-300'}`}>{d.title}</p>
                    {d.urgent && <AlertTriangle className="h-4 w-4 text-amber-400" />}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{d.date}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${d.urgent ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                    <span className={`text-sm font-bold ${d.urgent ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {d.days} days left
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Pending Work */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Pending Work</h3>
              <TrendingUp className="h-5 w-5 text-slate-500" />
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <button
                onClick={() => onNavigateToView('desk-9th')}
                className="text-left rounded-2xl border border-slate-800 bg-slate-800/30 p-5 transition-all hover:border-slate-700 hover:bg-slate-800/50"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-400">Payroll Processing</p>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  </div>
                </div>
                <p className="mt-3 text-3xl font-black text-white">
                  {payrollPendingCount} <span className="text-lg font-normal text-slate-500">packs</span>
                </p>
                <p className="mt-2 text-xs text-slate-500">Due before 9th</p>
                <div className="mt-4 flex items-center gap-1 text-xs font-bold text-emerald-400">
                  Go to desk <ArrowRight className="h-3 w-3" />
                </div>
              </button>

              <button
                onClick={() => onNavigateToView('desk-20th')}
                className="text-left rounded-2xl border border-slate-800 bg-slate-800/30 p-5 transition-all hover:border-slate-700 hover:bg-slate-800/50"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-400">Monthly Returns</p>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                    <CalendarClock className="h-4 w-4 text-blue-400" />
                  </div>
                </div>
                <p className="mt-3 text-3xl font-black text-white">
                  {taxPendingCount} <span className="text-lg font-normal text-slate-500">remittances</span>
                </p>
                <p className="mt-2 text-xs text-slate-500">Due before 20th</p>
                <div className="mt-4 flex items-center gap-1 text-xs font-bold text-blue-400">
                  Go to desk <ArrowRight className="h-3 w-3" />
                </div>
              </button>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
            <h3 className="text-lg font-bold text-white">Recent Activity</h3>
            <div className="mt-5 space-y-3">
              {recentActivity.length > 0 ? (
                recentActivity.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 rounded-xl border border-slate-800/50 bg-slate-800/20 px-4 py-3"
                  >
                    {getToneIcon(item.tone)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.pin} &bull; {item.action}</p>
                    </div>
                    <span className="text-xs text-slate-500 shrink-0">{item.time}</span>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-slate-500 text-sm">
                  No recent activity. Start by adding clients or queueing filings.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Quick Actions */}
        <div className="space-y-6">
          <h3 className="text-lg font-bold text-white">Quick Actions</h3>
          <div className="grid gap-3">
            {/* Onboard */}
            <button
              onClick={onOpenNewClientModal}
              className="group relative flex items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-400 p-5 text-left shadow-lg transition-all hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(16,185,129,0.3)]"
            >
              <div>
                <p className="text-lg font-black text-slate-950">Onboard Client</p>
                <p className="mt-1 text-xs font-semibold text-emerald-950/70">Add client & set obligations</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                <Plus className="h-5 w-5 text-slate-950" />
              </div>
            </button>

            {/* Bulk Import */}
            <div className="space-y-2">
              <button
                onClick={() => document.getElementById('bulkCsvUpload')?.click()}
                className="group relative flex w-full items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-teal-600 to-teal-400 p-5 text-left shadow-lg transition-all hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(20,184,166,0.3)]"
              >
                <div>
                  <p className="text-lg font-black text-slate-950">Bulk Import</p>
                  <p className="mt-1 text-xs font-semibold text-teal-950/70">Upload CSV template</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                  <Upload className="h-5 w-5 text-slate-950" />
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
                className="w-full text-center text-xs text-teal-400 hover:text-teal-300 transition-colors underline"
              >
                Download CSV Template
              </button>
            </div>
            <input type="file" id="bulkCsvUpload" accept=".csv" className="hidden" onChange={onBulkCsvUpload} />

            {/* Process Payroll */}
            <button
              onClick={() => onNavigateToView('desk-9th')}
              className="group relative flex items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-red-600 to-red-500 p-5 text-left shadow-lg transition-all hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(220,38,38,0.3)]"
            >
              <div>
                <p className="text-lg font-black text-white">Process Payroll</p>
                <p className="mt-1 text-xs font-medium text-red-100">Unified PAYE, NSSF, SHA</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                <UploadCloud className="h-5 w-5 text-white" />
              </div>
            </button>

            {/* Nil Filing */}
            <button
              onClick={() => onNavigateToView('desk-nil')}
              className="group relative flex items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-r from-slate-100 to-white p-5 text-left shadow-lg transition-all hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(255,255,255,0.15)]"
            >
              <div>
                <p className="text-lg font-black text-slate-950">Nil Filing Run</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">Auto-file empty returns</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900/5 backdrop-blur-md">
                <Activity className="h-5 w-5 text-slate-950" />
              </div>
            </button>

            {/* Client Registry */}
            <button
              onClick={() => onNavigateToView('clients')}
              className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-900 to-slate-800 p-5 text-left shadow-lg transition-all hover:scale-[1.02] hover:border-slate-600"
            >
              <div>
                <p className="text-lg font-black text-white">Client Registry</p>
                <p className="mt-1 text-xs font-medium text-slate-400">View portfolios matrix</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/5 bg-white/10 backdrop-blur-md">
                <Building2 className="h-5 w-5 text-white" />
              </div>
            </button>
          </div>

          {/* Mini Tip */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                <ChevronRight className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Pro Tip</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
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
