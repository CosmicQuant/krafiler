import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('employees')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull().references('clients.id').onDelete('cascade'))
        .addColumn('payrollNumber', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('employeeName', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('idNumber', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('kraPin', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('nssfNo', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('shaNo', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('phone', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('email', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('bankName', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('bankAccount', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('bankCode', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('department', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('jobTitle', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('employmentType', 'text', (col) => col.notNull().defaultTo('Permanent'))
        .addColumn('employmentStatus', 'text', (col) => col.notNull().defaultTo('Active'))
        .addColumn('dateJoined', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('dateLeft', 'text')
        .addColumn('basicPay', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .addColumn('updatedAt', 'text', (col) => col.notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('employees').execute();
}
