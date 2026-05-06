const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const mriStatePattern = \const [newClientPassword, setNewClientPassword] = useState('');\;
const mriStateReplace = \const [newClientPassword, setNewClientPassword] = useState('');
  const [mriInput, setMriInput] = useState('');\;
code = code.replace(mriStatePattern, mriStateReplace);

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('Done Phase 2');
