const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const s1 = code.indexOf('tbody className=\'divide-y divide-slate-800 lg:hidden\'');
if (s1 === -1) {
  const t = code.split('tbody').slice(1).map(x => x.substring(0, 50));
  console.log('Cant find mobile table class. Available:', t);
} else {
  const e1 = code.indexOf('tbody className=\'hidden divide-y divide-slate-800 lg:table-row-group\'');
  console.log(code.substring(s1, e1));
}
