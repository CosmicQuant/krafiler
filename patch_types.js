const fs = require('fs');

// Patch backend types
let bTypes = fs.readFileSync('backend/src/types/index.ts', 'utf8');
if (!bTypes.includes('payeZipUrl?: string;')) {
    bTypes = bTypes.replace(/totMonth\?\: number;\n    totTurnover\?\: number;/, "totMonth?: number;\n    totTurnover?: number;\n    payeZipUrl?: string;");
    bTypes = bTypes.replace(/taxObligationType\: TaxObligationType;\n\}/g, "taxObligationType: TaxObligationType;\n    payeZipUrl?: string;\n}");
    fs.writeFileSync('backend/src/types/index.ts', bTypes);
}

// Patch frontend types
let fTypes = fs.readFileSync('frontend/src/types/index.ts', 'utf8');
if (!fTypes.includes('payeZipUrl?: string;')) {
    fTypes = fTypes.replace(/totTurnover\?\: number;/, "totTurnover?: number;\n    payeZipUrl?: string;");
    fs.writeFileSync('frontend/src/types/index.ts', fTypes);
}

console.log('Types patched!');
