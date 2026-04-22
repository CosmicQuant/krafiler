import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs/promises';

export type ReturnType = 'Original' | 'Amended';

export interface ToTReturnInput {
    taxPayerPin: string;
    returnPeriod: {
        year: number;
        month: number;
    };
    turnover: number;
    returnType: ReturnType;
}

const PROPERTY_DELIMITER = '@P_@';
const VALUE_DELIMITER = '%V_@';

/**
 * Get last day of the month
 */
function getLastDayOfMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

/**
 * Format date as DD/MM/YYYY
 */
function formatDate(day: number, month: number, year: number, padDay = true, padMonth = true): string {
    const d = padDay ? day.toString().padStart(2, '0') : day.toString();
    const m = padMonth ? month.toString().padStart(2, '0') : month.toString();
    return `${d}/${m}/${year}`;
}

export function generateToTCellString(input: ToTReturnInput): string {
    const { taxPayerPin, returnPeriod, turnover, returnType } = input;
    const { year, month } = returnPeriod;

    // Tax calculation
    const taxRate = 1.5;
    const taxDue = Math.floor(turnover * (taxRate / 100));

    // Quarter logic
    // Jan-Mar = Q1, Apr-Jun = Q2, Jul-Sep = Q3, Oct-Dec = Q4
    const quarter = Math.ceil(month / 3);
    const qtrCode = `Q${quarter}`;

    const actMonthEnd = quarter * 3;
    const actYearEnd = year;

    const lastDayOfMonth = getLastDayOfMonth(year, month);
    const lastDayOfQuarter = getLastDayOfMonth(actYearEnd, actMonthEnd);

    const rtnPrdFrom = formatDate(1, month, year, true, true);  // e.g., 01/01/2026
    const rtnPrdToActStart = formatDate(1, month, year, false, false); // e.g., 1/1/2026
    const rtnPrdTo = formatDate(lastDayOfMonth, month, year, true, true); // e.g., 31/01/2026
    const rtnPrdToAct = formatDate(lastDayOfQuarter, actMonthEnd, actYearEnd, true, true); // e.g., 31/03/2026

    const paddedMonth = month.toString().padStart(2, '0');

    const fields: [string, string][] = [
        ['SecA.TaxPayerPIN', taxPayerPin],
        ['SecA.QtrCodeTemp', qtrCode],
        ['SecA.ReturnType', returnType],
        ['SecA.QtrCode', qtrCode],
        ['SecA.RtnPrdFrom', rtnPrdFrom],
        ['SecA.RtnPrdToActStart', rtnPrdToActStart],
        ['SecA.RtnPrdTo', rtnPrdTo],
        ['SecA.RtnPrdToAct', rtnPrdToAct],
        ['IsPartnership', 'No'],
        ['templateInfo.tempVrsn', '9.0.2'],
        ['templateInfo.obligId', '8'],
        ['RetInf.DepositStartDate', '01/01/2025'], // From template
        ['templateInfo.tempType', 'XLS'],
        ['templateInfo.ofcVrsn', 'EXCEL 1997-2003'],
        ['SecA.RtnMnth', paddedMonth],
        ['RtnYr', year.toString()],
        ['RtnMonth', paddedMonth],
        ['templateInfo.moduleId', '2'],
        ['templateInfo.formId', '12'],
        ['SecA.RtnYear', year.toString()],
        ['Sch1.DtlsOfLocalPrchsListTO', '0'],
        ['Sch2.DtlsTOTPdInAdvListTO', '0'],
        ['Sch2.DtlsTOTSelfAssPmtListTO', '0'],
        ['Sch2.DtlsTOTAdvPmtTO', '0'],
        ['PartnerListTO', '0'],
        ['checkCredit', taxDue.toString()],
        ['SecB.DtlsOfLocalPrchsListTO', '0'],
        ['SecB.TotTurnOver', turnover.toString()],
        ['SecB.TotTurnOverTaxRate', taxRate.toString()],
        ['SecB.TaxDue', taxDue.toString()],
        ['SecB.DtlsTOTPdInAdvListTO', '0'],
        ['SecB.PresumptiveTaxCdt', '0'],
        ['TaxComp.VehicleAdvTaxPaidListSTO', '0'],
        ['SecB.TotTaxPayable', taxDue.toString()]
    ];

    // Join fields in the required format: property@P_@value%V_@
    // Actually the string template ends with the last value, NO trailing delimiter
    return fields.map(([key, val]) => `${key}${VALUE_DELIMITER}${val}`).join(PROPERTY_DELIMITER);
}

export function buildToTXml(input: ToTReturnInput): string {
    const singleCellValue = generateToTCellString(input);
    const singleCellHash = crypto.createHash('sha256').update(singleCellValue).digest('hex').toLowerCase();

    // MultiCellValue is empty, and its hash is the hash of an empty string
    const multiCellHash = crypto.createHash('sha256').update('').digest('hex').toLowerCase();

    return `<?xml version="1.0" encoding="UTF-8"?>
<Sheet>
<SingleCellValue>${singleCellValue}</SingleCellValue>
<MultiCellValue></MultiCellValue>
<SingleCellHash>${singleCellHash}</SingleCellHash>
<MultiCellHash>${multiCellHash}</MultiCellHash>
<SheetCode>TOT_RET</SheetCode>
</Sheet>`;
}

export async function packageToTZip(input: ToTReturnInput, outputDir: string): Promise<string> {
    const xmlContent = buildToTXml(input);

    // Naming convention: [DD-MM-YYYY]_[HH-MM-SS]_[PIN]_TOT.zip
    const now = new Date();
    const dd = now.getDate().toString().padStart(2, '0');
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = now.getHours().toString().padStart(2, '0');
    const min = now.getMinutes().toString().padStart(2, '0');
    const ss = now.getSeconds().toString().padStart(2, '0');

    const timestamp = `${dd}-${mm}-${yyyy}_${hh}-${min}-${ss}`;
    const zipFilename = `${timestamp}_${input.taxPayerPin}_TOT.zip`;
    const xmlFilename = `${timestamp}_${input.taxPayerPin}_TOT.xml`;

    const zipPath = path.join(outputDir, zipFilename);

    const zip = new AdmZip();
    zip.addFile(xmlFilename, Buffer.from(xmlContent, 'utf8'));

    await fs.mkdir(outputDir, { recursive: true });

    await new Promise<void>((resolve, reject) => {
        zip.writeZip(zipPath, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    return zipPath;
}

// Command Line interface for testing with real data
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);

        if (args.length < 4) {
            console.error("Usage: npm run generate:tot -- <PIN> <YEAR> <MONTH> <TURNOVER_AMOUNT>");
            console.error("Example: npm run generate:tot -- A006711943R 2026 1 33000");
            process.exit(1);
        }

        const taxPayerPin = args[0].toUpperCase();
        const year = parseInt(args[1], 10);
        const month = parseInt(args[2], 10);
        const turnover = parseFloat(args[3]);

        if (isNaN(year) || isNaN(month) || isNaN(turnover)) {
            console.error("Error: YEAR, MONTH, and TURNOVER must be valid numbers.");
            process.exit(1);
        }

        const testInput: ToTReturnInput = {
            taxPayerPin,
            returnPeriod: { year, month },
            turnover,
            returnType: 'Original'
        };

        const outputDir = path.resolve(__dirname, '../../test_output');
        const zipFile = await packageToTZip(testInput, outputDir);
        console.log(`Successfully generated TOT return zip at: ${zipFile}`);

        // Output the generated XML for visual comparison
        console.log("\n--- Generated XML Preview ---");
        console.log(buildToTXml(testInput));
    })();
}

