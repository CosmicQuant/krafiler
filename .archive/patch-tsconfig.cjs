const fs = require('fs');
let code = fs.readFileSync('backend/tsconfig.json', 'utf-8');
code = code.replace(/"strict": true,/g, '"strict": true,\n    "esModuleInterop": true,');
fs.writeFileSync('backend/tsconfig.json', code);
console.log('Fixed tsconfig!');
