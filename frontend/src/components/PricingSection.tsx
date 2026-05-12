import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { motion } from 'framer-motion';

type Category = 'individuals' | 'accountants';
type Billing = 'monthly' | 'annual';

const pricingData = {
    individuals: [
        {
            name: 'Basic',
            description: 'For individuals and small setups filing a single PIN.',
            monthlyPrice: 0,
            annualPrice: 0,
            features: ['1 KRA PIN Supported', 'Basic Nil & VAT Filing', 'Standard Email Support']
        },
        {
            name: 'Pro',
            description: 'Perfect for growing businesses needing payroll & tax.',
            monthlyPrice: 15,
            annualPrice: 12,
            features: ['1 KRA PIN Supported', 'Payroll, NSSF, SHA Generation', 'Priority Support', 'Tax Compliance Alerts']
        },
        {
            name: 'Premium',
            description: 'Advanced features for maximum compliance security.',
            monthlyPrice: 35,
            annualPrice: 28,
            features: ['1 KRA PIN Supported', 'Automated Reminders', 'Audit Defense Consultation', 'Dedicated Account Manager']
        }
    ],
    accountants: [
        {
            name: 'Starter',
            description: 'For independent accountants starting their practice.',
            monthlyPrice: 40,
            annualPrice: 32,
            features: ['Up to 10 Client PINs', 'Bulk Nil Returns', 'Client Dashboard', 'Email Support']
        },
        {
            name: 'Growth',
            description: 'For mid-sized firms managing multiple clients.',
            monthlyPrice: 90,
            annualPrice: 72,
            features: ['Up to 50 Client PINs', 'Advanced Bulk Processing', 'Role-based Access', 'Priority Support']
        },
        {
            name: 'Scale',
            description: 'Designed for large auditing and accounting firms.',
            monthlyPrice: 200,
            annualPrice: 160,
            features: ['Unlimited Client PINs', 'White-labeled Reports', 'API Access', 'Dedicated Success Manager']
        }
    ]
};

export default function PricingSection() {
    const [category, setCategory] = useState<Category>('individuals');
    const [billing, setBilling] = useState<Billing>('monthly');

    const currentPlans = pricingData[category];

    return (
        <section id="pricing" className="scroll-mt-24 pt-16 pb-24">
            <div className="text-center max-w-3xl mx-auto px-6 mb-12">
                <h2 className="text-4xl font-black tracking-[-0.05em] text-slate-950 sm:text-5xl">
                    Simple, transparent pricing
                </h2>
                <p className="mt-4 text-lg text-slate-600">
                    Whether you are filing for yourself or managing hundreds of clients, we have a plan for you.
                </p>
                
                {/* Toggles Container */}
                <div className="mt-8 flex flex-col items-center gap-6">
                    {/* Category Toggle */}
                    <div className="inline-flex rounded-full bg-slate-200 p-1">
                        <button
                            onClick={() => setCategory('individuals')}
                            className={`rounded-full px-6 py-2.5 text-sm font-bold transition-all ${category === 'individuals' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                            Individuals & Companies
                        </button>
                        <button
                            onClick={() => setCategory('accountants')}
                            className={`rounded-full px-6 py-2.5 text-sm font-bold transition-all ${category === 'accountants' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                            Accountants & Auditors
                        </button>
                    </div>

                    {/* Billing Toggle */}
                    <div className="flex items-center gap-3">
                        <span className={`text-sm font-bold ${billing === 'monthly' ? 'text-slate-900' : 'text-slate-500'}`}>Monthly</span>
                        <button 
                            onClick={() => setBilling(b => b === 'monthly' ? 'annual' : 'monthly')}
                            className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 aria-checked:bg-slate-900"
                            role="switch"
                            aria-checked={billing === 'annual'}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${billing === 'annual' ? 'translate-x-6' : 'translate-x-1'}`}
                            />
                        </button>
                        <span className={`text-sm font-bold flex items-center gap-1.5 ${billing === 'annual' ? 'text-slate-900' : 'text-slate-500'}`}>
                            Annual
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">Save 20%</span>
                        </span>
                    </div>
                </div>
            </div>

            <div className="mx-auto max-w-6xl px-6 grid gap-8 lg:grid-cols-3">
                {currentPlans.map((plan, idx) => (
                    <motion.div 
                        key={plan.name}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: idx * 0.1, duration: 0.4 }}
                        className="relative flex flex-col rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
                    >
                        <div className="mb-6">
                            <h3 className="text-xl font-black tracking-tight text-slate-950">{plan.name}</h3>
                            <p className="mt-2 text-sm text-slate-500 min-h-[40px]">{plan.description}</p>
                        </div>
                        
                        <div className="mb-6 flex items-baseline gap-2">
                            <span className="text-4xl font-black tracking-tight text-slate-950">
                                ${billing === 'monthly' ? plan.monthlyPrice : plan.annualPrice}
                            </span>
                            <span className="text-sm font-semibold text-slate-500">/mo</span>
                        </div>
                        
                        {billing === 'annual' && plan.monthlyPrice > 0 && (
                            <p className="mb-6 text-sm font-semibold text-green-600">
                                Billed ${plan.annualPrice * 12} yearly
                            </p>
                        )}
                        {plan.monthlyPrice === 0 && (
                             <p className="mb-6 text-sm font-semibold text-slate-400">Free forever</p>
                        )}
                        {billing === 'monthly' && plan.monthlyPrice > 0 && (
                             <p className="mb-6 text-sm font-semibold text-white/0 select-none">Spacer</p>
                        )}

                        <ul className="mb-8 flex-1 space-y-4">
                            {plan.features.map(feature => (
                                <li key={feature} className="flex items-start gap-3 text-sm font-medium text-slate-700">
                                    <CheckCircle className="h-5 w-5 shrink-0 text-slate-900" />
                                    <span>{feature}</span>
                                </li>
                            ))}
                        </ul>

                        <button className="w-full rounded-2xl bg-slate-950 py-3.5 text-sm font-bold text-white transition-colors hover:bg-slate-800">
                            Get started
                        </button>
                    </motion.div>
                ))}
            </div>
        </section>
    );
}
