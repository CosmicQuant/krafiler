const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/CompanyDetails.tsx', 'utf8');
code = code.replace(/client\[obs\]/g, "client[obs as keyof ClientObligation]");
fs.writeFileSync('frontend/src/components/CompanyDetails.tsx', code);
console.log('Fixed array indexing');
