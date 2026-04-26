const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

if (!code.includes('  Upload,')) {
    code = code.replace(/} from 'lucide-react';/g, "  Upload,\n} from 'lucide-react';");
    console.log('Fixed lucide-react import');
}

code = code.replace(/20th Desk/g, 'VAT & Monthly Returns');
code = code.replace(/20th desk/g, 'Monthly Returns');
code = code.replace(/Split-Timeline Desks/g, 'Tax Filing Desks');

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('Updated wording.');
