import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('holidays')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull())
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('date', 'text', (col) => col.notNull())  // ISO date string YYYY-MM-DD
        .addColumn('isRecurring', 'integer', (col) => col.notNull().defaultTo(0))  // 1 = recurring annually, 0 = one-time
        .addColumn('holidayType', 'text', (col) => col.notNull().defaultTo('public'))  // 'public', 'company'
        .addColumn('createdAt', 'text', (col) => col.notNull().defaultTo(new Date().toISOString()))
        .addColumn('updatedAt', 'text', (col) => col.notNull().defaultTo(new Date().toISOString()))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('holidays').ifExists().execute();
}
