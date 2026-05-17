import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('audit_log')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull().references('clients.id').onDelete('cascade'))
        .addColumn('employeeId', 'integer')
        .addColumn('action', 'text', (col) => col.notNull())
        .addColumn('entityType', 'text', (col) => col.notNull())
        .addColumn('entityId', 'integer')
        .addColumn('oldValues', 'text')
        .addColumn('newValues', 'text')
        .addColumn('performedBy', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('audit_log').execute();
}
