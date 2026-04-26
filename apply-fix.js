const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const badBlock = `                    </tbody>
        const obligations: { client: any; type: string; status: TaxStatus }[] = [];
            <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Obligation</th>
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Required Data</th>
                                <th className="px-4 py-4 font-semibold uppercase tracking-wider">Computed Tax</th>
                </table>
                </div>
            </div>
        </div>
    );`;

const goodBlock = `                    </tbody>
                </table>
                </div>
            </div>
        </div>
    );`;

if (code.includes(badBlock)) {
    code = code.replace(badBlock, goodBlock);
    fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
    console.log('Fixed the dangling corrupt table tags and text!');
} else {
    // try to find it using regex or partial
    console.log('Could not find bad block to replace exactly. Let me use substring replacement');
    const start = code.indexOf(`                    </tbody>`);
    const end = code.indexOf(`    );`, start) + 6;
    if (start !== -1 && end !== -1 && end - start < 1000) {
        code = code.substring(0, start) + goodBlock + code.substring(end);
        fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
        console.log('Fixed using substring replacement!');
    }
}
