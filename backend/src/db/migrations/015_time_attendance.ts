import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('employees')
        .addColumn('standardCheckOut', 'text', (col) => col.notNull().defaultTo('17:00'))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('employees').dropColumn('standardCheckOut').execute();
}
