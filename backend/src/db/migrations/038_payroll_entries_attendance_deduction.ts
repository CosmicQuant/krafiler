import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('payroll_entries')
    .addColumn('attendanceDeduction', 'real', (col) => col.defaultTo(0))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('payroll_entries')
    .dropColumn('attendanceDeduction')
    .execute();
}
