import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('clients')
        .addColumn('incomeTaxResidentIndividual', 'text', (col) => col.defaultTo('na'))
        .execute();
    await db.schema.alterTable('clients')
        .addColumn('incomeTaxNonResidentIndividual', 'text', (col) => col.defaultTo('na'))
        .execute();
    await db.schema.alterTable('clients')
        .addColumn('incomeTaxCompany', 'text', (col) => col.defaultTo('na'))
        .execute();
    await db.schema.alterTable('clients')
        .addColumn('exciseDuty', 'text', (col) => col.defaultTo('na'))
        .execute();

    await db.schema.alterTable('clients')
        .addColumn('incomeTaxResidentIndividualLastFiledDate', 'text')
        .execute();
    await db.schema.alterTable('clients')
        .addColumn('incomeTaxResidentIndividualReceiptUrl', 'text')
        .execute();
    await db.schema.alterTable('clients')
        .addColumn('incomeTaxNonResidentIndividualLastFiledDate', 'text')
        .execute();
    await db.schema.alterTable('clients')
        .addColumn('incomeTaxNonResidentIndividualReceiptUrl', 'text')
        .execute();
    await db.schema.alterTable('clients')
        .addColumn('incomeTaxCompanyLastFiledDate', 'text')
        .execute();
    await db.schema.alterTable('clients')
        .addColumn('incomeTaxCompanyReceiptUrl', 'text')
        .execute();
    await db.schema.alterTable('clients')
        .addColumn('exciseDutyLastFiledDate', 'text')
        .execute();
    await db.schema.alterTable('clients')
        .addColumn('exciseDutyReceiptUrl', 'text')
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('clients')
        .dropColumn('incomeTaxResidentIndividual')
        .dropColumn('incomeTaxNonResidentIndividual')
        .dropColumn('incomeTaxCompany')
        .dropColumn('exciseDuty')
        .dropColumn('incomeTaxResidentIndividualLastFiledDate')
        .dropColumn('incomeTaxResidentIndividualReceiptUrl')
        .dropColumn('incomeTaxNonResidentIndividualLastFiledDate')
        .dropColumn('incomeTaxNonResidentIndividualReceiptUrl')
        .dropColumn('incomeTaxCompanyLastFiledDate')
        .dropColumn('incomeTaxCompanyReceiptUrl')
        .dropColumn('exciseDutyLastFiledDate')
        .dropColumn('exciseDutyReceiptUrl')
        .execute();
}
