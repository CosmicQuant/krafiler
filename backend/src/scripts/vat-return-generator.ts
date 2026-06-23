import { createHash } from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const csv = require('csv-parser');
const AdmZip = require('adm-zip');

function resolveBackendRoot(): string {
    const candidates = [
        path.resolve(__dirname, '../..'),
        path.resolve(__dirname, '../../..'),
        path.resolve(process.cwd()),
        path.resolve(process.cwd(), 'backend'),
    ];

    const match = candidates.find((candidate) => fsSync.existsSync(path.join(candidate, 'VAT3_Return_XLSM.xlsm')));
    return match || path.resolve(__dirname, '../..');
}

function resolveWorkspaceRoot(backendRoot: string): string {
    const candidates = [
        path.resolve(backendRoot, '..'),
        path.resolve(process.cwd()),
        path.resolve(process.cwd(), '..'),
    ];

    const match = candidates.find(
        (candidate) => fsSync.existsSync(path.join(candidate, 'backend')) && fsSync.existsSync(path.join(candidate, 'frontend')),
    );

    return match || path.resolve(backendRoot, '..');
}

const BACKEND_ROOT = resolveBackendRoot();
const WORKSPACE_ROOT = resolveWorkspaceRoot(BACKEND_ROOT);
const VAT_TEMPLATE_PATH = path.join(BACKEND_ROOT, 'VAT3_Return_XLSM.xlsm');
const VAT_TMP_ROOT = path.join(BACKEND_ROOT, 'tmp', 'vat-returns');

type CsvRow = string[];

type PreparedVatLineItem = {
    values: string[];
    taxableAmount: number;
    vatAmount: number;
};

export type VatBreakdownItem = {
    label: string;
    base: number;
    vat: number;
    rate: number;
};

export type PreparedVatReturnSummary = {
    inputVat: number;
    outputVat: number;
    previousCredit: number;
    withholdingAmount: number;
    payableVat: number;
    netVatBalance: number;
    sales?: VatBreakdownItem[];
    purchases?: VatBreakdownItem[];
};

export type PreparedVatReturnArtifacts = {
    generatedZipPath: string;
    generatedZipUrl: string;
    generatedZipLabel: string;
    sourcePackagePath: string;
    sourcePackageUrl: string;
    sourcePackageLabel: string;
    summary: PreparedVatReturnSummary;
    vatSummary: PreparedVatReturnSummary;
    namedValues: Record<string, string>;
    generatedFiles: string[];
    autoPopulationSucceeded: boolean;
};

export type PrepareVatReturnParams = {
    sourceZipPath: string;
    clientName: string;
    taxpayerPin: string;
    periodFrom: string;
    periodTo: string;
    previousCredit: number;
    /** User-entered taxable sales to non-VAT-registered buyers, added to Section B without-PIN totals */
    sectionBWithoutPinSales?: number;
};

function sanitizeClientName(clientName: string): string {
    return clientName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'Generated_Client';
}

