import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('payroll_entries')
        .addColumn('carBenefit', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('mealsBenefit', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('nonCashBenefits', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('housingBenefit', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('otherBenefits', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('overrides', 'text', (col) => col.defaultTo(null))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('carBenefit')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('mealsBenefit')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('nonCashBenefits')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('housingBenefit')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('otherBenefits')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('overrides')
        .execute();
}
