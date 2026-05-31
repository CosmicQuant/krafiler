import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('leave_requests')
        .addColumn('startTime', 'text', (col) => col.defaultTo(null))
        .execute();

    await db.schema
        .alterTable('leave_requests')
        .addColumn('endTime', 'text', (col) => col.defaultTo(null))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('leave_requests')
        .dropColumn('startTime')
        .execute();

    await db.schema
        .alterTable('leave_requests')
        .dropColumn('endTime')
        .execute();
}
