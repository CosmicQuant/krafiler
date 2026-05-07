import { Link } from 'react-router-dom';
import {
    Activity,
    Building2,
    LayoutDashboard,
    LogOut,
    TerminalSquare,
    Users,
    FileArchive,
    X,
} from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { PlanKey } from '../../types';

export function Sidebar({ 
    payrollPendingCount, 
    taxPendingCount, 
    plan, 
    capacityValue, 
    capacityPercentage 
}: { 
    payrollPendingCount: number; 
    taxPendingCount: number; 
    plan: { label: string; used: number };
    capacityValue: number | string;
    capacityPercentage: number;
}) {
    const { 
        view, 
        setView, 
        isSidebarOpen, 
        setIsSidebarOpen, 
        selectedPlan, 
        setSelectedPlan 
    } = useUIStore();

    return (
        <aside className={`absolute inset-y-0 left-0 z-50 w-72 shrink-0 border-r border-slate-800/50 bg-slate-950/95 backdrop-blur p-6 flex flex-col transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.4)] text-slate-950">
                        <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                        <span className="text-xl font-bold tracking-tight text-white">Kwanta<span className="text-emerald-500">.</span></span>
                    </div>
                </div>
                <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white transition">
                    <X className="h-6 w-6" />
                </button>
            </div>

            <nav className="mt-10 space-y-1.5 flex-1">
                <button onClick={() => { setView('overview'); setIsSidebarOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'overview' ? 'bg-slate-800/80 text-white shadow-inner' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}>
                    <LayoutDashboard className="h-4 w-4" /> Overview
                </button>
                
                <div className="pt-6 pb-2 px-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Tax Filing Desks</p>
                </div>
                <button onClick={() => { setView('desk-9th'); setIsSidebarOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'desk-9th' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.05)]' : 'text-slate-400 hover:bg-slate-900 border border-transparent'}`}>
                    <span className="flex items-center gap-3"><Users className="h-4 w-4" /> Payroll Processing</span>
                    <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-amber-500/10 border border-amber-500/20 px-1 text-xs font-bold text-amber-500">{payrollPendingCount}</span>
                </button>
                <button onClick={() => { setView('desk-20th'); setIsSidebarOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'desk-20th' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.05)]' : 'text-slate-400 hover:bg-slate-900 border border-transparent'}`}>
                    <span className="flex items-center gap-3"><TerminalSquare className="h-4 w-4" /> VAT & Monthly</span>
                    <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-amber-500/10 border border-amber-500/20 px-1 text-xs font-bold text-amber-500">{taxPendingCount}</span>
                </button>
                <button onClick={() => { setView('desk-elevy'); setIsSidebarOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'desk-elevy' ? 'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20 shadow-[0_0_10px_rgba(217,70,239,0.05)]' : 'text-slate-400 hover:bg-slate-900 border border-transparent'}`}>
                    <span className="flex items-center gap-3"><Activity className="h-4 w-4" /> Tourism Fund Desk</span>
                </button>
                <button onClick={() => { setView('desk-nil'); setIsSidebarOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'desk-nil' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-[0_0_10px_rgba(168,85,247,0.05)]' : 'text-slate-400 hover:bg-slate-900 border border-transparent'}`}>
                    <span className="flex items-center gap-3"><FileArchive className="h-4 w-4" /> Nil & ITR Desk</span>
                </button>

                <div className="pt-6 pb-2 px-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Tax Practice</p>
                </div>
                <button onClick={() => { setView('clients'); setIsSidebarOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === 'clients' ? 'bg-slate-800/80 text-white shadow-inner' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}>
                    <Building2 className="h-4 w-4" /> Client Database
                </button>
            </nav>

            <div className="mt-auto border-t border-slate-800/50 pt-6">
                <div className="rounded-2xl border border-slate-700/50 bg-slate-900/40 p-4 backdrop-blur">
                    <p className="text-xs font-medium text-slate-400">{plan.label}</p>
                    <div className="mt-2 flex items-end justify-between">
                        <p className="text-xl font-bold text-white">{plan.used} <span className="text-sm font-normal text-slate-500">/ {capacityValue} PINs</span></p>
                    </div>
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80">
                        <div className={`h-full rounded-full ${capacityPercentage > 85 ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'}`} style={{ width: `${capacityPercentage}%` }} />
                    </div>
                    <select 
                        value={selectedPlan} 
                        onChange={(e) => setSelectedPlan(e.target.value as PlanKey)}
                        className="mt-4 w-full rounded-lg bg-slate-800/80 px-3 py-2 text-xs font-medium text-white border border-slate-700 outline-none hover:bg-slate-700 transition cursor-pointer"
                    >
                        <option value="starter">Practice Starter</option>
                        <option value="growth">Growing Firm</option>
                        <option value="enterprise">Enterprise Desk</option>
                    </select>
                </div>
                <Link to="/" className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-800/50 hover:text-white">
                    <LogOut className="h-4 w-4" /> Sign Out
                </Link>
            </div>
        </aside>
    );
}
