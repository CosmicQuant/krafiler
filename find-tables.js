const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

let results = [];
let i = code.indexOf('<table');
while(i !== -1) {
    results.push(code.substring(i, code.indexOf('>', i) + 1));
    i = code.indexOf('<table', i + 1);
}
console.log(results.join('\n'));