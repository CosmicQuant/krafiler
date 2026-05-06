const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

if (!code.includes('  Cloud,')) {
    code = code.replace(/} from 'lucide-react';/g, "  Cloud,\n} from 'lucide-react';");
    fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
    console.log('Fixed Cloud import');
} else {
    console.log('Cloud already imported properly.');
}