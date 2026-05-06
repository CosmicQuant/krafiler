const fs = require('fs');

let cd = fs.readFileSync('frontend/src/components/CompanyDetails.tsx', 'utf8');
cd = cd.replace(/client: any;/, 'client: ClientObligation;');
fs.writeFileSync('frontend/src/components/CompanyDetails.tsx', cd);

let pd = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');
pd = pd.replace(/const \[etimsConnections, setEtimsConnections\].* \n/g, "");
pd = pd.replace(/const \[etimsModalClient, setEtimsModalClient\].* \n/g, "");
pd = pd.replace(/const \[etimsPassword, setEtimsPassword\].* \n/g, "");
pd = pd.replace(/const statsCount = {\n[^{}]*};\n/g, "");

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', pd);
