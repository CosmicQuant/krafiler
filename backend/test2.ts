import { generateComplianceFiles } from './src/scripts/axon-extraction-engine';
generateComplianceFiles('C:/Users/ADMIN/Downloads/Axon_Populated_Payroll_Test_2026-04-22 (2).csv', { employerName: '', employerPin: '', nssfEmployerNo: '', periodMMYYYY: '' }).then(() => console.log('Done')).catch(console.error);
