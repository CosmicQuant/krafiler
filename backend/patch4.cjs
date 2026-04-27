const fs = require('fs');
let code = fs.readFileSync('../frontend/src/components/PracticeDashboard.tsx', 'utf8');

// Add activeJobs state
if (!code.includes('const [activeJobs, setActiveJobs] = useState')) {
    code = code.replace(
        /const \[generatingClientIds, setGeneratingClientIds\] = useState\<Record\<string, boolean\>\>\(\{\}\);/,
        `const [generatingClientIds, setGeneratingClientIds] = useState<Record<string, boolean>>({});
    const [activeJobs, setActiveJobs] = useState<Record<string, { id: string, state: string, progress: number, message: string, failedReason?: string }>>({});`
    );
}

// Add polling useEffect
if (!code.includes('useEffect(() => { const interval = setInterval(')) {
    const pollingCode = `
    useEffect(() => {
        const checkJobs = async () => {
            const currentJobs = { ...activeJobs };
            let hasChanges = false;

            for (const [clientId, job] of Object.entries(currentJobs)) {
                if (job.state === 'completed' || job.state === 'failed') continue;

                try {
                    const res = await fetch(\`http://localhost:3001/api/tax/filing-status/\${job.id}\`);
                    if (!res.ok) continue;
                    const data = await res.json();
                    
                    const newMessage = data.lastStep ? data.lastStep.log : 'Processing...';
                    if (currentJobs[clientId].state !== data.state || currentJobs[clientId].progress !== data.progress || currentJobs[clientId].message !== newMessage) {
                        currentJobs[clientId] = {
                            id: data.jobId,
                            state: data.state,
                            progress: data.progress || 0,
                            message: newMessage,
                            failedReason: data.failedReason || ''
                        };
                        hasChanges = true;
                    }
                } catch (e) {
                     // suppress network errors so UI doesn't crash
                }
            }

            if (hasChanges) {
                setActiveJobs((prev) => ({ ...prev, ...currentJobs }));
            }
        };

        const interval = setInterval(checkJobs, 2000);
        return () => clearInterval(interval);
    }, [activeJobs]);
    `;
    code = code.replace(/const handleGenerateClientZip = async/, pollingCode + '\n    const handleGenerateClientZip = async');
}

// Update handleAutoFile extraction 
    code = code.replace(
        /setDashboardNotice\(\{ tone: 'success', message: \`Auto-filing job queued successfully for \$\{client\.name\}\. Check terminal logs!\` \}\);/,
        `const dataResp = await res.json();
            setDashboardNotice({ tone: 'success', message: \`Auto-filing job queued successfully for \${client.name}.\` });
            setActiveJobs((prev) => ({ ...prev, [client.id]: { id: dataResp.jobId, state: 'waiting', progress: 0, message: 'Queueing job...', failedReason: '' } }));`
    );

// Render progress bar near the Auto File button
if (!code.includes('activeJobs[client.id] && (')) {
    code = code.replace(
        /<div className="flex flex-col sm:flex-row gap-2 mt-2">/g,
        `
                                {activeJobs[client.id] && (
                                    <div className="w-full mt-3 mb-3 bg-slate-900 border border-slate-700 rounded-lg p-2">
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                            <span className="text-[10px] text-slate-300 font-medium font-mono uppercase tracking-wider truncate">
                                                {activeJobs[client.id].state === 'completed' ? '✓ Finished' : activeJobs[client.id].state === 'failed' ? '⚠ Failed' : '⚙ Filing...'}
                                            </span>
                                            <span className="text-[10px] text-slate-400 font-mono">{activeJobs[client.id].progress}%</span>
                                        </div>
                                        <div className="w-full bg-slate-800 rounded-full h-1.5 mb-1 overflow-hidden">
                                            <div 
                                                className={\`h-1.5 rounded-full transition-all duration-500 \${activeJobs[client.id].state === 'completed' ? 'bg-emerald-500' : activeJobs[client.id].state === 'failed' ? 'bg-red-500' : 'bg-blue-500'}\`}
                                                style={{ width: \`\${Math.max(activeJobs[client.id].progress, 5)}%\` }}
                                            ></div>
                                        </div>
                                        <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                                            {activeJobs[client.id].state === 'failed' ? <span className="text-red-400">{activeJobs[client.id].failedReason || 'An error occurred during filing.'}</span> : activeJobs[client.id].message}
                                        </div>
                                    </div>
                                )}
                                <div className="flex flex-col sm:flex-row gap-2">` // Fixed the gap-2 mt-2 removal here
    );
}

fs.writeFileSync('../frontend/src/components/PracticeDashboard.tsx', code);
console.log('UI updated for job progress!');