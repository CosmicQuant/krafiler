const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const regex = /const renderMatrixGrid = \(\) => \([\s\S]*?<\/tbody>[\s\S]*?<\/table>[\s\S]*?<\/div>[\s\S]*?<\/div>\n    \);/m;
const match = code.match(regex);
if(match) console.log('Match length:', match[0].length);
else console.log('Not found');
