const fs=require('fs'); 
let c=fs.readFileSync('frontend/src/components/PracticeDashboard.tsx','utf8'); 
c=c.replace("export type ClientObligation = {\\n    iTaxPassword?: string;\\n    sector?: string;", "export type ClientObligation = {\n    iTaxPassword?: string;\n    sector?: string;"); 
fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', c);
