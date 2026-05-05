
const fs = require("fs");
let c = fs.readFileSync("frontend/src/components/PracticeDashboard.tsx", "utf8");
c = c.replace(
  /<td className="px-6 py-4">\s*<div className="flex gap-2">\s*<input\s*type="date"\s*value={sel.periodFrom}\s*onChange={\(e\) => setNilSelections\(prev => \({ \.\.\.prev, \[client\.id\]: { \.\.\.sel, periodFrom: e\.target\.value } }\)\)}\s*className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1\.5 text-xs text-white outline-none focus:border-amber-500"\s*\/>\s*<span className="flex items-center text-slate-500">-<\/span>\s*<input\s*type="date"\s*value={sel\.periodTo}\s*onChange={\(e\) => setNilSelections\(prev => \({ \.\.\.prev, \[client\.id\]: { \.\.\.sel, periodTo: e\.target\.value } }\)\)}\s*className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1\.5 text-xs text-white outline-none focus:border-amber-500"\s*\/>\s*<\/div>\s*<\/td>/,
  `<td className="px-6 py-4">
    <div className="flex flex-col gap-2">
        <div className="flex gap-2">
            <input
                type="date"
                value={sel.periodFrom}
                onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, periodFrom: e.target.value } }))}
                className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-amber-500"
            />
            <span className="flex items-center text-slate-500">-</span>
            <input
                type="date"
                value={sel.periodTo}
                onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, periodTo: e.target.value } }))}
                className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-amber-500"
            />
        </div>
        {(sel.type === "income_tax_resident_individual" || sel.type === "income_tax_non_resident_individual") && (
            <label className="flex items-center gap-2 mt-1 cursor-pointer w-max">
                <input 
                    type="checkbox"
                    checked={sel.ownsRentalProperty || false}
                    onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, ownsRentalProperty: e.target.checked } }))}
                    className="rounded bg-slate-800 border-slate-700 focus:ring-amber-500 accent-amber-500 h-3.5 w-3.5"
                />
                <span className="text-[11px] text-slate-400">Owns Rental Property?</span>
            </label>
        )}
    </div>
</td>`
);
fs.writeFileSync("frontend/src/components/PracticeDashboard.tsx", c);
console.log("patched!");

