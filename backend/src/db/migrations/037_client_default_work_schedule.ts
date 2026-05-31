import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('clients')
    .addColumn('defaultWorkScheduleId', 'integer')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('clients')
    .dropColumn('defaultWorkScheduleId')
    .execute();
}
