const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const s = code.indexOf('const renderMatrixGrid = () => {');

const blockStr = `                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };`;

const replaceStr = `                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            </div>
        );
    };`;


if (code.includes(blockStr)) {
    code = code.replace(blockStr, replaceStr);
    fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', code);
    console.log('Fixed the div syntax error!');
} else {
    console.log('Block not found');
}
