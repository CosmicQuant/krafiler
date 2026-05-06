const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');
const searchStr = '{client.masterFileUrl ? (';
let pos = 0;
while (true) {
    pos = code.indexOf(searchStr, pos);
    if (pos === -1) break;
    const block = code.substring(pos, pos + 1000);
    if (block.includes('confirmDeleteCsv')) {
       console.log("BLOCK FOUND AT", pos);
       console.log(block.substring(0, 850));
       console.log("-----------------------");
    }
    pos += searchStr.length;
}