import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('loans')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull().references('clients.id').onDelete('cascade'))
        .addColumn('employeeId', 'integer', (col) => col.notNull())
        .addColumn('employeeName', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('kraPin', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('loanType', 'text', (col) => col.notNull().defaultTo('Salary Advance'))
        .addColumn('principal', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('monthlyDeduction', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('installments', 'integer', (col) => col.notNull().defaultTo(1))
        .addColumn('remainingInstallments', 'integer', (col) => col.notNull().defaultTo(1))
        .addColumn('interestRate', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('totalInterest', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('totalRepayable', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('amountPaid', 'real', (col) => col.notNull().defaultTo(0))
        .addColumn('status', 'text', (col) => col.notNull().defaultTo('Approved'))
        .addColumn('disbursedAt', 'text', (col) => col.defaultTo(null))
        .addColumn('notes', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .addColumn('updatedAt', 'text', (col) => col.notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('loans').execute();
}
