import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('employees').addColumn('identityType', 'text', (col) => col.notNull().defaultTo('National ID')).execute();
    await db.schema.alterTable('employees').addColumn('residentialStatus', 'text', (col) => col.notNull().defaultTo('Resident')).execute();
    await db.schema.alterTable('employees').addColumn('typeOfEmployee', 'text', (col) => col.notNull().defaultTo('Primary Employee')).execute();
    await db.schema.alterTable('employees').addColumn('pwd', 'text', (col) => col.notNull().defaultTo('No')).execute();
    await db.schema.alterTable('employees').addColumn('exemptionCert', 'text', (col) => col.notNull().defaultTo('')).execute();
    await db.schema.alterTable('employees').addColumn('carBenefit', 'real', (col) => col.notNull().defaultTo(0)).execute();
    await db.schema.alterTable('employees').addColumn('mealsBenefit', 'real', (col) => col.notNull().defaultTo(0)).execute();
    await db.schema.alterTable('employees').addColumn('nonCashBenefits', 'real', (col) => col.notNull().defaultTo(0)).execute();
    await db.schema.alterTable('employees').addColumn('typeOfHousing', 'text', (col) => col.notNull().defaultTo('Benefit not given')).execute();
    await db.schema.alterTable('employees').addColumn('housingBenefit', 'real', (col) => col.notNull().defaultTo(0)).execute();
    await db.schema.alterTable('employees').addColumn('otherBenefits', 'real', (col) => col.notNull().defaultTo(0)).execute();
    await db.schema.alterTable('employees').addColumn('otherPension', 'real', (col) => col.notNull().defaultTo(0)).execute();
    await db.schema.alterTable('employees').addColumn('postRetMedical', 'real', (col) => col.notNull().defaultTo(0)).execute();
    await db.schema.alterTable('employees').addColumn('mortgageInterest', 'real', (col) => col.notNull().defaultTo(0)).execute();
    await db.schema.alterTable('employees').addColumn('insuranceRelief', 'real', (col) => col.notNull().defaultTo(0)).execute();
    await db.schema.alterTable('employees').addColumn('payStructure', 'text', (col) => col.notNull().defaultTo('fixed')).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('employees').dropColumn('identityType').execute();
    await db.schema.alterTable('employees').dropColumn('residentialStatus').execute();
    await db.schema.alterTable('employees').dropColumn('typeOfEmployee').execute();
    await db.schema.alterTable('employees').dropColumn('pwd').execute();
    await db.schema.alterTable('employees').dropColumn('exemptionCert').execute();
    await db.schema.alterTable('employees').dropColumn('carBenefit').execute();
    await db.schema.alterTable('employees').dropColumn('mealsBenefit').execute();
    await db.schema.alterTable('employees').dropColumn('nonCashBenefits').execute();
    await db.schema.alterTable('employees').dropColumn('typeOfHousing').execute();
    await db.schema.alterTable('employees').dropColumn('housingBenefit').execute();
    await db.schema.alterTable('employees').dropColumn('otherBenefits').execute();
    await db.schema.alterTable('employees').dropColumn('otherPension').execute();
    await db.schema.alterTable('employees').dropColumn('postRetMedical').execute();
    await db.schema.alterTable('employees').dropColumn('mortgageInterest').execute();
    await db.schema.alterTable('employees').dropColumn('insuranceRelief').execute();
    await db.schema.alterTable('employees').dropColumn('payStructure').execute();
}
