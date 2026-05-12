const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/CompanyDetails.tsx', 'utf8');
code = code.replace("import { ClientObligation } from '../types';", "import { ClientObligation } from './PracticeDashboard';");
code = code.replace(/import React,\s*\{ useState \}/, "import { useState }");
code = code.replace(", Briefcase,", ",");
fs.writeFileSync('frontend/src/components/CompanyDetails.tsx', code);

let pd = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');
pd = pd.replace("useState<Client | null>", "useState<any | null>");
fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', pd);

console.log("Types fixed.");
