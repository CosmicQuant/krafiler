import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('employees').addColumn('standardCheckIn', 'text', (col) => col.notNull().defaultTo('08:00')).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('employees').dropColumn('standardCheckIn').execute();
}
