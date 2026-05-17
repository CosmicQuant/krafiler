import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('employees')
        .addColumn('passwordHash', 'text')
        .execute();

    await db.schema
        .alterTable('employees')
        .addColumn('passwordChangedAt', 'text')
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('employees')
        .dropColumn('passwordHash')
        .execute();

    await db.schema
        .alterTable('employees')
        .dropColumn('passwordChangedAt')
        .execute();
}
