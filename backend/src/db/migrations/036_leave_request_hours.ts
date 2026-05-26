import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('leave_requests')
        .addColumn('hours', 'real', (col) => col.defaultTo(0))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('leave_requests')
        .dropColumn('hours')
        .execute();
}
