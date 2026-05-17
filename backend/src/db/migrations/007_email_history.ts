import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('email_history')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull())
        .addColumn('employeeId', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('employeeName', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('kraPin', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('emailAddress', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('documentType', 'text', (col) => col.notNull().defaultTo('')) // payslip, p9
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending')) // sent, failed
        .addColumn('errorMessage', 'text', (col) => col.defaultTo(null))
        .addColumn('sentAt', 'text', (col) => col.notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('email_history').execute();
}
