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

type SalesPreparation = {
    lines: PreparedVatLineItem[];
    withPinBase: number;
    withPinVat: number;
    withoutPinBase: number;
    withoutPinVat: number;
};

type PurchasePreparation = {
    lines: PreparedVatLineItem[];
    purchaseBase: number;
    purchaseVat: number;
};

export type PreparedVatReturnSummary = {
    inputVat: number;
    outputVat: number;
    previousCredit: number;
    payableVat: number;
    netVatBalance: number;
};

export type PreparedVatReturnArtifacts = {
    generatedZipPath: string;
    generatedZipUrl: string;
    generatedZipLabel: string;
    sourcePackagePath: string;
    sourcePackageUrl: string;
    sourcePackageLabel: string;
    summary: PreparedVatReturnSummary;
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

function formatXmlNumber(value: number, decimals = 4): string {
    if (!Number.isFinite(value)) {
        return '0';
    }

    const fixed = round(value, decimals).toFixed(decimals);
    return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatKraDate(isoDate: string): string {
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

async function extractVatPackage(sourceZipPath: string, outputDir: string): Promise<string> {
    const outerZip = new AdmZip(sourceZipPath);
    outerZip.extractAllTo(outputDir, true);

    const nestedZipPath = path.join(outputDir, 'csv.zip');
    if (!fsSync.existsSync(nestedZipPath)) {
        throw new Error('Downloaded VAT package did not contain the nested csv.zip file.');
    }

    const nestedDir = path.join(outputDir, 'nested-csv');
    await ensureDirectory(nestedDir);
    const nestedZip = new AdmZip(nestedZipPath);
    nestedZip.extractAllTo(nestedDir, true);
    return nestedDir;
}

async function discoverVatSections(nestedCsvDir: string): Promise<{ [key: string]: string[] }> {
    const files = await fs.readdir(nestedCsvDir);
    const csvFiles = files.filter((f) => f.endsWith('.CSV'));
    const sections: { [key: string]: string[] } = {};

    for (const file of csvFiles) {
        // Match patterns like SEC_B_WITH_VAT_PIN1.CSV, SEC_H_ZERO_RATED_PIN1.CSV, etc.
        const match = file.match(/^SEC_([A-Z])_(.+?)(?:_PIN\d+)?\.CSV$/i);
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

function mapGeneralSalesRows(withPinRows: CsvRow[], withoutPinRows: CsvRow[]): SalesPreparation {
    const lookup = new Map<string, string>();
    const lines: PreparedVatLineItem[] = [];
    let withPinBase = 0;
    let withPinVat = 0;
    let withoutPinBase = 0;
    let withoutPinVat = 0;

    const mapRow = (row: CsvRow, countsAsWithPin: boolean) => {
        if (row.length < 7) {
            return;
        }

        const taxableAmount = parseAmount(row[6]);
        if (taxableAmount <= 0) {
            return;
        }

        const vatAmount = round(taxableAmount * 0.16, 4);
        const pin = (row[0] || '').trim();
        const values = [
            pin,
            normalizeName(row[1] || '', lookup, pin),
            (row[2] || '').trim(),
            (row[3] || '').trim(),
            normalizeInvoiceNumber(row[4] || ''),
            (row[5] || '').trim(),
            formatXmlNumber(taxableAmount, 4),
            formatXmlNumber(vatAmount, 4),
            '',
            '',
            'GNRL',
        ];

        lines.push({ values, taxableAmount, vatAmount });

        if (countsAsWithPin) {
            withPinBase += taxableAmount;
            withPinVat += vatAmount;
        } else {
            withoutPinBase += taxableAmount;
            withoutPinVat += vatAmount;
        }
    };

    withPinRows.forEach((row) => mapRow(row, true));
    withoutPinRows.forEach((row) => mapRow(row, false));

    return { lines, withPinBase, withPinVat, withoutPinBase, withoutPinVat };
}

function mapPurchaseRows(rows: CsvRow[], rateCode: 'GNRL' | 'OTHR' | 'ZERO' | 'EXEM' | 'IMPT'): PurchasePreparation {
    const lookup = new Map<string, string>();
    const lines: PreparedVatLineItem[] = [];
    let purchaseBase = 0;
    let purchaseVat = 0;

    for (const row of rows) {
        if (row.length < 8) {
            continue;
        }

        const taxableAmount = parseAmount(row[7]);
        if (taxableAmount <= 0) {
            continue;
        }

        const vatAmount = round(taxableAmount * 0.16, 4);
        const supplierPin = (row[1] || '').trim();
        const values = [
            (row[0] || '').trim(),
            supplierPin,
            normalizeName(row[2] || '', lookup, supplierPin),
            (row[3] || '').trim(),
            normalizeInvoiceNumber(row[4] || ''),
            (row[5] || '').trim(),
            (row[6] || '').trim(),
            formatXmlNumber(taxableAmount, 4),
            formatXmlNumber(vatAmount, 4),
            '',
            '',
            (row[0] || '').trim(),
            rateCode,
        ];

        lines.push({ values, taxableAmount, vatAmount });
        purchaseBase += taxableAmount;
        purchaseVat += vatAmount;
    }

    return { lines, purchaseBase, purchaseVat };
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

async function writeCsvArtifact(filePath: string, rows: PreparedVatLineItem[]): Promise<boolean> {
    if (rows.length === 0) {
        return false;
    }

    const content = `${rows.map((row) => toCsvLine(row.values)).join('\n')}\n`;
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
    salesLines: SalesPreparation;
    generalPurchases: PurchasePreparation;
    otherPurchases: PurchasePreparation;
}): Record<string, string> {
    const totalSales = params.salesLines.withPinBase + params.salesLines.withoutPinBase;
    const totalSalesVat = params.salesLines.withPinVat + params.salesLines.withoutPinVat;
    const totalPurchases = params.generalPurchases.purchaseBase + params.otherPurchases.purchaseBase;
    const totalInputVatExact = params.generalPurchases.purchaseVat + params.otherPurchases.purchaseVat;
    const totalInputVatRounded = round(totalInputVatExact, 2);
    const finalTaxPayable = round(totalSalesVat - totalInputVatRounded, 2);
    const netVatBalance = round(finalTaxPayable - params.previousCredit, 2);
    const periodEnd = new Date(params.periodTo);
    const monthCode = String(periodEnd.getMonth() + 1).padStart(2, '0');
    const returnYear = String(periodEnd.getFullYear());

    return {
        'deductibleCI': '0',
        'prorationRate': '100',
        'Purchase.InputTaxPurchDtlsExemptTO': '0',
        'Purchase.InputTaxPurchDtlsGRTO': formatXmlNumber(params.generalPurchases.purchaseBase, 4),
        'Purchase.InputTaxPurchDtlsORTO': formatXmlNumber(params.otherPurchases.purchaseBase, 4),
        'Purchase.InputTaxPurchDtlsZRTO': '0',
        'RetInf.DepositStartDate': '01/04/2025',
        'RetInf.DepositStartDatePID': '01/10/2025',
        'RetInf.PIN': '',
        'Sales.ExemptSalesDtlsTO': '0',
        'Sales.GeneralRateSalesDtlsTO': formatXmlNumber(totalSales, 4),
        'Sales.OtherRateSalesDtlsTO': '0',
        'Sales.ZeroRateSalesSecASecBTO': '0',
        'Sch1.GeneralRateSalesDtlsTO': formatXmlNumber(totalSales, 4),
        'Sch1.GeneralRateSalesVATTO': formatXmlNumber(totalSalesVat, 4),
        'Sch1.SalesAmtWithoutPINTO': formatXmlNumber(params.salesLines.withoutPinBase, 4),
        'Sch1.SalesAmtWithPINTO': formatXmlNumber(params.salesLines.withPinBase, 4),
        'Sch1.VATAmtWithoutPINTO': formatXmlNumber(params.salesLines.withoutPinVat, 4),
        'Sch1.VATAmtWithPINTO': formatXmlNumber(params.salesLines.withPinVat, 4),
        'Sch10.AmountVatClaimableListTO': '0',
        'Sch10.VATAdvcSelfAssPaidDtlsTO': '0',
        'Sch10.VATCrAdjVoucherDtlsTO': '0',
        'Sch10.VATPaidDtlsTO': '0',
        'Sch10.VATSelfAssPaidDtlsTO': '0',
        'Sch2.OtherRateSalesDtlsTO': '0',
        'Sch2.OtherRateSalesVATTO': '0',
        'Sch2.SalesAmtWithoutPINTO': '0',
        'Sch2.SalesAmtWithPINTO': '0',
        'Sch2.VATAmtWithoutPINTO': '0',
        'Sch2.VATAmtWithPINTO': '0',
        'Sch3.SalesAmtWithoutPINExpTO': '0',
        'Sch3.SalesAmtWithoutPINTO': '',
        'Sch3.SalesAmtWithPINExpTO': '0',
        'Sch3.SalesAmtWithPINTO': '0',
        'Sch3.ZeroRateSalesDtlsTO': '0',
        'Sch3.ZeroRateSalesExpTO': '0',
        'Sch3.ZeroRateSalesSecASecBTO': '0',
        'Sch4.ExemptSalesData': '',
        'Sch4.ExemptSalesDtlsTO': '0',
        'Sch4.SalesAmtWithoutPINTO': '0',
        'Sch4.SalesAmtWithPINTO': '0',
        'Sch5.AmtBfrVATWithoutPINTO': '0',
        'Sch5.AmtBfrVATWithPINTO': formatXmlNumber(params.generalPurchases.purchaseBase, 4),
        'Sch5.AmtVATWithoutPINTO': '0',
        'Sch5.AmtVATWithPINTO': formatXmlNumber(params.generalPurchases.purchaseVat, 4),
        'Sch5.InputTaxPurchDtlsGRTO': formatXmlNumber(params.generalPurchases.purchaseBase, 4),
        'Sch5.InputTaxPurchDtlsGRVATTO': formatXmlNumber(params.generalPurchases.purchaseVat, 4),
        'Sch6.AmtBfrVATWithoutPINTO': '0',
        'Sch6.AmtBfrVATWithPINTO': formatXmlNumber(params.otherPurchases.purchaseBase, 4),
        'Sch6.AmtVATWithoutPINTO': '0',
        'Sch6.AmtVATWithPINTO': formatXmlNumber(params.otherPurchases.purchaseVat, 4),
        'Sch6.InputTaxPurchDtlsORTO': formatXmlNumber(params.otherPurchases.purchaseBase, 4),
        'Sch6.InputTaxPurchDtlsORVATTO': formatXmlNumber(params.otherPurchases.purchaseVat, 4),
        'Sch7.AmtBfrVATWithoutPINTO': '0',
        'Sch7.AmtBfrVATWithPINTO': '0',
        'Sch7.InputTaxPurchDtlsZRTO': '0',
        'Sch8.AmtBfrVATWithoutPINAddTO': '',
        'Sch8.AmtBfrVATWithoutPINTO': '0',
        'Sch8.InputTaxPurchDtlsExemptTO': '0',
        'Sch8.PurchaseAmtWithPINTO': '0',
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
        'SecB.VATChargedOnGR': formatXmlNumber(totalSalesVat, 4),
        'SecB.VATChargedOnOR': '0',
        'SecB.VATChargedOnZR': '0',
        'SecC.TotalPurchases': formatXmlNumber(totalPurchases, 4),
        'SecC.TotalVatPurCharged': formatXmlNumber(totalInputVatExact, 4),
        'SecC.VATChargedOnGR': formatXmlNumber(params.generalPurchases.purchaseVat, 4),
        'SecC.VATChargedOnOR': formatXmlNumber(params.otherPurchases.purchaseVat, 4),
        'SecC.VATChargedOnZR': '0',
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
        'templateInfo.tempVrsn': '15.0.10',
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
    const workspaceDir = path.join(WORKSPACE_ROOT, 'frontend', 'public', 'clients', safeClientName);
    await ensureDirectory(workspaceDir);

    const fileName = preferredFileName || path.basename(sourcePath);
    const destinationPath = path.join(workspaceDir, fileName);
    await fs.copyFile(sourcePath, destinationPath);

    return {
        path: destinationPath,
        url: `/clients/${encodeURIComponent(safeClientName)}/${fileName}`,
        label: fileName,
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

    const nestedCsvDir = await extractVatPackage(params.sourceZipPath, extractedDir);
    const discoveredSections = await discoverVatSections(nestedCsvDir);

    // Process Section B (Sales) - read all B* files
    const salesWithPinRows = discoveredSections['B']?.length > 0 
        ? await readCsvRows(discoveredSections['B'].find((f) => f.includes('WITH_VAT_PIN')) || discoveredSections['B'][0])
        : [];
    const salesWithoutPinRows = discoveredSections['B']?.length > 1
        ? await readCsvRows(discoveredSections['B'].find((f) => f.includes('WITHOUT_PIN')) || discoveredSections['B'][1])
        : [];

    // Process Section F (General Rated Purchases)
    const generalPurchaseRows = discoveredSections['F']?.length > 0
        ? await readCsvRows(discoveredSections['F'][0])
        : [];

    // Process Section G (Other Rated Purchases)
    const otherPurchaseRows = discoveredSections['G']?.length > 0
        ? await readCsvRows(discoveredSections['G'][0])
        : [];

    // Process Section H (Zero Rated Purchases) - if present
    const zeroRatedRows = discoveredSections['H']?.length > 0
        ? await readCsvRows(discoveredSections['H'][0])
        : [];

    // Process Section I (Exempted Purchases) - if present
    const exemptedRows = discoveredSections['I']?.length > 0
        ? await readCsvRows(discoveredSections['I'][0])
        : [];

    // Process Section J (VAT Claimable on Imported Services) - if present
    const importedServicesRows = discoveredSections['J']?.length > 0
        ? await readCsvRows(discoveredSections['J'][0])
        : [];

    const salesLines = mapGeneralSalesRows(salesWithPinRows, salesWithoutPinRows);
    const generalPurchases = mapPurchaseRows(generalPurchaseRows, 'GNRL');
    const otherPurchases = mapPurchaseRows(otherPurchaseRows, 'OTHR');
    const zeroRatedPurchases = mapPurchaseRows(zeroRatedRows, 'ZERO');
    const exemptedPurchases = mapPurchaseRows(exemptedRows, 'EXEM');
    const importedServicesPurchases = mapPurchaseRows(importedServicesRows, 'IMPT');

    const namedValues = buildNamedValues({
        taxpayerPin: params.taxpayerPin,
        periodFrom: params.periodFrom,
        periodTo: params.periodTo,
        previousCredit: params.previousCredit,
        salesLines,
        generalPurchases,
        otherPurchases,
    });

    const generatedFiles: string[] = [];
    const zipEntries: Array<{ path: string; name: string }> = [];

    const salesCsvPath = path.join(generatedDir, 'B_General_Rated_Sales_Dtls.csv');
    if (await writeCsvArtifact(salesCsvPath, salesLines.lines)) {
        generatedFiles.push(salesCsvPath);
        zipEntries.push({ path: salesCsvPath, name: 'B_General_Rated_Sales_Dtls.csv' });
    }

    const generalPurchasesCsvPath = path.join(generatedDir, 'F_General_Rated_Purchases_Dtls.csv');
    if (await writeCsvArtifact(generalPurchasesCsvPath, generalPurchases.lines)) {
        generatedFiles.push(generalPurchasesCsvPath);
        zipEntries.push({ path: generalPurchasesCsvPath, name: 'F_General_Rated_Purchases_Dtls.csv' });
    }

    const otherPurchasesCsvPath = path.join(generatedDir, 'G_Other_Rated_Purchases_Dtls.csv');
    if (await writeCsvArtifact(otherPurchasesCsvPath, otherPurchases.lines)) {
        generatedFiles.push(otherPurchasesCsvPath);
        zipEntries.push({ path: otherPurchasesCsvPath, name: 'G_Other_Rated_Purchases_Dtls.csv' });
    }

    // Add Section H (Zero Rated Purchases) if it exists
    if (zeroRatedPurchases.lines.length > 0) {
        const zeroRatedCsvPath = path.join(generatedDir, 'H_Zero_Rated_Purchases_Dtls.csv');
        if (await writeCsvArtifact(zeroRatedCsvPath, zeroRatedPurchases.lines)) {
            generatedFiles.push(zeroRatedCsvPath);
            zipEntries.push({ path: zeroRatedCsvPath, name: 'H_Zero_Rated_Purchases_Dtls.csv' });
        }
    }

    // Add Section I (Exempted Purchases) if it exists
    if (exemptedPurchases.lines.length > 0) {
        const exemptedCsvPath = path.join(generatedDir, 'I_Exempted_Purchases_Dtls.csv');
        if (await writeCsvArtifact(exemptedCsvPath, exemptedPurchases.lines)) {
            generatedFiles.push(exemptedCsvPath);
            zipEntries.push({ path: exemptedCsvPath, name: 'I_Exempted_Purchases_Dtls.csv' });
        }
    }

    // Add Section J (VAT Claimable on Imported Services) if it exists
    if (importedServicesPurchases.lines.length > 0) {
        const importedServicesCsvPath = path.join(generatedDir, 'J_VAT_Imported_Services_Dtls.csv');
        if (await writeCsvArtifact(importedServicesCsvPath, importedServicesPurchases.lines)) {
            generatedFiles.push(importedServicesCsvPath);
            zipEntries.push({ path: importedServicesCsvPath, name: 'J_VAT_Imported_Services_Dtls.csv' });
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

    return {
        generatedZipPath: generatedZipArtifact.path,
        generatedZipUrl: generatedZipArtifact.url,
        generatedZipLabel: generatedZipArtifact.label,
        sourcePackagePath: sourcePackageArtifact.path,
        sourcePackageUrl: sourcePackageArtifact.url,
        sourcePackageLabel: sourcePackageArtifact.label,
        summary: {
            inputVat: round(parseAmount(namedValues['TaxDue.TotalVatPurCharged']), 2),
            outputVat: round(parseAmount(namedValues['TaxDue.OutputTaxCharged']), 2),
            previousCredit: round(params.previousCredit, 2),
            payableVat: round(parseAmount(namedValues['SecD.FinalTaxPayable']), 2),
            netVatBalance: round(parseAmount(namedValues['SecD.NetTaxPayableClaimable']), 2),
        },
        namedValues,
        generatedFiles,
        autoPopulationSucceeded: true,
    };
}