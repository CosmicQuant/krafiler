import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('employees')
        .addColumn('hourlyRate', 'real', (col) => col.defaultTo(0))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('employees')
        .dropColumn('hourlyRate')
        .execute();
}
