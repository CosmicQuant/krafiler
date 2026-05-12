const fs = require('fs');
let code = fs.readFileSync('C:\\Users\\ADMIN\\Desktop\\KRAFILER\\frontend\\src\\components\\PracticeDashboard.tsx', 'utf8');

code = code.replace(
    /const payload = \{\s*kraPin: activeClient\.pin,\s*kraPassword: activeClient\.iTaxPassword \|\| "1234",\s*periodFrom: "01\/01\/2026", \/\/ mock\s*periodTo: "31\/01\/2026", \/\/ mock\s*taxObligationType: "paye",\s*payeZipUrl: activeClient\.payeZipUrl\s*\};/g,
    `const payload = {
                kraPin: activeClient.pin,
                kraPassword: activeClient.iTaxPassword || "1234",
                periodFrom: "2026-01-01", // mock Date format YYYY-MM-DD
                periodTo: "2026-01-31", // mock Date format YYYY-MM-DD
                taxObligationType: "paye",
                payeZipUrl: activeClient.payeZipUrl,
                ownsRentalProperty: false
            };`
);

fs.writeFileSync('C:\\Users\\ADMIN\\Desktop\\KRAFILER\\frontend\\src\\components\\PracticeDashboard.tsx', code);
console.log('Payload fixed!');
