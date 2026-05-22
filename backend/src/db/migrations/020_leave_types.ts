import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    // Add isPaid column to leave_requests
    await db.schema
        .alterTable('leave_requests')
        .addColumn('isPaid', 'integer', (col) => col.notNull().defaultTo(1))
        .execute();

    // Create a table for clients to define their own leave types
    await db.schema
        .createTable('leave_types')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull().references('clients.id').onDelete('cascade'))
        .addColumn('name', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('isPaid', 'integer', (col) => col.notNull().defaultTo(1))
        .addColumn('maxDaysPerYear', 'integer', (col) => col.defaultTo(null))
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .addColumn('updatedAt', 'text', (col) => col.notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('leave_requests').dropColumn('isPaid').execute();
    await db.schema.dropTable('leave_types').execute();
}
