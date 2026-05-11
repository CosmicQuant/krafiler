/**
 * PracticeLandingPage.tsx
 *
 * Modern, conversion-focused landing page for Kwanta.
 * Built for speed, trust, and action.
 */

import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowRight,
    CheckCircle2,
    ShieldCheck,
    Zap,
    UploadCloud,
    FileCheck2,
    Download,
    Clock,
    Building2,
    TrendingUp,
    Users,
    Lock,
    Sparkles,
    BarChart3,
    Globe,
    Percent,
} from 'lucide-react';

const stats = [
    { label: 'Returns Filed', value: '12,000+', icon: FileCheck2 },
    { label: 'Kenyan Firms', value: '150+', icon: Building2 },
    { label: 'Hours Saved/mo', value: '320+', icon: Clock },
];

const features = [
    {
        icon: Zap,
        title: 'One-Click Payroll Generation',
        desc: 'Upload a single master CSV. Get KRA PAYE, NSSF, and SHA packs formatted and ready for portal upload instantly.',
        color: 'emerald',
    },
    {
        icon: Globe,
        title: 'Auto Filing with AI Captcha',
        desc: 'The worker logs into KRA, solves the arithmetic captcha via Gemini Vision, and files nil returns, VAT, TOT, and MRI without human intervention.',
        color: 'blue',
    },
    {
        icon: BarChart3,
        title: 'Live Compliance Dashboard',
        desc: "Track every client's obligation status across PAYE, VAT, TOT, MRI, NSSF, and SHA in a single real-time matrix.",
        color: 'purple',
    },
    {
        icon: Lock,
        title: 'Secure Credential Handling',
        desc: 'Client KRA passwords are passed directly to the automation worker and never logged or stored insecurely.',
        color: 'amber',
    },
    {
        icon: TrendingUp,
        title: 'Smart VAT Preparation',
        desc: "Download KRA's auto-populated VAT package, compute the summary, review, then file with one confirmation click.",
        color: 'rose',
    },
    {
        icon: Users,
        title: 'Multi-Client Portfolio',
        desc: 'Manage 10 or 1,000 clients from the same desk. Bulk import via CSV, onboard individually, or clone existing profiles.',
        color: 'cyan',
    },
];

const workflowSteps = [
    {
        step: '01',
        title: 'Upload Master CSV',
        desc: 'Drop your unified payroll spreadsheet. We read employee details, PINs, NHIF, NSSF, and statutory lines.',
    },
    {
        step: '02',
        title: 'Generate Authority Packs',
        desc: "PAYE ZIP, NSSF workbook, and SHA schedule are auto-formatted to each portal's exact spec.",
    },
    {
        step: '03',
        title: 'Auto-File or Review',
        desc: 'Queue the filing job. The worker logs into KRA, solves the captcha, uploads your pack, and downloads the receipt.',
    },
    {
        step: '04',
        title: 'Track & Store Receipts',
        desc: 'Every receipt is saved to the client profile. View filing history, track deadlines, and stay audit-ready.',
    },
];

type PayrollOptions = { paye: boolean; nssf: boolean; sha: boolean };

const KwantaLoader = () => (
    <div className="flex items-center justify-center space-x-1">
        <div className="h-2 w-2 animate-bounce rounded-full bg-emerald-400" style={{ animationDelay: '0ms' }} />
        <div className="h-2 w-2 animate-bounce rounded-full bg-emerald-400" style={{ animationDelay: '150ms' }} />
        <div className="h-2 w-2 animate-bounce rounded-full bg-emerald-400" style={{ animationDelay: '300ms' }} />
    </div>
);

