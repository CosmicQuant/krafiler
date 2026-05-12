const fs = require('fs');
let code = fs.readFileSync('src/components/PracticeDashboard.tsx', 'utf8');

const handleAutoFileFn = `
    const handleAutoFile = async (client: ClientObligation) => {
        try {
            let activeClient = client;
            if (!activeClient.payeZipUrl && (activeClient.masterFileUrl || activeClient.payrollSourceUrl)) {
                setDashboardNotice({ tone: 'info', message: \`Generating required ZIP files before filing for \${client.name}...\` });
                
                const sourceUrl = activeClient.masterFileUrl || activeClient.payrollSourceUrl;
                const sourceResponse = await fetch(sourceUrl as string, { cache: 'no-store' });
                if (!sourceResponse.ok) throw new Error(\`Could not load payroll CSV\`);
                const payrollFile = await sourceResponse.blob();
                
                const formData = new FormData();
                formData.append('payrollFile', payrollFile, \`\${client.name.replace(/\\s+/g, '_')}_Unified_Payroll.csv\`);
                formData.append('generatePaye', 'true');
                formData.append('generateNssf', 'true');
                formData.append('generateSha', 'true');
                formData.append('clientName', client.name);
                formData.append('clientId', client.id);

                const response = await fetch('http://localhost:3001/api/payroll/generate-unified', {
                    method: 'POST',
                    body: formData,
                });
                
                if (!response.ok) throw new Error('Failed to generate payroll ZIP.');
                const data = await response.json();
                
                activeClient = {
                    ...activeClient,
                    payeZipUrl: data.paye?.url
                };

                setClients((current) => current.map(c => 
                    c.id === client.id ? { ...c, payeZipUrl: data.paye?.url } : c
                ));
            }

            if (!activeClient.payeZipUrl) {
                throw new Error("No PAYE ZIP available to upload.");
            }

            setDashboardNotice({ tone: 'info', message: \`Dispatching KRA filing job for \${client.name}...\` });
            
            const payload = {
                kraPin: activeClient.pin,
                kraPassword: activeClient.iTaxPassword || "1234",
                periodFrom: "01/01/2026", // mock
                periodTo: "31/01/2026", // mock
                taxObligationType: "paye",
                payeZipUrl: activeClient.payeZipUrl 
            };

            const res = await fetch('http://localhost:3001/api/tax/file-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                 const err = await res.json().catch(()=>({}));
                 throw new Error(err.error || 'Failed to queue filing job.');
            }

            setDashboardNotice({ tone: 'success', message: \`Auto-filing job queued successfully for \${client.name}. Check terminal logs!\` });
        } catch(e: any) {
            setDashboardNotice({ tone: 'error', message: e.message });
        }
    };
`;

code = code.replace(/const handleGenerateAllZips = async \(\) => \{[\s\S]*?setIsGeneratingZips\(false\);\n        \}\n    \};\n?/, '$&\n' + handleAutoFileFn);

// Delete unused vars to fix TS errors
code = code.replace(/const \[etimsConnections, setEtimsConnections\] = useState.*?;\n/g, '');
code = code.replace(/const \[etimsModalClient, setEtimsModalClient\] = useState.*?;\n/g, '');
code = code.replace(/const \[etimsPassword, setEtimsPassword\] = useState.*?;\n/g, '');
code = code.replace(/const statsCount = \{[\s\S]*?\}\;\n/g, '');

fs.writeFileSync('src/components/PracticeDashboard.tsx', code);
console.log('Frontend dashboard patched properly!');
