import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import archiver from 'archiver';
import * as ExcelJS from 'exceljs';
import * as fastCsv from 'fast-csv';
import { createObjectCsvWriter } from 'csv-writer';

function normalizeCsvEncodingInPlace(filePath: string) {
    const rawBuffer = fs.readFileSync(filePath);

    if (rawBuffer.length >= 2 && rawBuffer[0] === 0xff && rawBuffer[1] === 0xfe) {
        fs.writeFileSync(filePath, rawBuffer.slice(2).toString('utf16le'), 'utf8');
        return;
    }

    if (rawBuffer.length >= 2 && rawBuffer[0] === 0xfe && rawBuffer[1] === 0xff) {
        const swappedBuffer = Buffer.from(rawBuffer.slice(2));
        swappedBuffer.swap16();
        fs.writeFileSync(filePath, swappedBuffer.toString('utf16le'), 'utf8');
    }
}

export interface CompanyConfig {
    employerPin: string;
    nssfEmployerNo: string;
    employerName: string;
    periodMMYYYY: string;
}

export interface EmployeeMasterRecord {
    payrollNumber: string;
    firstName: string;
    lastName: string;
    fullName: string;
    identityType: string;
    idNo: string;
    kraPin: string;
    nssfNo: string;
    nhifNo: string;
    phone: string;
    residentialStatus: string;
    typeOfEmployee: string;
    pwd: string;
    exemptionCert: string;
    totalCashPay: number;
    carBenefit: number;
    meals: number;
    nonCash: number;
    typeOfHousing: string;
    housingBenefit: number;
    otherBenefits: number;
    grossSalary: number;
    shaContribution: number;
    nssfContribution: number;
    otherPension: number;
    postRetMedical: number;
    mortgage: number;
    ahl: number;
    taxablePay: number;
    personalRelief: number;
    insuranceRelief: number;
    paye: number;
}

export class AxonDataExtractionEngine {
    private config: CompanyConfig;
    private outputDir: string;

