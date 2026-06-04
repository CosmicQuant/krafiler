/**
 * PayrollViewShell.tsx
 *
 * Single-client payroll view with a client selector dropdown.
 * Replaces the old Desk9thView list page.
 */

import { useState, useMemo, useEffect } from 'react';
import { ClientObligation } from '../../../types';
import { ClientSelectorDropdown } from '../ClientSelectorDropdown';
import { PayrollPipelineDashboard } from '../../payroll-pipeline/PayrollPipelineDashboard';

interface PayrollViewShellProps {
    clients: ClientObligation[];
    initialClient?: ClientObligation | null;
}

export function PayrollViewShell({ clients, initialClient }: PayrollViewShellProps) {
    const hasObligation = (val?: string | null) => !!val && val !== 'na';
    const payrollClients = useMemo(
        () => clients.filter((c) => hasObligation(c.paye) || hasObligation(c.nssf) || hasObligation(c.sha)),
        [clients]
    );

    const [selectedClient, setSelectedClient] = useState<ClientObligation | null>(
        initialClient ?? payrollClients[0] ?? null
    );

    // Sync with initialClient prop changes (e.g. deep-link navigation)
    useEffect(() => {
        if (initialClient && payrollClients.some((c) => String(c.id) === String(initialClient.id))) {
            setSelectedClient(initialClient);
        }
    }, [initialClient, payrollClients]);

    const activeClient = selectedClient || payrollClients[0];

    if (payrollClients.length === 0) {
        return (
            <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-center">
                <p className="text-sm font-semibold text-slate-900">No Payroll Clients</p>
                <p className="mt-1 text-xs text-slate-500">
                    Add a client with PAYE, NSSF, or SHA obligations to see them here.
                </p>
            </div>
        );
    }

    return (
        <div className="mt-6 space-y-6">
            {/* Client Selector */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="w-full sm:w-80">
                    <ClientSelectorDropdown
                        clients={payrollClients}
                        selectedClient={activeClient}
                        onSelectClient={setSelectedClient}
                        label="Client"
                    />
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 font-semibold">
                        {payrollClients.length} client{payrollClients.length === 1 ? '' : 's'}
                    </span>
                </div>
            </div>

            {/* Payroll Dashboard for selected client */}
            {activeClient && (
                <PayrollPipelineDashboard
                    client={activeClient}
                    onBack={() => {
                        // No-op — there's no list view to go back to anymore
                    }}
                />
            )}
        </div>
    );
}
