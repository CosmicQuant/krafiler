/**
 * ClientSelectorDropdown.tsx
 *
 * A polished dropdown for switching between clients in obligation-specific views.
 * Displays the client name prominently and the KRA PIN in smaller, lighter text.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Building2, Check, Search } from 'lucide-react';
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
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setSearchQuery('');
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setSearchQuery('');
            const t = setTimeout(() => searchInputRef.current?.focus(), 50);
            return () => clearTimeout(t);
        }
    }, [isOpen]);

    const selected = selectedClient || clients[0];

    const filteredClients = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return clients;
        return clients.filter(
            (c) =>
                c.name?.toLowerCase().includes(q) ||
                c.pin?.toLowerCase().includes(q),
        );
    }, [clients, searchQuery]);

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
                <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-slate-200 bg-white shadow-xl">
                    <div className="sticky top-0 border-b border-slate-100 bg-white p-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by name or PIN…"
                                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-[#ff0613]/30 focus:bg-white focus:ring-1 focus:ring-[#ff0613]/10"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && filteredClients.length > 0) {
                                        onSelectClient(filteredClients[0]);
                                        setIsOpen(false);
                                        setSearchQuery('');
                                    }
                                }}
                            />
                        </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1">
                        {filteredClients.length === 0 ? (
                            <div className="px-4 py-3 text-xs text-slate-400">
                                {clients.length === 0 ? 'No clients available.' : 'No clients match your search.'}
                            </div>
                        ) : (
                            filteredClients.map((client) => {
                                const isActive = selected?.id === client.id;
                                return (
                                    <button
                                        key={client.id}
                                        onClick={() => {
                                            onSelectClient(client);
                                            setIsOpen(false);
                                            setSearchQuery('');
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
                </div>
            )}
        </div>
    );
}
