const fs = require('fs');
const path = 'src/components/PracticeDashboard.tsx';
let data = fs.readFileSync(path, 'utf-8');

const regex = /const handleFileTot = async \([^]*?catch \(error\) \{[^]*?\}\n\s*\};/;
const match = data.match(regex);
if (match) {
    // we only replace the FIRST match with empty string, leaving the second one alone!
    data = data.replace(match[0], '');
    fs.writeFileSync(path, data, 'utf-8');
    console.log('Removed duplicate handleFileTot');
}
