const fs = require('fs');
let c = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const regex = /const generatePayrollZip = async \([^]+\n    \};/;

const generateTotZipStr = \
    const generateTotZip = async (client: ClientObligation) => {
        const val = totInputVals[client.id];
        if (!val || isNaN(parseFloat(val))) {
            setDashboardNotice({ tone: 'error', message: 'Please enter a valid gross sales/turnover amount first.'});
            return;
        }
        
        try {
            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth() === 0 ? 12 : today.getMonth();
            const yearP = month === 12 ? year - 1 : year;
            
            const response = await apiFetch('/tax/generate-tot-zip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kraPin: client.pin,
                    year: yearP,
                    month: month,
                    turnover: parseFloat(val),
                    clientName: client.name
                })
            });
            
            if (!response.ok) {
                const errResult = await response.json().catch(() => ({}));
                throw new Error(errResult.error || 'Failed to generate TOT ZIP');
            }
            
            const data = await response.json();
            
            // Mark TOT specifically as generated
            setClients((current) => current.map((existingClient) => (
                existingClient.id === client.id
                    ? {
                        ...existingClient,
                        tot: 'generated',
                        lastGeneratedAt: new Date().toISOString(),
                        totZipUrl: data.totInfo?.url,
                        totZipLabel: data.totInfo?.label,
                    }
                    : existingClient
            )));
            setDashboardNotice({ tone: 'success', message: \\\Successfully generated TOT return ZIP for \\\\\\});
        } catch (error) {
            console.error('TOT generation error:', error);
            setDashboardNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Error generating TOT.'});
        }
    };
\;

c = c.replace(/const generatePayrollZip = async \([^]+\n    \};/, match => match + '\n\n' + generateTotZipStr);
fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', c);
console.log('patched handleTotZip function!');
