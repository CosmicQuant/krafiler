import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
    UploadCloud,
    CheckCircle,
    ArrowRight,
    Percent,
    ShieldCheck,
    Download,
    FileText,
    Calendar,
    FileCheck2,
    Sparkles,
    Layers3,
    Clock3
} from 'lucide-react';
import kraLogo from '../../assests/kra.png';
import nssfLogo from '../../assests/nssflogo.png';
import shaLogo from '../../assests/shalogo.png';
import tourismFundLogo from '../../assests/tourismfundlogo.png';

type PayrollOptions = {
    paye: boolean;
    nssf: boolean;
    sha: boolean;
};

const institutionLogos = [
    {
        src: kraLogo,
        alt: 'KRA logo',
        title: 'KRA iTax',
        summary: 'PAYE packs and monthly tax workflows',
        imageClassName: 'h-10 w-auto'
    },
    {
        src: nssfLogo,
        alt: 'NSSF logo',
        title: 'NSSF',
        summary: 'Workbook-ready pension submissions',
        imageClassName: 'h-12 w-auto'
    },
    {
        src: shaLogo,
        alt: 'SHA logo',
        title: 'Social Health Authority',
        summary: 'Structured health contribution uploads',
        imageClassName: 'h-11 w-auto'
    },
    {
        src: tourismFundLogo,
        alt: 'Tourism Fund logo',
        title: 'Tourism Fund',
        summary: 'Levy workflows queued into the same stack',
        imageClassName: 'h-10 w-auto'
    }
];

const proofStats = [
    { label: 'One upload', value: '1 CSV' },
    { label: 'Core payroll outputs', value: '3 packs' },
    { label: 'Monthly deadlines covered', value: '9th & 20th' }
];

const staggerContainer: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.14 } }
};

const fadeInUp: Variants = {
    hidden: { opacity: 0, y: 28 },
    show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: 'easeOut' } }
};

const KwantaLoader = () => (
    <div className="flex items-center justify-center space-x-1.5">
        <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1, repeat: Infinity, delay: 0 }} className="h-2.5 w-2.5 rounded-full bg-red-600" />
        <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1, repeat: Infinity, delay: 0.2 }} className="h-2.5 w-2.5 rounded-full bg-slate-900" />
        <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1, repeat: Infinity, delay: 0.4 }} className="h-2.5 w-2.5 rounded-full bg-green-600" />
    </div>
);

const triggerBrowserDownload = (url: string, fileName: string) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
};

