const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const fields = ['paye', 'nita', 'housingLevy', 'nssf', 'sha', 'eLevy']; // Assuming eLevy isn't an amount, but just looping through what we have. (Wait, eLevy is boolean/status). Let's stick to the main 5.
const fieldsToFix = ['paye', 'nita', 'housingLevy', 'nssf', 'sha'];

for (const f of fieldsToFix) {
  const fAmt = f + 'Amount';
  // Desktop
  code = code.replace(
    `{(client. !== undefined && client. !== null) ? <span className="text-[10px] font-bold text-slate-300">KES {client.${fAmt}.toLocaleString()}</span> : null}`,
    `{(client.${fAmt} !== undefined && client.${fAmt} !== null) ? <span className="text-[10px] font-bold text-slate-300">KES {client.${fAmt}.toLocaleString()}</span> : <span className="text-[10px] font-bold text-slate-500">KES 0</span>}`
  );
  // Desktop fallback if it was already partly fixed
  code = code.replace(
    `{(client.${fAmt} !== undefined && client.${fAmt} !== null) ? <span className="text-[10px] font-bold text-slate-300">KES {client.${fAmt}.toLocaleString()}</span> : null}`,
    `{(client.${fAmt} !== undefined && client.${fAmt} !== null) ? <span className="text-[10px] font-bold text-slate-300">KES {client.${fAmt}.toLocaleString()}</span> : <span className="text-[10px] font-bold text-slate-500">KES 0</span>}`
  );
  // Mobile
  code = code.replace(
    `{(client. !== undefined && client. !== null) ? <span className="text-[10px] text-slate-500">KES {client.${fAmt}.toLocaleString()}</span> : null}`,
    `{(client.${fAmt} !== undefined && client.${fAmt} !== null) ? <span className="text-[10px] text-slate-400">KES {client.${fAmt}.toLocaleString()}</span> : <span className="text-[10px] text-slate-500">KES 0</span>}`
  );
  // Mobile fallback
  code = code.replace(
    `{(client.${fAmt} !== undefined && client.${fAmt} !== null) ? <span className="text-[10px] text-slate-500">KES {client.${fAmt}.toLocaleString()}</span> : null}`,
    `{(client.${fAmt} !== undefined && client.${fAmt} !== null) ? <span className="text-[10px] text-slate-400">KES {client.${fAmt}.toLocaleString()}</span> : <span className="text-[10px] text-slate-500">KES 0</span>}`
  );
}

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('Fixed amounts using robust string replacements.');