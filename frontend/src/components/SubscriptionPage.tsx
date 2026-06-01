/**
 * SubscriptionPage.tsx
 *
 * Plan selection and Paystack checkout for KRAFILER.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetchJson } from '../services/api';
import { Check, Loader2, CreditCard, Shield, Users, FileText, Building2 } from 'lucide-react';

interface Plan {
    id: string;
    name: string;
    maxClients: number;
    maxFilings: number;
    amountKes: number;
    interval: string;
    currency: string;
}

interface SubscriptionMe {
    plan: string;
    subscriptionStatus: string;
    subscriptionEndsAt: string | null;
    clientCount: number;
    filingsThisMonth: number;
}

const planIcons: Record<string, React.ReactNode> = {
    starter: <Users className="h-6 w-6" />,
    solo: <Building2 className="h-6 w-6" />,
    practice: <FileText className="h-6 w-6" />,
    firm: <Shield className="h-6 w-6" />,
};

export default function SubscriptionPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [plans, setPlans] = useState<Plan[]>([]);
    const [sub, setSub] = useState<SubscriptionMe | null>(null);
    const [loading, setLoading] = useState(true);
    const [payingPlanId, setPayingPlanId] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const plansRes = await apiFetchJson<{ plans: Plan[] }>('/subscriptions/plans');
                setPlans(plansRes.plans);
                const meRes = await apiFetchJson<{ data: SubscriptionMe }>('/subscriptions/me');
                setSub(meRes as unknown as SubscriptionMe);
            } catch (e) {
                console.error('Failed to load subscription data:', e);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const handleSubscribe = async (planId: string) => {
        if (!user) return;
        setPayingPlanId(planId);
        try {
            const res = await apiFetchJson<{
                authorizationUrl: string;
                reference: string;
            }>('/subscriptions/initialize', {
                method: 'POST',
                body: JSON.stringify({ planId, callbackUrl: `${window.location.origin}/subscription?verify=1` }),
            });

            if (res.authorizationUrl) {
                window.location.href = res.authorizationUrl;
            }
        } catch (e: any) {
            alert(e.message || 'Failed to start payment.');
        } finally {
            setPayingPlanId(null);
        }
    };

    const handleVerify = async (reference: string) => {
        setLoading(true);
        try {
            await apiFetchJson(`/subscriptions/verify/${encodeURIComponent(reference)}`);
            const meRes = await apiFetchJson<{ data: SubscriptionMe }>('/subscriptions/me');
            setSub(meRes as unknown as SubscriptionMe);
        } catch (e) {
            console.error('Verification failed:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('reference') || params.get('trxref');
        const verify = params.get('verify');
        if (ref && verify) {
            handleVerify(ref);
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, []);

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-50">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4">
            <div className="max-w-5xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-3xl font-bold text-slate-900">Choose your plan</h1>
                    <p className="mt-2 text-slate-500">
                        Simple, transparent pricing for Kenyan tax professionals.
                    </p>
                    {sub && (
                        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700">
                            <Check className="h-4 w-4" />
                            Current: {sub.plan} — {sub.subscriptionStatus}
                            {sub.subscriptionEndsAt && (
                                <span className="text-emerald-600/70">
                                    (renews {new Date(sub.subscriptionEndsAt).toLocaleDateString()})
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {plans.map((plan) => {
                        const isCurrent = sub?.plan === plan.id;
                        const isPaying = payingPlanId === plan.id;
                        return (
                            <div
                                key={plan.id}
                                className={`rounded-2xl border bg-white p-6 shadow-sm transition hover:shadow-md ${
                                    isCurrent ? 'border-emerald-400 ring-1 ring-emerald-400' : 'border-slate-200'
                                }`}
                            >
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                                        {planIcons[plan.id] || <CreditCard className="h-6 w-6" />}
                                    </div>
                                    <div>
                                        <div className="text-sm font-bold text-slate-900">{plan.name}</div>
                                        <div className="text-xs text-slate-500">{plan.interval}</div>
                                    </div>
                                </div>

                                <div className="mb-4">
                                    <span className="text-2xl font-bold text-slate-900">KES {plan.amountKes.toLocaleString()}</span>
                                    <span className="text-xs text-slate-400"> / month</span>
                                </div>

                                <ul className="mb-6 space-y-2 text-sm text-slate-600">
                                    <li className="flex items-center gap-2">
                                        <Check className="h-4 w-4 text-emerald-500" />
                                        {plan.maxClients === Infinity ? 'Unlimited clients' : `Up to ${plan.maxClients} clients`}
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <Check className="h-4 w-4 text-emerald-500" />
                                        {plan.maxFilings === Infinity ? 'Unlimited filings' : `Up to ${plan.maxFilings} filings/mo`}
                                    </li>
                                </ul>

                                <button
                                    onClick={() => handleSubscribe(plan.id)}
                                    disabled={isPaying || isCurrent}
                                    className={`w-full rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                                        isCurrent
                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                                            : 'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300'
                                    }`}
                                >
                                    {isPaying ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin" /> Processing…
                                        </span>
                                    ) : isCurrent ? (
                                        'Current plan'
                                    ) : (
                                        'Subscribe'
                                    )}
                                </button>
                            </div>
                        );
                    })}
                </div>

                <div className="mt-8 text-center">
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="text-sm text-slate-500 hover:text-slate-900 underline"
                    >
                        Back to dashboard
                    </button>
                </div>
            </div>
        </div>
    );
}
