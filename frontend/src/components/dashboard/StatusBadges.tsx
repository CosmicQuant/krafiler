import { CheckCircle2, Clock, FileArchive } from 'lucide-react';
import { TaxStatus } from '../../types';

export function StatusBadge({ status, generatedAt, lastFiledDate, receiptUrl }: { status: TaxStatus; generatedAt?: string; lastFiledDate?: string; receiptUrl?: string }) {
    if (status === 'na') return <span className="text-slate-600">-</span>;
    if (status === 'done') return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Done</span>;
    if (status === 'generated') return (
        <span className="inline-flex flex-col items-center">
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-semibold text-blue-400"><FileArchive className="h-3 w-3" /> Generated</span>
            {generatedAt && <span className="mt-1 text-[9px] font-medium text-slate-500 opacity-80">{generatedAt}</span>}
        </span>
    );
    if (status === 'filed') return (
        <span className="inline-flex flex-col items-center">
            {receiptUrl ? (
                <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-semibold text-indigo-400 hover:bg-indigo-500/30 transition-colors" title="Download Returns Receipt">
                    <CheckCircle2 className="h-3 w-3" /> Filed
                </a>
            ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-semibold text-indigo-400"><CheckCircle2 className="h-3 w-3" /> Filed</span>
            )}
            {lastFiledDate && <span className="mt-1 text-[10px] font-medium text-slate-400">{lastFiledDate}</span>}
        </span>
    );
    if (status === 'paid') return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Paid</span>;
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-400"><Clock className="h-3 w-3" /> Due</span>;
}

export function InteractiveStatusBadge({ 
    status, 
    generatedAt,
    lastFiledDate,
    receiptUrl,
    onUpdateStatus 
}: { 
    status: TaxStatus; 
    generatedAt?: string;
    lastFiledDate?: string;
    receiptUrl?: string;
    onUpdateStatus: (newStatus: TaxStatus) => void 
}) {
    if (status === 'na' || status === 'done' || status === 'due') {
        return <StatusBadge status={status} lastFiledDate={lastFiledDate} receiptUrl={receiptUrl} />;
    }

    return (
        <div className="group relative inline-flex flex-col items-center justify-center">
            <div className="cursor-pointer transition" role="button" tabIndex={0}>
                <StatusBadge status={status} generatedAt={generatedAt} lastFiledDate={lastFiledDate} receiptUrl={receiptUrl} />
            </div>
            <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 z-50 hidden flex-col w-32 scale-95 opacity-0 group-hover:flex group-hover:scale-100 group-hover:opacity-100 items-center justify-center transition-all origin-top duration-200">
                <div className="rounded-xl border border-slate-700 bg-slate-800 shadow-2xl p-1.5 text-xs overflow-hidden flex flex-col gap-1 w-full">
                    <button 
                        onClick={() => onUpdateStatus('filed')}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-semibold text-indigo-400 hover:bg-indigo-500/20"
                    >
                        <CheckCircle2 className="h-3 w-3" /> Mark Filed
                    </button>
                    <button 
                        onClick={() => onUpdateStatus('paid')}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-semibold text-emerald-400 hover:bg-emerald-500/20"
                    >
                        <CheckCircle2 className="h-3 w-3" /> Mark Paid
                    </button>
                </div>
            </div>
        </div>
    );
}
