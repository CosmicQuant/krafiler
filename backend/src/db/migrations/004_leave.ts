import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('leave_requests')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull().references('clients.id').onDelete('cascade'))
        .addColumn('employeeId', 'integer', (col) => col.notNull().references('employees.id').onDelete('cascade'))
        .addColumn('employeeName', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('kraPin', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('leaveType', 'text', (col) => col.notNull().defaultTo('Annual'))
        .addColumn('startDate', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('endDate', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('daysCount', 'integer', (col) => col.notNull().defaultTo(1))
        .addColumn('reason', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('Pending'))
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .addColumn('updatedAt', 'text', (col) => col.notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('leave_requests').execute();
}
