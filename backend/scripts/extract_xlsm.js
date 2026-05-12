const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const WORKDIR = path.resolve(__dirname, '..');
const VAT_PATH = path.join(WORKDIR, 'VAT3_Return_XLSM.xlsm');
const OUT_DIR = path.join(WORKDIR, 'tmp', 'vat-xlsm-extract');

function ensureDir(d){ if(!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
ensureDir(OUT_DIR);

if(!fs.existsSync(VAT_PATH)){
  console.error('VAT workbook not found at', VAT_PATH);
  process.exit(2);
}

const zip = new AdmZip(VAT_PATH);
const entries = zip.getEntries();

// helper to get entry by name
function entry(name){ return entries.find(e => e.entryName === name); }

// 1) Read workbook.xml and workbook rels
const workbookXml = entry('xl/workbook.xml')?.getData().toString('utf8') || '';
const relsXml = entry('xl/_rels/workbook.xml.rels')?.getData().toString('utf8') || '';

// map rId to target
const relMatches = [...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)];
const ridToTarget = {};
for(const m of relMatches){ ridToTarget[m[1]] = m[2]; }

// parse sheets from workbook.xml
const sheetMatches = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];
const sheets = sheetMatches.map(m => ({ name: m[1], rId: m[2], target: ridToTarget[m[2]] || null }));

// resolve target paths to entry names (rels targets are relative to xl/)
sheets.forEach(s => {
  if(s.target){
    s.targetPath = path.posix.join('xl', s.target.replace(/^\/+/, ''));
  } else {
    s.targetPath = null;
  }
});

fs.writeFileSync(path.join(OUT_DIR, 'sheets.json'), JSON.stringify(sheets, null, 2));
console.log('Found sheets:', sheets.map(s=>s.name).join(', '));

// 2) Extract defined names
const definedNames = [...workbookXml.matchAll(/<definedName[^>]*>([\s\S]*?)<\/definedName>/g)].map(m=>{
  const nameMatch = m[0].match(/name="([^"]+)"/);
  return { raw: m[1].trim(), name: nameMatch ? nameMatch[1] : null };
});
fs.writeFileSync(path.join(OUT_DIR, 'definedNames.json'), JSON.stringify(definedNames, null, 2));

// 3) Extract formulas from each worksheet XML referenced
const formulas = [];
for(const s of sheets){
  if(!s.targetPath) continue;
  const entryObj = entry(s.targetPath);
  if(!entryObj) continue;
  const xml = entryObj.getData().toString('utf8');
  // find cell with formula: <c r="A1" ...>\n<f ...>FORMULA</f>
  const cellMatches = [...xml.matchAll(/<c[^>]*r="([^\"]+)"[^>]*>[\s\S]*?<f[^>]*>([\s\S]*?)<\/f>[\s\S]*?<\/c>/g)];
  for(const c of cellMatches){
    formulas.push({ sheet: s.name, cell: c[1], formula: c[2].trim() });
  }
}
fs.writeFileSync(path.join(OUT_DIR, 'formulas.json'), JSON.stringify(formulas, null, 2));

// Also create markdown summary
let md = '# Extracted Formulas\n\n';
for(const s of sheets){
  md += `## Sheet: ${s.name}\n\n`;
  const subs = formulas.filter(f=>f.sheet===s.name);
  if(subs.length===0){ md += '_No formulas found._\n\n'; continue; }
  for(const f of subs){
    md += `- ${f.cell}: ${f.formula}\n`;
  }
  md += '\n';
}
fs.writeFileSync(path.join(OUT_DIR, 'formulas.md'), md);
console.log('Extracted formulas into', path.join(OUT_DIR, 'formulas.md'));

// 4) Extract vbaProject.bin and do a heuristic extraction of text blocks containing VBA-like code
const vbaEntry = entry('xl/vbaProject.bin');
if(vbaEntry){
  const bin = vbaEntry.getData();
  const binPath = path.join(OUT_DIR, 'vbaProject.bin');
  fs.writeFileSync(binPath, bin);
  console.log('Wrote raw vbaProject.bin to', binPath);

  // Heuristic: split by null bytes and find segments with typical VBA tokens
  const parts = bin.toString('latin1').split('\u0000');
  const candidates = [];
  for(const p of parts){
    if(p.length < 50) continue;
    if(/\bSub\b|\bFunction\b|\bAttribute\b|\bEnd Sub\b|\bEnd Function\b|VB_/.test(p)){
      candidates.push(p.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''));
    }
  }

  // write out candidates
  const vbaDir = path.join(OUT_DIR, 'vba-modules');
  ensureDir(vbaDir);
  let idx = 0;
  for(const c of candidates){
    idx++;
    let filename = path.join(vbaDir, `module_${idx}.txt`);
    fs.writeFileSync(filename, c, 'utf8');
  }
  fs.writeFileSync(path.join(OUT_DIR, 'vba_candidates_count.txt'), String(candidates.length));
  console.log('Extracted', candidates.length, 'VBA-like text blocks to', vbaDir);
} else {
  console.log('No vbaProject.bin found in workbook.');
}

console.log('Done. Outputs in', OUT_DIR);
