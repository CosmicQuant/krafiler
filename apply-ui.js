const fs = require('fs');

let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

// Replace Block 1 (Mobile view)
const block1Old = `<div className="flex items-center gap-2 w-full">
                                        <a href={client.masterFileUrl} target="_blank" rel="noreferrer" className="flex-1 flex items-center justify-center rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-600 hover:text-white transition">
                                            <FileSpreadsheet className="h-4 w-4 mr-2 shrink-0 text-slate-400" />
                                            <span className="truncate">{client.masterFileLabel || 'View Master CSV'}</span>
                                        </a>`;

const block1New = `<div className="flex flex-col gap-2 w-full">
                                        <div className="flex items-center gap-2 justify-end w-full">`;

const replace1Mid = `                                        <a href={client.masterFileUrl} target="_blank" rel="noreferrer" className="flex-1 flex w-full items-center justify-center rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-600 hover:text-white transition">
                                            <FileSpreadsheet className="h-4 w-4 mr-2 shrink-0 text-slate-400" />
                                            <span className="truncate">{client.masterFileLabel || 'View Master CSV'}</span>
                                        </a>
                                    </div>`;

// Search for the end of the mobile block (the closing div after the delete button)
const buttonBlockEndMobile = `>
                                                <Trash2 className="h-4 w-4 text-red-500 hover:text-red-400" />
                                            </button>
                                        )}
                                    </div>`;
const buttonBlockEndMobileNew = `>
                                                <Trash2 className="h-4 w-4 text-red-500 hover:text-red-400" />
                                            </button>
                                        )}
                                        </div>\n` + replace1Mid;

// We will use regex to capture the label and button
const mobileRegex = /<div className="flex items-center gap-2 w-full">\s*<a href=\{client\.masterFileUrl\}[^>]*>[\s\S]*?<\/a>\s*(<label[\s\S]*?<\/label>)\s*(\{client\.masterFileUrl && \([\s\S]*?<\/button>\s*\)\})\s*<\/div>/;

code = code.replace(mobileRegex, (match, label, button) => {
    return `<div className="flex flex-col gap-2 w-full">
                                        <div className="flex items-center gap-2 justify-end">
                                            ${label.trim()}
                                            ${button.trim()}
                                        </div>
                                        <a href={client.masterFileUrl} target="_blank" rel="noreferrer" className="flex-1 flex items-center justify-center rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-600 hover:text-white transition">
                                            <FileSpreadsheet className="h-4 w-4 mr-2 shrink-0 text-slate-400" />
                                            <span className="truncate">{client.masterFileLabel || 'View Master CSV'}</span>
                                        </a>
                                    </div>`;
});


const desktopRegex = /<div className="flex items-center gap-1\.5 max-w-\[160px\] md:max-w-\[240px\]">\s*<a href=\{client\.masterFileUrl\}[^>]*>[\s\S]*?<\/a>\s*(<label[\s\S]*?<\/label>)\s*(\{client\.masterFileUrl && \([\s\S]*?<\/button>\s*\)\})\s*<\/div>/;

code = code.replace(desktopRegex, (match, label, button) => {
    return `<div className="flex flex-col gap-1.5 max-w-[160px] md:max-w-[240px]">
                                            <div className="flex items-center gap-1.5 justify-end">
                                                ${label.trim()}
                                                ${button.trim()}
                                            </div>
                                            <a href={client.masterFileUrl} target="_blank" rel="noreferrer" className="flex flex-1 items-center gap-2 truncate rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition">
                                                <FileSpreadsheet className="h-3 w-3 shrink-0 text-slate-500" />
                                                <span className="truncate">{client.masterFileLabel || 'Open file'}</span>
                                            </a>
                                        </div>`;
});

fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
console.log('UI Updated.');