function formatArtifactTimestamp(date = new Date()): string {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${dd}-${mm}-${yyyy}_${hh}-${min}-${ss}`;
}

function round(value: number, decimals = 2): number {
    const multiplier = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function getVatRate(rateCode: string): number {
    switch (rateCode) {
        case 'GNRL': return 0.16;
        case 'OTHR': return 0.08;
        case 'ZERO': return 0.00;
        case 'EXEM': return 0.00;
        case 'IMPT': return 0.16;
        default: return 0.16;
    }
}

function formatXmlNumber(value: number, decimals = 4): string {
    if (!Number.isFinite(value)) {
        return '0';
    }

    const fixed = round(value, decimals).toFixed(decimals);
    return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatKraDate(isoDate: string): string {
    // Parse YYYY-MM-DD directly to avoid timezone shifts.
    // new Date('2026-04-01') is parsed as UTC midnight; in timezones west of UTC
    // getDate() can return the previous day (e.g. 31/03 instead of 01/04).
    const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        const [, yyyy, mm, dd] = match;
        return `${dd}/${mm}/${yyyy}`;
    }
    // Fallback for non-ISO strings
    const date = new Date(isoDate);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function parseAmount(rawValue: string | undefined): number {
    if (!rawValue || rawValue.trim().length === 0) {
        return 0;
    }

    const parsed = Number(rawValue.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeInvoiceNumber(value: string): string {
    return value.replace(/^\|/, '').trim();
}

// Credit-note rows in KRA source CSVs have two extra trailing columns:
//   column J (index 9) = credit-note invoice number
//   column K (index 10) = credit-note date
function getCreditNoteColumns(row: CsvRow): { cnInvoice: string; cnDate: string } {
    return {
        cnInvoice: normalizeInvoiceNumber(row[9] || ''),
        cnDate: (row[10] || '').trim(),
    };
}

function normalizeName(value: string, lookup: Map<string, string>, key: string): string {
    const trimmed = value.trim();
    if (trimmed) {
        lookup.set(key, trimmed);
        return trimmed;
    }

    return lookup.get(key) || '';
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

async function ensureDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
}

async function readCsvRows(filePath: string): Promise<CsvRow[]> {
    if (!fsSync.existsSync(filePath)) {
        return [];
    }

    return new Promise<CsvRow[]>((resolve, reject) => {
        const rows: CsvRow[] = [];
        fsSync
            .createReadStream(filePath)
            .pipe(csv({ headers: false }))
            .on('data', (record: Record<string, string>) => {
                const values = Object.keys(record)
                    .sort((left, right) => Number(left) - Number(right))
                    .map((key) => String(record[key] ?? ''));

                if (values.every((value) => value.trim().length === 0)) {
                    return;
                }

                rows.push(values);
            })
            .on('end', () => resolve(rows))
            .on('error', reject);
    });
}

type ExtractVatPackageResult =
    | { kind: 'csv'; nestedCsvDir: string; xlsFilePath: string }
    | { kind: 'xls-only'; nestedCsvDir: null; xlsFilePath: string };

function findXlsFile(outputDir: string): string | undefined {
    const extractedFiles = fsSync.readdirSync(outputDir);
    return extractedFiles.find((f) => f.toLowerCase().endsWith('.xls') || f.toLowerCase().endsWith('.xlsx'));
}

type DepositDates = {
    depositStartDate: string;
    depositStartDatePid: string;
};

function parseSingleCellValue(sheetXml: string): Record<string, string> {
    const singleCellMatch = sheetXml.match(/<SingleCellValue>([^<]*)<\/SingleCellValue>/);
    if (!singleCellMatch) {
        return {};
    }

    const raw = singleCellMatch[1];
    const values: Record<string, string> = {};
    // Entries are separated by @P_@ and each entry is name%V_@value
    const entries = raw.split('@P_@');
    for (const entry of entries) {
        const separatorIndex = entry.indexOf('%V_@');
        if (separatorIndex === -1) {
            continue;
        }
        const name = entry.slice(0, separatorIndex);
        const value = entry.slice(separatorIndex + '%V_@'.length);
        if (name) {
            values[name] = value;
        }
    }
    return values;
}

function extractDepositDatesFromXls(xlsFilePath: string): DepositDates | null {
    try {
        const content = fsSync.readFileSync(xlsFilePath, 'utf8');
        const values = parseSingleCellValue(content);
        const depositStartDate = values['RetInf.DepositStartDate'];
        const depositStartDatePid = values['RetInf.DepositStartDatePID'];
        if (depositStartDate && depositStartDatePid) {
            return { depositStartDate, depositStartDatePid };
        }
    } catch (err: any) {
        console.warn(`Failed to extract deposit dates from ${xlsFilePath}: ${err.message}`);
    }
    return null;
}

async function extractVatPackage(sourceZipPath: string, outputDir: string): Promise<ExtractVatPackageResult> {
    // Verify the downloaded file is actually a ZIP
    const fileBuffer = fsSync.readFileSync(sourceZipPath);
    const isZip = fileBuffer.length >= 4 &&
        fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4B &&
        fileBuffer[2] === 0x03 && fileBuffer[3] === 0x04;

    if (!isZip) {
        throw new Error(
            `Downloaded file is not a valid ZIP archive. ` +
            `The automation likely clicked the wrong download button (e.g., a template link instead of "Download Autopopulated VAT Return"). ` +
            `Please check the KRA portal page structure — the correct button should download a ZIP containing csv.zip inside.`
        );
    }

    const outerZip = new AdmZip(sourceZipPath);
    outerZip.extractAllTo(outputDir, true);

    const xlsFile = findXlsFile(outputDir);
    const xlsFilePath = xlsFile ? path.join(outputDir, xlsFile) : undefined;

    const nestedZipPath = path.join(outputDir, 'csv.zip');
    if (fsSync.existsSync(nestedZipPath)) {
        const nestedDir = path.join(outputDir, 'nested-csv');
        await ensureDirectory(nestedDir);
        const nestedZip = new AdmZip(nestedZipPath);
        nestedZip.extractAllTo(nestedDir, true);
        if (!xlsFilePath) {
            throw new Error(
                `Downloaded VAT package contained csv.zip but no .xls workbook. ` +
                `Extracted contents: [${fsSync.readdirSync(outputDir).join(', ')}].`
            );
        }
        return { kind: 'csv', nestedCsvDir: nestedDir, xlsFilePath };
    }

    // Some clients have no transactions for the period. KRA then returns a ZIP
    // that contains only the .xls workbook (no nested csv.zip). In that case we
    // generate a no-transaction VAT return using only the credit brought forward.
    if (xlsFilePath) {
        return { kind: 'xls-only', nestedCsvDir: null, xlsFilePath };
    }

    throw new Error(
        `Downloaded VAT package did not contain the nested csv.zip file and no .xls workbook was found. ` +
        `Extracted contents: [${fsSync.readdirSync(outputDir).join(', ')}]. ` +
        `This usually means the wrong download button was clicked — ` +
        `the "Download Autopopulated VAT Return" button should produce a ZIP with csv.zip inside, ` +
        `but template download links only produce an .xls file.`
    );
}

async function discoverVatSections(nestedCsvDir: string): Promise<{ [key: string]: string[] }> {
    const files = await fs.readdir(nestedCsvDir);
    const csvFiles = files.filter((f) => f.endsWith('.CSV'));
    const sections: { [key: string]: string[] } = {};

    for (const file of csvFiles) {
        // Match patterns like SEC_B_WITH_VAT_PIN1.CSV, SEC_D1_WITH_VAT_PIN1.CSV, SEC_H_ZERO_RATED_PIN1.CSV, etc.
        const match = file.match(/^SEC_([A-Z]\d*)_(.+?)(?:_PIN\d+)?\.CSV$/i);
        if (match) {
            const sectionLetter = match[1].toUpperCase();
            if (!sections[sectionLetter]) {
                sections[sectionLetter] = [];
            }
            sections[sectionLetter].push(path.join(nestedCsvDir, file));
        }
    }

    return sections;
}

function findAmountInRow(row: CsvRow): number {
    // Source CSVs place the amount at different positions.
    // Scan from the right for the first non-zero numeric value.
    // Credit notes appear as negative amounts and must be included.
    for (let i = row.length - 1; i >= 0; i--) {
        const val = parseAmount(row[i]);
        if (val !== 0 && !Number.isNaN(val)) {
            return val;
        }
    }
    return 0;
}

function mapSectionRows(params: {
    rows: CsvRow[];
    section: 'B' | 'C' | 'D1' | 'D2' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';
}): { lines: PreparedVatLineItem[]; totalBase: number; totalVat: number } {
    const { rows, section } = params;
    const lookup = new Map<string, string>();
    const lines: PreparedVatLineItem[] = [];
    let totalBase = 0;
    let totalVat = 0;

    for (const row of rows) {
        const taxableAmount = findAmountInRow(row);
        if (taxableAmount === 0) {
            continue;
        }

        let values: string[] = [];
        let vatAmount = 0;

        // Credit-note rows carry two extra trailing columns in the source CSVs:
        //   column J (index 9) = credit-note invoice number
        //   column K (index 10) = credit-note date
        const { cnInvoice, cnDate } = getCreditNoteColumns(row);
        const hasCreditNoteColumns = cnInvoice.length > 0 || cnDate.length > 0;

        switch (section) {
            case 'B':
            case 'C': {
                // Sales with PIN (10-col source; credit notes add J/K)
                // Output: 11 cols [PIN, Name, OurPIN, Date, Invoice, Desc, Amount, VAT, CN invoice, CN date, Rate]
                const rate = section === 'B' ? 0.16 : 0.08;
                vatAmount = round(taxableAmount * rate, 4);
                const pin = (row[0] || '').trim();
                values = [
                    pin,
                    normalizeName(row[1] || '', lookup, pin),
                    (row[2] || '').trim(),
                    (row[3] || '').trim(),
                    normalizeInvoiceNumber(row[4] || ''),
                    (row[5] || '').trim(),
                    formatXmlNumber(taxableAmount, 4),
                    formatXmlNumber(vatAmount, 4),
                    cnInvoice,
                    cnDate,
                    section === 'B' ? 'GNRL' : 'OTHR',
                ];
                break;
            }
            case 'D1':
            case 'D2': {
                // Zero-rated sales (10-col source; credit notes add J/K)
                // Output: 13 cols [PIN, Name, OurPIN, Date, Invoice, Desc, Amount, 0, empty, CN invoice, CN date, empty, ZERO]
                const pin = (row[1] || '').trim();
                values = [
                    pin,
                    normalizeName(row[2] || '', lookup, pin),
                    (row[3] || '').trim(),
                    (row[4] || '').trim(),
                    normalizeInvoiceNumber(row[5] || ''),
                    (row[6] || '').trim(),
                    formatXmlNumber(taxableAmount, 4),
                    '0',
                    '',
                    cnInvoice,
                    cnDate,
                    '',
                    'ZERO',
                ];
                break;
            }
            case 'E': {
                // Exempt sales (10-col source; credit notes add J/K)
                // Output: 13 cols [PIN, Name, OurPIN, Date, Invoice, Desc, Amount, 0, empty, CN invoice, CN date, empty, EXEMPT]
                const pin = (row[0] || '').trim();
                values = [
                    pin,
                    normalizeName(row[1] || '', lookup, pin),
                    (row[2] || '').trim(),
                    (row[3] || '').trim(),
                    normalizeInvoiceNumber(row[4] || ''),
                    (row[5] || '').trim(),
                    formatXmlNumber(taxableAmount, 4),
                    '0',
                    '',
                    cnInvoice,
                    cnDate,
                    '',
                    'EXEMPT',
                ];
                break;
            }
            case 'F':
            case 'G': {
                // Purchases with VAT (11-col source; credit notes add J/K)
                // Output: 13 cols [Local/Digital Supply, PIN, Name, Date, Invoice, Desc, empty, Amount, VAT, CN invoice, CN date, Local/DST, Rate]
                vatAmount = round(taxableAmount * (section === 'F' ? 0.16 : 0.08), 4);
                const supplierPin = (row[1] || '').trim();
                const locality = (row[0] || '').trim();
                const classification = locality === 'Digital Supply' ? 'DST' : locality;
                values = [
                    locality,
                    supplierPin,
                    normalizeName(row[2] || '', lookup, supplierPin),
                    (row[3] || '').trim(),
                    normalizeInvoiceNumber(row[4] || ''),
                    (row[5] || '').trim(),
                    '',
                    formatXmlNumber(taxableAmount, 4),
                    formatXmlNumber(vatAmount, 4),
                    cnInvoice,
                    cnDate,
                    classification,
                    section === 'F' ? 'GNRL' : 'OTHR',
                ];
                break;
            }
            case 'H': {
                // Zero-rated purchases (9-col source; credit notes add J/K)
                // Output: 13 cols [Local, PIN, Name, Date, Invoice, empty, Desc, empty, Amount, CN invoice, CN date, Local, ZERO]
                const supplierPin = (row[1] || '').trim();
                values = [
                    (row[0] || '').trim(),
                    supplierPin,
                    normalizeName(row[2] || '', lookup, supplierPin),
                    (row[3] || '').trim(),
                    normalizeInvoiceNumber(row[4] || ''),
                    '',
                    (row[6] || '').trim(),
                    '',
                    formatXmlNumber(taxableAmount, 4),
                    cnInvoice,
                    cnDate,
                    (row[0] || '').trim(),
                    'ZERO',
                ];
                break;
            }
            case 'I': {
                // Exempt purchases (8-col source; credit notes add J/K)
                // Output: 10 cols [Local, PIN, Name, Date, Invoice, Desc, empty, Amount, Local, EXEMPT]
                const supplierPin = (row[1] || '').trim();
                values = [
                    (row[0] || '').trim(),
                    supplierPin,
                    normalizeName(row[2] || '', lookup, supplierPin),
                    (row[3] || '').trim(),
                    normalizeInvoiceNumber(row[4] || ''),
                    (row[5] || '').trim(),
                    '',
                    formatXmlNumber(taxableAmount, 4),
                    (row[0] || '').trim(),
                    'EXEMPT',
                ];
                break;
            }
            case 'J': {
                // Imported services (assume same 11-col source as F; credit notes add J/K)
                vatAmount = round(taxableAmount * 0.16, 4);
                const supplierPin = (row[1] || '').trim();
                values = [
                    (row[0] || '').trim(),
                    supplierPin,
                    normalizeName(row[2] || '', lookup, supplierPin),
                    (row[3] || '').trim(),
                    normalizeInvoiceNumber(row[4] || ''),
                    (row[5] || '').trim(),
                    '',
                    formatXmlNumber(taxableAmount, 4),
                    formatXmlNumber(vatAmount, 4),
                    cnInvoice,
                    cnDate,
                    (row[0] || '').trim(),
                    'IMPT',
                ];
                break;
            }
        }

        lines.push({ values, taxableAmount, vatAmount });
        totalBase += taxableAmount;
        totalVat += vatAmount;
    }

    // KRA lists Local purchases before Digital Supply purchases in Section F
    if (section === 'F') {
        lines.sort((left, right) => {
            const leftIsLocal = left.values[0] === 'Local';
            const rightIsLocal = right.values[0] === 'Local';
            if (leftIsLocal && !rightIsLocal) return -1;
            if (!leftIsLocal && rightIsLocal) return 1;
            return 0;
        });
    }

    return { lines, totalBase, totalVat };
}

function toCsvLine(values: string[]): string {
    return values
        .map((value) => {
            const normalized = value ?? '';
            if (/[",\r\n]/.test(normalized)) {
                return `"${normalized.replace(/"/g, '""')}"`;
            }
            return normalized;
        })
        .join(',');
}

