import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('attendance_records')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull().references('clients.id').onDelete('cascade'))
        .addColumn('employeeId', 'integer', (col) => col.notNull())
        .addColumn('employeeName', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('kraPin', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('date', 'text', (col) => col.notNull())
        .addColumn('checkIn', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('checkOut', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('Present'))
        .addColumn('notes', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .addColumn('updatedAt', 'text', (col) => col.notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('attendance_records').execute();
}
