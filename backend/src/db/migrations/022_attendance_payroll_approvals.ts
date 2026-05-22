import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('attendance_payroll_approvals')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull())
        .addColumn('period', 'text', (col) => col.notNull())
        .addColumn('employeeId', 'integer', (col) => col.notNull())
        .addColumn('employeeName', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('absentDays', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('lateHours', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('overtimeHours', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('overtimeRate', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('overtimeMultiplier', 'real', (col) => col.notNull().defaultTo(1.5))
        .addColumn('overtimeAmount', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('approvedBy', 'text')
        .addColumn('approvedAt', 'text')
        .addColumn('createdAt', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .execute();

    await db.schema
        .createIndex('idx_attendance_payroll_approvals_client_period')
        .on('attendance_payroll_approvals')
        .columns(['clientId', 'period'])
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('attendance_payroll_approvals').ifExists().execute();
}