async function writeCsvArtifact(filePath: string, rows: PreparedVatLineItem[], trailingBlankColumns?: number): Promise<boolean> {
    if (rows.length === 0) {
        return false;
    }

    const lines = rows.map((row) => toCsvLine(row.values));
    if (trailingBlankColumns && trailingBlankColumns > 0) {
        lines.push(','.repeat(trailingBlankColumns - 1));
    }
    const content = `${lines.join('\n')}\n`;
    await fs.writeFile(filePath, content, 'utf8');
    return true;
}

function readDefinedNameOrder(workbookPath: string): string[] {
    const zip = new AdmZip(workbookPath);
    const workbookEntry = zip.getEntry('xl/workbook.xml');
    if (!workbookEntry) {
        throw new Error('Could not read workbook.xml from the VAT workbook template.');
    }

    const xmlContent = workbookEntry.getData().toString('utf8');
    const matches = [...xmlContent.matchAll(/<definedName name="([^"]+)"/g)];
    return matches
        .map((match) => match[1])
        .filter((name) => !name.startsWith('_xlnm.'));
}

function buildNamedValues(params: {
    taxpayerPin: string;
    periodFrom: string;
    periodTo: string;
    previousCredit: number;
    depositStartDate?: string;
    depositStartDatePid?: string;
    bWithPin: { totalBase: number; totalVat: number };
    bWithoutPin: { totalBase: number; totalVat: number };
    cWithPin: { totalBase: number; totalVat: number };
    cWithoutPin: { totalBase: number; totalVat: number };
    dWithPin: { totalBase: number; totalVat: number };
    dWithoutPin: { totalBase: number; totalVat: number };
    eWithPin: { totalBase: number; totalVat: number };
    eWithoutPin: { totalBase: number; totalVat: number };
    fPurchases: { totalBase: number; totalVat: number };
    gPurchases: { totalBase: number; totalVat: number };
    hPurchases: { totalBase: number; totalVat: number };
    iPurchases: { totalBase: number; totalVat: number };
    jPurchases: { totalBase: number; totalVat: number };
}): Record<string, string> {
    const generalSalesTotal = params.bWithPin.totalBase + params.bWithoutPin.totalBase;
    const generalSalesVat = params.bWithPin.totalVat + params.bWithoutPin.totalVat;
    const otherSalesTotal = params.cWithPin.totalBase + params.cWithoutPin.totalBase;
    const otherSalesVat = params.cWithPin.totalVat + params.cWithoutPin.totalVat;
    const zeroRatedSalesTotal = params.dWithPin.totalBase + params.dWithoutPin.totalBase;
    const zeroRatedSalesVat = params.dWithPin.totalVat + params.dWithoutPin.totalVat;
    const exemptSalesTotal = params.eWithPin.totalBase + params.eWithoutPin.totalBase;
    const exemptSalesVat = params.eWithPin.totalVat + params.eWithoutPin.totalVat;

    const totalSales = generalSalesTotal + otherSalesTotal + zeroRatedSalesTotal + exemptSalesTotal;
    const totalSalesVat = generalSalesVat + otherSalesVat + zeroRatedSalesVat + exemptSalesVat;
    const totalPurchases = params.fPurchases.totalBase + params.gPurchases.totalBase + params.hPurchases.totalBase + params.iPurchases.totalBase + params.jPurchases.totalBase;
    const totalInputVatExact = params.fPurchases.totalVat + params.gPurchases.totalVat + params.hPurchases.totalVat + params.iPurchases.totalVat + params.jPurchases.totalVat;
    const totalInputVatRounded = round(totalInputVatExact, 2);
    const finalTaxPayable = round(totalSalesVat - totalInputVatRounded, 2);
    const netVatBalance = round(finalTaxPayable - params.previousCredit, 2);
    const periodEnd = new Date(params.periodTo);
    const monthCode = String(periodEnd.getMonth() + 1).padStart(2, '0');
    const returnYear = String(periodEnd.getFullYear());

    return {
        'deductibleCI': '0',
        'prorationRate': '100',
        'Purchase.InputTaxPurchDtlsExemptTO': formatXmlNumber(params.iPurchases.totalBase, 4),
        'Purchase.InputTaxPurchDtlsGRTO': formatXmlNumber(params.fPurchases.totalBase, 4),
        'Purchase.InputTaxPurchDtlsORTO': formatXmlNumber(params.gPurchases.totalBase, 4),
        'Purchase.InputTaxPurchDtlsZRTO': formatXmlNumber(params.hPurchases.totalBase, 4),
        'RetInf.DepositStartDate': '01/04/2025',
        'RetInf.DepositStartDatePID': '10/01/2025',
        'RetInf.PIN': '',
        'Sales.ExemptSalesDtlsTO': formatXmlNumber(exemptSalesTotal, 4),
        'Sales.GeneralRateSalesDtlsTO': formatXmlNumber(generalSalesTotal, 4),
        'Sales.OtherRateSalesDtlsTO': formatXmlNumber(otherSalesTotal, 4),
        'Sales.ZeroRateSalesSecASecBTO': formatXmlNumber(zeroRatedSalesTotal, 4),
        'Sch1.GeneralRateSalesDtlsTO': formatXmlNumber(generalSalesTotal, 4),
        'Sch1.GeneralRateSalesVATTO': formatXmlNumber(generalSalesVat, 4),
        'Sch1.SalesAmtWithoutPINTO': formatXmlNumber(params.bWithoutPin.totalBase, 4),
        'Sch1.SalesAmtWithPINTO': formatXmlNumber(params.bWithPin.totalBase, 4),
        'Sch1.VATAmtWithoutPINTO': formatXmlNumber(params.bWithoutPin.totalVat, 4),
        'Sch1.VATAmtWithPINTO': formatXmlNumber(params.bWithPin.totalVat, 4),
        'Sch10.AmountVatClaimableListTO': '0',
        'Sch10.VATAdvcSelfAssPaidDtlsTO': '0',
        'Sch10.VATCrAdjVoucherDtlsTO': '0',
        'Sch10.VATPaidDtlsTO': '0',
        'Sch10.VATSelfAssPaidDtlsTO': '0',
        'Sch2.OtherRateSalesDtlsTO': formatXmlNumber(otherSalesTotal, 4),
        'Sch2.OtherRateSalesVATTO': formatXmlNumber(otherSalesVat, 4),
        'Sch2.SalesAmtWithoutPINTO': formatXmlNumber(params.cWithoutPin.totalBase, 4),
        'Sch2.SalesAmtWithPINTO': formatXmlNumber(params.cWithPin.totalBase, 4),
        'Sch2.VATAmtWithoutPINTO': formatXmlNumber(params.cWithoutPin.totalVat, 4),
        'Sch2.VATAmtWithPINTO': formatXmlNumber(params.cWithPin.totalVat, 4),
        'Sch3.SalesAmtWithoutPINExpTO': formatXmlNumber(params.dWithoutPin.totalBase, 4),
        'Sch3.SalesAmtWithoutPINTO': formatXmlNumber(params.dWithoutPin.totalBase, 4),
        'Sch3.SalesAmtWithPINExpTO': formatXmlNumber(params.dWithPin.totalBase, 4),
        'Sch3.SalesAmtWithPINTO': formatXmlNumber(params.dWithPin.totalBase, 4),
        'Sch3.ZeroRateSalesDtlsTO': formatXmlNumber(zeroRatedSalesTotal, 4),
        'Sch3.ZeroRateSalesExpTO': formatXmlNumber(zeroRatedSalesTotal, 4),
        'Sch3.ZeroRateSalesSecASecBTO': formatXmlNumber(zeroRatedSalesTotal, 4),
        'Sch4.ExemptSalesData': '',
        'Sch4.ExemptSalesDtlsTO': formatXmlNumber(exemptSalesTotal, 4),
        'Sch4.SalesAmtWithoutPINTO': formatXmlNumber(params.eWithoutPin.totalBase, 4),
        'Sch4.SalesAmtWithPINTO': formatXmlNumber(params.eWithPin.totalBase, 4),
        'Sch5.AmtBfrVATWithoutPINTO': '0',
        'Sch5.AmtBfrVATWithPINTO': formatXmlNumber(params.fPurchases.totalBase, 4),
        'Sch5.AmtVATWithoutPINTO': '0',
        'Sch5.AmtVATWithPINTO': formatXmlNumber(params.fPurchases.totalVat, 4),
        'Sch5.InputTaxPurchDtlsGRTO': formatXmlNumber(params.fPurchases.totalBase, 4),
        'Sch5.InputTaxPurchDtlsGRVATTO': formatXmlNumber(params.fPurchases.totalVat, 4),
        'Sch6.AmtBfrVATWithoutPINTO': '0',
        'Sch6.AmtBfrVATWithPINTO': formatXmlNumber(params.gPurchases.totalBase, 4),
        'Sch6.AmtVATWithoutPINTO': '0',
        'Sch6.AmtVATWithPINTO': formatXmlNumber(params.gPurchases.totalVat, 4),
        'Sch6.InputTaxPurchDtlsORTO': formatXmlNumber(params.gPurchases.totalBase, 4),
        'Sch6.InputTaxPurchDtlsORVATTO': formatXmlNumber(params.gPurchases.totalVat, 4),
        'Sch7.AmtBfrVATWithoutPINTO': '0',
        'Sch7.AmtBfrVATWithPINTO': formatXmlNumber(params.hPurchases.totalBase, 4),
        'Sch7.InputTaxPurchDtlsZRTO': formatXmlNumber(params.hPurchases.totalBase, 4),
        'Sch8.AmtBfrVATWithoutPINAddTO': '0',
        'Sch8.AmtBfrVATWithoutPINTO': '0',
        'Sch8.InputTaxPurchDtlsExemptTO': formatXmlNumber(params.iPurchases.totalBase, 4),
        'Sch8.PurchaseAmtWithPINTO': formatXmlNumber(params.iPurchases.totalBase, 4),
        'Sch8.WithHoldingVATDtlsTO': '0',
        'searchOffset': '',
        'searchoffset_Section_C': '',
        'SearchOffset_Section_F': '',
        'SearchOffset_Section_G': '',
        'SecA.EntityType': 'Head Office',
        'SecA.EntityTypeCode': 'HOET',
        'SecA.MonthCode': monthCode,
        'SecA.RtnPdFrom': formatKraDate(params.periodFrom),
        'SecA.RtnPdTo': formatKraDate(params.periodTo),
        'SecA.RtnPrdToAct': formatKraDate(params.periodTo),
        'SecA.RtnPrdToActStart': formatKraDate(params.periodFrom),
        'SecA.RtnType': 'Original',
        'SecA.RtnYear': returnYear,
        'SecA.TaxPayerPIN': params.taxpayerPin.toUpperCase(),
        'SecA.VatNonResident': 'No',
        'SecB.OutputTaxCharged': formatXmlNumber(totalSalesVat, 4),
        'SecB.TotalSales': formatXmlNumber(totalSales, 4),
        'SecB.VATChargedOnGR': formatXmlNumber(generalSalesVat, 4),
        'SecB.VATChargedOnOR': formatXmlNumber(otherSalesVat, 4),
        'SecB.VATChargedOnZR': formatXmlNumber(zeroRatedSalesVat, 4),
        'SecC.TotalPurchases': formatXmlNumber(totalPurchases, 4),
        'SecC.TotalVatPurCharged': formatXmlNumber(totalInputVatExact, 4),
        'SecC.VATChargedOnGR': formatXmlNumber(params.fPurchases.totalVat, 4),
        'SecC.VATChargedOnOR': formatXmlNumber(params.gPurchases.totalVat, 4),
        'SecC.VATChargedOnZR': formatXmlNumber(params.hPurchases.totalVat, 4),
        'SecD.AddRefundClaimPaid': '0',
        'SecD.CrdtBroughtFrwd': formatXmlNumber(params.previousCredit, 4),
        'SecD.DeductableIPTax': formatXmlNumber(totalInputVatRounded, 2),
        'SecD.FinalTaxPayable': formatXmlNumber(finalTaxPayable, 2),
        'SecD.InputVatExemptSup': '',
        'SecD.InputVatTaxbleExemptSup': '',
        'SecD.LessNonDedTnputTax': '0',
        'SecD.NetTaxPayableClaimable': formatXmlNumber(netVatBalance, 2),
        'secD.totalVatPayable': '0',
        'SecD.TotalVatPyble': formatXmlNumber(netVatBalance, 2),
        'TaxDue.AmountVatClaimableListTO': '0',
        'TaxDue.CrAdjVoucherDtlsTO': '0',
        'TaxDue.DbAdjVoucherDtlsTO': '0',
        'TaxDue.OutputTaxCharged': formatXmlNumber(totalSalesVat, 4),
        'TaxDue.TotalVatPurCharged': formatXmlNumber(totalInputVatRounded, 2),
        'TaxDue.VATPaidDtlsTO': '0',
        'TaxDue.VATWhtTO': '0',
        'templateInfo.formId': '4',
        'templateInfo.moduleId': '2',
        'templateInfo.obligId': '9',
        'templateInfo.ofcVrsn': 'EXCEL 1997-2003',
        'templateInfo.tempType': 'XLS',
        'templateInfo.tempVrsn': '15.0.11',
        'WithHolding.ListTO': '0',
    };
}

