import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { calculatePayrollFields } from '../utils/payroll-calculations';

// Initialize Gemini
const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

export interface StandardMapping {
    // Preamble Extraction
    companyName: string | null;
    companyPin: string | null;
    companyNssf: string | null;
    companyNssfPassword: string | null;
    companySha: string | null;
    companyShaPassword: string | null;

    // Header Mapping
    firstName: string | null;
    lastName: string | null;
    employeeName: string | null; // Added to catch single-column names
    kraPin: string | null;
    nssfNo: string | null;
    shaNo: string | null;
    idNumber: string | null;
    grossSalary: string | null;
}

const EMPLOYEE_HEADER_KEYS: Array<keyof StandardMapping> = [
    'employeeName',
    'firstName',
    'lastName',
    'kraPin',
    'nssfNo',
    'shaNo',
    'idNumber',
    'grossSalary'
];

export async function processAndStandardizePayroll(
    inputFilePath: string,
    client: any,
    targetDir: string,
    originalFilename: string
): Promise<{ success: boolean; mappedFile: string; message: string }> {

    if (!apiKey) {
        return { success: false, mappedFile: '', message: 'AI Mapping failed: GEMINI_API_KEY not configured.' };
    }

    try {
        if (!fs.existsSync(inputFilePath)) {
            throw new Error(`File does not exist: ${inputFilePath}`);
        }

        const wb = new ExcelJS.Workbook();
        
        let sheet: ExcelJS.Worksheet;
        
        // Detect actual zip/excel bytes rather than relying purely on user filename
        const buffer = fs.readFileSync(inputFilePath);
        if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
            await wb.xlsx.readFile(inputFilePath);
            sheet = wb.worksheets[0];
        } else {
            sheet = await wb.csv.readFile(inputFilePath);
        }

        if (!sheet || sheet.rowCount === 0) {
            throw new Error('File is empty or could not be read.');
        }

        // 1. Extract first 15 rows to give context to the AI (in case there is a big preamble)
        let sampleData = '';
        for (let i = 1; i <= Math.min(15, sheet.rowCount); i++) {
            const rowValues = sheet.getRow(i).values as any[];
            // rowValues is sparse array, starting at index 1
            const cleanRow = rowValues.slice(1).map(val => val ? String(val).trim() : '');
            sampleData += cleanRow.join(' | ') + '\n';
        }

        // 2. Call Gemini to map headers and extract preamble
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });
        
        const prompt = `
        You are a highly intelligent payroll data extraction AI.
        A user uploaded a payroll file (could be unstructured). 
        Analyze the first 15 rows provided below.
        
        TASK 1: Extract Preamble Values
        Find any explicit VALUES for the company/employer listed at the top of the file. 
        - companyName: The actual name of the company.
        - companyPin: The KRA PIN of the company.
        - companyNssf: The company's NSSF number/login.
        - companyNssfPassword: The company's NSSF password.
        - companySha: The company's SHA/SHIF/NHIF login.
        - companyShaPassword: The company's SHA password.
        Return the exact string values found for these, or null if not present.

        TASK 2: Map Headers
        Identify which exact column header texts correspond to our standard required employee fields.
        - employeeName (Full Name of Employee, OR generic 'Name' column)
        - firstName (First Name of Employee - only if split from Last Name)
        - lastName (Last Name or Surname of Employee - only if split from First Name)
        - kraPin (KRA PIN)
        - nssfNo (NSSF Number)
        - shaNo (SHA/NHIF Number)
        - idNumber (National ID Number)
        - grossSalary (Gross Monthly Salary)

        Return ONLY a single raw JSON object containing ALL properties from both Task 1 and Task 2.
        For Task 2 (Headers), DO NOT invent column names. ONLY use the exact string present in the sample data.
        If a field is completely missing, set its value to null.

        Sample Data (first 15 rows with | separator):
        ${sampleData}
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const mapping: StandardMapping = JSON.parse(responseText);

        console.log('[AI Mapper] Successfully mapped headers:', mapping);

        // 3. Find which row actually contains the headers and column indexes
        let headerRowIndex = -1;
        let columnIndices: Record<string, number> = {};

        for (let i = 1; i <= Math.min(20, sheet.rowCount); i++) {
            const rowVals = sheet.getRow(i).values as any[];
            let foundHeaders = 0;
            const tempMap: Record<string, number> = {};
            const matchedKeys = new Set<string>();

            rowVals.forEach((val, idx) => {
                if (!val) return;
                const cellStr = String(val).trim().toLowerCase();

                EMPLOYEE_HEADER_KEYS.forEach((key) => {
                    const mappedHeader = mapping[key];
                    if (!mappedHeader || matchedKeys.has(key)) {
                        return;
                    }

                    if (cellStr === mappedHeader.trim().toLowerCase()) {
                        matchedKeys.add(key);
                        foundHeaders++;
                        tempMap[key] = idx; // idx corresponds to column number
                    }
                });
            });

            if (foundHeaders >= 2) {
                headerRowIndex = i;
                columnIndices = tempMap;
                break;
            }
        }

        if (headerRowIndex === -1) {
             throw new Error('AI could not confidently locate the header row in this file based on mapped fields.');
        }

        // 4. Construct the completely new, standard spreadsheet
        const newWb = new ExcelJS.Workbook();
        const standardSheet = newWb.addWorksheet('Master Payroll Data');

        // Insert the 7-row Preamble (Matches exactly the Axon_Unified_Payroll_Template_v4.xlsx format)
        // Row 1:
        standardSheet.addRow(['COMPANY NAME:', mapping.companyName || client.name || '']);
        // Row 2:
        standardSheet.addRow(['COMPANY KRA PIN:', mapping.companyPin || client.kraPin || '']);
        // Row 3:
        standardSheet.addRow(['COMPANY NSSF NO:', mapping.companyNssf || client.nssfNo || '']);
        // Row 4:
        standardSheet.addRow(['COMPANY NSSF PASSWORD:', mapping.companyNssfPassword || client.nssfPassword || '']);
        // Row 5:
        standardSheet.addRow(['COMPANY SHA LOGIN:', mapping.companySha || client.shaLoginId || '']);
        // Row 6:
        standardSheet.addRow(['COMPANY SHA PASSWORD:', mapping.companyShaPassword || client.shaPassword || '']);
        // Row 7:
        standardSheet.addRow([]);

        // Row 7 (Headers): Uses our exact 30 standard template headers
        const standardHeaders = [
            "Payroll Number", "PIN of Employee", "ID Number", "Identity Type", "Name of Employee", 
            "SHA No", "NSSF No", "Residential Status", "Type of Employee", "Persons with Disability(PWD)", 
            "Exemption Certificate", "Total Cash Pay (A)", "Value of Car Benefit (B)", "Value of Meals (C)", 
            "Non Cash Benefits (D)", "Type of Housing", "Housing Benefit (F)", "Other Benefits (G)", 
            "Total Gross Pay (Ksh) (H)", "Social Health Insurance Fund (I)", "NSSF Contribution (J)", 
            "Other Pension Contribution (K)", "Post Retirement Medical Fund (L)", "Mortgage Interest (M)", 
            "Affordable Housing Levy (N)", "Taxable Pay(Ksh) (O)", "Monthly Personal Relief (Ksh) (P)", 
            "Amount of Insurance Relief (Q)", "PAYE Tax (Ksh) (R)", "Self Assessed PAYE Tax (Ksh) (S)"
        ];
        standardSheet.addRow(standardHeaders);

        // 5. Populate Data Rows and Map logic
        // Starts reading data strictly from after the headerRowIndex
        let employeeCounter = 1;
        for (let i = headerRowIndex + 1; i <= sheet.rowCount; i++) {
            const rawRow = sheet.getRow(i).values as any[];
            if (!rawRow || rawRow.length === 0) continue;

            const en = columnIndices['employeeName'] ? String(rawRow[columnIndices['employeeName']] || '').trim() : '';
            const fn = columnIndices['firstName'] ? String(rawRow[columnIndices['firstName']] || '').trim() : '';
            const ln = columnIndices['lastName'] ? String(rawRow[columnIndices['lastName']] || '').trim() : '';
            const fullName = en || [fn, ln].filter(Boolean).join(' ');

            if (!fullName) continue; // Skip blank rows

            const newRow = new Array(30).fill('');
            
            // Map our specific AI extracted features
            newRow[0] = String(employeeCounter++); // Payroll Number (Sequential pure numbers)
            newRow[1] = columnIndices['kraPin'] ? String(rawRow[columnIndices['kraPin']] || '') : 'NOT_PROVIDED';
            newRow[2] = columnIndices['idNumber'] ? String(rawRow[columnIndices['idNumber']] || '') : '0';
            newRow[3] = 'National ID';
            newRow[4] = fullName;
            newRow[5] = columnIndices['shaNo'] ? String(rawRow[columnIndices['shaNo']] || '') : 'NOT_PROVIDED';
            newRow[6] = columnIndices['nssfNo'] ? String(rawRow[columnIndices['nssfNo']] || '') : 'NOT_PROVIDED';
            
            newRow[7] = 'Resident'; // Residential Status
            newRow[8] = 'Primary Employee'; // Type of Employee
            newRow[9] = 'No'; // PWD
            newRow[10] = '0'; // Exemption Certificate

            // Base components for Cash Pay
            const gross = parseFloat(columnIndices['grossSalary'] ? String(rawRow[columnIndices['grossSalary']] || 0).replace(/,/g, '') : '0') || 0;
            newRow[11] = gross; // Total Cash Pay (A)
            
            // Allow other items to be zero natively. Our axon extraction engine natively sums and manipulates these if needed, 
            // but the prompt is strictly keeping it straight.
            newRow[12] = 0; // Value of Car
            newRow[13] = 0; // Value of Meals
            newRow[14] = 0; // Non Cash Benefits
            newRow[15] = 'Benefit not given'; // Housing
            newRow[16] = 0; // Housing Benefit (F)
            newRow[17] = 0; // Other Benefits (G)
            
            const calculatedFields = calculatePayrollFields({
                employeeName: fullName,
                totalCashPay: gross,
                carBenefit: Number(newRow[12]) || 0,
                meals: Number(newRow[13]) || 0,
                nonCash: Number(newRow[14]) || 0,
                housingBenefit: Number(newRow[16]) || 0,
                otherBenefits: Number(newRow[17]) || 0,
                pwd: String(newRow[9] || ''),
                otherPension: 0,
                postRetMedical: 0,
                mortgage: 0,
                insuranceRelief: 0,
            });

            newRow[18] = calculatedFields.grossSalary;
            newRow[19] = calculatedFields.shaContribution;
            newRow[20] = calculatedFields.nssfContribution;
            newRow[21] = 0; // Other Pension Contribution (K)
            newRow[22] = 0; // Post Retirement Medical Fund (L)
            newRow[23] = 0; // Mortgage Interest (M)
            newRow[24] = calculatedFields.ahl;
            newRow[25] = calculatedFields.taxablePay;
            newRow[26] = calculatedFields.personalRelief;
            newRow[27] = calculatedFields.insuranceRelief;
            newRow[28] = calculatedFields.paye;
            newRow[29] = calculatedFields.selfAssessedPaye;

            // Add the row to sheet
            standardSheet.addRow(newRow);
        }

        // Write as CSV to target directory for frontend consumption
        const standardCsvPath = path.join(targetDir, originalFilename.replace(/\.xlsx?$|\.csv$/i, '_Standardized.csv'));
        await newWb.csv.writeFile(standardCsvPath);

        return { success: true, mappedFile: standardCsvPath, message: 'File successfully mapped and standardized via AI.' };
    } catch (error: any) {
        console.error('[AI Mapper] Error:', error);
        return { success: false, mappedFile: '', message: error.message || 'Unknown mapping error.' };
    }
}
