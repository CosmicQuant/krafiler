/**
 * PracticeLandingPage.tsx
 *
 * Modern, conversion-focused landing page for Kwanta.ai.
 * White + KRA red + black palette. Clean SaaS aesthetic.
 */

import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiFetchJson } from '../services/api';
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
    Lock,
    BarChart3,
    Globe,
    Star,
    Play,
    Calculator,
    Receipt,
    Landmark,
    FileArchive,
    FileSpreadsheet,
    FileType,
} from 'lucide-react';
import PricingSection from './PricingSection';

const stats = [
    { label: 'Returns Filed', value: '12,000+', icon: FileCheck2 },
    { label: 'Kenyan Firms', value: '150+', icon: Building2 },
    { label: 'Hours Saved/mo', value: '320+', icon: Clock },
];

const features = [
    {
        icon: Zap,
        title: 'One Master Payroll, All Authorities',
        desc: 'Upload a single payroll file. Kwanta.ai auto-generates KRA PAYE, NSSF, SHA & HELB packs — formatted and ready to file. It can also automatically file for you.',
        color: 'red',
    },
    {
        icon: Globe,
        title: 'Automatic Filing',
        desc: 'File VAT, TOT, Nil returns, DST and MRI automatically or generate ZIP packs if you want to upload yourself across all your clients. No manual Excel & portal work. No missed deadlines.',
        color: 'blue',
    },
    {
        icon: BarChart3,
        title: 'Real-Time Compliance Tracker',
        desc: "Track every client's filing status across PAYE, VAT, TOT, MRI, NSSF, and SHA in a single real-time dashboard.",
        color: 'purple',
    },
    {
        icon: Lock,
        title: 'Bank-Grade Security',
        desc: 'Client credentials are handled securely and never logged or stored outside the filing workflow.',
        color: 'red',
    },
    {
        icon: TrendingUp,
        title: 'eTIMS VAT Reconciliation',
        desc: 'Sync your eTIMS invoices with VAT returns automatically. Reconcile sales data, detect discrepancies, and ensure every return matches your electronic tax invoices.',
        color: 'blue',
    },
    {
        icon: FileSpreadsheet,
        title: 'ZIP, CSV & Excel Packs',
        desc: 'Generate authority-ready ZIP files for KRA uploads, CSV schedules for NSSF, and Excel workbooks for SHA. Every format pre-validated before download.',
        color: 'purple',
    },
];

const workflowSteps = [
    {
        step: '01',
        title: 'Upload Your Data',
        desc: 'Drop your unified payroll spreadsheet (Excel or CSV). Kwanta.ai reads employee details, PINs, and statutory lines automatically.',
    },
    {
        step: '02',
        title: 'Generate Filing Packs',
        desc: 'PAYE ZIP, NSSF workbook, SHA schedule, and HELB remittance are auto-formatted to each authority\'s exact requirements.',
    },
    {
        step: '03',
        title: 'File Automatically',
        desc: 'Returns are filed across all authorities automatically, or download the packs to upload manually. You just review and confirm.',
    },
    {
        step: '04',
        title: 'Track & Store Receipts',
        desc: 'Every receipt is saved to the client profile. View filing history, track deadlines, and stay audit-ready.',
    },
];

const testimonials = [
    {
        name: 'James Mwangi',
        title: 'CPA, Managing Partner',
        firm: 'Mwangi & Associates',
        quote: 'We used to spend 3 days every month on KRA filings. With Kwanta.ai, it is done in 2 hours. The automation is a game changer for our practice.',
        rating: 5,
    },
    {
        name: 'Sarah Ochieng',
        title: 'Senior Auditor',
        firm: 'Nairobi Audit Partners',
        quote: 'The tax preparation workflow alone saves us 10 hours per client. Being able to download KRA auto-populated data and review before filing reduces errors to zero.',
        rating: 5,
    },
    {
        name: 'Peter Kimani',
        title: 'Tax Consultant',
        firm: 'PK Tax Advisory',
        quote: 'I manage 45 clients. Before Kwanta.ai, I needed two junior staff just for portal work. Now I handle everything myself from one dashboard.',
        rating: 5,
    },
];

