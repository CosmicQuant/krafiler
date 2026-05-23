import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('payroll_entries')
        .addColumn('updatedAt', 'text', (col) => col.notNull().defaultTo(new Date().toISOString()))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    // SQLite does not support dropping columns directly via Kysely
    // This is handled via loaded JSON schema if needed
}
