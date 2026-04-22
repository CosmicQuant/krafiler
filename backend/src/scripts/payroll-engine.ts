import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import archiver from 'archiver';

export interface Employee {
    payrollNumber: string;
    firstName: string;
    lastName: string;
    identityType: string; // e.g., '1' for National ID
    idNo: string;
    kraPin: string;
    nssfNo: string;
    nhifNo: string;
    phone: string;
    grossSalary: number;
}

export class PayrollEngine {
    private employerPin: string;
    private nssfEmployerNo: string;
    private periodMMYYYY: string;
    private outputDir: string;

    constructor(employerPin: string, nssfEmployerNo: string, periodMMYYYY: string, outputDir: string) {
        this.employerPin = employerPin;
        this.nssfEmployerNo = nssfEmployerNo;
        this.periodMMYYYY = periodMMYYYY;
        this.outputDir = outputDir;
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    private formatMoney(amount: number): string {
        return amount.toFixed(2);
    }

    // --- Core Calculations ---
    public calculatePayroll(employee: Employee) {
        const gross = employee.grossSalary;

        // NSSF Phase 4 (2026)
        const tier1Limit = 9000;
        const tier2Limit = 108000;

        const tier1Gross = Math.min(gross, tier1Limit);
        const tier1Nssf = tier1Gross * 0.06;

        const tier2Gross = Math.max(0, Math.min(gross - tier1Limit, tier2Limit - tier1Limit));
        const tier2Nssf = tier2Gross * 0.06;

        const totalNssf = tier1Nssf + tier2Nssf;

        // SHA
        const shaContribution = Math.max(300, gross * 0.0275);

        // AHL (Housing Levy)
        const ahl = gross * 0.015;

        // PAYE
        // Note: Actual 2026 bands require specific threshold logic. Simplified representation based on prompt.
        const taxablePay = gross - totalNssf - ahl; // Deductions before tax
        let tax = 0;
        let remaining = taxablePay;

        // Simplified 2026 Brackets (first 24k @ 10%, next 8333 @ 25%, etc.)
        if (remaining > 0) {
            const b1 = Math.min(remaining, 24000);
            tax += b1 * 0.10;
            remaining -= b1;
        }
        if (remaining > 0) {
            const b2 = Math.min(remaining, 8333);
            tax += b2 * 0.25;
            remaining -= b2;
        }
        if (remaining > 0) {
            const b3 = Math.min(remaining, 467667); // roughly up to 500k
            tax += b3 * 0.30;
            remaining -= b3;
        }
        if (remaining > 0) {
            const b4 = Math.min(remaining, 300000); // 500k to 800k
            tax += b4 * 0.325;
            remaining -= b4;
        }
        if (remaining > 0) {
            tax += remaining * 0.35; // Above 800k
        }

        const paye = Math.max(0, tax - 2400); // Personal Relief

        return {
            tier1Gross, tier1Nssf,
            tier2Gross, tier2Nssf,
            totalNssf,
            shaContribution,
            ahl,
            paye
        };
    }

    // --- Output 1: SHA CSV ---
    public generateSHACsv(employees: Employee[]): string {
        const header = `PAYROLL NUMBER,FIRSTNAME,LASTNAME,IDENTITY TYPE,ID NO,KRA PIN,NHIF NO,CONTRIBUTION AMOUNT,PHONE\n`;
        const rows = employees.map(emp => {
            const calc = this.calculatePayroll(emp);
            return `'${emp.payrollNumber},${emp.firstName},${emp.lastName},${emp.identityType},'${emp.idNo},'${emp.kraPin},'${emp.nhifNo},'${this.formatMoney(calc.shaContribution)},${emp.phone}`;
        }).join('\n');

        const filePath = path.join(this.outputDir, `SHA_${this.periodMMYYYY}.csv`);
        fs.writeFileSync(filePath, header + rows);
        return filePath;
    }

    // --- Output 2: NSSF CSV ---
    public generateNSSFCsv(employees: Employee[]): string {
        let totalIncome = 0;
        let totalEmployernssf = 0;
        let totalMembernssf = 0;

        const dataRows: string[] = [];

        employees.forEach(emp => {
            const calc = this.calculatePayroll(emp);

            totalIncome += emp.grossSalary;
            totalEmployernssf += calc.totalNssf;
            totalMembernssf += calc.totalNssf;

            // Tier 1 (101)
            dataRows.push(`'${emp.payrollNumber},${emp.firstName},${emp.lastName},${emp.identityType},'${emp.idNo},'${emp.kraPin},'${emp.nssfNo},Tier I,'101,${this.formatMoney(calc.tier1Gross)},${this.formatMoney(calc.tier1Nssf)}`);
            // Tier 2 (102)
            if (calc.tier2Gross > 0) {
                dataRows.push(`'${emp.payrollNumber},${emp.firstName},${emp.lastName},${emp.identityType},'${emp.idNo},'${emp.kraPin},'${emp.nssfNo},Tier II,'102,${this.formatMoney(calc.tier2Gross)},${this.formatMoney(calc.tier2Nssf)}`);
            }
        });

        const totalRecords = dataRows.length;
        const totalAmount = totalEmployernssf + totalMembernssf;

        const metadata = `EMPLOYER PIN,${this.employerPin}\n` +
            `NSSF NO,${this.nssfEmployerNo}\n` +
            `PERIOD,${this.periodMMYYYY}\n` +
            `TOTAL INCOME,${this.formatMoney(totalIncome)}\n` +
            `TOTAL MEMBER,${this.formatMoney(totalMembernssf)}\n` +
            `TOTAL EMPLOYER,${this.formatMoney(totalEmployernssf)}\n` +
            `TOTAL RECORDS,${totalRecords}\n` +
            `TOTAL AMOUNT,${this.formatMoney(totalAmount)}\n` +
            `,,\n,,\n`; // Trailing empty metadata rows typically found in NSSF format

        const header = `PAYROLL NUMBER,FIRST NAME,LAST NAME,ID TYPE,ID NUMBER,KRA PIN,NSSF NUMBER,CONTRIBUTION TYPE,INCOME TYPE,PENSIONABLE EARNINGS,CONTRIBUTION AMOUNT\n`;

        const filePath = path.join(this.outputDir, `NSSF_${this.periodMMYYYY}.csv`);
        fs.writeFileSync(filePath, metadata + header + dataRows.join('\n'));
        return filePath;
    }

    // --- Output 3: iTax PAYE ZIP ---
    public async generatePAYEZip(employees: Employee[]): Promise<string> {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');

        const timestampStr = `${dd}-${mm}-${yyyy}_${hh}-${min}-${ss}`;
        const zipFileName = `${timestampStr}_${this.employerPin}_PAYE.zip`;
        const xmlFileName = `${timestampStr}_${this.employerPin}_PAYE.xml`;

        const zipPath = path.join(this.outputDir, zipFileName);

        // 1. Generate XML
        let singleCellValue = '';
        // Mock generation of P_ / V_ structure
        singleCellValue += `@P_@PIN${this.employerPin}%V_@`;
        singleCellValue += `@P_@Month${this.periodMMYYYY.substring(0, 2)}%V_@`;
        singleCellValue += `@P_@Year${this.periodMMYYYY.substring(2)}%V_@`;

        const hashDigest = crypto.createHash('sha256').update(singleCellValue).digest('hex').toUpperCase();

        const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<PAYEReturn>
    <SingleCellValue>${singleCellValue}</SingleCellValue>
    <SingleCellHash>${hashDigest}</SingleCellHash>
</PAYEReturn>`;

        // 2. Generate CSV
        const csvContent = `PIN,Employee Name,Gross Pay,PAYE\n` + employees.map(emp => {
            const calc = this.calculatePayroll(emp);
            return `${emp.kraPin},${emp.firstName} ${emp.lastName},${this.formatMoney(emp.grossSalary)},${this.formatMoney(calc.paye)}`;
        }).join('\n');

        // 3. Zip it
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', () => resolve(zipPath));
            archive.on('error', (err: any) => reject(err));

            archive.pipe(output);
            archive.append(xmlContent, { name: xmlFileName });
            archive.append(csvContent, { name: 'B_Employees_Dtls_Simp.csv' });
            archive.finalize();
        });
    }
}
