import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('payroll_entries')
        .addColumn('stdPayAmount', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('holidayHours', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('holidayPayAmount', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('paidLeaveHours', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('paidLeavePayAmount', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('absentHours', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('absentDedAmount', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('lateHours', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('lateDedAmount', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('unpaidLeaveHours', 'real', (col) => col.notNull().defaultTo(0))
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .addColumn('unpaidLeaveDedAmount', 'real', (col) => col.notNull().defaultTo(0))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('stdPayAmount')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('holidayHours')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('holidayPayAmount')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('paidLeaveHours')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('paidLeavePayAmount')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('absentHours')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('absentDedAmount')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('lateHours')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('lateDedAmount')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('unpaidLeaveHours')
        .execute();

    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('unpaidLeaveDedAmount')
        .execute();
}
