import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('employees').addColumn('bonusPay', 'real', (col) => col.notNull().defaultTo(0)).execute();
    await db.schema.alterTable('payroll_entries').addColumn('bonusPay', 'real', (col) => col.notNull().defaultTo(0)).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('employees').dropColumn('bonusPay').execute();
    await db.schema.alterTable('payroll_entries').dropColumn('bonusPay').execute();
}
