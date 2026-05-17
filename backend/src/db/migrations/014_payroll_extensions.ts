import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('clients')
        .addColumn('payStructure', 'text', (col) => col.notNull().defaultTo('fixed'))
        .execute();

    await db.schema
        .createTable('overtime_records')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull().references('clients.id').onDelete('cascade'))
        .addColumn('employeeId', 'integer', (col) => col.notNull())
        .addColumn('period', 'text', (col) => col.notNull())
        .addColumn('hours', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('rate', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('multiplier', 'real', (col) => col.notNull().defaultTo(1))
        .addColumn('amount', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('overtimePay', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('absentDays', 'integer', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('lateDays', 'integer', (col) => col.notNull().defaultTo(0))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('payroll_entries').dropColumn('lateDays').execute();
    await db.schema.alterTable('payroll_entries').dropColumn('absentDays').execute();
    await db.schema.alterTable('payroll_entries').dropColumn('overtimePay').execute();
    await db.schema.dropTable('overtime_records').execute();
    await db.schema.alterTable('clients').dropColumn('payStructure').execute();
}
