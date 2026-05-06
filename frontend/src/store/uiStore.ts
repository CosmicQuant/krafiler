import { create } from 'zustand';
import { DashboardView, PlanKey } from '../types';

type UIState = {
    view: DashboardView;
    monthlyReturnFilter: 'ALL' | 'VAT' | 'TOT' | 'MRI' | 'DST';
    isSidebarOpen: boolean;
    selectedPlan: PlanKey;
    showNewClientModal: boolean;
    setView: (view: DashboardView) => void;
    setMonthlyReturnFilter: (filter: 'ALL' | 'VAT' | 'TOT' | 'MRI' | 'DST') => void;
    setIsSidebarOpen: (isOpen: boolean) => void;
    setSelectedPlan: (plan: PlanKey) => void;
    setShowNewClientModal: (show: boolean) => void;
};

export const useUIStore = create<UIState>((set) => ({
    view: 'desk-9th',
    monthlyReturnFilter: 'VAT',
    isSidebarOpen: false,
    selectedPlan: 'growth',
    showNewClientModal: false,
    setView: (view) => set({ view }),
    setMonthlyReturnFilter: (filter) => set({ monthlyReturnFilter: filter }),
    setIsSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
    setSelectedPlan: (plan) => set({ selectedPlan: plan }),
    setShowNewClientModal: (show) => set({ showNewClientModal: show }),
}));
