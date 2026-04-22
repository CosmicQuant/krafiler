const fs = require('fs');
const fastCsv = require('fast-csv');
const path = 'C:/Users/ADMIN/Downloads/Axon_Populated_Payroll_Test_2026-04-22 (2).csv';
fs.createReadStream(path).pipe(fastCsv.parse({ headers: true, skipRows: 4 })).on('data', console.log).on('end', () => console.log('Done'));

