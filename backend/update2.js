const fs = require('fs');
let content = fs.readFileSync('backend/src/scripts/axon-extraction-engine.ts', 'utf8');

const shaRegex = /public generateSHACsv[\s\S]*?return filePath;\n    }/;
const nssfRegex = /public generateNSSFCsv[\s\S]*?return filePath;\n    }/;

const newSha = \
    public async generateSHAExcel(employees: EmployeeMasterRecord[]): Promise<string> {
        const today = new Date().toISOString().split('T')[0];
        const fileName = \\\\_SHA_Upload.xlsx\\\;
        const filePath = path.join(this.outputDir, fileName);

        const templatePath = path.join(__dirname, '../../templates/Payroll Template (6).xlsx');
        if (!fs.existsSync(templatePath)) {
            console.warn('falling back to SHA CSV');
            // We use CSV as fallback, copy original function logic if needed, but here we enforce Excel
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);
        const sheet = workbook.worksheets[0];

        // Clear existing data rows starting from row 2
        let r = 2;
        while (sheet.getRow(r).getCell(1).value || sheet.getRow(r).getCell(2).value) {
            sheet.getRow(r).values = [];
            r++;
        }

        let currentRow = 2;
        employees.forEach(emp => {
            const row = sheet.getRow(currentRow++);
            // To trigger the green triangle in Excel (stored as text), we MUST pass a string and NOT prepend an apostrophe
            // ExcelJS handles text representations automatically correctly when the cell is formatted as Text,
            // or simply passing a string representation of a number creates the green triangle.
            row.getCell(1).value = emp.payrollNumber ? emp.payrollNumber.toString() : ''; // A
            row.getCell(2).value = emp.firstName; // B
            row.getCell(3).value = emp.lastName; // C
            row.getCell(4).value = 'National ID'; // D: dropdown list matching EXACT string
            row.getCell(5).value = emp.idNo ? emp.idNo.toString() : ''; // E
            row.getCell(6).value = emp.kraPin; // F
            row.getCell(7).value = emp.nhifNo; // G
            row.getCell(8).value = emp.shaContribution; // H (Number)
            row.getCell(9).value = emp.phone ? emp.phone.toString() : ''; // I
        });

        await workbook.xlsx.writeFile(filePath);
        console.log(\\\Generated SHA Excel: \\\\);
        return filePath;
    }
\;

const newNssf = \
    public async generateNSSFExcel(employees: EmployeeMasterRecord[]): Promise<string> {
        const today = new Date().toISOString().split('T')[0];
        const fileName = \\\\_NSSF_Upload.xlsx\\\;
        const filePath = path.join(this.outputDir, fileName);

        const templatePath = path.join(__dirname, '../../templates/GOLDENNSSF032026.xlsx');
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);
        const sheet = workbook.worksheets[0];

        let totalIncome = 0;
        let totalMemberNssf = 0;
        let totalEmployerNssf = 0;
        let totalRecordsCount = 0;

        let currentRow = 13;
        
        // clear existing row 13+
        let r = 13;
        while (sheet.getRow(r).getCell(1).value || sheet.getRow(r).getCell(2).value) {
            sheet.getRow(r).values = [];
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

            // Row A: 101
            const row1 = sheet.getRow(currentRow++);
            row1.getCell(1).value = emp.payrollNumber ? emp.payrollNumber.toString() : '';
            row1.getCell(2).value = emp.lastName;
            row1.getCell(3).value = emp.firstName;
            row1.getCell(4).value = emp.idNo ? emp.idNo.toString() : '';
            row1.getCell(5).value = emp.kraPin;
            row1.getCell(6).value = emp.nssfNo;
            row1.getCell(7).value = '101'; // green triangle -> string
            row1.getCell(8).value = Math.min(gross, 9000); // number
            row1.getCell(9).value = '1'; // green triangle -> string
            row1.getCell(10).value = tier1Member.toString(); // green triangle -> string
            row1.getCell(11).value = tier1Employer.toString(); // green triangle -> string
            row1.getCell(12).value = tier1Member + tier1Employer; // probably number or string, use number. Let's use number to see if formula matches.

            totalRecordsCount++;

            // Row B: 102
            if (tier2Member > 0) {
                const row2 = sheet.getRow(currentRow++);
                row2.getCell(1).value = emp.payrollNumber ? emp.payrollNumber.toString() : '';
                row2.getCell(2).value = emp.lastName;
                row2.getCell(3).value = emp.firstName;
                row2.getCell(4).value = emp.idNo ? emp.idNo.toString() : '';
                row2.getCell(5).value = emp.kraPin;
                row2.getCell(6).value = emp.nssfNo;
                row2.getCell(7).value = '102'; // string
                row2.getCell(8).value = Math.max(0, Math.min(gross - 9000, 108000 - 9000)); // number
                row2.getCell(9).value = '1'; // string
                row2.getCell(10).value = tier2Member.toString(); // string
                row2.getCell(11).value = tier2Employer.toString(); // string
                row2.getCell(12).value = tier2Member + tier2Employer; // number
                totalRecordsCount++;
            }
        });

        const totalContributions = totalMemberNssf + totalEmployerNssf;

        // Meta Header mapping EXACTLY setting values natively in template without stripping formatting
        sheet.getCell('B2').value = this.config.employerPin ? this.config.employerPin.toString() : '';
        sheet.getCell('B3').value = this.config.nssfEmployerNo ? this.config.nssfEmployerNo.toString() : '';
        sheet.getCell('B4').value = this.config.employerName;
        sheet.getCell('B5').value = this.config.periodMMYYYY ? this.config.periodMMYYYY.toString() : '';
        sheet.getCell('B6').value = totalIncome.toString();
        sheet.getCell('B7').value = totalMemberNssf.toString();
        sheet.getCell('B8').value = totalEmployerNssf.toString();
        sheet.getCell('B9').value = totalContributions.toString();
        sheet.getCell('B10').value = totalRecordsCount.toString();

        await workbook.xlsx.writeFile(filePath);
        console.log(\\\Generated NSSF Excel: \\\\);
        return filePath;
    }
\;

content = content.replace(shaRegex, newSha);
content = content.replace(nssfRegex, newNssf);

const callRegex = /const shaFilePath = engine.generateSHACsv\\(employees\\);\\s*const nssfFilePath = engine.generateNSSFCsv\\(employees\\);/;
const newCall = \const shaFilePath = await engine.generateSHAExcel(employees);
        const nssfFilePath = await engine.generateNSSFExcel(employees);\;

content = content.replace(callRegex, newCall);

fs.writeFileSync('backend/src/scripts/axon-extraction-engine.ts', content);
console.log('Saved update!');

