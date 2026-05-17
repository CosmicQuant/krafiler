import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('payroll_runs')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull().references('clients.id').onDelete('cascade'))
        .addColumn('period', 'text', (col) => col.notNull())
        .addColumn('periodLabel', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('draft'))
        .addColumn('totalEmployees', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('totalGross', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('totalDeductions', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('totalNet', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('notes', 'text')
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .addColumn('updatedAt', 'text', (col) => col.notNull())
        .execute();

    await db.schema
        .createTable('payroll_entries')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('payrollRunId', 'integer', (col) => col.notNull().references('payroll_runs.id').onDelete('cascade'))
        .addColumn('clientId', 'integer', (col) => col.notNull())
        .addColumn('employeeId', 'integer', (col) => col.notNull())
        .addColumn('employeeName', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('kraPin', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('payrollNumber', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('basicPay', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('benefits', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('grossPay', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('shaDeduction', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('nssfDeduction', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('ahlDeduction', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('otherDeductions', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('totalDeductions', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('taxablePay', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('payeTax', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('netPay', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('daysWorked', 'integer', (col) => col.notNull().defaultTo(30))
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .execute();

    await db.schema
        .createIndex('idx_payroll_runs_client_period')
        .on('payroll_runs')
        .columns(['clientId', 'period'])
        .execute();

    await db.schema
        .createIndex('idx_payroll_entries_run')
        .on('payroll_entries')
        .columns(['payrollRunId'])
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('payroll_entries').execute();
    await db.schema.dropTable('payroll_runs').execute();
}
