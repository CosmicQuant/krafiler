const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const regex = /<button className="inline-flex items-center gap-2 rounded-xl bg-emerald-500\/10 border border-emerald-500\/20 px-4 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500\/20 hover:text-emerald-300 transition shadow-sm drop-shadow mt-1">\s*Process Return\s*<\/button>/m;

const replaceWith = \<button 
    onClick={() => {
        if (ob.type === 'MRI') handleFileMri(ob.client);
        else alert('Filing for ' + ob.type + ' is coming soon!');
    }}
    disabled={isPendingFilingJob(activeJobs[ob.client.id])}
    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition shadow-sm drop-shadow mt-1 disabled:opacity-50 disabled:cursor-not-allowed">
    Process {ob.type} Return
</button>\;

let newCode = code.replace(regex, replaceWith);
if (newCode !== code) {
    fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', newCode, 'utf8');
    console.log("Success");
} else {
    console.log("Failed to match regex");
}
