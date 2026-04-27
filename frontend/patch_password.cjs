const fs = require('fs');
const filePath = 'C:/Users/ADMIN/Desktop/KRAFILER/frontend/src/components/PracticeDashboard.tsx';
let code = fs.readFileSync(filePath, 'utf8');

code = code.replace(
    /kraPassword: activeClient\.iTaxPassword\s*\|\|\s*"1234"/,
    `kraPassword: (activeClient as any).password || activeClient.iTaxPassword || "1234"`
);

fs.writeFileSync(filePath, code);
console.log('Password fetching fixed!');
