import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('clients')
        .addColumn('logoUrl', 'text')
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('clients')
        .dropColumn('logoUrl')
        .execute();
}
