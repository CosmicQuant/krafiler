import { ArrowDownLeft, ArrowUpRight, Calculator, Receipt } from 'lucide-react';

export type VatBreakdownItem = {
  label: string;
  base: number;
  vat: number;
  rate: number;
};

export type VatSummaryCardProps = {
  sales?: VatBreakdownItem[];
  purchases?: VatBreakdownItem[];
  previousCredit: number;
  netVatBalance: number;
};

function formatMoney(value: number): string {
  return value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(rate: number): string {
  if (rate === 0) return '0.00%';
  return `${(rate * 100).toFixed(2)}%`;
}

function SectionTable({
  title,
  icon,
  items,
  totalBase,
  totalVat,
  colorClass,
}: {
  title: string;
  icon: React.ReactNode;
  items: VatBreakdownItem[];
  totalBase: number;
  totalVat: number;
  colorClass: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-3 border-b border-slate-700/50 ${colorClass} bg-opacity-10`}>
        {icon}
        <h4 className="text-sm font-bold text-white tracking-wide">{title}</h4>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700/40">
            <th className="px-4 py-2 text-left font-semibold">Description</th>
            <th className="px-4 py-2 text-right font-semibold">Amount (Excl. VAT)</th>
            <th className="px-4 py-2 text-right font-semibold">Rate</th>
            <th className="px-4 py-2 text-right font-semibold">VAT Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/30">
          {items.map((item, idx) => (
            <tr key={idx} className="hover:bg-slate-800/40 transition">
              <td className="px-4 py-2.5 text-slate-300 font-medium">{item.label}</td>
              <td className="px-4 py-2.5 text-right text-slate-200 font-semibold tabular-nums">
                KES {formatMoney(item.base)}
              </td>
              <td className="px-4 py-2.5 text-right text-slate-400 tabular-nums">{formatPercent(item.rate)}</td>
              <td className="px-4 py-2.5 text-right text-slate-200 font-semibold tabular-nums">
                KES {formatMoney(item.vat)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-800/40 border-t border-slate-700/60">
          <tr>
            <td className="px-4 py-3 text-slate-300 font-bold">Total</td>
            <td className="px-4 py-3 text-right text-white font-bold tabular-nums">KES {formatMoney(totalBase)}</td>
            <td className="px-4 py-3 text-right text-slate-500">—</td>
            <td className="px-4 py-3 text-right text-white font-bold tabular-nums">KES {formatMoney(totalVat)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function VatSummaryCard({ sales = [], purchases = [], previousCredit, netVatBalance }: VatSummaryCardProps) {
  const totalSalesBase = sales.reduce((sum, s) => sum + s.base, 0);
  const totalSalesVat = sales.reduce((sum, s) => sum + s.vat, 0);
  const totalPurchasesBase = purchases.reduce((sum, p) => sum + p.base, 0);
  const totalPurchasesVat = purchases.reduce((sum, p) => sum + p.vat, 0);

  const isPayable = netVatBalance >= 0;
  const balanceLabel = isPayable ? 'VAT Payable' : 'Credit Balance';
  const balanceValue = Math.abs(netVatBalance);
  const balanceColor = isPayable ? 'text-blue-400' : 'text-emerald-400';
  const balanceBg = isPayable ? 'bg-blue-500/10 border-blue-500/20' : 'bg-emerald-500/10 border-emerald-500/20';

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-700/60 bg-slate-950/50 p-5 shadow-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-indigo-400" />
          <h3 className="text-base font-bold text-white">VAT Return Summary</h3>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Auto-populated from KRA</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionTable
          title="Section M — Sales (Goods and Services)"
          icon={<ArrowUpRight className="h-4 w-4 text-rose-400" />}
          items={sales}
          totalBase={totalSalesBase}
          totalVat={totalSalesVat}
          colorClass="bg-rose-500"
        />
        <SectionTable
          title="Section N — Purchases (Goods and Services)"
          icon={<ArrowDownLeft className="h-4 w-4 text-emerald-400" />}
          items={purchases}
          totalBase={totalPurchasesBase}
          totalVat={totalPurchasesVat}
          colorClass="bg-emerald-500"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Output VAT</div>
          <div className="text-sm font-bold text-rose-400 tabular-nums">KES {formatMoney(totalSalesVat)}</div>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Input VAT</div>
          <div className="text-sm font-bold text-emerald-400 tabular-nums">KES {formatMoney(totalPurchasesVat)}</div>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Previous Credit</div>
          <div className="text-sm font-bold text-slate-300 tabular-nums">KES {formatMoney(previousCredit)}</div>
        </div>
      </div>

      <div className={`flex items-center justify-between rounded-xl border px-5 py-4 ${balanceBg}`}>
        <div className="flex items-center gap-2">
          <Receipt className={`h-5 w-5 ${balanceColor}`} />
          <span className={`text-sm font-bold ${balanceColor}`}>{balanceLabel}</span>
          <span className="text-[10px] text-slate-500">(After credit applied)</span>
        </div>
        <span className={`text-xl font-black tabular-nums ${balanceColor}`}>
          KES {formatMoney(balanceValue)}
        </span>
      </div>
    </div>
  );
}
