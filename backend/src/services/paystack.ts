/**
 * paystack.ts
 *
 * Paystack API integration for KRAFILER subscriptions.
 * Uses native fetch (Node 20+) to avoid extra dependencies.
 */

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

interface PaystackResponse<T = unknown> {
    status: boolean;
    message: string;
    data?: T;
}

async function paystackFetch<T>(path: string, init?: RequestInit): Promise<PaystackResponse<T>> {
    const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
            ...(init?.headers || {}),
        },
    });

    const body = (await res.json().catch(() => ({}))) as PaystackResponse<T>;
    if (!res.ok || !body.status) {
        throw new Error(body.message || `Paystack error: ${res.status}`);
    }
    return body;
}

export interface PaystackPlan {
    id: number;
    name: string;
    plan_code: string;
    amount: number;
    interval: string;
    currency: string;
}

export interface PaystackTransaction {
    id: number;
    status: string;
    reference: string;
    amount: number;
    paid_at: string | null;
    channel: string;
    currency: string;
}

export interface PaystackSubscription {
    id: number;
    status: string;
    subscription_code: string;
    email_token: string;
    amount: number;
    cron_expression: string;
    next_payment_date: string;
    open_invoice: unknown | null;
}

export async function listPaystackPlans(): Promise<PaystackPlan[]> {
    const res = await paystackFetch<{ data: PaystackPlan[] }>('/plan');
    return res.data?.data || [];
}

export async function createPaystackPlan(options: {
    name: string;
    amount: number; // in kobo (lowest currency unit)
    interval: string;
    currency?: string;
}): Promise<PaystackPlan> {
    const res = await paystackFetch<PaystackPlan>('/plan', {
        method: 'POST',
        body: JSON.stringify({
            name: options.name,
            amount: options.amount,
            interval: options.interval,
            currency: options.currency || 'KES',
        }),
    });
    return res.data as PaystackPlan;
}

export async function initializeTransaction(options: {
    email: string;
    amount: number; // in kobo
    plan?: string; // plan_code for subscription
    reference?: string;
    callback_url?: string;
    metadata?: Record<string, unknown>;
}): Promise<{ authorization_url: string; access_code: string; reference: string }> {
    const res = await paystackFetch<{
        authorization_url: string;
        access_code: string;
        reference: string;
    }>('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify(options),
    });
    return res.data as { authorization_url: string; access_code: string; reference: string };
}

export async function verifyTransaction(reference: string): Promise<PaystackTransaction> {
    const res = await paystackFetch<{ data: PaystackTransaction }>(`/transaction/verify/${encodeURIComponent(reference)}`);
    return res.data?.data as PaystackTransaction;
}

export async function createSubscription(options: {
    customer: string; // email or customer code
    plan: string; // plan_code
    start_date?: string; // ISO date
}): Promise<PaystackSubscription> {
    const res = await paystackFetch<PaystackSubscription>('/subscription', {
        method: 'POST',
        body: JSON.stringify(options),
    });
    return res.data as PaystackSubscription;
}

export async function listSubscriptions(customer?: string): Promise<PaystackSubscription[]> {
    const qs = customer ? `?customer=${encodeURIComponent(customer)}` : '';
    const res = await paystackFetch<{ data: PaystackSubscription[] }>(`/subscription${qs}`);
    return res.data?.data || [];
}

export async function fetchSubscription(subscriptionCode: string): Promise<PaystackSubscription> {
    const res = await paystackFetch<{ data: PaystackSubscription }>(`/subscription/${encodeURIComponent(subscriptionCode)}`);
    return res.data?.data as PaystackSubscription;
}
