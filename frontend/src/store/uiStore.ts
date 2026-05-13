import { create } from 'zustand';
import { DashboardView, PlanKey } from '../types';

type UIState = {
    view: DashboardView;
    monthlyReturnFilter: 'ALL' | 'VAT' | 'TOT' | 'MRI' | 'DST';
    isSidebarOpen: boolean;
    isSidebarCollapsed: boolean;
    selectedPlan: PlanKey;
    showNewClientModal: boolean;
    setView: (view: DashboardView) => void;
    setMonthlyReturnFilter: (filter: 'ALL' | 'VAT' | 'TOT' | 'MRI' | 'DST') => void;
    setIsSidebarOpen: (isOpen: boolean) => void;
    setIsSidebarCollapsed: (collapsed: boolean) => void;
    toggleSidebarCollapsed: () => void;
    setSelectedPlan: (plan: PlanKey) => void;
    setShowNewClientModal: (show: boolean) => void;
};

export const useUIStore = create<UIState>((set) => ({
    view: 'overview',
    monthlyReturnFilter: 'VAT',
    isSidebarOpen: false,
    isSidebarCollapsed: true,
    selectedPlan: 'growth',
    showNewClientModal: false,
    setView: (view) => set({ view }),
    setMonthlyReturnFilter: (filter) => set({ monthlyReturnFilter: filter }),
    setIsSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
    setIsSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
    toggleSidebarCollapsed: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
    setSelectedPlan: (plan) => set({ selectedPlan: plan }),
    setShowNewClientModal: (show) => set({ showNewClientModal: show }),
}));
