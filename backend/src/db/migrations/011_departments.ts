import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('departments')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull().references('clients.id').onDelete('cascade'))
        .addColumn('name', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('headEmployeeId', 'integer')
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .addColumn('updatedAt', 'text', (col) => col.notNull())
        .execute();

    await db.schema
        .alterTable('employees')
        .addColumn('departmentId', 'integer')
        .execute();

    await db.schema
        .alterTable('employees')
        .addColumn('role', 'text', (col) => col.notNull().defaultTo('employee'))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('employees').dropColumn('departmentId').execute();
    await db.schema.alterTable('employees').dropColumn('role').execute();
    await db.schema.dropTable('departments').execute();
}