function buildVatXml(namedValues: Record<string, string>): string {
    const definedNameOrder = readDefinedNameOrder(VAT_TEMPLATE_PATH);
    const singleCellEntries = definedNameOrder
        .filter((name) => Object.prototype.hasOwnProperty.call(namedValues, name))
        .map((name) => `${name}%V_@${namedValues[name]}`);

    const singleCellValue = singleCellEntries.join('@P_@');
    const multiCellValue = '';
    const singleCellHash = createHash('sha256').update(singleCellValue, 'utf8').digest('hex');
    const multiCellHash = createHash('sha256').update(multiCellValue, 'utf8').digest('hex');

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Sheet>',
        `<SingleCellValue>${escapeXml(singleCellValue)}</SingleCellValue>`,
        `<MultiCellValue>${escapeXml(multiCellValue)}</MultiCellValue>`,
        `<SingleCellHash>${singleCellHash}</SingleCellHash>`,
        `<MultiCellHash>${multiCellHash}</MultiCellHash>`,
        '<SheetCode>VAT_RET</SheetCode>',
        '</Sheet>',
        '',
    ].join('\n');
}

function createVatUploadZip(destinationZipPath: string, files: Array<{ path: string; name: string }>): void {
    const zip = new AdmZip();
    for (const file of files) {
        zip.addLocalFile(file.path, '', file.name);
    }
    zip.writeZip(destinationZipPath);
}

