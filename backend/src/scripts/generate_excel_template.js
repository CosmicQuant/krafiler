const ExcelJS = require('exceljs');

async function generateMasterTemplate() {
    const workbook = new ExcelJS.Workbook();
    // Force Excel to recalculate all formulas when the file is opened
    workbook.calcProperties.fullCalcOnLoad = true;

    const sheet = workbook.addWorksheet('Master Payroll Data');

    // 0. Add Company Info Header (Expanded Preamble)
    sheet.addRow(['COMPANY NAME:', '']);
    sheet.addRow(['COMPANY KRA PIN:', '']);
    sheet.addRow(['COMPANY NSSF NO:', '']);
    sheet.addRow(['NSSF LOGIN ID', '', 'NSSF PASSWORD', '']);
    sheet.addRow(['SHA LOGIN ID', '', 'SHA PASSWORD', '']);
    sheet.addRow([]); // Blank row for spacing

    // Style Company Info
    [1, 2, 3].forEach(rowIndex => {
        sheet.getCell(A+rowIndex).font = { bold: true };
        sheet.getCell(B+rowIndex).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF0B3' } // Light yellow to indicate editable
        };
        // Force text format for PIN and NSSF to prevent zero-dropping
        if (rowIndex === 2 || rowIndex === 3) {
            sheet.getCell(B+rowIndex).numFmt = '@';
        }
    });

    [4, 5].forEach(rowIndex => {
        sheet.getCell(A+rowIndex).font = { bold: true, color: { argb: 'FF475569' } };
        sheet.getCell(C+rowIndex).font = { bold: true, color: { argb: 'FF475569' } };
        
        sheet.getCell(B+rowIndex).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        sheet.getCell(D+rowIndex).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        
        sheet.getCell(B+rowIndex).numFmt = '@';
        sheet.getCell(D+rowIndex).numFmt = '@';
    });

    // 1. Define the exact 30 headers (Including all manual and calculated fields)
    const headers = [
        "Payroll Number",                     // A
        "PIN of Employee",                    // B
        "ID Number",                          // C
        "Identity Type",                      // D
        "Name of Employee",                   // E
        "SHA No",                             // F
        "NSSF No",                            // G
        "Residential Status",                 // H
        "Type of Employee",                   // I
        "Persons with Disability(PWD)",       // J
        "Exemption Certificate",              // K
        "Total Cash Pay (A)",                 // L
        "Value of Car Benefit (B)",           // M
        "Value of Meals (C)",                 // N
        "Non Cash Benefits (D)",              // O
        "Type of Housing",                    // P
        "Housing Benefit (F)",                // Q
        "Other Benefits (G)",                 // R
        "Total Gross Pay (Ksh) (H)",          // S (Calculated)
        "Social Health Insurance Fund (I)",   // T (Calculated)
        "NSSF Contribution (J)",              // U (Calculated)
        "Other Pension Contribution (K)",     // V
        "Post Retirement Medical Fund (L)",   // W
        "Mortgage Interest (M)",              // X
        "Affordable Housing Levy (N)",        // Y (Calculated)
        "Taxable Pay(Ksh) (O)",               // Z (Calculated)
        "Monthly Personal Relief (Ksh) (P)",  // AA (Calculated)
        "Amount of Insurance Relief (Q)",     // AB
        "PAYE Tax (Ksh) (R)",                 // AC (Calculated)
        "Self Assessed PAYE Tax (Ksh) (S)"    // AD (Calculated)
    ];

    // Add headers to the sheet
    sheet.addRow(headers);

    // Format the header row (Bold, dark background) - Now row 7
    const headerRow = sheet.getRow(7);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' } // Slate 800
    };

    // Highlight Calculated Headers in Green
    const calcColumns = [19, 20, 21, 25, 26, 27, 29, 30]; // S, T, U, Y, Z, AA, AC, AD
    calcColumns.forEach(colIndex => {
        const cell = headerRow.getCell(colIndex);
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF065F46' } // Emerald 800
        };
    });

    // Set column widths for readability
    sheet.columns.forEach(col => { col.width = 22; });

    // 2. Add Dropdowns, Number Formatting, and Formulas for 500 rows (starting from Row 8)
    for (let i = 8; i <= 507; i++) {

        // --- DROPDOWNS (DATA VALIDATION) ---
        sheet.getCell(D+i).dataValidation = {
            type: 'list', allowBlank: true, formulae: ['"National ID,Passport,Alien ID,Refugee ID"']
        };
        sheet.getCell(H+i).dataValidation = {
            type: 'list', allowBlank: true, formulae: ['"Resident,Non-Resident"']
        };
        sheet.getCell(I+i).dataValidation = {
            type: 'list', allowBlank: true, formulae: ['"Primary Employee,Secondary Employee"']
        };
        sheet.getCell(J+i).dataValidation = {
            type: 'list', allowBlank: true, formulae: ['"No,Yes"']
        };
        sheet.getCell(P+i).dataValidation = {
            type: 'list', allowBlank: true, formulae: ['"Benefit not given,Employers Owned House,Employers Rented House,Agricultural Farm"']
        };

        // --- FORCE TEXT FORMATTING FOR IDENTIFIERS ---
        ['A', 'B', 'C', 'F', 'G'].forEach(col => {
            sheet.getCell(col+i).numFmt = '@';
        });

        // --- AUTO-CALCULATION FORMULAS (EXCEL NATIVE) ---
        // Make calculated cells visually distinct with a light green background
        const calcFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } }; // Emerald 50

        // S: Gross Pay (H) = A+B+C+D+F+G
        const cellS = sheet.getCell(S+i);
        cellS.value = { formula: IF(E+i+="","",SUM(L+i+:O+i+) + Q+i+ + R+i+) };
        cellS.fill = calcFill;

        // T: SHIF (I) = 2.75% of Gross
        const cellT = sheet.getCell(T+i);
        cellT.value = { formula: IF(E+i+="","",S+i+*0.0275) };
        cellT.fill = calcFill;

        // U: NSSF (J) = Phase 4 (6% of gross up to 108,000. Max 6480)
        const cellU = sheet.getCell(U+i);
        cellU.value = { formula: IF(E+i+="","",IF(S+i+>0, MIN(S+i+*0.06, 6480), 0)) };
        cellU.fill = calcFill;

        // Y: AHL (N) = 1.5% of Gross
        const cellY = sheet.getCell(Y+i);
        cellY.value = { formula: IF(E+i+="","",S+i+*0.015) };
        cellY.fill = calcFill;

        // Z: Taxable Pay (O) = Gross - Deductions - PWD Exemption(150k)
        const cellZ = sheet.getCell(Z+i);
        cellZ.value = { formula: IF(E+i+="","",MAX(0, S+i+ - T+i+ - U+i+ - V+i+ - W+i+ - X+i+ - Y+i+ - IF(J+i+="Yes", 150000, 0))) };
        cellZ.fill = calcFill;

        // AA: Personal Relief (P) = 2400 if Total Cash Pay > 0 or Employee Name is provided
        const cellAA = sheet.getCell(AA+i);
        cellAA.value = { formula: IF(E+i+="","",IF(OR(L+i+>0, E+i+<>""), 2400, 0)) };
        cellAA.fill = calcFill;

        // AC: PAYE Tax (R) = Graduated 2026 tax bands on Taxable Pay (Z) minus Reliefs (AA, AB)
        const cellAC = sheet.getCell(AC+i);
        // Using Excel's SUMPRODUCT/MAX equivalent for graduated tax
        cellAC.value = {
            formula: IF(E+i+="","",MAX(0, MAX(0, Z+i+*0.1) + MAX(0, (Z+i+-24000)*0.15) + MAX(0, (Z+i+-32333)*0.05) + MAX(0, (Z+i+-500000)*0.025) + MAX(0, (Z+i+-800000)*0.025) - AA+i+ - AB+i+))
        };
        cellAC.fill = calcFill;

        // AD: Self Assessed PAYE (S) = Matches PAYE (R)
        const cellAD = sheet.getCell(AD+i);
        cellAD.value = { formula: IF(E+i+="","",AC+i+) };
        cellAD.fill = calcFill;

        // Format all money columns (L through AD) to 2 decimal places
        for (let colCode = 76; colCode <= 90; colCode++) { // L (76) to Z (90)
            sheet.getCell(String.fromCharCode(colCode)+i).numFmt = '#,##0.00';
        }
        ['AA', 'AB', 'AC', 'AD'].forEach(col => {
            sheet.getCell(col+i).numFmt = '#,##0.00';
        });
    }

    // 3. Save the file
    const fileName = 'Axon_Unified_Payroll_Template_v5.xlsx';
    await workbook.xlsx.writeFile(fileName);
    console.log(✅ Success! Generated  with strict dropdown menus and live Excel Auto-Calculations.);
}

generateMasterTemplate().catch(console.error);