export default function PracticeLandingPage() {
    const [scrolled, setScrolled] = useState(false);
    const [demoSales, setDemoSales] = useState(50000);
    const [isVisible, setIsVisible] = useState<Record<string, boolean>>({});
    const observerRef = useRef<IntersectionObserver | null>(null);

    const [payrollFile, setPayrollFile] = useState<File | null>(null);
    const [payrollStatus, setPayrollStatus] = useState<null | 'processing' | 'done'>(null);
    const [payrollOptions, setPayrollOptions] = useState<PayrollOptions>({ paye: true, nssf: true, sha: true });
    const [payrollResponse, setPayrollResponse] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        observerRef.current = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setIsVisible((prev) => ({ ...prev, [entry.target.id]: true }));
                    }
                });
            },
            { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
        );
        document.querySelectorAll('[data-animate]').forEach((el) => {
            observerRef.current?.observe(el);
        });
        return () => observerRef.current?.disconnect();
    }, []);

    useEffect(() => {
        return () => { if (payrollResponse) window.URL.revokeObjectURL(payrollResponse); };
    }, [payrollResponse]);

    const selectedOutputCount = Object.values(payrollOptions).filter(Boolean).length;
    const totTax = Math.round(demoSales * 0.03);

    const fadeClass = (id: string) =>
        `transition-all duration-700 ${isVisible[id] ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`;

    const handlePayrollToggle = (key: keyof PayrollOptions) => {
        setPayrollOptions((current) => ({ ...current, [key]: !current[key] }));
    };

    const handlePayrollGeneration = async () => {
        if (!payrollFile || selectedOutputCount === 0) return;
        setPayrollStatus('processing');
        try {
            const formData = new FormData();
            formData.append('payrollFile', payrollFile);
            formData.append('generatePaye', String(payrollOptions.paye));
            formData.append('generateNssf', String(payrollOptions.nssf));
            formData.append('generateSha', String(payrollOptions.sha));

            const res = await fetch('/api/payroll/generate-unified', { method: 'POST', body: formData });
            if (!res.ok) { setPayrollStatus('done'); return; }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            if (payrollResponse) window.URL.revokeObjectURL(payrollResponse);
            setPayrollResponse(url);

            const a = document.createElement('a');
            a.href = url;
            a.download = 'Kwanta_Payroll_Pack.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setPayrollStatus('done');
        } catch {
            setPayrollStatus('done');
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white selection:bg-emerald-500/30">
            {/* Ambient background */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute left-1/4 top-0 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/10 blur-[120px] mix-blend-screen" />
                <div className="absolute right-1/4 top-1/2 h-[500px] w-[500px] -translate-y-1/2 translate-x-1/2 rounded-full bg-blue-500/10 blur-[100px] mix-blend-screen" />
                <div className="absolute bottom-0 left-1/2 h-[400px] w-[400px] -translate-x-1/2 translate-y-1/2 rounded-full bg-purple-500/10 blur-[100px] mix-blend-screen" />
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] opacity-20" />
            </div>

            {/* Sticky Nav */}
            <nav
                className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
                    scrolled ? 'border-b border-slate-800/50 bg-slate-950/80 backdrop-blur-xl' : 'bg-transparent'
                }`}
            >
                <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-slate-950">
                            <Sparkles className="h-5 w-5" />
                        </div>
                        <div>
                            <span className="text-lg font-black tracking-tight text-white">
                                Kwanta<span className="text-emerald-500">.</span>
                            </span>
                        </div>
                    </div>
                    <div className="hidden items-center gap-8 text-sm font-semibold text-slate-300 md:flex">
                        <a href="#features" className="transition hover:text-white">Features</a>
                        <a href="#workflow" className="transition hover:text-white">How it Works</a>
                        <a href="#demo" className="transition hover:text-white">Demo</a>
                        <Link to="/dashboard" className="transition hover:text-white">Login</Link>
                    </div>
                    <Link
                        to="/dashboard"
                        className="rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400"
                    >
                        Open Dashboard
                    </Link>
                </div>
            </nav>

            <main className="relative z-10">
                {/* Hero */}
                <section className="relative mx-auto max-w-7xl px-6 pb-24 pt-32 lg:pt-40">
                    <div className="mx-auto max-w-4xl text-center">
                        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-400">
                            <ShieldCheck className="h-4 w-4" />
                            Built exclusively for Kenyan Accounting and Audit Firms
                        </div>

                        <h1 className="mt-8 text-5xl font-black tracking-tight sm:text-7xl lg:text-[5.5rem] leading-[1.05]">
                            Automate your entire
                            <br />
                            <span className="bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent">
                                KRA compliance stack.
                            </span>
                        </h1>

                        <p className="mx-auto mt-8 max-w-2xl text-lg text-slate-400 sm:text-xl leading-relaxed">
                            Generate payroll packs, file nil returns, process VAT, TOT, and MRI — for
                            <span className="text-white font-semibold"> all your clients</span>, from one
                            intelligent dashboard. No more portal hopping. No more manual captchas.
                        </p>

                        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                            <Link
                                to="/dashboard"
                                className="group inline-flex items-center gap-2 rounded-full bg-emerald-500 px-8 py-4 text-base font-bold text-slate-950 transition hover:-translate-y-0.5 hover:bg-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/30"
                            >
                                Start Free Trial
                                <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
                            </Link>
                            <a
                                href="#demo"
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-700 bg-slate-900/50 px-8 py-4 text-base font-semibold text-white backdrop-blur transition hover:bg-slate-800"
                            >
                                See Live Demo
                            </a>
                        </div>

                        {/* Social proof bar */}
                        <div className="mt-14 flex flex-wrap items-center justify-center gap-8 border-t border-slate-800/50 pt-10">
                            {stats.map((s) => (
                                <div key={s.label} className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-emerald-400">
                                        <s.icon className="h-5 w-5" />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-xl font-black text-white">{s.value}</div>
                                        <div className="text-xs font-medium text-slate-500">{s.label}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Feature Grid */}
                <section id="features" className="mx-auto max-w-7xl px-6 py-24">
                    <div data-animate id="feat-head" className={fadeClass('feat-head')}>
                        <div className="mx-auto max-w-2xl text-center">
                            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
                                Everything you need to run compliance at scale
                            </h2>
                            <p className="mt-4 text-lg text-slate-400">
                                One platform. Every authority. Zero spreadsheet chaos.
                            </p>
                        </div>
                    </div>

                    <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {features.map((f, i) => {
                            const colorMap: Record<string, string> = {
                                emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
                                blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
                                purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
                                amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                                rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
                                cyan: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
                            };
                            const id = `feat-${i}`;
                            return (
                                <div
                                    key={f.title}
                                    data-animate
                                    id={id}
                                    className={`group rounded-2xl border border-slate-800 bg-slate-900/40 p-7 backdrop-blur-sm transition hover:border-slate-700 hover:bg-slate-800/40 ${fadeClass(id)}`}
                                    style={{ transitionDelay: `${i * 75}ms` }}
                                >
                                    <div
                                        className={`inline-flex rounded-xl border p-3 ${colorMap[f.color]}`}
                                    >
                                        <f.icon className="h-6 w-6" />
                                    </div>
                                    <h3 className="mt-5 text-lg font-bold text-white">{f.title}</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Workflow Steps */}
                <section id="workflow" className="mx-auto max-w-7xl px-6 py-24">
                    <div data-animate id="wf-head" className={fadeClass('wf-head')}>
                        <div className="mx-auto max-w-2xl text-center">
                            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
                                From CSV to filed return in 4 steps
                            </h2>
                            <p className="mt-4 text-lg text-slate-400">
                                The worker handles KRA login, captcha solving, and receipt download automatically.
                            </p>
                        </div>
                    </div>

                    <div className="mt-16 grid gap-8 lg:grid-cols-4">
                        {workflowSteps.map((ws, i) => {
                            const id = `wf-${i}`;
                            return (
                                <div
                                    key={ws.step}
                                    data-animate
                                    id={id}
                                    className={`relative ${fadeClass(id)}`}
                                    style={{ transitionDelay: `${i * 100}ms` }}
                                >
                                    {i < workflowSteps.length - 1 && (
                                        <div className="absolute top-8 left-full hidden h-px w-full -translate-y-1/2 bg-gradient-to-r from-slate-700 to-transparent lg:block" />
                                    )}
                                    <div className="text-5xl font-black text-slate-800">{ws.step}</div>
                                    <h3 className="mt-4 text-lg font-bold text-white">{ws.title}</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{ws.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Interactive Demo */}
                <section id="demo" className="mx-auto max-w-7xl px-6 py-24">
                    <div data-animate id="demo-head" className={fadeClass('demo-head')}>
                        <div className="mx-auto max-w-2xl text-center">
                            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Try the tools right now</h2>
                            <p className="mt-4 text-lg text-slate-400">
                                No signup required. Generate a real payroll pack or model TOT tax in seconds.
                            </p>
                        </div>
                    </div>

                    <div className="mt-16 grid gap-8 lg:grid-cols-2">
                        {/* TOT Calculator Demo */}
                        <div
                            data-animate
                            id="demo-tot"
                            className={`rounded-3xl border border-slate-800 bg-slate-900/50 p-8 backdrop-blur-sm ${fadeClass('demo-tot')}`}
                        >
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-rose-500/10 p-2.5 text-rose-400">
                                    <Percent className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">TOT Calculator</h3>
                                    <p className="text-xs text-slate-500">3% Turnover Tax preview</p>
                                </div>
                            </div>

                            <div className="mt-8">
                                <div className="flex items-center justify-between text-sm font-semibold text-slate-400">
                                    <span>Monthly sales (KES)</span>
                                    <span className="rounded-full bg-slate-800 px-3 py-1 font-black text-white">
                                        {demoSales.toLocaleString()}
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="1000000"
                                    step="5000"
                                    value={demoSales}
                                    onChange={(e) => setDemoSales(Number(e.target.value))}
                                    className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-emerald-500"
                                />
                            </div>

                            <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-6">
                                <div className="text-sm font-medium text-slate-500">Calculated TOT payable</div>
                                <div className="mt-2 text-4xl font-black tracking-tight text-white">
                                    KES {totTax.toLocaleString()}
                                </div>
                                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                    Includes 3% rate. No deductions apply for TOT.
                                </div>
                            </div>

                            <Link
                                to="/dashboard"
                                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400"
                            >
                                File this TOT return <ArrowRight className="h-4 w-4" />
                            </Link>
                        </div>

                        {/* Payroll Pack Generator Demo */}
                        <div
                            data-animate
                            id="demo-payroll"
                            className={`rounded-3xl border border-slate-800 bg-slate-900/50 p-8 backdrop-blur-sm ${fadeClass('demo-payroll')}`}
                        >
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-400">
                                    <UploadCloud className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">Payroll Pack Generator</h3>
                                    <p className="text-xs text-slate-500">Upload once. Get 3 authority files.</p>
                                </div>
                            </div>

                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className={`mt-6 cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
                                    payrollFile
                                        ? 'border-emerald-500 bg-emerald-500/5'
                                        : 'border-slate-700 bg-slate-800/30 hover:border-slate-600'
                                }`}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept=".csv"
                                    onChange={(e) => { if (e.target.files?.length) setPayrollFile(e.target.files[0]); }}
                                />
                                {payrollFile ? (
                                    <FileCheck2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                                ) : (
                                    <UploadCloud className="mx-auto mb-2 h-8 w-8 text-slate-500" />
                                )}
                                <div className="text-sm font-bold text-white">{payrollFile ? payrollFile.name : 'Click to upload payroll CSV'}</div>
                                <div className="mt-1 text-xs text-slate-500">Unified export with employee identifiers</div>
                            </div>

                            <div className="mt-5 grid gap-2 sm:grid-cols-3">
                                {(['paye', 'nssf', 'sha'] as const).map((key) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => handlePayrollToggle(key)}
                                        className={`rounded-xl border px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition ${
                                            payrollOptions[key]
                                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                                : 'border-slate-700 bg-slate-800/30 text-slate-500 hover:border-slate-600'
                                        }`}
                                    >
                                        {key}
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={handlePayrollGeneration}
                                disabled={!payrollFile || selectedOutputCount === 0 || payrollStatus === 'processing'}
                                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {payrollStatus === 'processing' ? <KwantaLoader /> : <Download className="h-4 w-4" />}
                                {payrollStatus === 'processing' ? 'Generating...' : 'Generate Payroll Pack'}
                            </button>

                            {payrollStatus === 'done' && payrollResponse && (
                                <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                                    <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                                        <CheckCircle2 className="h-4 w-4" /> Pack ready
                                    </div>
                                    <a
                                        href={payrollResponse}
                                        download="Kwanta_Payroll_Pack.zip"
                                        className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                                    >
                                        Download ZIP
                                    </a>
                                </div>
                            )}

                            <div className="mt-5 space-y-3">
                                {[
                                    { label: 'PAYE CSV + ZIP', status: 'KRA-ready upload pack', color: 'text-rose-400' },
                                    { label: 'NSSF Workbook', status: 'Contribution schedule', color: 'text-emerald-400' },
                                    { label: 'SHA Schedule', status: 'Health authority format', color: 'text-sky-400' },
                                ].map((item) => (
                                    <div
                                        key={item.label}
                                        className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-4 py-3"
                                    >
                                        <div>
                                            <div className="text-xs font-bold text-white">{item.label}</div>
                                            <div className="text-[11px] text-slate-500">{item.status}</div>
                                        </div>
                                        <CheckCircle2 className={`h-4 w-4 ${item.color}`} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* CTA Section */}
                <section className="mx-auto max-w-7xl px-6 py-24">
                    <div
                        data-animate
                        id="cta"
                        className={`relative overflow-hidden rounded-[2.5rem] border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-slate-900 to-slate-950 p-12 text-center lg:p-20 ${fadeClass('cta')}`}
                    >
                        <div className="absolute left-1/2 top-0 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/20 blur-[100px]" />
                        <div className="relative z-10">
                            <h2 className="text-3xl font-black tracking-tight sm:text-5xl">
                                Ready to automate your practice?
                            </h2>
                            <p className="mx-auto mt-6 max-w-xl text-lg text-slate-400">
                                Join 150+ Kenyan firms already using Kwanta to file returns faster, track clients better,
                                and never miss a deadline.
                            </p>
                            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                                <Link
                                    to="/dashboard"
                                    className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-8 py-4 text-base font-bold text-slate-950 transition hover:-translate-y-0.5 hover:bg-emerald-400"
                                >
                                    Start Free Trial <ArrowRight className="h-5 w-5" />
                                </Link>
                                <Link
                                    to="/dashboard"
                                    className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/50 px-8 py-4 text-base font-semibold text-white backdrop-blur transition hover:bg-slate-800"
                                >
                                    Open Dashboard
                                </Link>
                            </div>
                            <p className="mt-6 text-xs text-slate-500">
                                No credit card required. Start with the free trial and upgrade when you are ready.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Footer */}
                <footer className="border-t border-slate-800/50 bg-slate-950/30 py-12">
                    <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 sm:flex-row">
                        <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-slate-950">
                                <Sparkles className="h-4 w-4" />
                            </div>
                            <span className="text-lg font-black tracking-tight text-white">
                                Kwanta<span className="text-emerald-500">.</span>
                            </span>
                        </div>
                        <p className="text-sm text-slate-500">
                            &copy; 2026 Kwanta. Built for Kenyan finance teams.
                        </p>
                        <div className="flex gap-6 text-sm font-medium text-slate-400">
                            <a href="#features" className="transition hover:text-white">Features</a>
                            <a href="#workflow" className="transition hover:text-white">Workflow</a>
                            <Link to="/dashboard" className="transition hover:text-white">Dashboard</Link>
                        </div>
                    </div>
                </footer>
            </main>
        </div>
    );
}
