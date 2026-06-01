const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'taxpulse-498006' });
const db = admin.firestore();
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const bucket = storage.bucket('taxpulse');
const uid = 'l7xzLPqfR1bQcBRVZWVzjv61kqL2';

const GCS_MASTER_FILES = {
    '2': 'Karafuu_Restaurant_and_Investments_Limited_Standardized.csv',
    '40': 'Axon_Populated_Payroll_Test_2026-04-22 (2).csv',
    '95': 'Goldenclove_payroll (1)_Standardized.csv',
    '157': 'Goldenclove_payroll (1)_Standardized.csv',
    '158': 'JAHAWI PAYROLL_Standardized.csv',
    '160': 'Deacon_Manpower_Solutions_Payroll_May_2026 (1)_Standardized.csv',
};

function parseObligations(arr) {
    if (!Array.isArray(arr)) arr = [];
    const text = arr.join(' ').toLowerCase();
    const r = {
        paye: 'na', nssf: 'na', sha: 'na', vat: 'na', tot: 'na', mri: 'na',
        dst: 'na', eLevy: 'na', income_tax_resident_individual: 'na',
        income_tax_non_resident_individual: 'na', income_tax_company: 'na',
        excise_duty: 'na',
    };

    if (text.includes('paye')) r.paye = 'due';
    if (text.includes('nssf')) r.nssf = 'due';
    if (text.includes('sha')) r.sha = 'due';
    if (text.includes('vat')) r.vat = 'due';
    if (text.includes('tot') || text.includes('turnover')) r.tot = 'due';
    if (text.includes('mri') || text.includes('rental')) r.mri = 'due';
    if (text.includes('dst') || text.includes('elevy') || text.includes('e-levy')) r.dst = 'due';
    if (text.includes('excise')) r.excise_duty = 'due';
    if (text.includes('income') && text.includes('tax')) {
        if (text.includes('company') || text.includes('incometaxcompany') || text.includes('income_tax_company')) {
            r.income_tax_company = 'due';
        } else if (text.includes('non') || text.includes('non-resident') || text.includes('nonresident')) {
            r.income_tax_non_resident_individual = 'due';
        } else if (text.includes('resident')) {
            r.income_tax_resident_individual = 'due';
        } else {
            r.income_tax_resident_individual = 'due';
        }
    }
    return r;
}

async function getSignedUrl(clientId, filename) {
    const destination = `users/${uid}/clients/${clientId}/master-csv/${filename}`;
    const file = bucket.file(destination);
    try {
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        });
        return url;
    } catch (e) {
        console.error('Failed to generate signed URL for', clientId, filename, e.message);
        return null;
    }
}

async function repair() {
    const snap = await db.collection('clients').where('ownerUid', '==', uid).get();
    let updated = 0;
    let masterUpdated = 0;

    for (const doc of snap.docs) {
        const d = doc.data();
        const clientId = doc.id;
        const obs = parseObligations(d.obligations);
        const update = { ...obs };

        // Normalize obligations field to a comma-separated string for consistency
        const obligationTokens = Array.isArray(d.obligations) ? d.obligations : [];
        update.obligations = obligationTokens.join(', ');

        // Check if this client has a master CSV in GCS
        const masterFilename = GCS_MASTER_FILES[clientId];
        if (masterFilename) {
            const gcsPath = `users/${uid}/clients/${clientId}/master-csv/${masterFilename}`;
            const signedUrl = await getSignedUrl(clientId, masterFilename);
            update.masterFile = { gcsPath };
            update.masterFileLabel = masterFilename;
            if (signedUrl) {
                update.masterFileUrl = signedUrl;
            }
            masterUpdated++;
        }

        await db.collection('clients').doc(clientId).update(update);
        console.log('Repaired client', clientId, d.name || '', '-> paye:', obs.paye, 'vat:', obs.vat, 'tot:', obs.tot, 'mri:', obs.mri, 'master:', masterFilename || 'none');
        updated++;
    }

    console.log(`\nDone! Updated ${updated} clients. Set masterFile for ${masterUpdated} clients.`);
}

repair().catch(console.error);
