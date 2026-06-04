/**
 * ClientSelectorDropdown.tsx
 *
 * A polished dropdown for switching between clients in obligation-specific views.
 * Displays the client name prominently and the KRA PIN in smaller, lighter text.
 */

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Building2, Check } from 'lucide-react';
import { ClientObligation } from '../../types';
import { cn } from '../../utils/cn';

interface ClientSelectorDropdownProps {
    clients: ClientObligation[];
    selectedClient: ClientObligation | null;
    onSelectClient: (client: ClientObligation) => void;
    label?: string;
    className?: string;
}

export function ClientSelectorDropdown({
    clients,
    selectedClient,
    onSelectClient,
    label,
    className,
}: ClientSelectorDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selected = selectedClient || clients[0];

    return (
        <div ref={containerRef} className={cn('relative', className)}>
            {label && (
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {label}
                </label>
            )}
            <button
                onClick={() => setIsOpen((v) => !v)}
                className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition',
                    isOpen
                        ? 'border-[#ff0613]/30 bg-[#ff0613]/5 ring-1 ring-[#ff0613]/10'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                )}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                        <Building2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        {selected ? (
                            <>
                                <p className="truncate text-sm font-bold text-slate-900">
                                    {selected.name}
                                </p>
                                <p className="truncate text-[11px] text-slate-500 font-mono">
                                    {selected.pin}
                                </p>
                            </>
                        ) : (
                            <p className="text-sm text-slate-400">Select a client…</p>
                        )}
                    </div>
                </div>
                <ChevronDown
                    className={cn(
                        'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
                        isOpen && 'rotate-180'
                    )}
                />
            </button>

            {isOpen && (
                <div className="absolute z-50 mt-1.5 w-full max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                    {clients.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-400">
                            No clients available.
                        </div>
                    ) : (
                        clients.map((client) => {
                            const isActive = selected?.id === client.id;
                            return (
                                <button
                                    key={client.id}
                                    onClick={() => {
                                        onSelectClient(client);
                                        setIsOpen(false);
                                    }}
                                    className={cn(
                                        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition',
                                        isActive
                                            ? 'bg-[#ff0613]/5'
                                            : 'hover:bg-slate-50'
                                    )}
                                >
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                                        <Building2 className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p
                                            className={cn(
                                                'truncate text-sm',
                                                isActive
                                                    ? 'font-bold text-[#ff0613]'
                                                    : 'font-semibold text-slate-900'
                                            )}
                                        >
                                            {client.name}
                                        </p>
                                        <p className="truncate text-[11px] text-slate-500 font-mono">
                                            {client.pin}
                                        </p>
                                    </div>
                                    {isActive && (
                                        <Check className="h-4 w-4 shrink-0 text-[#ff0613]" />
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}
