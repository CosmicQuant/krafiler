import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('work_schedules')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull())
        .addColumn('name', 'text', (col) => col.notNull())
        // JSON: { "Mon": 8, "Tue": 8, "Wed": 8, "Thu": 8, "Fri": 8, "Sat": 4, "Sun": 0 }
        .addColumn('config', 'text', (col) => col.notNull().defaultTo('{}'))
        .addColumn('standardCheckIn', 'text', (col) => col.notNull().defaultTo('08:00'))
        .addColumn('standardCheckOut', 'text', (col) => col.notNull().defaultTo('17:00'))
        .addColumn('saturdayCheckOut', 'text')
        .addColumn('createdAt', 'text', (col) => col.notNull().defaultTo(new Date().toISOString()))
        .addColumn('updatedAt', 'text', (col) => col.notNull().defaultTo(new Date().toISOString()))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('work_schedules').ifExists().execute();
}
