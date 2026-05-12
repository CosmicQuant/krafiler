const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const targetRegex = /const handleAutoFileNssf = async \([\s\S]+?setDashboardNotice\(\{ tone: 'error', message: e\.message \}\);\s+\};/;

const replaceStr = `const handleAutoFileNssf = async (client: ClientObligation) => {
        if (!client.nssfFileUrl || !client.masterFileUrl) {
            setDashboardNotice({ tone: 'error', message: \`No NSSF File or Master CSV available for \${client.name}. Please generate ZIP first.\` });
            return;
        }

        setDashboardNotice({ tone: 'info', message: \`Starting NSSF Auto-filing for \${client.name}...\` });

        try {
            const payload = {
                nssfFileUrl: client.nssfFileUrl,
                masterFileUrl: client.masterFileUrl,
                period: "04/2026", // Mock or dynamic based on app state
            };

            const res = await apiFetch('/tax/file-nssf-return', {
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
                        [client.id]: {
                            id: dataResp.jobId,
                            state: duplicateState,
                            progress: prev[client.id]?.id === dataResp.jobId ? prev[client.id].progress : 0,
                            message: dataResp.message || 'A filing is already queued or active.',
                            failedReason: '',
                        },
                    }));
                    setDashboardNotice({ tone: 'info', message: dataResp.message || \`A filing is already queued for \${client.name}.\` });
                    return;
                }
                throw new Error(dataResp.message || dataResp.error || 'Failed to file NSSF.');
            }

            setActiveJobs((prev) => ({
                ...prev,
                [client.id]: {
                    id: dataResp.jobId,
                    state: 'waiting',
                    progress: 0,
                    message: 'Job queued...',
                    failedReason: '',
                },
            }));

            setDashboardNotice({ tone: 'success', message: \`NSSF auto-filing queued successfully for \${client.name}.\` });
        } catch(e: any) {
            setDashboardNotice({ tone: 'error', message: e.message });
        }
    };`;

code = code.replace(targetRegex, replaceStr);
fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('Done');
