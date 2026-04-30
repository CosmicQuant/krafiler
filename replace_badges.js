
const fs = require('fs');
let content = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

content = content.replace(
    /<InteractiveStatusBadge\s+status=\{client\.paye\}\s+generatedAt=\{client\.lastGeneratedAt\}\s+onUpdateStatus=\{\(s\) => handleUpdateSingleStatus\(client\.id, 'paye', s\)\}\s*\/>/g,
    '<InteractiveStatusBadge status={client.paye} generatedAt={client.lastGeneratedAt} lastFiledDate={client.payeLastFiledDate} receiptUrl={client.payeReceiptUrl} onUpdateStatus={(s) => handleUpdateSingleStatus(client.id, \'paye\', s)} />'
);

content = content.replace(
    /<InteractiveStatusBadge\s+status=\{client\.nssf\}\s+generatedAt=\{client\.lastGeneratedAt\}\s+onUpdateStatus=\{\(s\) => handleUpdateSingleStatus\(client\.id, 'nssf', s\)\}\s*\/>/g,
    '<InteractiveStatusBadge status={client.nssf} generatedAt={client.lastGeneratedAt} lastFiledDate={client.nssfLastFiledDate} receiptUrl={client.nssfReceiptUrl} onUpdateStatus={(s) => handleUpdateSingleStatus(client.id, \'nssf\', s)} />'
);

content = content.replace(
    /<InteractiveStatusBadge\s+status=\{client\.sha\}\s+generatedAt=\{client\.lastGeneratedAt\}\s+onUpdateStatus=\{\(s\) => handleUpdateSingleStatus\(client\.id, 'sha', s\)\}\s*\/>/g,
    '<InteractiveStatusBadge status={client.sha} generatedAt={client.lastGeneratedAt} lastFiledDate={client.shaLastFiledDate} receiptUrl={client.shaReceiptUrl} onUpdateStatus={(s) => handleUpdateSingleStatus(client.id, \'sha\', s)} />'
);

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', content);
