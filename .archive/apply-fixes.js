const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

if (!code.includes('Upload,')) {
    code = code.replace(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/, (match, p1) => {
        if (!p1.includes('Upload')) {
            return `import { ${p1.trim()}, Upload } from 'lucide-react'`;
        }
        return match;
    });
}

// Mobile View Replacements
while(code.includes('<div className="flex items-center gap-2 w-full">')) {
    const s = code.indexOf('<div className="flex items-center gap-2 w-full">');
    const e = code.indexOf('</div>', s + 100);
    // Let's replace the inner structure.
    code = code.replace(
        '<div className="flex items-center gap-2 w-full">',
        '<div className="flex flex-col gap-2 w-full"><div className="flex items-center gap-2 justify-end">'
    );
    // Now we need to close that wrapper. But wait, replacing `<div className="flex items-center gap-2 w-full">` and extracting link and buttons.
    break; // prevent infinite loop for now
}

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
