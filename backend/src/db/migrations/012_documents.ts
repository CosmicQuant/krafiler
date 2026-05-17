import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('documents')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull().references('clients.id').onDelete('cascade'))
        .addColumn('employeeId', 'integer', (col) => col.notNull().references('employees.id').onDelete('cascade'))
        .addColumn('documentType', 'text', (col) => col.notNull().defaultTo('other'))
        .addColumn('fileName', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('originalName', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('fileSize', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('mimeType', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('notes', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('uploadedAt', 'text', (col) => col.notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('documents').execute();
}
