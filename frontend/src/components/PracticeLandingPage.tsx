import { ArrowRight, CheckCircle2, Building, ShieldCheck, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

const plans = [
    {
        name: 'Practice Starter',
        limit: 'Up to 10 Clients',
        audience: 'Independent accountants and boutique firms building their portfolio.',
        price: 'Ksh 2,500',
        features: ['Up to 10 active PINs', 'Unified Payroll & Statutory Generation', 'Basic Email Support', 'Standard Matrix Dashboard'],
        highlight: false,
    },
    {
        name: 'Growing Firm',
        limit: 'Up to 50 Clients',
        audience: 'Established accounting practices managing mixed tax obligations.',
        price: 'Ksh 10,000',
        features: ['Up to 50 active PINs', 'Bulk Compliance Processing', 'Priority Support', 'Full Split-Timeline Workspace', 'Audit Logs'],
        highlight: true,
    },
    {
        name: 'Enterprise Desk',
        limit: 'Unlimited Clients',
        audience: 'Large outsourcing teams and multi-manager audit desks.',
        price: 'Custom',
        features: ['Unlimited PINs', 'Dedicated Account Manager', 'White-glove Onboarding', 'Advanced Role Management', 'Custom API Access'],
        highlight: false,
    },
];

export default function PracticeLandingPage() {
    return (
        <div className="min-h-screen bg-slate-950 text-white selection:bg-emerald-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute left-1/4 top-0 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/10 blur-[120px] mix-blend-screen" />
                <div className="absolute right-1/4 top-1/2 h-[500px] w-[500px] -translate-y-1/2 translate-x-1/2 rounded-full bg-blue-500/10 blur-[100px] mix-blend-screen" />
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] opacity-20" />
            </div>

            <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-slate-950">
                        <Building className="h-6 w-6" />
                    </div>
                    <div>
                        <span className="text-lg font-black tracking-tight text-white">Kwanta<span className="text-emerald-500">.</span></span>
                    </div>
                </div>
                <div className="flex items-center gap-6">
                    <a href="#pricing" className="text-sm font-semibold text-slate-300 hover:text-white">Pricing</a>
                    <Link to="/dashboard" className="hidden sm:block text-sm font-semibold text-slate-300 hover:text-white">Login</Link>
                    <Link to="/dashboard" className="rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400">
                        Open Dashboard
                    </Link>
                </div>
            </nav>

            <main className="relative z-10 mx-auto max-w-7xl px-6 pt-20 pb-32">
                <header className="mx-auto max-w-4xl text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-400">
                        <ShieldCheck className="h-4 w-4" /> Built exclusively for Kenyan Accounting and Audit Firms
                    </div>
                    <h1 className="mt-8 text-5xl font-black tracking-tight sm:text-7xl lg:text-[5rem] leading-[1.1]">
                        Automate Your Practice's <br className="hidden sm:block"/> <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">KRA Filings.</span>
                    </h1>
                    <p className="mx-auto mt-8 max-w-2xl text-lg text-slate-400 sm:text-xl leading-relaxed">
                        Manage payrolls, VAT, TOT, and E-Levy for 10 or 1,000 clients from a single massive matrix dashboard. Spend less time formatting CSVs and more time advising clients.
                    </p>
                    <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-8 py-4 text-base font-bold text-slate-950 transition hover:-translate-y-0.5 hover:bg-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/30">
                            Start Free Practice Trial <ArrowRight className="h-5 w-5" />
                        </Link>
                        <a href="#pricing" className="inline-flex justify-center rounded-full border border-slate-700 bg-slate-900/50 px-8 py-4 text-base font-semibold text-white backdrop-blur transition hover:bg-slate-800">
                            View Pricing Limits
                        </a>
                    </div>
                </header>

                <div className="mt-32 grid gap-8 sm:grid-cols-3">
                    <div className="rounded-3xl border border-white/5 bg-white/5 p-8 backdrop-blur">
                        <div className="inline-flex rounded-2xl bg-emerald-500/20 p-3 text-emerald-400">
                            <Zap className="h-6 w-6" />
                        </div>
                        <h3 className="mt-6 text-xl font-bold">Unified Generation</h3>
                        <p className="mt-3 text-slate-400 leading-relaxed">Upload one master CSV. Get KRA, NSSF, and SHA outputs instantly mapped for your entire mixed-obligation portfolio.</p>
                    </div>
                    <div className="rounded-3xl border border-white/5 bg-white/5 p-8 backdrop-blur">
                        <div className="inline-flex rounded-2xl bg-blue-500/20 p-3 text-blue-400">
                            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </div>
                        <h3 className="mt-6 text-xl font-bold">Split-Timeline Desks</h3>
                        <p className="mt-3 text-slate-400 leading-relaxed">Never miss the 9th or 20th again. Workspaces physically divide Payroll/E-Levy tasks from standard VAT/TOT obligations.</p>
                    </div>
                    <div className="rounded-3xl border border-white/5 bg-white/5 p-8 backdrop-blur">
                        <div className="inline-flex rounded-2xl bg-purple-500/20 p-3 text-purple-400">
                            <ShieldCheck className="h-6 w-6" />
                        </div>
                        <h3 className="mt-6 text-xl font-bold">Portfolio Control</h3>
                        <p className="mt-3 text-slate-400 leading-relaxed">Built for firms to manage multiple agents and client capacities securely. Matrix data-grids handle unpredictable tax matrices.</p>
                    </div>
                </div>

                <div id="pricing" className="mt-40">
                    <div className="text-center">
                        <h2 className="text-4xl font-black tracking-tight">Practice Capacity Plans</h2>
                        <p className="mt-4 text-lg text-slate-400">Simple, tiered pricing built specifically for accounting firms.</p>
                    </div>
                    
                    <div className="mt-16 grid gap-8 lg:grid-cols-3">
                        {plans.map((plan) => (
                            <div key={plan.name} className={`relative flex flex-col rounded-[2rem] border ${plan.highlight ? 'border-emerald-500 bg-slate-900 shadow-2xl shadow-emerald-500/10' : 'border-slate-800 bg-slate-900/50'}`}>
                                {plan.highlight && (
                                    <div className="absolute -top-4 left-0 right-0 mx-auto w-max rounded-full bg-emerald-500 px-4 py-1 text-xs font-bold uppercase tracking-wider text-slate-950">
                                        Most Popular
                                    </div>
                                )}
                                <div className="p-8">
                                    <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                                    <p className="mt-2 text-sm text-emerald-400 font-semibold">{plan.limit}</p>
                                    <p className="mt-4 text-sm text-slate-400 leading-relaxed">{plan.audience}</p>
                                    <div className="mt-6 flex items-baseline gap-1">
                                        <span className="text-4xl font-black text-white">{plan.price}</span>
                                        {plan.price !== 'Custom' && <span className="text-slate-400">/mo</span>}
                                    </div>
                                    <Link to="/dashboard" className={`mt-8 block w-full rounded-2xl px-6 py-4 text-center text-sm font-bold transition ${plan.highlight ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
                                        Get Started
                                    </Link>
                                </div>
                                <div className="border-t border-slate-800 p-8">
                                    <ul className="space-y-4">
                                        {plan.features.map((feature, idx) => (
                                            <li key={idx} className="flex items-start gap-3 text-sm text-slate-300">
                                                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                                                <span>{feature}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </main>
        </div>
    );
}