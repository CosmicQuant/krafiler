const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

code = code.replace(/\]\);\s*\\n\s*const \[selectedClient/g, ']);\n    const [selectedClient');
fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('Fixed syntax!');