async function copyArtifactToClientWorkspace(sourcePath: string, clientName: string, preferredFileName?: string): Promise<{ path: string; url: string; label: string }> {
    const safeClientName = sanitizeClientName(clientName);
    const fileName = preferredFileName || path.basename(sourcePath);
    
    // Try Cloud Storage first, fall back to local disk
    try {
        const { uploadFile, getSignedDownloadUrl } = await import('../lib/cloudStorage');
        const destination = `temp/vat/${safeClientName}/${fileName}`;
        await uploadFile(sourcePath, destination, { contentType: 'application/zip' });
        const signedUrl = await getSignedDownloadUrl(destination, 60); // 60-minute expiry
        
        return {
            path: sourcePath,
            url: signedUrl,
            label: fileName,
        };
    } catch (err: any) {
        // Fallback: copy to local workspace for dev mode
        const workspaceDir = path.join(WORKSPACE_ROOT, 'frontend', 'public', 'clients', safeClientName);
        await ensureDirectory(workspaceDir);
        const destinationPath = path.join(workspaceDir, fileName);
        await fs.copyFile(sourcePath, destinationPath);
        
        return {
            path: destinationPath,
            url: `/clients/${encodeURIComponent(safeClientName)}/${fileName}`,
            label: fileName,
        };
    }
}

