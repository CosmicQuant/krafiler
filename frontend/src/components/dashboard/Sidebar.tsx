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
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { useUIStore } from '../../store/uiStore';

const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
];

const deskItems = [
    { id: 'desk-9th', label: 'Payroll Processing', icon: Users, countKey: 'payroll' as const },
    { id: 'desk-20th', label: 'VAT & Monthly', icon: TerminalSquare, countKey: 'tax' as const },
    { id: 'desk-elevy', label: 'Tourism Fund Desk', icon: Activity, countKey: null },
    { id: 'desk-nil', label: 'Nil & ITR Desk', icon: FileArchive, countKey: null },
];

const practiceItems = [
    { id: 'clients', label: 'Client Database', icon: Building2 },
];

export function Sidebar({ 
    payrollPendingCount, 
    taxPendingCount, 
}: { 
    payrollPendingCount: number; 
    taxPendingCount: number; 
}) {
    const { 
        view, 
        setView, 
        isSidebarOpen, 
        setIsSidebarOpen,
        isSidebarCollapsed,
        toggleSidebarCollapsed,
    } = useUIStore();

    const getCount = (key: string | null) => {
        if (key === 'payroll') return payrollPendingCount;
        if (key === 'tax') return taxPendingCount;
        return 0;
    };

    const collapsed = isSidebarCollapsed;

    return (
        <>
            {/* Mobile overlay */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            <aside className={`
                absolute inset-y-0 left-0 z-50 shrink-0 border-r border-slate-200 bg-white/95 backdrop-blur 
                flex flex-col transform transition-all duration-300 ease-in-out
                lg:relative lg:translate-x-0
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                ${collapsed ? 'w-16 lg:w-16' : 'w-72 lg:w-72'}
            `}>
                {/* Header */}
                <div className={`flex items-center justify-between px-3 py-4 ${collapsed ? 'justify-center' : ''}`}>
                    <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#ff0613] shadow-[0_0_15px_rgba(255,6,19,0.3)] text-white">
                            <Building2 className="h-5 w-5" />
                        </div>
                        {!collapsed && (
                            <span className="text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap">
                                Kwanta<span className="text-[#ff0613]">.ai</span>
                            </span>
                        )}
                    </div>
                    {!collapsed && (
                        <button 
                            onClick={() => setIsSidebarOpen(false)} 
                            className="lg:hidden text-slate-400 hover:text-slate-900 transition"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    )}
                </div>

                {/* Collapse toggle (desktop only) */}
                <div className={`px-3 mb-2 ${collapsed ? 'flex justify-center' : ''}`}>
                    <button
                        onClick={toggleSidebarCollapsed}
                        className="hidden lg:flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    </button>
                </div>

                <nav className="flex-1 overflow-y-auto overflow-x-hidden space-y-1 px-2">
                    {/* Overview */}
                    {navItems.map((item) => (
                        <SidebarButton
                            key={item.id}
                            item={item}
                            isActive={view === item.id}
                            onClick={() => { setView(item.id as any); setIsSidebarOpen(false); }}
                            collapsed={collapsed}
                        />
                    ))}

                    {/* Tax Filing Desks */}
                    {!collapsed && (
                        <div className="pt-5 pb-1.5 px-2">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tax Filing Desks</p>
                        </div>
                    )}
                    {collapsed && <div className="h-4" />}
                    {deskItems.map((item) => {
                        const count = getCount(item.countKey);
                        return (
                            <SidebarButton
                                key={item.id}
                                item={item}
                                isActive={view === item.id}
                                onClick={() => { setView(item.id as any); setIsSidebarOpen(false); }}
                                collapsed={collapsed}
                                count={count > 0 ? count : undefined}
                            />
                        );
                    })}

                    {/* Tax Practice */}
                    {!collapsed && (
                        <div className="pt-5 pb-1.5 px-2">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tax Practice</p>
                        </div>
                    )}
                    {collapsed && <div className="h-4" />}
                    {practiceItems.map((item) => (
                        <SidebarButton
                            key={item.id}
                            item={item}
                            isActive={view === item.id}
                            onClick={() => { setView(item.id as any); setIsSidebarOpen(false); }}
                            collapsed={collapsed}
                        />
                    ))}
                </nav>

                {/* Footer */}
                <div className="mt-auto border-t border-slate-100 px-2 py-3">
                    <Link 
                        to="/" 
                        className={`flex items-center gap-2 rounded-lg py-2 text-sm font-medium text-slate-400 transition hover:bg-slate-50 hover:text-slate-700 ${collapsed ? 'justify-center px-0' : 'px-3'}`}
                        title="Sign Out"
                    >
                        <LogOut className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>Sign Out</span>}
                    </Link>
                </div>
            </aside>
        </>
    );
}

function SidebarButton({ 
    item, 
    isActive, 
    onClick, 
    collapsed, 
    count 
}: { 
    item: { id: string; label: string; icon: React.ElementType }; 
    isActive: boolean; 
    onClick: () => void;
    collapsed: boolean;
    count?: number;
}) {
    const Icon = item.icon;
    
    if (collapsed) {
        return (
            <button
                onClick={onClick}
                className={`group relative flex w-full items-center justify-center rounded-xl px-2 py-2.5 transition ${
                    isActive 
                        ? 'bg-[#ff0613]/10 text-[#ff0613]' 
                        : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'
                }`}
                title={item.label}
            >
                <Icon className="h-5 w-5 shrink-0" />
                {count !== undefined && count > 0 && (
                    <span className="absolute top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#ff0613] px-1 text-[10px] font-bold text-white">
                        {count}
                    </span>
                )}
                {/* Tooltip */}
                <span className="absolute left-full ml-2 hidden rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white whitespace-nowrap group-hover:block z-50 shadow-lg">
                    {item.label}
                    {count !== undefined && count > 0 && ` (${count})`}
                </span>
            </button>
        );
    }

    return (
        <button
            onClick={onClick}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                isActive 
                    ? 'bg-[#ff0613]/10 text-[#ff0613] border border-[#ff0613]/10' 
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 border border-transparent'
            }`}
        >
            <span className="flex items-center gap-3">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">{item.label}</span>
            </span>
            {count !== undefined && count > 0 && (
                <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-[#ff0613]/10 border border-[#ff0613]/20 px-1 text-xs font-bold text-[#ff0613]">
                    {count}
                </span>
            )}
        </button>
    );
}
