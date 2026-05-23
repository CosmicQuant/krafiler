import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('payroll_adjustments')
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('payrollRunId', 'integer', (col) => col.notNull())
        .addColumn('payrollEntryId', 'integer', (col) => col.notNull())
        .addColumn('type', 'text', (col) => col.notNull().defaultTo('allowance'))
        .addColumn('label', 'text', (col) => col.notNull())
        .addColumn('amount', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('isStatutory', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .execute();

    await db.schema
        .createIndex('idx_adjustments_payrollRunId').on('payroll_adjustments').column('payrollRunId')
        .execute();

    await db.schema
        .createIndex('idx_adjustments_payrollEntryId').on('payroll_adjustments').column('payrollEntryId')
        .execute();

    await db.schema
        .createIndex('idx_adjustments_type').on('payroll_adjustments').column('type')
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('payroll_adjustments').ifExists().execute();
}