async function buildNoTransactionVatArtifacts(
    params: PrepareVatReturnParams,
    generatedDir: string,
    workingDir: string,
): Promise<PreparedVatReturnArtifacts> {
    const zeroTotals = { totalBase: 0, totalVat: 0 };
    const namedValues = buildNamedValues({
        taxpayerPin: params.taxpayerPin,
        periodFrom: params.periodFrom,
        periodTo: params.periodTo,
        previousCredit: params.previousCredit,
        bWithPin: zeroTotals,
        bWithoutPin: zeroTotals,
        cWithPin: zeroTotals,
        cWithoutPin: zeroTotals,
        dWithPin: zeroTotals,
        dWithoutPin: zeroTotals,
        eWithPin: zeroTotals,
        eWithoutPin: zeroTotals,
        fPurchases: zeroTotals,
        gPurchases: zeroTotals,
        hPurchases: zeroTotals,
        iPurchases: zeroTotals,
        jPurchases: zeroTotals,
    });

    const vatXmlFileName = `${formatArtifactTimestamp(new Date())}_${params.taxpayerPin.toUpperCase()}_VAT.xml`;
    const vatXmlPath = path.join(generatedDir, vatXmlFileName);
    await fs.writeFile(vatXmlPath, buildVatXml(namedValues), 'utf8');

    const finalZipFileName = `${formatArtifactTimestamp(new Date())}_${params.taxpayerPin.toUpperCase()}_VAT.zip`;
    const finalZipPath = path.join(workingDir, finalZipFileName);
    createVatUploadZip(finalZipPath, [{ path: vatXmlPath, name: vatXmlFileName }]);

    const sourcePackageArtifact = await copyArtifactToClientWorkspace(params.sourceZipPath, params.clientName);
    const generatedZipArtifact = await copyArtifactToClientWorkspace(finalZipPath, params.clientName, finalZipFileName);

    const netVatBalance = round(0 - params.previousCredit, 2);
    const resultSummary: PreparedVatReturnSummary = {
        inputVat: 0,
        outputVat: 0,
        previousCredit: round(params.previousCredit, 2),
        withholdingAmount: 0,
        payableVat: 0,
        netVatBalance,
        sales: [
            { label: 'Taxable Sales (General Rate)', base: 0, vat: 0, rate: 0.16 },
            { label: 'Taxable Sales (Other Rate)', base: 0, vat: 0, rate: 0.08 },
            { label: 'Sales (Zero Rated)', base: 0, vat: 0, rate: 0.00 },
            { label: 'Sales (Exempt)', base: 0, vat: 0, rate: 0.00 },
        ],
        purchases: [
            { label: 'Taxable Purchases (General Rate)', base: 0, vat: 0, rate: 0.16 },
            { label: 'Taxable Purchases (Other Rate)', base: 0, vat: 0, rate: 0.08 },
            { label: 'Purchases (Zero Rated)', base: 0, vat: 0, rate: 0.00 },
            { label: 'Exempt Purchases', base: 0, vat: 0, rate: 0.00 },
            { label: 'Imported Services', base: 0, vat: 0, rate: 0.16 },
        ],
    };

    return {
        generatedZipPath: generatedZipArtifact.path,
        generatedZipUrl: generatedZipArtifact.url,
        generatedZipLabel: generatedZipArtifact.label,
        sourcePackagePath: sourcePackageArtifact.path,
        sourcePackageUrl: sourcePackageArtifact.url,
        sourcePackageLabel: sourcePackageArtifact.label,
        summary: resultSummary,
        vatSummary: resultSummary,
        namedValues,
        generatedFiles: [vatXmlPath],
        autoPopulationSucceeded: true,
    };
}

