import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import archiver from 'archiver';
import { db } from '../db/kysely';
import * as ExcelJS from 'exceljs';

function roundMoney(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function getClientWorkspaceDir(clientName: string) {
    const safe = clientName
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .trim() || 'Client';
    return path.join(__dirname, '../../../frontend/public/clients', safe);
}

export interface ComplianceResult {
    payeZipUrl: string | null;
    payeZipLabel: string | null;
    nssfFileUrl: string | null;
    nssfFileLabel: string | null;
    shaFileUrl: string | null;
    shaFileLabel: string | null;
    summaryAmounts: {
        payeAmount: number;
        nitaAmount: number;
        housingLevyAmount: number;
        nssfAmount: number;
        shaAmount: number;
    };
}

export async function generateComplianceFromPayrollRun(
    runId: number,
    clientId: number,
    options?: { generatePaye?: boolean; generateNssf?: boolean; generateSha?: boolean }
): Promise<ComplianceResult> {
    const opts = { generatePaye: true, generateNssf: true, generateSha: true, ...options };

    const run = await db
        .selectFrom('payroll_runs')
        .selectAll()
        .where('id', '=', runId)
        .where('clientId', '=', clientId)
        .executeTakeFirst();
    if (!run) throw new Error('Payroll run not found');

    const client = await db
        .selectFrom('clients')
        .selectAll()
        .where('id', '=', clientId)
        .executeTakeFirst();
    if (!client) throw new Error('Client not found');

    const entries = await db
        .selectFrom('payroll_entries')
        .selectAll()
        .where('payrollRunId', '=', runId)
        .where('clientId', '=', clientId)
        .orderBy('employeeName', 'asc')
        .execute();
    if (entries.length === 0) throw new Error('No payroll entries found for this run');

    const employees = await db
        .selectFrom('employees')
        .selectAll()
        .where('clientId', '=', clientId)
        .execute();
    const empMap = new Map<number, typeof employees[number]>();
    for (const e of employees) empMap.set(e.id, e);

    const workspaceDir = getClientWorkspaceDir(client.name || 'Generated Client');
    fs.mkdirSync(workspaceDir, { recursive: true });

    const [yearStr, monthStr] = run.period.split('-');
    const y = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10);
    const mm = String(m).padStart(2, '0');
    const yyyy = String(y);
    const periodMMYYYY = `${mm}${yyyy}`;
    const lastDay = new Date(y, m, 0).getDate();
    const rtnPrdFrom = `01/${mm}/${yyyy}`;
    const rtnPrdTo = `${String(lastDay).padStart(2, '0')}/${mm}/${yyyy}`;
    const monthName = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' });

    const summaryAmounts = {
        payeAmount: roundMoney(entries.reduce((s, e) => s + e.payeTax, 0)),
        nitaAmount: entries.length * 50,
        housingLevyAmount: roundMoney(entries.reduce((s, e) => s + e.ahlDeduction, 0)),
        nssfAmount: roundMoney(entries.reduce((s, e) => s + e.nssfDeduction, 0)),
        shaAmount: roundMoney(entries.reduce((s, e) => s + e.shaDeduction, 0)),
    };

    const timestamp = (() => {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm2 = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy2 = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        return `${dd}-${mm2}-${yyyy2}_${hh}-${min}-${ss}`;
    })();

    const employerPin = client.pin || 'P000000000A';

    let payeZipUrl: string | null = null;
    let payeZipLabel: string | null = null;
    let nssfFileUrl: string | null = null;
    let nssfFileLabel: string | null = null;
    let shaFileUrl: string | null = null;
    let shaFileLabel: string | null = null;

    if (opts.generatePaye) {
        const zipLabel = `${timestamp}_${employerPin}_PAYE.zip`;
        const zipPath = path.join(workspaceDir, zipLabel);
        const xmlLabel = `${timestamp}_${employerPin}_PAYE.xml`;

        const archive = archiver('zip', { zlib: { level: 9 } });
        const output = fs.createWriteStream(zipPath);

        await new Promise<void>((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);

            const totEmp = entries.length;
            const totNITA = totEmp * 50;
            const totAHL = summaryAmounts.housingLevyAmount;
            const totTax = summaryAmounts.payeAmount;
            const totSelfAssessedTax = totTax;
            const totPayable = totNITA + totAHL + totTax;

            const singleCellValue = `ClcTaxDue.EmpTO%V_@${totSelfAssessedTax}@P_@ClcTaxDue.FringeBenfTO%V_@0@P_@ClcTaxDue.LumpSumTO%V_@0@P_@ClcTaxDue.TaxDedEmpWithoutPin%V_@0@P_@ClcTaxDue.totalHousingContribution%V_@${totAHL}@P_@ClcTaxDue.totalNITAContribution%V_@${totNITA}@P_@ClcTaxDue.TotEmpRcrds%V_@${totEmp}@P_@ClcTaxDue.TotNITALevyMemb%V_@${totEmp}@P_@ClcTaxDue.TotPybl%V_@${totPayable}@P_@ClcTaxDue.TotTaxPybl%V_@${totTax}@P_@DtlsArrSalPdBftsPayeDedFrmEmpListTO%V_@0@P_@DtlsSalPdBftsPayeDedFrmEmpListTO%V_@${totTax}@P_@DtlsSalPdBftsSelfPayTaxListTO%V_@${totSelfAssessedTax}@P_@FringeBenfTaxCalcListTO%V_@0@P_@labelForYearChangeSecB%V_@Mortgage Interest (M)@P_@RetInf.arrearStartDate%V_@01/02/2021@P_@RetInf.DatePaymentStartDate%V_@01/01/${yyyy}@P_@RetInf.DepositStartDate%V_@01/02/${parseInt(yyyy, 10) - 1}@P_@RtnInf.EntityCode%V_@HOET@P_@RtnInf.EntityType%V_@Head Office@P_@RtnInf.isAddAssmt%V_@N@P_@RtnInf.Month%V_@${monthName}@P_@RtnInf.MonthCode%V_@${mm}@P_@RtnInf.ReturnType%V_@Original@P_@RtnInf.ReturnTypeCd%V_@1@P_@RtnInf.RtnMonth%V_@${mm}@P_@RtnInf.RtnPrdFrom%V_@${rtnPrdFrom}@P_@RtnInf.RtnPrdTo%V_@${rtnPrdTo}@P_@RtnInf.RtnPrdToAct%V_@${rtnPrdTo}@P_@RtnInf.RtnPrdToActStart%V_@${rtnPrdFrom}@P_@RtnInf.RtnYear%V_@${yyyy}@P_@RtnInf.TaxPayersPIN%V_@${employerPin}@P_@TaxPdOnLumpSumPdAftrTrmtnListTO%V_@0@P_@templateInfo.formId%V_@60@P_@templateInfo.moduleId%V_@2@P_@templateInfo.obligId%V_@7@P_@templateInfo.ofcVrsn%V_@EXCEL 1997-2003@P_@templateInfo.tempType%V_@XLS@P_@templateInfo.tempVrsn%V_@30.0.2`;

            const singleCellHash = crypto.createHash('sha256').update(singleCellValue).digest('hex');
            const multiCellHash = crypto.createHash('sha256').update('').digest('hex');

            const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<Sheet>
<SingleCellValue>${singleCellValue}</SingleCellValue>
<MultiCellValue/>
<SingleCellHash>${singleCellHash}</SingleCellHash>
<MultiCellHash>${multiCellHash}</MultiCellHash>
<SheetCode>PAYE_RET</SheetCode>
</Sheet>`;

            archive.append(xmlContent, { name: xmlLabel });

            const csvRows = entries.map(entry => {
                const emp = empMap.get(entry.employeeId);
                const fullName = entry.employeeName || '';
                const resStatus = 'Resident';
                const empType = 'Primary Employee';
                const pwd = 'No';
                const exemptionCert = '0';
                const unpaidLeaveDays = entry.unpaidLeaveDays || 0;
                const unpaidLeaveDeduction = roundMoney((entry.basicPay / Math.max(1, entry.daysWorked || 30)) * unpaidLeaveDays);
                const totalCashPay = roundMoney(entry.basicPay + entry.overtimePay - unpaidLeaveDeduction);
                const carBenefit = 0;
                const meals = 0;
                const nonCash = 0;
                const typeOfHousing = 'Benefit not given';
                const housingOrOtherBenefits = entry.benefits || 0;
                const grossSalary = entry.grossPay;
                const shaContribution = entry.shaDeduction;
                const nssfContribution = entry.nssfDeduction;
                const otherPension = 0;
                const postRetMedical = 0;
                const mortgage = 0;
                const ahl = entry.ahlDeduction;
                const taxablePayCalc = roundMoney(Math.max(0, entry.grossPay - entry.shaDeduction - entry.nssfDeduction - entry.ahlDeduction));
                const personalRelief = 2400;
                const insuranceRelief = 0;
                const paye = entry.payeTax;
                const selfAssessedPaye = entry.payeTax;
                const typeEmpCode = empType.toLowerCase().includes('primary') ? 'PRMEMP' : 'SECEMP';
                const resStatCode = resStatus.toLowerCase().includes('non') ? 'NRES' : 'RES';

                return `${entry.kraPin},${fullName},${resStatus},${empType},${pwd},${exemptionCert},${totalCashPay},${carBenefit},${meals},${nonCash},${typeOfHousing},,${housingOrOtherBenefits},${grossSalary},${shaContribution},${nssfContribution},${otherPension},${postRetMedical},${mortgage},${ahl},${taxablePayCalc},${personalRelief},${insuranceRelief},${paye},${selfAssessedPaye},${typeEmpCode},0,${resStatCode},DTEMP`;
            }).join('\n');

            archive.append(csvRows, { name: 'B_Employees_Dtls_Simp.csv' });
            archive.finalize();
        });

        const clientNameEnc = encodeURIComponent(path.basename(workspaceDir));
        payeZipUrl = `/clients/${clientNameEnc}/${zipLabel}`;
        payeZipLabel = zipLabel;
    }

    if (opts.generateNssf) {
        const fileLabel = `${timestamp}_${employerPin}_NSSF.xlsx`;
        const filePath = path.join(workspaceDir, fileLabel);

        const templatePath = path.join(__dirname, '../../templates/GOLDENNSSF032026.xlsx');
        if (fs.existsSync(templatePath)) {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(templatePath);
            const sheet = workbook.worksheets[0];

            let totalIncome = 0;
            let totalMemberNssf = 0;
            let totalEmployerNssf = 0;
            let totalRecordsCount = 0;
            let currentRow = 13;

            let r = 13;
            while (sheet.getRow(r) && sheet.getRow(r).getCell(1).value !== null && sheet.getRow(r).getCell(1).value !== undefined) {
                for (let c = 1; c <= 12; c++) sheet.getRow(r).getCell(c).value = null;
                r++;
            }

            for (const entry of entries) {
                const emp = empMap.get(entry.employeeId);
                const gross = entry.grossPay;
                totalIncome += gross;

                const tier1Member = roundMoney(Math.min(gross * 0.06, 540));
                const tier1Employer = tier1Member;
                const tier2Member = roundMoney(Math.max(0, Math.min((gross - 9000) * 0.06, 5940)));
                const tier2Employer = tier2Member;
                totalMemberNssf += (tier1Member + tier2Member);
                totalEmployerNssf += (tier1Employer + tier2Employer);

                const row1 = sheet.getRow(currentRow++);
                row1.getCell(1).value = entry.payrollNumber ? String(entry.payrollNumber) : '';
                row1.getCell(2).value = entry.employeeName ? entry.employeeName.split(' ').pop() || '' : '';
                row1.getCell(3).value = entry.employeeName ? entry.employeeName.split(' ').slice(0, -1).join(' ') || entry.employeeName : '';
                row1.getCell(4).value = emp?.idNumber ? Number(emp.idNumber) || '' : '';
                row1.getCell(5).value = entry.kraPin;
                row1.getCell(6).value = emp?.nssfNo || '';
                row1.getCell(7).value = '101';
                row1.getCell(8).value = gross;
                row1.getCell(9).value = '1';
                row1.getCell(10).value = tier1Member.toString();
                row1.getCell(11).value = tier1Employer.toString();
                row1.getCell(12).value = (tier1Member + tier1Employer).toString();
                totalRecordsCount++;

                if (tier2Member > 0) {
                    const row2 = sheet.getRow(currentRow++);
                    row2.getCell(1).value = entry.payrollNumber ? String(entry.payrollNumber) : '';
                    row2.getCell(2).value = row1.getCell(2).value;
                    row2.getCell(3).value = row1.getCell(3).value;
                    row2.getCell(4).value = row1.getCell(4).value;
                    row2.getCell(5).value = entry.kraPin;
                    row2.getCell(6).value = emp?.nssfNo || '';
                    row2.getCell(7).value = '102';
                    row2.getCell(8).value = gross;
                    row2.getCell(9).value = '1';
                    row2.getCell(10).value = tier2Member.toString();
                    row2.getCell(11).value = tier2Employer.toString();
                    row2.getCell(12).value = (tier2Member + tier2Employer).toString();
                    totalRecordsCount++;
                }
            }

            const totalContributions = totalMemberNssf + totalEmployerNssf;
            sheet.getCell('B2').value = employerPin;
            sheet.getCell('B3').value = ((client as any).nssfEmployerNo || '').replace(/^NSSF/i, '');
            sheet.getCell('B4').value = client.name || '';
            sheet.getCell('B5').value = periodMMYYYY;
            sheet.getCell('B6').value = totalIncome.toString();
            sheet.getCell('B7').value = totalMemberNssf.toString();
            sheet.getCell('B8').value = totalEmployerNssf.toString();
            sheet.getCell('B9').value = totalContributions.toString();
            sheet.getCell('B10').value = totalRecordsCount.toString();

            await workbook.xlsx.writeFile(filePath);

            const clientNameEnc = encodeURIComponent(path.basename(workspaceDir));
            nssfFileUrl = `/clients/${clientNameEnc}/${fileLabel}`;
            nssfFileLabel = fileLabel;
        }
    }

    if (opts.generateSha) {
        const fileLabel = `${timestamp}_${employerPin}_SHA.xlsx`;
        const filePath = path.join(workspaceDir, fileLabel);

        const templatePath = path.join(__dirname, '../../templates/Payroll Template (6).xlsx');
        if (fs.existsSync(templatePath)) {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(templatePath);
            const sheet = workbook.worksheets[0];

            const sheetWithValidations = sheet as ExcelJS.Worksheet & {
                dataValidations?: { add: (range: string, validation: Record<string, unknown>) => void };
            };
            sheetWithValidations.dataValidations?.add('D2:D1048576', {
                type: 'list',
                allowBlank: true,
                showErrorMessage: true,
                errorStyle: 'stop',
                error: 'Please select a valid Identity Type',
                formulae: ['"Refugee ID,National ID,Alien ID,Passport Number"']
            });

            let r2 = 2;
            while (sheet.getRow(r2) && sheet.getRow(r2).getCell(1).value !== null && sheet.getRow(r2).getCell(1).value !== undefined) {
                for (let c = 1; c <= 9; c++) sheet.getRow(r2).getCell(c).value = null;
                r2++;
            }

            let currentRow2 = 2;
            for (const entry of entries) {
                const emp = empMap.get(entry.employeeId);
                const row = sheet.getRow(currentRow2++);
                row.getCell(1).value = entry.payrollNumber ? String(entry.payrollNumber) : '';
                row.getCell(2).value = entry.employeeName ? entry.employeeName.split(' ').slice(0, -1).join(' ') || entry.employeeName : '';
                row.getCell(3).value = entry.employeeName ? entry.employeeName.split(' ').pop() || '' : '';
                row.getCell(4).value = 'National ID';
                row.getCell(5).value = emp?.idNumber ? String(emp.idNumber) : '';
                row.getCell(6).value = entry.kraPin;
                row.getCell(7).value = emp?.shaNo || '';
                row.getCell(8).value = entry.shaDeduction.toString();
                row.getCell(9).value = emp?.phone ? String(emp.phone) : '';
            }

            await workbook.xlsx.writeFile(filePath);

            const clientNameEnc = encodeURIComponent(path.basename(workspaceDir));
            shaFileUrl = `/clients/${clientNameEnc}/${fileLabel}`;
            shaFileLabel = fileLabel;
        }
    }

    return {
        payeZipUrl,
        payeZipLabel,
        nssfFileUrl,
        nssfFileLabel,
        shaFileUrl,
        shaFileLabel,
        summaryAmounts,
    };
}
