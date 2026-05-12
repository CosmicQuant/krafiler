const fs = require('fs');
const path = 'frontend/src/components/PracticeDashboard.tsx';
let data = fs.readFileSync(path, 'utf-8');

const target = '    const handleCancelAutoFile = async (client: ClientObligation) => {';
const handleFileTot = `
    const handleFileTot = async (client: ClientObligation) => {
        const amountStr = totInputVals[client.id];
        const amount = amountStr ? parseFloat(amountStr) : 0;
        if (isNaN(amount) || amount <= 0) {
            setDashboardNotice({ tone: 'error', message: \`Please enter a valid turnover amount for \${client.name}.\` });
            return;
        }

        setDashboardNotice({ tone: 'info', message: \`Starting TOT Auto-filing for \${client.name}... \` });
        try {
            const currentDate = new Date();
            currentDate.setMonth(currentDate.getMonth() - 1);
            const year = currentDate.getFullYear();
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            const periodFrom = \`\${year}-\${month}-01\`;
            const lastDay = new Date(year, currentDate.getMonth() + 1, 0).getDate();
            const periodTo = \`\${year}-\${month}-\${lastDay}\`;

            const payload = {
                kraPin: client.pin,
                kraPassword: (client as any).password || client.iTaxPassword || client.pin,
                periodFrom,
                periodTo,
                taxObligationType: "turnover_tax",
                totTurnover: amount,
                totYear: String(year),
                totMonth: String(currentDate.getMonth() + 1)
            };

            const res = await apiFetch('/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const dataResp = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (res.status === 409 && dataResp.jobId) {
                    const duplicateState = dataResp.jobState || 'waiting';
                    setActiveJobs((prev) => ({
                        ...prev,
                        [client.id]: { id: dataResp.jobId, state: duplicateState, progress: 0, message: 'Reconnected to running job.' }
                    }));
                    setDashboardNotice({ tone: 'info', message: 'Reconnected to an existing TOT job.' });
                } else {
                    throw new Error(dataResp.message || 'Auto-file request failed');
                }
            } else if (dataResp.jobId) {
                setActiveJobs((prev) => ({
                    ...prev,
                    [client.id]: { id: dataResp.jobId, state: 'waiting', progress: 0, message: 'TOT Job queued...' }
                }));
                setDashboardNotice({ tone: 'success', message: 'TOT filing job started successfully.' });
            }
        } catch (error) {
            console.error('Auto-file error:', error);
            setDashboardNotice({ tone: 'error', message: \`Failed to queue TOT filing for \${client.name}.\` });
        }
    };

`;

if (data.includes(target) && !data.includes('const handleFileTot = async')) {
    data = data.replace(target, handleFileTot + target);
    fs.writeFileSync(path, data, 'utf-8');
    console.log('Successfully injected handleFileTot!!!');
} else {
    console.log('Failed to find target or already injected');
}