    constructor(config: CompanyConfig, outputDir: string) {
        this.config = config;
        this.outputDir = outputDir;
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    private formatMoney(amount: number): string {
        return amount.toFixed(2);
    }

    private stripApostrophe(value: string | undefined): string {
        if (!value) return '';
        const normalizedValue = value.replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim();
        return normalizedValue.startsWith("'") ? normalizedValue.substring(1).trim() : normalizedValue;
    }

    public async parseMasterCsv(inputCsvPath: string): Promise<EmployeeMasterRecord[]> {
        return new Promise((resolve, reject) => {
            const employees: EmployeeMasterRecord[] = [];

            fs.createReadStream(inputCsvPath)
                .pipe(fastCsv.parse({
                    headers: headers => headers.map(h => h ? h.replace(/^'/, '').trim() : h),
                    skipLines: 4,
                    trim: true
                }))
                .on('data', (row) => {
                    // Extract and clean fields based on instructions
                    const fullName = this.stripApostrophe(row['Name of Employee'] || row['Name']);

                    // Skip empty rows (vital when exporting from 500-row templates)
                    if (!fullName) return;

                    const nameParts = fullName.split(' ');
                    const firstName = nameParts.length > 0 ? nameParts[0] : '';
                    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

                    const parseNum = (val: string | undefined) => parseFloat(this.stripApostrophe(val)) || 0;

                    const emp: EmployeeMasterRecord = {
                        payrollNumber: this.stripApostrophe(row['Payroll Number'] || row['PayrollNo'] || row['EMP NO']),
                        firstName: firstName,
                        lastName: lastName,
                        fullName: fullName,
                        identityType: '1', // Defaulting to National ID 
                        idNo: this.stripApostrophe(row['ID Number'] || row['ID No'] || row['ID']),
                        kraPin: this.stripApostrophe(row['PIN of Employee'] || row['PIN'] || row['KRA PIN']),
                        nssfNo: this.stripApostrophe(row['NSSF No'] || row['NSSF (J)'] || row['NSSF']),
                        nhifNo: this.stripApostrophe(row['SHA No'] || row['SHIF (I)'] || row['SHIF'] || row['NHIF']),
                        phone: this.stripApostrophe(row['Phone'] || row['Mobile'] || ''),
                        residentialStatus: this.stripApostrophe(row['Residential Status'] || 'Resident'),
                        typeOfEmployee: this.stripApostrophe(row['Type of Employee'] || 'Primary Employee'),
                        pwd: this.stripApostrophe(row['Persons with Disability(PWD)'] || 'No'),
                        exemptionCert: this.stripApostrophe(row['Exemption Certificate'] || ''),
                        totalCashPay: parseNum(row['Total Cash Pay (A)'] || row['Total Cash Pay']),
                        carBenefit: parseNum(row['Value of Car Benefit (B)'] || row['Value of Car Benefit']),
                        meals: parseNum(row['Value of Meals (C)'] || row['Value of Meals']),
                        nonCash: parseNum(row['Non Cash Benefits (D)'] || row['Non Cash Benefits']),
                        typeOfHousing: this.stripApostrophe(row['Type of Housing'] || 'Benefit not given'),
                        housingBenefit: parseNum(row['Housing Benefit (F)'] || row['Housing Benefit']),
                        otherBenefits: parseNum(row['Other Benefits (G)'] || row['Other Benefits']),
                        grossSalary: parseNum(row['Total Gross Pay (Ksh) (H)'] || row['Gross Pay (H)'] || row['Gross Pay']),
                        shaContribution: parseNum(row['Social Health Insurance Fund (I)'] || row['SHIF (I)'] || row['SHIF']),
                        nssfContribution: parseNum(row['NSSF Contribution (J)'] || row['NSSF Contribution']),
                        otherPension: parseNum(row['Other Pension Contribution (K)'] || row['Other Pension Contribution']),
                        postRetMedical: parseNum(row['Post Retirement Medical Fund (L)'] || row['Post Retirement Medical Fund']),
                        mortgage: parseNum(row['Mortgage Interest (M)'] || row['Mortgage Interest']),
                        ahl: parseNum(row['Affordable Housing Levy (N)'] || row['Affordable Housing Levy']),
                        taxablePay: parseNum(row['Taxable Pay(Ksh) (O)'] || row['Taxable Pay(Ksh)'] || row['Taxable Pay']),
                        personalRelief: parseNum(row['Monthly Personal Relief (Ksh) (P)'] || row['Monthly Personal Relief (Ksh)'] || row['Monthly Personal Relief']),
                        insuranceRelief: parseNum(row['Amount of Insurance Relief (Q)'] || row['Amount of Insurance Relief']),
                        paye: parseNum(row['PAYE Tax (Ksh) (R)'] || row['PAYE (R)'] || row['PAYE'])
                    };
                    employees.push(emp);
                })
                .on('error', (error) => reject(error))
                .on('end', () => resolve(employees));
        });
    }

    public async generateSHAExcel(employees: EmployeeMasterRecord[]): Promise<string> {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const fileName = `${dd}-${mm}-${yyyy}_${hh}-${min}-${ss}_${this.config.employerPin}_SHA.xlsx`;
        const filePath = path.join(this.outputDir, fileName);

        const templatePath = path.join(__dirname, '../../templates/Payroll Template (6).xlsx');
        if (!fs.existsSync(templatePath)) return filePath; // rudimentary fallback logic return

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);
        const sheet = workbook.worksheets[0];

        // Apply dropdown validation for the entire Column D (Identity Type)
        const sheetWithValidations = sheet as ExcelJS.Worksheet & {
            dataValidations?: {
                add: (range: string, validation: Record<string, unknown>) => void;
            };
        };

        sheetWithValidations.dataValidations?.add('D2:D1048576', {
            type: 'list',
            allowBlank: true,
            showErrorMessage: true,
            errorStyle: 'stop',
            error: 'Please select a valid Identity Type',
            formulae: ['"Refugee ID,National ID,Alien ID,Passport Number"']
        });

        // Ensure rows reset correctly without destroying the dropdown validation
        let r = 2;
        while (sheet.getRow(r).getCell(1).value !== null && sheet.getRow(r).getCell(1).value !== undefined) {
            for (let c = 1; c <= 9; c++) {
                sheet.getRow(r).getCell(c).value = null;
            }
            r++;
        }

        let currentRow = 2;
        employees.forEach(emp => {
            const row = sheet.getRow(currentRow++);
            // Passing strings guarantees correctly formatted text validation mapping instead of literal prefix characters
            row.getCell(1).value = emp.payrollNumber ? emp.payrollNumber.toString() : ''; // String A
            row.getCell(2).value = emp.firstName; // String B 
            row.getCell(3).value = emp.lastName;  // String C

            // D: Identity Type
            const idCell = row.getCell(4);
            idCell.value = 'National ID';

            row.getCell(5).value = emp.idNo ? emp.idNo.toString() : ''; // String E
            row.getCell(6).value = emp.kraPin; // String F
            row.getCell(7).value = emp.nhifNo; // String G
            row.getCell(8).value = emp.shaContribution ? emp.shaContribution.toString() : '0'; // String H (Forced Text)
            row.getCell(9).value = emp.phone ? emp.phone.toString() : ''; // String I
        });

        await workbook.xlsx.writeFile(filePath);
        console.log(`Generated SHA Excel: ${filePath}`);
        return filePath;
    }

    public async generateNSSFExcel(employees: EmployeeMasterRecord[]): Promise<string> {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const fileName = `${dd}-${mm}-${yyyy}_${hh}-${min}-${ss}_${this.config.employerPin}_NSSF.xlsx`;
        const filePath = path.join(this.outputDir, fileName);

        const templatePath = path.join(__dirname, '../../templates/GOLDENNSSF032026.xlsx');
        if (!fs.existsSync(templatePath)) return filePath; // Rudimentary fallback

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);
        const sheet = workbook.worksheets[0];

        let totalIncome = 0;
        let totalMemberNssf = 0;
        let totalEmployerNssf = 0;
        let totalRecordsCount = 0;
        let currentRow = 13;

        // Clear existing row 13+ without breaking styles/validations
        let r = 13;
        while (sheet.getRow(r).getCell(1).value !== null && sheet.getRow(r).getCell(1).value !== undefined) {
            for (let c = 1; c <= 12; c++) {
                sheet.getRow(r).getCell(c).value = null;
            }
            r++;
        }

        employees.forEach(emp => {
            const gross = emp.grossSalary;
            totalIncome += gross;

            const tier1Member = Math.min(gross * 0.06, 540);
            const tier1Employer = tier1Member;

            const tier2Member = Math.max(0, Math.min((gross - 9000) * 0.06, 5940));
            const tier2Employer = tier2Member;

            totalMemberNssf += (tier1Member + tier2Member);
            totalEmployerNssf += (tier1Employer + tier2Employer);

            // Row A: 101 - Populate natively into the template structure
            const row1 = sheet.getRow(currentRow++);
            row1.getCell(1).value = emp.payrollNumber ? emp.payrollNumber.toString() : ''; // A: String triggers text format
            row1.getCell(2).value = emp.lastName; // B
            row1.getCell(3).value = emp.firstName; // C
            row1.getCell(4).value = emp.idNo ? Number(emp.idNo) : ''; // D: Number
            row1.getCell(5).value = emp.kraPin; // E
            row1.getCell(6).value = emp.nssfNo ? Number(emp.nssfNo) : ''; // F: Number
            row1.getCell(7).value = '101'; // G: String triggers triangle natively
            row1.getCell(8).value = Math.min(gross, 9000); // H: No triangle means number natively
            row1.getCell(9).value = '1'; // I: String trigger
            row1.getCell(10).value = tier1Member.toString(); // J: String trigger
            row1.getCell(11).value = tier1Employer.toString(); // K: String trigger
            row1.getCell(12).value = (tier1Member + tier1Employer).toString(); // L: String (Total)

            totalRecordsCount++;

            // Row B: 102
            if (tier2Member > 0) {
                const row2 = sheet.getRow(currentRow++);
                row2.getCell(1).value = emp.payrollNumber ? emp.payrollNumber.toString() : '';
                row2.getCell(2).value = emp.lastName;
                row2.getCell(3).value = emp.firstName;
                row2.getCell(4).value = emp.idNo ? Number(emp.idNo) : '';
                row2.getCell(5).value = emp.kraPin;
                row2.getCell(6).value = emp.nssfNo ? Number(emp.nssfNo) : '';
                row2.getCell(7).value = '102'; // String trigger
                row2.getCell(8).value = Math.max(0, Math.min(gross - 9000, 108000 - 9000)); // Number
                row2.getCell(9).value = '1'; // String trigger
                row2.getCell(10).value = tier2Member.toString(); // String trigger
                row2.getCell(11).value = tier2Employer.toString(); // String trigger
                row2.getCell(12).value = (tier2Member + tier2Employer).toString(); // String (Total)
                totalRecordsCount++;
            }
        });

        const totalContributions = totalMemberNssf + totalEmployerNssf;

        // Header mapping natively back to specific coordinate spots
        sheet.getCell('B2').value = this.config.employerPin ? this.config.employerPin.toString() : '';
        sheet.getCell('B3').value = this.config.nssfEmployerNo ? Number(this.config.nssfEmployerNo) : ''; // Number mapping (NO TEXT)
        sheet.getCell('B4').value = this.config.employerName;
        sheet.getCell('B5').value = this.config.periodMMYYYY ? this.config.periodMMYYYY.toString() : '';
        sheet.getCell('B6').value = totalIncome.toString(); // String trigger
        sheet.getCell('B7').value = totalMemberNssf.toString(); // String trigger
        sheet.getCell('B8').value = totalEmployerNssf.toString(); // String trigger
        sheet.getCell('B9').value = totalContributions.toString(); // String trigger
        sheet.getCell('B10').value = totalRecordsCount.toString(); // String trigger

        await workbook.xlsx.writeFile(filePath);
        console.log(`Generated NSSF Excel: ${filePath}`);
        return filePath;
    }

    public async generatePAYEZip(employees: EmployeeMasterRecord[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy = now.getFullYear();
            const hh = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');

            const timestampStr = `${dd}-${mm}-${yyyy}_${hh}-${min}-${ss}`;
            const zipFileName = `${dd}-${mm}-${yyyy}_${hh}-${min}-${ss}_${this.config.employerPin}_PAYE.zip`;
            const xmlFileName = `${timestampStr}_${this.config.employerPin}_PAYE.xml`;

            const zipPath = path.join(this.outputDir, zipFileName);

            const archive = archiver('zip', { zlib: { level: 9 } });
            const output = fs.createWriteStream(zipPath);

            output.on('close', () => {
                console.log(`Generated PAYE ZIP: ${zipPath}`);
                resolve(zipPath)
            });
            archive.on('error', (err: any) => reject(err));

            archive.pipe(output);

            // File B: XML Generation
            const totEmp = employees.length;
            const totNITA = totEmp * 50;
            const totAHL = employees.reduce((sum, emp) => sum + (emp.ahl || 0), 0);
            const totTax = employees.reduce((sum, emp) => sum + (emp.paye || 0), 0);
            const totPayable = totNITA + totAHL + totTax;

            const monthCode = this.config.periodMMYYYY.substring(0, 2) || mm;
            const yearStr = this.config.periodMMYYYY.substring(2) || String(yyyy);
            const monthObj = new Date(parseInt(yearStr), parseInt(monthCode) - 1, 1);
            const monthName = monthObj.toLocaleString('en-US', { month: 'long' });
            const lastDay = new Date(parseInt(yearStr), parseInt(monthCode), 0).getDate();

            const rtnPrdFrom = `01/${monthCode}/${yearStr}`;
            const rtnPrdTo = `${lastDay}/${monthCode}/${yearStr}`;

            let singleCellValue = `ClcTaxDue.EmpTO%V_@0@P_@ClcTaxDue.FringeBenfTO%V_@0@P_@ClcTaxDue.LumpSumTO%V_@0@P_@ClcTaxDue.TaxDedEmpWithoutPin%V_@0@P_@ClcTaxDue.totalHousingContribution%V_@${totAHL}@P_@ClcTaxDue.totalNITAContribution%V_@${totNITA}@P_@ClcTaxDue.TotEmpRcrds%V_@${totEmp}@P_@ClcTaxDue.TotNITALevyMemb%V_@${totEmp}@P_@ClcTaxDue.TotPybl%V_@${totPayable}@P_@ClcTaxDue.TotTaxPybl%V_@${totTax}@P_@DtlsArrSalPdBftsPayeDedFrmEmpListTO%V_@0@P_@DtlsSalPdBftsPayeDedFrmEmpListTO%V_@0@P_@DtlsSalPdBftsSelfPayTaxListTO%V_@0@P_@FringeBenfTaxCalcListTO%V_@0@P_@labelForYearChangeSecB%V_@Mortgage Interest (M)@P_@RetInf.arrearStartDate%V_@01/02/2021@P_@RetInf.DatePaymentStartDate%V_@01/01/${yearStr}@P_@RetInf.DepositStartDate%V_@01/02/${parseInt(yearStr) - 1}@P_@RtnInf.EntityCode%V_@HOET@P_@RtnInf.EntityType%V_@Head Office@P_@RtnInf.isAddAssmt%V_@N@P_@RtnInf.Month%V_@${monthName}@P_@RtnInf.MonthCode%V_@${monthCode}@P_@RtnInf.ReturnType%V_@Original@P_@RtnInf.ReturnTypeCd%V_@1@P_@RtnInf.RtnMonth%V_@${monthCode}@P_@RtnInf.RtnPrdFrom%V_@${rtnPrdFrom}@P_@RtnInf.RtnPrdTo%V_@${rtnPrdTo}@P_@RtnInf.RtnPrdToAct%V_@${rtnPrdTo}@P_@RtnInf.RtnPrdToActStart%V_@${rtnPrdFrom}@P_@RtnInf.RtnYear%V_@${yearStr}@P_@RtnInf.TaxPayersPIN%V_@${this.config.employerPin}@P_@TaxPdOnLumpSumPdAftrTrmtnListTO%V_@0@P_@templateInfo.formId%V_@60@P_@templateInfo.moduleId%V_@2@P_@templateInfo.obligId%V_@7@P_@templateInfo.ofcVrsn%V_@EXCEL 1997-2003@P_@templateInfo.tempType%V_@XLS@P_@templateInfo.tempVrsn%V_@30.0.2`;

            const singleCellHash = crypto.createHash('sha256').update(singleCellValue).digest('hex');
            const multiCellHash = crypto.createHash('sha256').update('').digest('hex');

            const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<Sheet>
<SingleCellValue>${singleCellValue}</SingleCellValue>
<MultiCellValue/>
<SingleCellHash>${singleCellHash}</SingleCellHash>
<MultiCellHash>${multiCellHash}</MultiCellHash>
</Sheet>`;

            archive.append(xmlContent, { name: xmlFileName });

            // File A: Simp CSV
            // Do NOT use apostrophes here. Map to exactly 29 KRA iTax columns 
            // Note: Does not include a header row, starts directly with data
            const simpRows = employees.map(emp => {
                const typeEmpCode = emp.typeOfEmployee.toLowerCase().includes('primary') ? 'PRMEMP' : 'SECEMP';
                const resStatCode = emp.residentialStatus.toLowerCase().includes('resident') && !emp.residentialStatus.toLowerCase().includes('non') ? 'RES' : 'NRES';

                // Fields map to the B_Employees_Dtls_Simp standard EXACTLY as expected by iTax
                return `${emp.kraPin},${emp.fullName},${emp.residentialStatus},${emp.typeOfEmployee},${emp.pwd},${emp.exemptionCert},${emp.totalCashPay},${emp.carBenefit},${emp.meals},${emp.nonCash},${emp.typeOfHousing},,${emp.housingBenefit || emp.otherBenefits || 0},${emp.grossSalary},${emp.shaContribution},${emp.nssfContribution},${emp.otherPension},${emp.postRetMedical},${emp.mortgage},${emp.ahl},${emp.taxablePay},${emp.personalRelief},${emp.insuranceRelief},${emp.paye},0,${typeEmpCode},0,${resStatCode},DTEMP`;
            }).join('\n');

            archive.append(simpRows, { name: 'B_Employees_Dtls_Simp.csv' });

            archive.finalize();
        });
    }
}

export async function generateComplianceFiles(inputCsvPath: string, fallbackConfig: CompanyConfig, options?: { generatePaye: boolean, generateNssf: boolean, generateSha: boolean }) {
    console.log('--- Starting Axon Data Extraction & Generation Engine ---');
    const outputDir = path.join(path.dirname(inputCsvPath), 'output');

    normalizeCsvEncodingInPlace(inputCsvPath);

    // Read Company Config directly from the first 3 rows of the CSV 
    // This allows clients to skip UI form filling
    const companyConfig = await new Promise<CompanyConfig>((resolve, reject) => {
        const cfg: CompanyConfig = { employerName: '', employerPin: '', nssfEmployerNo: '', periodMMYYYY: '' };
        let rowCount = 0;
        fs.createReadStream(inputCsvPath)
            .pipe(fastCsv.parse({ headers: false, trim: true }))
            .on('data', (row) => {
                if (rowCount === 0) cfg.employerName = row[1] ? String(row[1]).replace(/^\uFEFF/, '').replace(/\u0000/g, '').replace(/^'/, '').trim() : '';
                if (rowCount === 1) cfg.employerPin = row[1] ? String(row[1]).replace(/^\uFEFF/, '').replace(/\u0000/g, '').replace(/^'/, '').trim() : '';
                if (rowCount === 2) cfg.nssfEmployerNo = row[1] ? String(row[1]).replace(/^\uFEFF/, '').replace(/\u0000/g, '').replace(/^'/, '').trim() : '';
                rowCount++;
            })
            .on('end', () => {
                // Automatically set the period based on the current date, to remove user input need
                const now = new Date();
                cfg.periodMMYYYY = `${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;

                // Fallbacks if mapping failed
                cfg.employerName = cfg.employerName || fallbackConfig.employerName;
                cfg.employerPin = cfg.employerPin || fallbackConfig.employerPin;
                cfg.nssfEmployerNo = cfg.nssfEmployerNo || fallbackConfig.nssfEmployerNo;

                resolve(cfg);
            })
            .on('error', reject);
    });

    const engine = new AxonDataExtractionEngine(companyConfig, outputDir);

    try {
        const employees = await engine.parseMasterCsv(inputCsvPath);
        console.log(`Parsed ${employees.length} employee records from master CSV.`);

        const activeOptions = options || { generatePaye: true, generateNssf: true, generateSha: true };

        const shaFilePath = activeOptions.generateSha ? await engine.generateSHAExcel(employees) : null;
        const nssfFilePath = activeOptions.generateNssf ? await engine.generateNSSFExcel(employees) : null;
        const payeZipPath = activeOptions.generatePaye ? await engine.generatePAYEZip(employees) : null;

        console.log('--- Compliance Files Generation Complete ---');
        return { shaFilePath, nssfFilePath, payeZipPath, companyConfig };
    } catch (error) {
        console.error('Error generating compliance files:', error);
        throw error;
    }
}
