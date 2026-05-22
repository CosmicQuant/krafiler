import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('payroll_entries')
        .addColumn('taxableBonus', 'real', (col) => col.notNull().defaultTo(0))
        .execute();
    await db.schema.alterTable('payroll_entries')
        .addColumn('nonTaxableBonus', 'real', (col) => col.notNull().defaultTo(0))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('payroll_entries')
        .dropColumn('taxableBonus')
        .execute();
    await db.schema.alterTable('payroll_entries')
        .dropColumn('nonTaxableBonus')
        .execute();
}