export default function LandingPage() {
    const [kraPin, setKraPin] = useState('');
    const [totSales, setTotSales] = useState(50000);
    const [totStatus, setTotStatus] = useState<null | 'generating' | 'done'>(null);
    const [totResponse, setTotResponse] = useState<any>(null);

    const [payrollStatus, setPayrollStatus] = useState<null | 'processing' | 'done'>(null);
    const [payrollFile, setPayrollFile] = useState<File | null>(null);
    const [payrollResponse, setPayrollResponse] = useState<string | null>(null);
    const [payrollOptions, setPayrollOptions] = useState<PayrollOptions>({ paye: true, nssf: true, sha: true });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [nilObligation, setNilObligation] = useState('vat');

    const selectedOutputCount = Object.values(payrollOptions).filter(Boolean).length;
    const selectedOutputLabel = selectedOutputCount === 0
        ? 'Choose at least one payroll output'
        : `${selectedOutputCount} payroll output${selectedOutputCount === 1 ? '' : 's'} selected`;

    useEffect(() => {
        return () => {
            if (payrollResponse) {
                window.URL.revokeObjectURL(payrollResponse);
            }
        };
    }, [payrollResponse]);

    const handleTOTGeneration = async () => {
        setTotStatus('generating');

        try {
            const res = await fetch('/api/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kraPin: kraPin || 'P052063835W',
                    totYear: new Date().getFullYear(),
                    totMonth: new Date().getMonth() + 1,
                    totTurnover: totSales,
                    taxObligationType: 'turnover_tax'
                })
            });

            const data = await res.json();
            setTotResponse(data);
            setTotStatus('done');
        } catch (err) {
            console.error(err);
            setTotStatus('done');
        }
    };

    const handlePayrollToggle = (key: keyof PayrollOptions) => {
        setPayrollOptions((current) => ({ ...current, [key]: !current[key] }));
    };

    const handlePayrollGeneration = async () => {
        if (!payrollFile || selectedOutputCount === 0) {
            return;
        }

        setPayrollStatus('processing');

        const formData = new FormData();
        formData.append('payrollFile', payrollFile);
        formData.append('employerName', 'Company Ltd');
        formData.append('generatePaye', String(payrollOptions.paye));
        formData.append('generateNssf', String(payrollOptions.nssf));
        formData.append('generateSha', String(payrollOptions.sha));

        try {
            const res = await fetch('/api/payroll/generate-unified', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                setPayrollStatus('done');
                return;
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);

            if (payrollResponse) {
                window.URL.revokeObjectURL(payrollResponse);
            }

            setPayrollResponse(url);
            triggerBrowserDownload(url, 'Kwanta_Payroll_Pack.zip');
            setPayrollStatus('done');
        } catch (err) {
            console.error(err);
            setPayrollStatus('done');
        }
    };

    return (
        <div className="relative min-h-screen overflow-x-hidden bg-[#f4f5ef] text-slate-900 selection:bg-red-200">
            <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
                <motion.div
                    animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
                    transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute left-[-12%] top-[-10%] h-[36rem] w-[36rem] rounded-full bg-red-500/10 blur-[140px]"
                />
                <motion.div
                    animate={{ x: [0, -45, 0], y: [0, -35, 0] }}
                    transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute right-[-10%] top-[10%] h-[34rem] w-[34rem] rounded-full bg-green-500/10 blur-[150px]"
                />
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.03)_1px,transparent_1px)] bg-[size:52px_52px] opacity-40" />
            </div>

            <nav className="sticky top-0 z-50 border-b border-slate-200/70 bg-[#f4f5ef]/80 backdrop-blur-xl">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_20px_45px_rgba(15,23,42,0.22)]">
                            <Layers3 className="h-5 w-5" />
                        </div>
                        <div>
                            <span className="block text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Kwanta</span>
                            <span className="block text-xl font-black tracking-[-0.06em] text-slate-950">Compliance OS</span>
                        </div>
                    </div>

                    <div className="hidden items-center gap-8 text-sm font-semibold text-slate-600 lg:flex">
                        <a href="#payroll-engine" className="transition-colors hover:text-slate-950">Payroll Engine</a>
                        <a href="#tax-engine" className="transition-colors hover:text-slate-950">Tax Engine</a>
                        <a href="#nil-itr" className="transition-colors hover:text-slate-950">Nil & P9</a>
                    </div>

                    <div className="flex items-center gap-3">
                        <input
                            type="text"
                            placeholder="Global KRA PIN"
                            className="hidden rounded-2xl border border-slate-200 bg-white px-4 py-2.5 font-mono text-sm uppercase text-slate-800 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-red-500/40 md:block"
                            value={kraPin}
                            onChange={(e) => setKraPin(e.target.value)}
                        />
                        <a href="#payroll-engine" className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 hover:bg-slate-800">
                            Start Filing
                        </a>
                    </div>
                </div>
            </nav>

            <main className="relative z-10">
                <section className="mx-auto grid max-w-7xl gap-12 px-6 pb-12 pt-16 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:pt-20">
                    <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: 'easeOut' }}>
                        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-red-200 bg-white/80 px-4 py-2 text-sm font-bold text-red-700 shadow-sm">
                            <Sparkles className="h-4 w-4" /> Payroll, PAYE, NSSF, SHA, TOT and levy flows in one place
                        </div>

                        <h1 className="max-w-3xl text-5xl font-black tracking-[-0.08em] text-slate-950 sm:text-6xl xl:text-7xl">
                            From one payroll export to a
                            <span className="bg-[linear-gradient(120deg,#dc2626_0%,#0f172a_45%,#15803d_100%)] bg-clip-text text-transparent"> ready-to-file Kenyan compliance pack.</span>
                        </h1>

                        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
                            Kwanta turns raw payroll and sales data into submission-ready PAYE, NSSF, SHA and TOT outputs with the speed finance teams need before the 9th and 20th. Less portal friction, less spreadsheet cleanup, more certainty.
                        </p>

                        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                            <a href="#payroll-engine" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-7 py-4 text-base font-bold text-white shadow-[0_24px_50px_rgba(15,23,42,0.22)] transition-all hover:-translate-y-1 hover:bg-slate-800">
                                Build The Payroll Pack <ArrowRight className="h-5 w-5" />
                            </a>
                            <a href="#tax-engine" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white/80 px-7 py-4 text-base font-bold text-slate-900 transition-all hover:-translate-y-1 hover:border-red-300 hover:bg-white">
                                Run TOT Filing <Percent className="h-5 w-5 text-red-600" />
                            </a>
                        </div>

                        <div className="mt-10 grid gap-4 sm:grid-cols-3">
                            {proofStats.map((stat) => (
                                <div key={stat.label} className="rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
                                    <div className="text-2xl font-black tracking-[-0.06em] text-slate-950">{stat.value}</div>
                                    <div className="mt-1 text-sm font-medium text-slate-500">{stat.label}</div>
                                </div>
                            ))}
                        </div>
                    </motion.div>

                    <motion.div variants={fadeInUp} initial="hidden" animate="show" className="relative">
                        <motion.div
                            animate={{ y: [0, -10, 0] }}
                            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
                            className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 p-7 text-white shadow-[0_30px_80px_rgba(15,23,42,0.28)]"
                        >
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(220,38,38,0.22),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.18),transparent_34%)]" />

                            <div className="relative z-10">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Submission-ready cockpit</p>
                                        <h2 className="mt-2 text-3xl font-black tracking-[-0.06em]">Every authority in one workflow</h2>
                                    </div>
                                    <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                                        April 2026 cycle
                                    </div>
                                </div>

                                <div className="mt-7 grid gap-3">
                                    {institutionLogos.slice(0, 3).map((institution, index) => (
                                        <motion.div
                                            key={institution.title}
                                            initial={{ opacity: 0, x: 24 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ duration: 0.55, delay: 0.12 + index * 0.08 }}
                                            className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/6 p-4 backdrop-blur-sm"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="rounded-2xl bg-white px-3 py-2 shadow-sm">
                                                    <img src={institution.src} alt={institution.alt} className={institution.imageClassName} />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-white">{institution.title}</div>
                                                    <div className="text-sm text-slate-400">{institution.summary}</div>
                                                </div>
                                            </div>
                                            <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-bold text-green-300">Ready</span>
                                        </motion.div>
                                    ))}
                                </div>

                                <div className="mt-7 grid grid-cols-3 gap-3">
                                    <div className="rounded-3xl border border-white/10 bg-white/6 p-4">
                                        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Due 9th</div>
                                        <div className="mt-2 text-lg font-black">Payroll Pack</div>
                                    </div>
                                    <div className="rounded-3xl border border-white/10 bg-white/6 p-4">
                                        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Due 20th</div>
                                        <div className="mt-2 text-lg font-black">TOT Filing</div>
                                    </div>
                                    <div className="rounded-3xl border border-white/10 bg-white/6 p-4">
                                        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Visibility</div>
                                        <div className="mt-2 text-lg font-black">Live Status</div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>

                        <motion.div
                            animate={{ scale: [1, 1.05, 1], opacity: [0.4, 0.55, 0.4] }}
                            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                            className="absolute -bottom-8 -left-10 h-32 w-32 rounded-full bg-red-500/20 blur-3xl"
                        />
                    </motion.div>
                </section>

                <section className="mx-auto max-w-7xl px-6 pb-10">
                    <motion.div variants={staggerContainer} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-100px' }} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {institutionLogos.map((institution) => (
                            <motion.div key={institution.title} variants={fadeInUp} whileHover={{ y: -6 }} className="rounded-[1.7rem] border border-slate-200 bg-white/85 p-5 shadow-[0_18px_44px_rgba(15,23,42,0.08)] backdrop-blur-sm">
                                <div className="flex min-h-16 items-center rounded-2xl bg-slate-50 px-4 py-3">
                                    <img src={institution.src} alt={institution.alt} className={institution.imageClassName} />
                                </div>
                                <div className="mt-4 text-lg font-black tracking-[-0.04em] text-slate-950">{institution.title}</div>
                                <p className="mt-1 text-sm leading-6 text-slate-600">{institution.summary}</p>
                            </motion.div>
                        ))}
                    </motion.div>
                </section>

                <motion.div variants={staggerContainer} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-100px' }} className="mx-auto max-w-7xl space-y-12 px-6 pb-24">
                    <motion.section variants={fadeInUp} id="payroll-engine" className="scroll-mt-24 overflow-hidden rounded-[2rem] border border-slate-200 bg-white/85 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-sm">
                        <div className="border-b border-slate-200 bg-slate-50/90 px-8 py-7">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                                <div>
                                    <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-red-700">
                                        <Calendar className="h-3.5 w-3.5" /> Due 9th workflow
                                    </div>
                                    <h2 className="mt-3 text-3xl font-black tracking-[-0.06em] text-slate-950">Unified payroll extraction, packaging and submission prep</h2>
                                    <p className="mt-2 max-w-3xl text-slate-600">
                                        Upload once, choose the outputs you want, and generate the exact PAYE, NSSF and SHA files your team needs. NSSF and SHA already belong in the same workflow, so there is no extra “coming soon” step to wait for.
                                    </p>
                                </div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm">
                                    <CheckCircle className="h-4 w-4 text-green-600" /> {selectedOutputLabel}
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-10 p-8 lg:grid-cols-[1.05fr_0.95fr]">
                            <div>
                                <h3 className="text-lg font-black tracking-[-0.04em] text-slate-950">1. Upload your unified payroll file</h3>
                                <p className="mt-2 text-sm leading-6 text-slate-600">Feed the engine your master CSV and let the packager split, map and format each authority output automatically.</p>

                                <motion.div
                                    whileHover={{ y: -4 }}
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`mt-6 cursor-pointer rounded-[1.7rem] border-2 border-dashed p-8 text-center transition-all ${payrollFile ? 'border-green-500 bg-green-50/70 shadow-[inset_0_0_28px_rgba(34,197,94,0.08)]' : 'border-slate-300 bg-slate-50/80 hover:border-red-400 hover:bg-white'}`}
                                >
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        className="hidden"
                                        accept=".csv"
                                        onChange={(e) => {
                                            if (e.target.files?.length) {
                                                setPayrollFile(e.target.files[0]);
                                            }
                                        }}
                                    />
                                    {payrollFile ? <FileCheck2 className="mx-auto mb-3 h-11 w-11 text-green-600" /> : <UploadCloud className="mx-auto mb-3 h-11 w-11 text-slate-400" />}
                                    <div className="text-base font-bold text-slate-900">{payrollFile ? payrollFile.name : 'Click to upload master payroll CSV'}</div>
                                    <div className="mt-2 text-sm text-slate-500">Expected source: one unified export with payroll, statutory and employee identifiers.</div>
                                </motion.div>

                                <div className="mt-8">
                                    <h4 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">2. Choose outputs for this run</h4>
                                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                                        {[
                                            {
                                                key: 'paye' as const,
                                                title: 'KRA PAYE',
                                                summary: 'CSV and ZIP bundle aligned to iTax uploads',
                                                src: kraLogo,
                                                alt: 'KRA logo',
                                                imageClassName: 'h-8 w-auto',
                                                activeClasses: 'border-red-300 bg-red-50 shadow-[0_18px_38px_rgba(220,38,38,0.08)]'
                                            },
                                            {
                                                key: 'nssf' as const,
                                                title: 'NSSF',
                                                summary: 'Workbook-ready pension contribution schedule',
                                                src: nssfLogo,
                                                alt: 'NSSF logo',
                                                imageClassName: 'h-10 w-auto',
                                                activeClasses: 'border-green-300 bg-green-50 shadow-[0_18px_38px_rgba(34,197,94,0.08)]'
                                            },
                                            {
                                                key: 'sha' as const,
                                                title: 'SHA',
                                                summary: 'Structured workbook with mapped contribution lines',
                                                src: shaLogo,
                                                alt: 'SHA logo',
                                                imageClassName: 'h-9 w-auto',
                                                activeClasses: 'border-sky-300 bg-sky-50 shadow-[0_18px_38px_rgba(14,165,233,0.08)]'
                                            }
                                        ].map((option) => {
                                            const isActive = payrollOptions[option.key];

                                            return (
                                                <button
                                                    key={option.key}
                                                    type="button"
                                                    onClick={() => handlePayrollToggle(option.key)}
                                                    className={`rounded-[1.5rem] border p-4 text-left transition-all hover:-translate-y-1 ${isActive ? option.activeClasses : 'border-slate-200 bg-white hover:border-slate-300'}`}
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="rounded-2xl bg-white px-3 py-2 shadow-sm">
                                                            <img src={option.src} alt={option.alt} className={option.imageClassName} />
                                                        </div>
                                                        <div className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] ${isActive ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                                            {isActive ? 'Included' : 'Off'}
                                                        </div>
                                                    </div>
                                                    <div className="mt-4 text-base font-black tracking-[-0.03em] text-slate-950">{option.title}</div>
                                                    <p className="mt-1 text-sm leading-6 text-slate-600">{option.summary}</p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-5">
                                <div className="rounded-[1.8rem] bg-slate-950 p-7 text-white shadow-[0_28px_60px_rgba(15,23,42,0.24)]">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Pack generation</div>
                                            <h3 className="mt-2 text-2xl font-black tracking-[-0.05em]">Generate the filing pack</h3>
                                        </div>
                                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-300">
                                            Ready now
                                        </div>
                                    </div>

                                    <div className="mt-6 grid gap-3">
                                        {[
                                            { label: 'PAYE pack', enabled: payrollOptions.paye },
                                            { label: 'NSSF workbook', enabled: payrollOptions.nssf },
                                            { label: 'SHA workbook', enabled: payrollOptions.sha }
                                        ].map((item) => (
                                            <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
                                                <span className="font-semibold text-white">{item.label}</span>
                                                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] ${item.enabled ? 'bg-green-500/15 text-green-300' : 'bg-slate-800 text-slate-400'}`}>
                                                    {item.enabled ? 'Selected' : 'Skipped'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    <button
                                        onClick={handlePayrollGeneration}
                                        disabled={!payrollFile || selectedOutputCount === 0 || payrollStatus === 'processing'}
                                        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-4 text-base font-black text-slate-950 transition-all hover:-translate-y-1 hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-200"
                                    >
                                        {payrollStatus === 'processing' ? <KwantaLoader /> : <Download className="h-5 w-5" />}
                                        {payrollStatus === 'processing' ? 'Generating package...' : 'Generate submission-ready ZIP'}
                                    </button>

                                    <p className="mt-4 text-sm leading-6 text-slate-400">
                                        This run already covers PAYE, NSSF and SHA in the same packaging workflow. Select only what you want, then download one compliant bundle.
                                    </p>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/80 p-5">
                                        <div className="flex items-center gap-3 text-slate-950">
                                            <ShieldCheck className="h-5 w-5 text-green-600" />
                                            <span className="font-black tracking-[-0.03em]">Authority-ready formatting</span>
                                        </div>
                                        <p className="mt-2 text-sm leading-6 text-slate-600">The engine aligns each output to its required workbook or KRA packaging format before download.</p>
                                    </div>
                                    <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/80 p-5">
                                        <div className="flex items-center gap-3 text-slate-950">
                                            <Clock3 className="h-5 w-5 text-red-600" />
                                            <span className="font-black tracking-[-0.03em]">Deadline-first workflow</span>
                                        </div>
                                        <p className="mt-2 text-sm leading-6 text-slate-600">Built to compress the work that usually piles up right before payroll and tax filing deadlines.</p>
                                    </div>
                                </div>

                                <AnimatePresence>
                                    {payrollResponse && (
                                        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-4 rounded-[1.7rem] border border-green-200 bg-green-50 p-5 shadow-sm">
                                            <div>
                                                <div className="flex items-center gap-2 font-black text-green-900">
                                                    <CheckCircle className="h-4 w-4" /> Payroll pack ready
                                                </div>
                                                <p className="mt-1 text-sm text-green-700">Download the generated ZIP with every selected filing output.</p>
                                            </div>
                                            <a href={payrollResponse} download="Kwanta_Payroll_Pack.zip" className="rounded-2xl bg-green-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-green-700">
                                                Download ZIP
                                            </a>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </motion.section>

                    <motion.section variants={fadeInUp} id="tax-engine" className="scroll-mt-24 grid gap-6 lg:grid-cols-[0.98fr_1.02fr]">
                        <div className="rounded-[2rem] border border-red-200 bg-white/85 p-8 shadow-[0_24px_70px_rgba(220,38,38,0.08)] backdrop-blur-sm">
                            <div className="flex items-center gap-4">
                                <div className="rounded-2xl bg-red-50 p-3 text-red-600">
                                    <Percent className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-red-600">Due 20th workflow</div>
                                    <h3 className="text-2xl font-black tracking-[-0.05em] text-slate-950">TOT Express</h3>
                                </div>
                            </div>

                            <p className="mt-5 text-sm leading-6 text-slate-600">Model turnover tax before submission, then dispatch the filing payload without leaving the same workspace.</p>

                            <div className="mt-7 space-y-6">
                                <div>
                                    <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-600">
                                        <span>Monthly sales (KES)</span>
                                        <span className="rounded-full bg-slate-100 px-3 py-1 font-black text-slate-950">{totSales.toLocaleString()}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1000000"
                                        step="5000"
                                        value={totSales}
                                        onChange={(e) => setTotSales(Number(e.target.value))}
                                        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-red-600"
                                    />
                                </div>

                                <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-5">
                                    <div className="text-sm font-semibold text-slate-500">Calculated 3% tax</div>
                                    <div className="mt-2 text-3xl font-black tracking-[-0.06em] text-slate-950">KES {(totSales * 0.03).toLocaleString()}</div>
                                </div>

                                <button
                                    onClick={handleTOTGeneration}
                                    disabled={totStatus === 'generating'}
                                    className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-black transition-all hover:-translate-y-1 ${totStatus === 'generating' ? 'bg-slate-100 text-slate-500' : 'bg-red-600 text-white shadow-[0_22px_44px_rgba(220,38,38,0.18)] hover:bg-red-700'}`}
                                >
                                    {totStatus === 'generating' ? <KwantaLoader /> : <CheckCircle className="h-5 w-5" />}
                                    {totStatus === 'generating' ? 'Submitting TOT...' : 'File TOT instantly'}
                                </button>

                                <AnimatePresence>
                                    {totStatus === 'done' && (
                                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
                                            {totResponse?.message || 'TOT filing dispatch triggered successfully.'}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>

                        <div className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 p-8 text-white shadow-[0_28px_70px_rgba(15,23,42,0.22)]">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.25),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(220,38,38,0.18),transparent_30%)]" />
                            <div className="relative z-10">
                                <div className="flex items-center gap-4">
                                    <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                                        <img src={tourismFundLogo} alt="Tourism Fund logo" className="h-10 w-auto" />
                                    </div>
                                    <div>
                                        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Expansion lane</div>
                                        <h3 className="text-2xl font-black tracking-[-0.05em]">Monthly tax workflows beyond payroll</h3>
                                    </div>
                                </div>

                                <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300">The same operating surface can handle turnover tax, nil filings, VAT and levy work. Keep the compliance team on one rhythm instead of splitting work across portals and spreadsheets.</p>

                                <div className="mt-7 grid gap-4 sm:grid-cols-2">
                                    {[
                                        'VAT filing workspace',
                                        'Monthly rental income',
                                        'Digital services tax',
                                        'Tourism levy submission'
                                    ].map((item) => (
                                        <div key={item} className="flex items-center justify-between rounded-[1.4rem] border border-white/10 bg-white/6 px-4 py-4 backdrop-blur-sm transition-colors hover:bg-white/10">
                                            <span className="font-semibold text-white">{item}</span>
                                            <ArrowRight className="h-4 w-4 text-green-400" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </motion.section>

                    <motion.section variants={fadeInUp} id="nil-itr" className="scroll-mt-24 grid gap-6 lg:grid-cols-2">
                        <div className="rounded-[2rem] border border-slate-200 bg-white/85 p-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-sm">
                            <h3 className="flex items-center gap-3 text-2xl font-black tracking-[-0.05em] text-slate-950">
                                <div className="rounded-2xl bg-green-50 p-3 text-green-600">
                                    <CheckCircle className="h-5 w-5" />
                                </div>
                                Instant nil filing
                            </h3>
                            <p className="mt-3 text-sm leading-6 text-slate-600">Need to clear a month with zero activity? Queue the nil return directly from the same dashboard.</p>

                            <div className="mt-6 space-y-4">
                                <select value={nilObligation} onChange={(e) => setNilObligation(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500/40">
                                    <option value="vat">VAT (Value Added Tax)</option>
                                    <option value="paye">PAYE</option>
                                    <option value="tot">Turnover Tax</option>
                                    <option value="mri">Monthly Rental Income</option>
                                </select>
                                <button className="w-full rounded-2xl border border-slate-200 bg-white py-4 text-base font-black text-slate-950 transition-all hover:-translate-y-1 hover:border-green-300 hover:bg-green-50">
                                    Submit nil return
                                </button>
                            </div>
                        </div>

                        <div className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 p-8 text-white shadow-[0_28px_70px_rgba(15,23,42,0.22)]">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_28%)]" />
                            <div className="relative z-10">
                                <h3 className="flex items-center gap-3 text-2xl font-black tracking-[-0.05em]">
                                    <div className="rounded-2xl bg-white/10 p-3 text-white">
                                        <FileText className="h-5 w-5" />
                                    </div>
                                    Annual P9 and ITR actions
                                </h3>
                                <p className="mt-3 text-sm leading-6 text-slate-300">Distribute P9 forms to employees, then hand individual tax filing from the same finance operations stack.</p>

                                <div className="mt-6 flex flex-col gap-3">
                                    <button className="rounded-2xl border border-white/10 bg-white/6 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10">
                                        Generate employee P9s
                                    </button>
                                    <button className="rounded-2xl bg-white py-3 text-sm font-black text-slate-950 transition-colors hover:bg-slate-100">
                                        File individual tax return
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.section>
                </motion.div>
            </main>

            <footer className="relative z-10 border-t border-slate-200/80 bg-white/70 py-12 text-center text-sm text-slate-500 backdrop-blur-sm">
                <p>&copy; 2026 Kwanta. Built for Kenyan finance teams that need speed, certainty and cleaner monthly closes.</p>
                <div className="mt-4 flex justify-center gap-2 opacity-60">
                    <div className="h-2 w-2 rounded-full bg-slate-900" />
                    <div className="h-2 w-2 rounded-full bg-red-600" />
                    <div className="h-2 w-2 rounded-full bg-green-600" />
                    <div className="h-2 w-2 rounded-full border border-slate-300 bg-white" />
                </div>
            </footer>
        </div>
    );
}