export async function prepareVatReturnArtifacts(params: PrepareVatReturnParams): Promise<PreparedVatReturnArtifacts> {
    if (!fsSync.existsSync(VAT_TEMPLATE_PATH)) {
        throw new Error(`VAT workbook template not found: ${VAT_TEMPLATE_PATH}`);
    }

    await ensureDirectory(VAT_TMP_ROOT);

    const runId = `${Date.now()}_${params.taxpayerPin.toUpperCase()}`;
    const workingDir = path.join(VAT_TMP_ROOT, runId);
    const extractedDir = path.join(workingDir, 'extracted');
    const generatedDir = path.join(workingDir, 'generated');
    await ensureDirectory(extractedDir);
    await ensureDirectory(generatedDir);

    const extractionResult = await extractVatPackage(params.sourceZipPath, extractedDir);

    // ── No-transaction path: KRA returned only an .xls workbook with no csv.zip ─
    if (extractionResult.kind === 'xls-only') {
        return buildNoTransactionVatArtifacts(params, generatedDir, workingDir);
    }

    const nestedCsvDir = extractionResult.nestedCsvDir;
    const discoveredSections = await discoverVatSections(nestedCsvDir);

    // ── Helper: read all files for a section key, returning per-subsection rows ─
    async function readSectionFiles(sectionKey: string): Promise<{ withPin: CsvRow[]; withoutPin: CsvRow[] }> {
        const files = discoveredSections[sectionKey] || [];
        const withPinFile = files.find((f) => f.includes('WITH_VAT_PIN'));
        const withoutPinFile = files.find((f) => f.includes('WITHOUT_PIN'));
        return {
            withPin: withPinFile ? await readCsvRows(withPinFile) : [],
            withoutPin: withoutPinFile ? await readCsvRows(withoutPinFile) : [],
        };
    }

    // ── Read source sections ────────────────────────────────────────────────
    const bSource = await readSectionFiles('B');
    const cSource = await readSectionFiles('C');
    // D section may be named D1, D2 in source files
    const dSource = discoveredSections['D']?.length > 0
        ? await readSectionFiles('D')
        : discoveredSections['D1']?.length > 0
            ? await readSectionFiles('D1')
            : { withPin: [], withoutPin: [] };
    const eSource = await readSectionFiles('E');
    // Section F may be split into multiple CSVs by KRA:
    //   - SEC_F_WITH_VAT_PIN1.CSV (main general-rated purchases)
    //   - SEC_F_Digital_Supply1.CSV (digital supply purchases)
    //   - SEC_F_WITHOUT_PIN_AND_NON-VAT_PIN1.CSV (must be ignored)
    // Combine the first two into the generated F CSV; explicitly drop the third.
    const fSource: CsvRow[] = [];
    const fFiles = (discoveredSections['F'] || []).filter((f) => !f.match(/WITHOUT_PIN_AND_NON-VAT_PIN/i));
    for (const fFile of fFiles) {
        fSource.push(...(await readCsvRows(fFile)));
    }
    const gSource = discoveredSections['G']?.length > 0 ? await readCsvRows(discoveredSections['G'][0]) : [];
    const hSource = discoveredSections['H']?.length > 0 ? await readCsvRows(discoveredSections['H'][0]) : [];
    const iSource = discoveredSections['I']?.length > 0 ? await readCsvRows(discoveredSections['I'][0]) : [];
    const jSource = discoveredSections['J']?.length > 0 ? await readCsvRows(discoveredSections['J'][0]) : [];

    // ── Process WITH-PIN sales for detail CSVs ──────────────────────────────
    const bWithPin = mapSectionRows({ rows: bSource.withPin, section: 'B' });
    const cWithPin = mapSectionRows({ rows: cSource.withPin, section: 'C' });
    const dWithPin = mapSectionRows({ rows: dSource.withPin, section: 'D2' });
    const eWithPin = mapSectionRows({ rows: eSource.withPin, section: 'E' });

    // ── Process WITHOUT-PIN sales for XML totals only ───────────────────────
    const bWithoutPin = mapSectionRows({ rows: bSource.withoutPin, section: 'B' });
    const cWithoutPin = mapSectionRows({ rows: cSource.withoutPin, section: 'C' });
    const dWithoutPin = mapSectionRows({ rows: dSource.withoutPin, section: 'D1' });
    const eWithoutPin = mapSectionRows({ rows: eSource.withoutPin, section: 'E' });

    // ── Incorporate user-supplied section B without-PIN sales ────────────────
    if (params.sectionBWithoutPinSales && Number.isFinite(params.sectionBWithoutPinSales) && params.sectionBWithoutPinSales > 0) {
        const extraBase = round(params.sectionBWithoutPinSales, 2);
        const extraVat = round(extraBase * 0.16, 2);
        bWithoutPin.totalBase += extraBase;
        bWithoutPin.totalVat += extraVat;
    }

    // ── Process purchases ───────────────────────────────────────────────────
    const fPurchases = mapSectionRows({ rows: fSource, section: 'F' });
    const gPurchases = mapSectionRows({ rows: gSource, section: 'G' });
    const hPurchases = mapSectionRows({ rows: hSource, section: 'H' });
    const iPurchases = mapSectionRows({ rows: iSource, section: 'I' });
    const jPurchases = mapSectionRows({ rows: jSource, section: 'J' });

    // ── Build XML named values ──────────────────────────────────────────────
    const generalSalesTotal = bWithPin.totalBase + bWithoutPin.totalBase;
    const generalSalesVat = bWithPin.totalVat + bWithoutPin.totalVat;
    const otherSalesTotal = cWithPin.totalBase + cWithoutPin.totalBase;
    const otherSalesVat = cWithPin.totalVat + cWithoutPin.totalVat;
    const zeroRatedSalesTotal = dWithPin.totalBase + dWithoutPin.totalBase;
    const zeroRatedSalesVat = dWithPin.totalVat + dWithoutPin.totalVat;
    const exemptSalesTotal = eWithPin.totalBase + eWithoutPin.totalBase;
    const exemptSalesVat = eWithPin.totalVat + eWithoutPin.totalVat;

    const totalSales = generalSalesTotal + otherSalesTotal + zeroRatedSalesTotal + exemptSalesTotal;
    const totalSalesVat = generalSalesVat + otherSalesVat + zeroRatedSalesVat + exemptSalesVat;
    const totalPurchases = fPurchases.totalBase + gPurchases.totalBase + hPurchases.totalBase + iPurchases.totalBase + jPurchases.totalBase;
    const totalInputVatExact = fPurchases.totalVat + gPurchases.totalVat + hPurchases.totalVat + iPurchases.totalVat + jPurchases.totalVat;
    const totalInputVatRounded = round(totalInputVatExact, 2);
    const finalTaxPayable = round(totalSalesVat - totalInputVatRounded, 2);
    const netVatBalance = round(finalTaxPayable - params.previousCredit, 2);

    const namedValues = buildNamedValues({
        taxpayerPin: params.taxpayerPin,
        periodFrom: params.periodFrom,
        periodTo: params.periodTo,
        previousCredit: params.previousCredit,
        bWithPin,
        bWithoutPin,
        cWithPin,
        cWithoutPin,
        dWithPin,
        dWithoutPin,
        eWithPin,
        eWithoutPin,
        fPurchases,
        gPurchases,
        hPurchases,
        iPurchases,
        jPurchases,
    });

    const generatedFiles: string[] = [];
    const zipEntries: Array<{ path: string; name: string }> = [];

    // ── Sales detail CSVs (WITH_PIN only) ───────────────────────────────────
    // B is always generated if there are with-pin rows.
    // C/D/E are generated only if the source section has WITH_VAT_PIN data
    // (i.e. rows with PIN and name details). Without-pin amounts go to XML totals only.
    if (bWithPin.lines.length > 0) {
        const bPath = path.join(generatedDir, 'B_General_Rated_Sales_Dtls.csv');
        if (await writeCsvArtifact(bPath, bWithPin.lines)) {
            generatedFiles.push(bPath);
            zipEntries.push({ path: bPath, name: 'B_General_Rated_Sales_Dtls.csv' });
        }
    }

    if (cWithPin.lines.length > 0) {
        const cPath = path.join(generatedDir, 'C_Other_Rated_Sales_Dtls.csv');
        // KRA appends a blank row at the end of the C Other Rated Sales CSV
        if (await writeCsvArtifact(cPath, cWithPin.lines, 11)) {
            generatedFiles.push(cPath);
            zipEntries.push({ path: cPath, name: 'C_Other_Rated_Sales_Dtls.csv' });
        }
    }

    if (dWithPin.lines.length > 0) {
        const dPath = path.join(generatedDir, 'D_Zero_Rated_Sales_Dtls.csv');
        if (await writeCsvArtifact(dPath, dWithPin.lines)) {
            generatedFiles.push(dPath);
            zipEntries.push({ path: dPath, name: 'D_Zero_Rated_Sales_Dtls.csv' });
        }
    }

    if (eWithPin.lines.length > 0) {
        const ePath = path.join(generatedDir, 'E_Exempted_Sales_Dtls.csv');
        if (await writeCsvArtifact(ePath, eWithPin.lines)) {
            generatedFiles.push(ePath);
            zipEntries.push({ path: ePath, name: 'E_Exempted_Sales_Dtls.csv' });
        }
    }

    // ── Purchase detail CSVs ────────────────────────────────────────────────
    if (fPurchases.lines.length > 0) {
        const fPath = path.join(generatedDir, 'F_General_Rated_Purchases_Dtls.csv');
        if (await writeCsvArtifact(fPath, fPurchases.lines)) {
            generatedFiles.push(fPath);
            zipEntries.push({ path: fPath, name: 'F_General_Rated_Purchases_Dtls.csv' });
        }
    }

    if (gPurchases.lines.length > 0) {
        const gPath = path.join(generatedDir, 'G_Other_Rated_Purchases_Dtls.csv');
        if (await writeCsvArtifact(gPath, gPurchases.lines)) {
            generatedFiles.push(gPath);
            zipEntries.push({ path: gPath, name: 'G_Other_Rated_Purchases_Dtls.csv' });
        }
    }

    if (hPurchases.lines.length > 0) {
        const hPath = path.join(generatedDir, 'H_Zero_Rated_Purchases_Dtls.csv');
        if (await writeCsvArtifact(hPath, hPurchases.lines)) {
            generatedFiles.push(hPath);
            zipEntries.push({ path: hPath, name: 'H_Zero_Rated_Purchases_Dtls.csv' });
        }
    }

    if (iPurchases.lines.length > 0) {
        const iPath = path.join(generatedDir, 'I_Exempted_Purchases_Dtls.csv');
        if (await writeCsvArtifact(iPath, iPurchases.lines)) {
            generatedFiles.push(iPath);
            zipEntries.push({ path: iPath, name: 'I_Exempted_Purchases_Dtls.csv' });
        }
    }

    if (jPurchases.lines.length > 0) {
        const jPath = path.join(generatedDir, 'J_VAT_Imported_Services_Dtls.csv');
        if (await writeCsvArtifact(jPath, jPurchases.lines)) {
            generatedFiles.push(jPath);
            zipEntries.push({ path: jPath, name: 'J_VAT_Imported_Services_Dtls.csv' });
        }
    }

    const vatXmlFileName = `${formatArtifactTimestamp(new Date())}_${params.taxpayerPin.toUpperCase()}_VAT.xml`;
    const vatXmlPath = path.join(generatedDir, vatXmlFileName);
    await fs.writeFile(vatXmlPath, buildVatXml(namedValues), 'utf8');
    generatedFiles.push(vatXmlPath);
    zipEntries.unshift({ path: vatXmlPath, name: vatXmlFileName });

    const finalZipFileName = `${formatArtifactTimestamp(new Date())}_${params.taxpayerPin.toUpperCase()}_VAT.zip`;
    const finalZipPath = path.join(workingDir, finalZipFileName);
    createVatUploadZip(finalZipPath, zipEntries);

    const sourcePackageArtifact = await copyArtifactToClientWorkspace(params.sourceZipPath, params.clientName);
    const generatedZipArtifact = await copyArtifactToClientWorkspace(finalZipPath, params.clientName, finalZipFileName);

    const rGeneralSalesTotal = bWithPin.totalBase + bWithoutPin.totalBase;
    const rGeneralSalesVat = bWithPin.totalVat + bWithoutPin.totalVat;
    const rOtherSalesTotal = cWithPin.totalBase + cWithoutPin.totalBase;
    const rOtherSalesVat = cWithPin.totalVat + cWithoutPin.totalVat;
    const rZeroRatedSalesTotal = dWithPin.totalBase + dWithoutPin.totalBase;
    const rZeroRatedSalesVat = dWithPin.totalVat + dWithoutPin.totalVat;
    const rExemptSalesTotal = eWithPin.totalBase + eWithoutPin.totalBase;
    const rExemptSalesVat = eWithPin.totalVat + eWithoutPin.totalVat;
    const rTotalSalesVat = round(rGeneralSalesVat + rOtherSalesVat + rZeroRatedSalesVat + rExemptSalesVat, 2);
    const rTotalInputVat = fPurchases.totalVat + gPurchases.totalVat + hPurchases.totalVat + iPurchases.totalVat + jPurchases.totalVat;
    const rTotalInputRounded = round(rTotalInputVat, 2);
    const rFinalTaxPayable = round(rTotalSalesVat - rTotalInputRounded, 2);
    const rNetVatBalance = round(rFinalTaxPayable - params.previousCredit, 2);

    const resultSummary: PreparedVatReturnSummary = {
        inputVat: rTotalInputRounded,
        outputVat: round(rTotalSalesVat, 2),
        previousCredit: round(params.previousCredit, 2),
        withholdingAmount: 0, // Will be populated by worker if withholding exists
        payableVat: rFinalTaxPayable,
        netVatBalance: rNetVatBalance,
        sales: [
            { label: 'Taxable Sales (General Rate)', base: round(rGeneralSalesTotal, 2), vat: round(rGeneralSalesVat, 2), rate: 0.16 },
            { label: 'Taxable Sales (Other Rate)', base: round(rOtherSalesTotal, 2), vat: round(rOtherSalesVat, 2), rate: 0.08 },
            { label: 'Sales (Zero Rated)', base: round(rZeroRatedSalesTotal, 2), vat: round(rZeroRatedSalesVat, 2), rate: 0.00 },
            { label: 'Sales (Exempt)', base: round(rExemptSalesTotal, 2), vat: round(rExemptSalesVat, 2), rate: 0.00 },
        ],
        purchases: [
            { label: 'Taxable Purchases (General Rate)', base: round(fPurchases.totalBase, 2), vat: round(fPurchases.totalVat, 2), rate: 0.16 },
            { label: 'Taxable Purchases (Other Rate)', base: round(gPurchases.totalBase, 2), vat: round(gPurchases.totalVat, 2), rate: 0.08 },
            { label: 'Purchases (Zero Rated)', base: round(hPurchases.totalBase, 2), vat: round(hPurchases.totalVat, 2), rate: 0.00 },
            { label: 'Exempt Purchases', base: round(iPurchases.totalBase, 2), vat: round(iPurchases.totalVat, 2), rate: 0.00 },
            { label: 'Imported Services', base: round(jPurchases.totalBase, 2), vat: round(jPurchases.totalVat, 2), rate: 0.16 },
        ],
    };

    return {
        generatedZipPath: generatedZipArtifact.path,
        generatedZipUrl: generatedZipArtifact.url,
        generatedZipLabel: generatedZipArtifact.label,
        sourcePackagePath: sourcePackageArtifact.path,
        sourcePackageUrl: sourcePackageArtifact.url,
        sourcePackageLabel: sourcePackageArtifact.label,
        summary: resultSummary,
        vatSummary: resultSummary,
        namedValues,
        generatedFiles,
        autoPopulationSucceeded: true,
    };
}