const authorityLogos = [
    { name: 'KRA', abbr: 'KRA', full: 'Kenya Revenue Authority', src: '/logos/kra.png' },
    { name: 'NSSF', abbr: 'NSSF', full: 'National Social Security Fund', src: '/logos/nssflogo.png' },
    { name: 'SHA', abbr: 'SHA', full: 'Social Health Authority', src: '/logos/shalogo.png' },
    { name: 'eLevy', abbr: 'eLevy', full: 'Tourism Fund E-Levy', src: '/logos/tourismfundlogo.png' },
    { name: 'eTIMS', abbr: 'eTIMS', full: 'Electronic Tax Invoice Management', src: '/logos/kra.png' },
    { name: 'NITA', abbr: 'NITA', full: 'National Industrial Training Authority', src: '/logos/kra.png' },
];

type PayrollOptions = { paye: boolean; nssf: boolean; sha: boolean };

const KwantaLoader = () => (
    <div className="flex items-center justify-center space-x-1">
        <div className="h-2 w-2 animate-bounce rounded-full bg-[#ff0613]" style={{ animationDelay: '0ms' }} />
        <div className="h-2 w-2 animate-bounce rounded-full bg-[#ff0613]" style={{ animationDelay: '150ms' }} />
        <div className="h-2 w-2 animate-bounce rounded-full bg-[#ff0613]" style={{ animationDelay: '300ms' }} />
    </div>
);

