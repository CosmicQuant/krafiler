import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('payroll_entries')
        .addColumn('lockedAt', 'text', (col) => col)
        .execute();

    // Ensure status has a default for new rows
    await db.schema
        .alterTable('payroll_runs')
        .addColumn('lockedAt', 'text', (col) => col)
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('payroll_entries')
        .dropColumn('lockedAt')
        .execute();

    await db.schema
        .alterTable('payroll_runs')
        .dropColumn('lockedAt')
        .execute();
}
