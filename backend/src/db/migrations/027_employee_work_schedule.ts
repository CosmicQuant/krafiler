import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
        await db.schema
        .alterTable('employees')
        .addColumn('workScheduleId', 'integer')
        .execute();

    await db.schema
        .alterTable('employees')
        .addColumn('offDay', 'text')
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('employees')
        .dropColumn('workScheduleId')
        .execute();

    await db.schema
        .alterTable('employees')
        .dropColumn('offDay')
        .execute();
}
