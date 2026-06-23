import {
    Send,
    CheckCircle2,
    MailOpen,
    MousePointerClick,
    AlertCircle,
    XCircle,
    Clock,
    ShieldAlert,
    Ban,
    type LucideIcon,
} from 'lucide-react';
import { cn } from '../../utils/cn';

export interface EmailEvent {
    id: string;
    type: string;
    createdAt: string;
    data?: {
        subject?: string;
        to?: string[];
        from?: string;
        bounce?: { message?: string; type?: string; subType?: string };
        error?: { message?: string };
    };
}

interface EmailEventTimelineProps {
    events: EmailEvent[];
    compact?: boolean;
}

interface EventMeta {
    label: string;
    description: string;
    Icon: LucideIcon;
    tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

function getEventMeta(eventType: string): EventMeta {
    switch (eventType) {
        case 'email.sent':
            return {
                label: 'Sent',
                description: 'Email accepted by Resend and queued for delivery.',
                Icon: Send,
                tone: 'neutral',
            };
        case 'email.delivered':
            return {
                label: 'Delivered',
                description: 'Email successfully delivered to the recipient\'s mail server.',
                Icon: CheckCircle2,
                tone: 'success',
            };
        case 'email.opened':
            return {
                label: 'Opened',
                description: 'Recipient opened the email.',
                Icon: MailOpen,
                tone: 'info',
            };
        case 'email.clicked':
            return {
                label: 'Clicked',
                description: 'Recipient clicked a link in the email.',
                Icon: MousePointerClick,
                tone: 'info',
            };
        case 'email.bounced':
            return {
                label: 'Bounced',
                description: 'Email was permanently rejected by the recipient\'s mail server.',
                Icon: XCircle,
                tone: 'danger',
            };
        case 'email.complained':
            return {
                label: 'Complained',
                description: 'Recipient marked the email as spam.',
                Icon: ShieldAlert,
                tone: 'warning',
            };
        case 'email.failed':
            return {
                label: 'Failed',
                description: 'Email failed to send.',
                Icon: XCircle,
                tone: 'danger',
            };
        case 'email.delivery_delayed':
            return {
                label: 'Delayed',
                description: 'Delivery is temporarily delayed.',
                Icon: Clock,
                tone: 'warning',
            };
        case 'email.suppressed':
            return {
                label: 'Suppressed',
                description: 'Email was suppressed by Resend.',
                Icon: Ban,
                tone: 'warning',
            };
        default:
            return {
                label: eventType.replace('email.', ''),
                description: 'Email event received.',
                Icon: AlertCircle,
                tone: 'neutral',
            };
    }
}

const toneClasses: Record<EventMeta['tone'], { bg: string; border: string; text: string; icon: string; dot: string }> = {
    neutral: {
        bg: 'bg-slate-50',
        border: 'border-slate-200',
        text: 'text-slate-700',
        icon: 'text-slate-500',
        dot: 'bg-slate-400',
    },
    success: {
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        text: 'text-emerald-700',
        icon: 'text-emerald-600',
        dot: 'bg-emerald-500',
    },
    info: {
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        text: 'text-blue-700',
        icon: 'text-blue-600',
        dot: 'bg-blue-500',
    },
    warning: {
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        text: 'text-amber-700',
        icon: 'text-amber-600',
        dot: 'bg-amber-500',
    },
    danger: {
        bg: 'bg-rose-50',
        border: 'border-rose-200',
        text: 'text-rose-700',
        icon: 'text-rose-600',
        dot: 'bg-rose-500',
    },
};

function formatEventTime(iso: string): string {
    try {
        return new Date(iso).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    } catch {
        return iso;
    }
}

export function EmailEventTimeline({ events, compact }: EmailEventTimelineProps) {
    if (events.length === 0) {
        return (
            <div className="py-4 text-center text-xs text-slate-400">
                No delivery events yet. Events appear when Resend processes the email.
            </div>
        );
    }

    const sorted = [...events].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (compact) {
        const latest = sorted[0];
        const meta = getEventMeta(latest.type);
        const tone = toneClasses[meta.tone];
        return (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', tone.bg, tone.border, tone.text)}>
                <meta.Icon className={cn('h-3 w-3', tone.icon)} />
                {meta.label}
            </span>
        );
    }

    return (
        <div className="space-y-0 py-2">
            {sorted.map((event, index) => {
                const meta = getEventMeta(event.type);
                const tone = toneClasses[meta.tone];
                const isLast = index === sorted.length - 1;

                return (
                    <div key={event.id} className="relative flex gap-3">
                        {!isLast && (
                            <div className="absolute left-[9px] top-5 h-full w-px bg-slate-200" />
                        )}
                        <div className={cn('relative z-10 mt-1.5 h-[18px] w-[18px] rounded-full border-2 border-white shadow-sm', tone.dot)} />
                        <div className={cn('mb-3 flex-1 rounded-lg border p-3', tone.bg, tone.border)}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <meta.Icon className={cn('h-3.5 w-3.5', tone.icon)} />
                                    <span className={cn('text-xs font-semibold', tone.text)}>{meta.label}</span>
                                </div>
                                <span className="text-[10px] text-slate-500">
                                    {formatEventTime(event.createdAt)}
                                </span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">
                                {meta.description}
                            </p>
                            {event.data?.bounce?.message && (
                                <p className="mt-1.5 text-[10px] text-rose-600">
                                    {event.data.bounce.type} — {event.data.bounce.message}
                                </p>
                            )}
                            {event.data?.error?.message && (
                                <p className="mt-1.5 text-[10px] text-rose-600">
                                    {event.data.error.message}
                                </p>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