// 3D Tilt Card Component
function TiltCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    const cardRef = useRef<HTMLDivElement>(null);
    const [transform, setTransform] = useState('perspective(1000px) rotateX(0deg) rotateY(0deg)');

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -8;
        const rotateY = ((x - centerX) / centerX) * 8;
        setTransform(`perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`);
    };

    const handleMouseLeave = () => {
        setTransform('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)');
    };

    return (
        <div
            ref={cardRef}
            className={className}
            style={{ transform, transition: 'transform 0.15s ease-out' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            {children}
        </div>
    );
}

// Demo ToT Form Component
function DemoTotForm() {
    const [pin, setPin] = useState('');
    const [month, setMonth] = useState('');
    const [year, setYear] = useState(new Date().getFullYear().toString());
    const [amount, setAmount] = useState('');
    const [status, setStatus] = useState<'idle' | 'generating' | 'done'>('idle');
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const [downloadLabel, setDownloadLabel] = useState<string | null>(null);

    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const handleGenerate = async () => {
        if (!pin || !month || !amount) return;
        setStatus('generating');

        try {
            const monthIndex = months.indexOf(month) + 1;
            const data = await apiFetchJson('/tax/generate-tot-zip', {
                method: 'POST',
                body: JSON.stringify({
                    kraPin: pin,
                    year: parseInt(year),
                    month: monthIndex,
                    turnover: parseFloat(amount),
                    clientName: 'Demo'
                })
            });

            setDownloadUrl(data.totInfo?.url || null);
            setDownloadLabel(data.totInfo?.label || null);
            setStatus('done');
        } catch (err) {
            console.error('TOT generation error:', err);
            setStatus('idle');
            alert(err instanceof Error ? err.message : 'Failed to generate TOT ZIP');
        }
    };

    const tax = amount ? Math.round(Number(amount) * 0.015) : 0;

    return (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-[#ff0613]/10 p-2.5 text-[#ff0613]">
                        <Calculator className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-900">ToT Return Generator</h3>
                        <p className="text-xs text-slate-500">Generate a Turnover Tax ZIP for KRA upload</p>
                    </div>
                </div>
                <div className="rounded-full bg-[#ff0613]/10 px-3 py-1">
                    <span className="text-sm font-black text-[#ff0613]">KES 200</span>
                </div>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">KRA PIN</label>
                    <div className="relative">
                        <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            type="text"
                            value={pin}
                            onChange={(e) => setPin(e.target.value.toUpperCase())}
                            placeholder="P052000000X"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613]/50 focus:ring-1 focus:ring-[#ff0613]/20 transition"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5">Month</label>
                        <select
                            value={month}
                            onChange={(e) => setMonth(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-sm text-slate-900 outline-none focus:border-[#ff0613]/50 transition appearance-none"
                        >
                            <option value="">Select month</option>
                            {months.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5">Year</label>
                        <input
                            type="number"
                            value={year}
                            onChange={(e) => setYear(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-sm text-slate-900 outline-none focus:border-[#ff0613]/50 transition"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Monthly Turnover (KES)</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium">KES</span>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="500000"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-12 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#ff0613]/50 focus:ring-1 focus:ring-[#ff0613]/20 transition"
                        />
                    </div>
                </div>

                {amount && (
                    <div className="rounded-2xl border border-[#ff0613]/20 bg-[#ff0613]/5 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-xs text-slate-500">Turnover Tax (1.5%)</div>
                                <div className="text-2xl font-black text-slate-900 mt-1">KES {tax.toLocaleString()}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-slate-500">Rate</div>
                                <div className="text-sm font-bold text-[#ff0613]">1.5%</div>
                            </div>
                        </div>
                    </div>
                )}

                <button
                    onClick={handleGenerate}
                    disabled={!pin || !month || !amount || status === 'generating'}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff0613] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#d80000] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {status === 'generating' ? <KwantaLoader /> : <FileArchive className="h-4 w-4" />}
                    {status === 'generating' ? 'Generating ZIP...' : status === 'done' ? 'Regenerate ZIP' : 'Generate ToT ZIP'}
                </button>

                {status === 'done' && downloadUrl && (
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-emerald-600">
                            <CheckCircle2 className="h-4 w-4" /> ZIP ready for KRA upload
                        </div>
                        <a
                            href={downloadUrl}
                            download={downloadLabel || undefined}
                            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600 transition"
                        >
                            Download
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
}

// Trust Marquee Component
function TrustMarquee() {
    const marqueeRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        const el = marqueeRef.current;
        if (!el) return;
        let animationId: number;
        let scrollPos = 0;
        
        const animate = () => {
            scrollPos += 0.5;
            if (scrollPos >= el.scrollWidth / 2) scrollPos = 0;
            el.style.transform = `translateX(-${scrollPos}px)`;
            animationId = requestAnimationFrame(animate);
        };
        
        animationId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationId);
    }, []);

    const doubled = [...authorityLogos, ...authorityLogos];

    return (
        <div className="relative overflow-hidden py-8 border-y border-slate-100 bg-slate-50/50">
            <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-white to-transparent z-10" />
            <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-white to-transparent z-10" />
            
            <div ref={marqueeRef} className="flex items-center gap-16 whitespace-nowrap">
                {doubled.map((logo, i) => (
                    <div key={`${logo.abbr}-${i}`} className="flex items-center gap-3 px-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white border border-slate-200 shadow-sm">
                            <img src={logo.src} alt={logo.name} className="h-8 w-auto object-contain" />
                        </div>
                        <div>
                            <div className="text-sm font-black text-slate-700 tracking-wider">{logo.abbr}</div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-widest">{logo.full}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Floating 3D Dashboard Mockup
function FloatingMockup() {
    return (
        <div className="relative w-full max-w-4xl mx-auto" style={{ perspective: '1200px' }}>
            <div 
                className="relative rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
                style={{ 
                    transform: 'rotateX(8deg) rotateY(-5deg) rotateZ(1deg)',
                    transformStyle: 'preserve-3d',
                    boxShadow: '0 50px 100px -20px rgba(0,0,0,0.15), 0 30px 60px -30px rgba(255,6,19,0.08)'
                }}
            >
                {/* Mockup Header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex gap-1.5">
                        <div className="h-3 w-3 rounded-full bg-red-400/80" />
                        <div className="h-3 w-3 rounded-full bg-[#ff0613]/80" />
                        <div className="h-3 w-3 rounded-full bg-emerald-400/80" />
                    </div>
                    <div className="ml-4 flex-1">
                        <div className="h-5 w-48 rounded-md bg-slate-200/60" />
                    </div>
                </div>
                
                {/* Mockup Content */}
                <div className="p-6 space-y-4">
                    {/* Stats Row */}
                    <div className="grid grid-cols-4 gap-3">
                        {[
                            { label: 'Clients', value: '28', color: 'bg-blue-50 border-blue-100' },
                            { label: 'Due This Month', value: '14', color: 'bg-[#ff0613]/5 border-[#ff0613]/10' },
                            { label: 'Filed', value: '8', color: 'bg-emerald-50 border-emerald-100' },
                            { label: 'Receipts', value: '156', color: 'bg-purple-50 border-purple-100' },
                        ].map(stat => (
                            <div key={stat.label} className={`rounded-xl border ${stat.color} p-3`}>
                                <div className="text-xs text-slate-500">{stat.label}</div>
                                <div className="text-xl font-black text-slate-900 mt-1">{stat.value}</div>
                            </div>
                        ))}
                    </div>
                    
                    {/* Table Mockup */}
                    <div className="rounded-xl border border-slate-100 bg-slate-50/30 overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
                            <div className="h-3 w-24 rounded bg-slate-200/50" />
                            <div className="h-3 w-16 rounded bg-slate-200/50" />
                            <div className="h-3 w-20 rounded bg-slate-200/50" />
                            <div className="h-3 w-12 rounded bg-slate-200/50" />
                        </div>
                        {[1,2,3,4].map(i => (
                            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100/50">
                                <div className="h-3 w-28 rounded bg-slate-100" />
                                <div className="h-3 w-20 rounded bg-slate-100" />
                                <div className="h-3 w-16 rounded bg-slate-100" />
                                <div className={`h-5 w-14 rounded-full ${i <= 2 ? 'bg-emerald-100' : 'bg-[#ff0613]/10'}`} />
                            </div>
                        ))}
                    </div>
                </div>
                
                {/* Glow effect */}
                <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 h-40 w-3/4 rounded-full bg-[#ff0613]/5 blur-[60px]" />
            </div>
            
            {/* Floating cards around mockup */}
            <div 
                className="absolute -right-8 top-8 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
                style={{ transform: 'translateZ(60px) rotateY(-10deg)' }}
            >
                <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    </div>
                    <div>
                        <div className="text-[10px] text-slate-400">PAYE Filed</div>
                        <div className="text-xs font-bold text-slate-900">Client #042</div>
                    </div>
                </div>
            </div>
            
            <div 
                className="absolute -left-6 bottom-16 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
                style={{ transform: 'translateZ(40px) rotateY(10deg)' }}
            >
                <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-[#ff0613]/10 flex items-center justify-center">
                        <Receipt className="h-4 w-4 text-[#ff0613]" />
                    </div>
                    <div>
                        <div className="text-[10px] text-slate-400">Receipt Downloaded</div>
                        <div className="text-xs font-bold text-slate-900">VAT-2026-05</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function PracticeLandingPage() {
    const [scrolled, setScrolled] = useState(false);
    const [isVisible, setIsVisible] = useState<Record<string, boolean>>({});
    const observerRef = useRef<IntersectionObserver | null>(null);

    const [payrollFile, setPayrollFile] = useState<File | null>(null);
    const [payrollStatus, setPayrollStatus] = useState<null | 'processing' | 'done'>(null);
    const [payrollOptions, setPayrollOptions] = useState<PayrollOptions>({ paye: true, nssf: true, sha: true });
    const [payrollResponse, setPayrollResponse] = useState<{
        masterZipUrl: string;
        paye?: { url: string; label: string };
        nssf?: { url: string; label: string };
        sha?: { url: string; label: string };
    } | null>(null);
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

    const selectedOutputCount = Object.values(payrollOptions).filter(Boolean).length;

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
            formData.append('clientName', 'Demo');

            const data = await apiFetchJson('/payroll/generate-unified', { method: 'POST', body: formData });
            if (!data.masterZipUrl) {
                throw new Error('No payroll pack was generated');
            }

            setPayrollResponse({
                masterZipUrl: data.masterZipUrl,
                paye: data.paye || undefined,
                nssf: data.nssf || undefined,
                sha: data.sha || undefined,
            });
            setPayrollStatus('done');

            const filename = data.masterZipUrl.split('/').pop() || 'Kwanta.ai_Payroll_Pack.zip';
            const a = document.createElement('a');
            a.href = data.masterZipUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (err) {
            console.error('Payroll generation error:', err);
            alert(err instanceof Error ? err.message : 'Failed to generate payroll pack');
            setPayrollStatus(null);
        }
    };

    return (
        <div className="min-h-screen bg-white text-slate-900 selection:bg-red-100">
            {/* Ambient background */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute left-1/4 top-0 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff0613]/[0.03] blur-[120px]" />
                <div className="absolute right-1/4 top-1/2 h-[500px] w-[500px] -translate-y-1/2 translate-x-1/2 rounded-full bg-slate-200/50 blur-[100px]" />
                <div className="absolute bottom-0 left-1/2 h-[400px] w-[400px] -translate-x-1/2 translate-y-1/2 rounded-full bg-[#ff0613]/[0.03] blur-[100px]" />
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:64px_64px] opacity-30" />
            </div>

            {/* Sticky Nav */}
            <nav
                className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
                    scrolled ? 'border-b border-slate-200 bg-white/90 backdrop-blur-xl shadow-sm' : 'bg-transparent'
                }`}
            >
                <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#ff0613] text-white">
                            <Landmark className="h-5 w-5" />
                        </div>
                        <div>
                            <span className="text-lg font-black tracking-tight text-slate-900">
                                Kwanta<span className="text-[#ff0613]">.ai</span>
                            </span>
                        </div>
                    </div>
                    <div className="hidden items-center gap-8 text-sm font-semibold text-slate-500 md:flex">
                        <a href="#features" className="transition hover:text-[#ff0613]">Features</a>
                        <a href="#workflow" className="transition hover:text-[#ff0613]">How it Works</a>
                        <a href="#demo" className="transition hover:text-[#ff0613]">Demo</a>
                        <a href="#pricing" className="transition hover:text-[#ff0613]">Pricing</a>
                        <Link to="/dashboard" className="transition hover:text-[#ff0613]">Login</Link>
                    </div>
                    <Link
                        to="/dashboard"
                        className="rounded-full bg-[#ff0613] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#d80000]"
                    >
                        Get Started
                    </Link>
                </div>
            </nav>

            <main className="relative z-10">
                {/* Hero */}
                <section className="relative mx-auto max-w-7xl px-6 pb-24 pt-32 lg:pt-40">
                    <div className="mx-auto max-w-4xl text-center">
                        <div className="inline-flex items-center gap-2 rounded-full border border-[#ff0613]/20 bg-[#ff0613]/5 px-4 py-1.5 text-sm font-medium text-[#ff0613]">
                            <ShieldCheck className="h-4 w-4" />
                            Built exclusively for Kenyan Accounting and Audit Firms
                        </div>

                        <h1 className="mt-8 text-5xl font-black tracking-tight sm:text-7xl lg:text-[5.5rem] leading-[1.05] text-slate-900">
                            Automate Statutory Filings
                        </h1>

                        <p className="mx-auto mt-8 max-w-2xl text-lg text-slate-500 sm:text-xl leading-relaxed">
                            AI-powered automation for <span className="text-[#ff0613] font-semibold">KRA, NSSF, SHA, Tourism Fund & More</span>. Kwanta.ai generates ZIP files and Excel/CSV files ready to upload and submit, and can also file everything automatically.
                            <span className="text-slate-900 font-semibold"> No Excel data entry. No portal hopping. Just results.</span>
                        </p>

                        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                            <Link
                                to="/dashboard"
                                className="group inline-flex items-center gap-2 rounded-full bg-[#ff0613] px-8 py-4 text-base font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#d80000] focus:outline-none focus:ring-4 focus:ring-[#ff0613]/30"
                            >
                                Start Automating Now
                                <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
                            </Link>
                            <a
                                href="#demo"
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-8 py-4 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                            >
                                <Play className="h-4 w-4" />
                                Run Your First Filing
                            </a>
                        </div>

                        {/* Social proof bar */}
                        <div className="mt-14 flex flex-wrap items-center justify-center gap-8 border-t border-slate-100 pt-10">
                            {stats.map((s) => (
                                <div key={s.label} className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-[#ff0613]">
                                        <s.icon className="h-5 w-5" />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-xl font-black text-slate-900">{s.value}</div>
                                        <div className="text-xs font-medium text-slate-400">{s.label}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Floating Dashboard Mockup */}
                    <div className="mt-20">
                        <FloatingMockup />
                    </div>
                </section>

                {/* Trust Marquee */}
                <TrustMarquee />

                {/* Feature Grid */}
                <section id="features" className="mx-auto max-w-7xl px-6 py-24">
                    <div data-animate id="feat-head" className={fadeClass('feat-head')}>
                        <div className="mx-auto max-w-2xl text-center">
                            <h2 className="text-3xl font-black tracking-tight sm:text-4xl text-slate-900">
                                Everything you need to run compliance at scale
                            </h2>
                            <p className="mt-4 text-lg text-slate-500">
                                One platform. Every authority. Zero spreadsheet chaos.
                            </p>
                        </div>
                    </div>

                    <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {features.map((f, i) => {
                            const colorMap: Record<string, string> = {
                                red: 'text-[#ff0613] bg-[#ff0613]/10 border-[#ff0613]/20',
                                blue: 'text-blue-500 bg-blue-50 border-blue-100',
                                purple: 'text-purple-500 bg-purple-50 border-purple-100',
                            };
                            const id = `feat-${i}`;
                            return (
                                <TiltCard key={f.title}>
                                    <div
                                        data-animate
                                        id={id}
                                        className={`group rounded-2xl border border-slate-100 bg-white p-7 shadow-sm transition hover:border-slate-200 hover:shadow-md ${fadeClass(id)}`}
                                        style={{ transitionDelay: `${i * 75}ms` }}
                                    >
                                        <div
                                            className={`inline-flex rounded-xl border p-3 ${colorMap[f.color]}`}
                                        >
                                            <f.icon className="h-6 w-6" />
                                        </div>
                                        <h3 className="mt-5 text-lg font-bold text-slate-900">{f.title}</h3>
                                        <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.desc}</p>
                                    </div>
                                </TiltCard>
                            );
                        })}
                    </div>
                </section>

                {/* Workflow Steps */}
                <section id="workflow" className="mx-auto max-w-7xl px-6 py-24">
                    <div data-animate id="wf-head" className={fadeClass('wf-head')}>
                        <div className="mx-auto max-w-2xl text-center">
                            <h2 className="text-3xl font-black tracking-tight sm:text-4xl text-slate-900">
                                From CSV to filed return in 4 steps
                            </h2>
                            <p className="mt-4 text-lg text-slate-500">
                                Compliance work that used to take days now takes minutes.
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
                                        <div className="absolute top-8 left-full hidden h-px w-full -translate-y-1/2 bg-gradient-to-r from-slate-200 to-transparent lg:block" />
                                    )}
                                    <div className="text-5xl font-black text-slate-100">{ws.step}</div>
                                    <h3 className="mt-4 text-lg font-bold text-slate-900">{ws.title}</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-slate-500">{ws.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Interactive Demo */}
                <section id="demo" className="mx-auto max-w-7xl px-6 py-24">
                    <div data-animate id="demo-head" className={fadeClass('demo-head')}>
                        <div className="mx-auto max-w-2xl text-center">
                            <h2 className="text-3xl font-black tracking-tight sm:text-4xl text-slate-900">Try the tools right now</h2>
                            <p className="mt-4 text-lg text-slate-500">
                                No signup required. Generate a real payroll pack or model TOT tax in seconds. Pay only for what you use.
                            </p>
                        </div>
                    </div>

                    <div className="mt-16 grid gap-8 lg:grid-cols-2">
                        {/* ToT Generator Demo */}
                        <DemoTotForm />

                        {/* Payroll Pack Generator Demo */}
                        <div
                            data-animate
                            id="demo-payroll"
                            className={`rounded-3xl border border-slate-200 bg-white p-8 shadow-sm ${fadeClass('demo-payroll')}`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
                                        <UploadCloud className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900">Payroll Pack Generator</h3>
                                        <p className="text-xs text-slate-500">Upload once. Get 4 authority files.</p>
                                    </div>
                                </div>
                                <div className="rounded-full bg-blue-50 px-3 py-1">
                                    <span className="text-sm font-black text-blue-600">KES 500</span>
                                </div>
                            </div>

                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className={`mt-6 cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
                                    payrollFile
                                        ? 'border-[#ff0613] bg-[#ff0613]/[0.03]'
                                        : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                                }`}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept=".csv,.xlsx,.xls"
                                    onChange={(e) => { if (e.target.files?.length) setPayrollFile(e.target.files[0]); }}
                                />
                                {payrollFile ? (
                                    <FileCheck2 className="mx-auto mb-2 h-8 w-8 text-[#ff0613]" />
                                ) : (
                                    <div className="flex items-center justify-center gap-2 mb-2">
                                        <FileSpreadsheet className="h-6 w-6 text-slate-400" />
                                        <FileType className="h-6 w-6 text-slate-400" />
                                    </div>
                                )}
                                <div className="text-sm font-bold text-slate-900">{payrollFile ? payrollFile.name : 'Click to upload payroll file'}</div>
                                <div className="mt-1 text-xs text-slate-400">Accepts Excel (.xlsx, .xls) or CSV with employee identifiers</div>
                            </div>

                            <div className="mt-5 grid gap-2 sm:grid-cols-4">
                                {(['paye', 'nssf', 'sha'] as const).map((key) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => handlePayrollToggle(key)}
                                        className={`rounded-xl border px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition ${
                                            payrollOptions[key]
                                                ? 'border-[#ff0613]/30 bg-[#ff0613]/5 text-[#ff0613]'
                                                : 'border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-300'
                                        }`}
                                    >
                                        {key}
                                    </button>
                                ))}
                                <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                                    helb
                                </div>
                            </div>

                            <button
                                onClick={handlePayrollGeneration}
                                disabled={!payrollFile || selectedOutputCount === 0 || payrollStatus === 'processing'}
                                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff0613] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#d80000] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {payrollStatus === 'processing' ? <KwantaLoader /> : <Download className="h-4 w-4" />}
                                {payrollStatus === 'processing' ? 'Generating...' : 'Generate Payroll Pack'}
                            </button>

                            {payrollStatus === 'done' && payrollResponse && (
                                <div className="mt-4 rounded-xl border border-[#ff0613]/20 bg-[#ff0613]/5 p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2 text-sm font-bold text-[#ff0613]">
                                            <CheckCircle2 className="h-4 w-4" /> Pack ready
                                        </div>
                                        <a
                                            href={payrollResponse.masterZipUrl}
                                            download={payrollResponse.masterZipUrl.split('/').pop() || 'Kwanta.ai_Payroll_Pack.zip'}
                                            className="rounded-lg bg-[#ff0613] px-4 py-2 text-xs font-bold text-white hover:bg-[#d80000]"
                                        >
                                            Download All ZIP
                                        </a>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {payrollResponse.paye && (
                                            <a
                                                href={payrollResponse.paye.url}
                                                download={payrollResponse.paye.label}
                                                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 hover:bg-slate-50 transition"
                                            >
                                                <FileArchive className="h-4 w-4 shrink-0 text-[#ff0613]" />
                                                <span className="truncate max-w-[120px]">{payrollResponse.paye.label}</span>
                                            </a>
                                        )}
                                        {payrollResponse.nssf && (
                                            <a
                                                href={payrollResponse.nssf.url}
                                                download={payrollResponse.nssf.label}
                                                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 hover:bg-slate-50 transition"
                                            >
                                                <FileSpreadsheet className="h-4 w-4 shrink-0 text-blue-500" />
                                                <span className="truncate max-w-[120px]">{payrollResponse.nssf.label}</span>
                                            </a>
                                        )}
                                        {payrollResponse.sha && (
                                            <a
                                                href={payrollResponse.sha.url}
                                                download={payrollResponse.sha.label}
                                                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 hover:bg-slate-50 transition"
                                            >
                                                <FileType className="h-4 w-4 shrink-0 text-sky-500" />
                                                <span className="truncate max-w-[120px]">{payrollResponse.sha.label}</span>
                                            </a>
                                        )}
                                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-400 cursor-not-allowed">
                                            <FileSpreadsheet className="h-4 w-4 shrink-0 text-purple-300" />
                                            HELB (soon)
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="mt-5 flex flex-wrap gap-3">
                                {[
                                    { icon: FileArchive, label: 'PAYE CSV+ZIP', desc: 'KRA-ready upload', color: 'text-[#ff0613]' },
                                    { icon: FileSpreadsheet, label: 'NSSF Workbook', desc: 'Contribution schedule', color: 'text-blue-500' },
                                    { icon: FileType, label: 'SHA Schedule', desc: 'Health authority format', color: 'text-sky-500' },
                                    { icon: FileSpreadsheet, label: 'HELB Remittance', desc: 'Coming soon', color: 'text-purple-400' },
                                ].map(item => (
                                    <div key={item.label} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                                        <item.icon className={`h-4 w-4 shrink-0 ${item.color}`} />
                                        <div>
                                            <div className="text-xs font-bold text-slate-900">{item.label}</div>
                                            <div className="text-[10px] text-slate-400">{item.desc}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Testimonials */}
                <section className="mx-auto max-w-7xl px-6 py-24">
                    <div data-animate id="test-head" className={fadeClass('test-head')}>
                        <div className="mx-auto max-w-2xl text-center">
                            <h2 className="text-3xl font-black tracking-tight sm:text-4xl text-slate-900">
                                Trusted by Kenyan accounting firms
                            </h2>
                            <p className="mt-4 text-lg text-slate-500">
                                See what practicing accountants say about Kwanta.ai.
                            </p>
                        </div>
                    </div>

                    <div className="mt-16 grid gap-6 sm:grid-cols-3">
                        {testimonials.map((t, i) => {
                            const id = `test-${i}`;
                            return (
                                <TiltCard key={t.name}>
                                    <div
                                        data-animate
                                        id={id}
                                        className={`rounded-2xl border border-slate-100 bg-white p-7 shadow-sm ${fadeClass(id)}`}
                                        style={{ transitionDelay: `${i * 100}ms` }}
                                    >
                                        <div className="flex gap-1 mb-4">
                                            {[...Array(t.rating)].map((_, j) => (
                                                <Star key={j} className="h-4 w-4 fill-[#ff0613] text-[#ff0613]" />
                                            ))}
                                        </div>
                                        <p className="text-sm leading-relaxed text-slate-600 italic">
                                            "{t.quote}"
                                        </p>
                                        <div className="mt-6 flex items-center gap-3">
                                            <div className="h-10 w-10 rounded-full bg-[#ff0613]/10 flex items-center justify-center text-[#ff0613] font-bold text-sm">
                                                {t.name.split(' ').map(n => n[0]).join('')}
                                            </div>
                                            <div>
                                                <div className="text-sm font-bold text-slate-900">{t.name}</div>
                                                <div className="text-xs text-slate-400">{t.title}, {t.firm}</div>
                                            </div>
                                        </div>
                                    </div>
                                </TiltCard>
                            );
                        })}
                    </div>
                </section>

                {/* Pricing Section */}
                <PricingSection />

                {/* CTA Section */}
                <section id="pricing-cta" className="mx-auto max-w-7xl px-6 py-24">
                    <div
                        data-animate
                        id="cta"
                        className={`relative overflow-hidden rounded-[2.5rem] border border-[#ff0613]/10 bg-gradient-to-br from-[#ff0613]/5 via-white to-white p-12 text-center lg:p-20 ${fadeClass('cta')}`}
                    >
                        <div className="absolute left-1/2 top-0 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff0613]/10 blur-[100px]" />
                        <div className="relative z-10">
                            <h2 className="text-3xl font-black tracking-tight sm:text-5xl text-slate-900">
                                Ready to automate your practice?
                            </h2>
                            <p className="mx-auto mt-6 max-w-xl text-lg text-slate-500">
                                Join 150+ Kenyan firms already using Kwanta.ai to file returns faster, track clients better,
                                and never miss a deadline.
                            </p>
                            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                                <Link
                                    to="/dashboard"
                                    className="inline-flex items-center gap-2 rounded-full bg-[#ff0613] px-8 py-4 text-base font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#d80000]"
                                >
                                    Get Started <ArrowRight className="h-5 w-5" />
                                </Link>
                                <Link
                                    to="/dashboard"
                                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-8 py-4 text-base font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                                >
                                    Open Dashboard
                                </Link>
                            </div>
                            <p className="mt-6 text-xs text-slate-400">
                                Simple pricing. Cancel anytime. Start filing in minutes.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Footer */}
                <footer className="border-t border-slate-100 bg-slate-50/50 py-12">
                    <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 sm:flex-row">
                        <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ff0613] text-white">
                                <Landmark className="h-4 w-4" />
                            </div>
                            <span className="text-lg font-black tracking-tight text-slate-900">
                                Kwanta<span className="text-[#ff0613]">.ai</span>
                            </span>
                        </div>
                        <p className="text-sm text-slate-400">
                            &copy; 2026 Kwanta.ai. Built for Kenyan finance teams.
                        </p>
                        <div className="flex gap-6 text-sm font-medium text-slate-500">
                            <a href="#features" className="transition hover:text-[#ff0613]">Features</a>
                            <a href="#workflow" className="transition hover:text-[#ff0613]">Workflow</a>
                            <Link to="/dashboard" className="transition hover:text-[#ff0613]">Dashboard</Link>
                        </div>
                    </div>
                </footer>
            </main>
        </div>
    );
}
