const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

if (!code.includes('monthlyReturnFilter')) {
    code = code.replace(
        /const \[view, setView\] = useState<DashboardView>\((.*?)\);/,
        `const [view, setView] = useState<DashboardView>($1);\n    const [monthlyReturnFilter, setMonthlyReturnFilter] = useState<'ALL' | 'VAT' | 'TOT' | 'MRI' | 'DST'>('VAT');`
    );
    console.log("Added toggle state");
}

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
