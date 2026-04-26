const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const s = code.indexOf('const renderMatrixGrid = () => {');
const search = `                            )}
                        </tbody>
                    </table>
                </div>
            </div>`;

const pos = code.indexOf(search, s);
if(pos !== -1) {
   const before = code.substring(0, pos);
   const after = code.substring(pos + search.length);
   fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', before + search + '\n        </div>' + after);
   console.log('Done!');
} else {
    console.log('Not found');
}