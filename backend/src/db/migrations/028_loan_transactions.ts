import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('loan_transactions')
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('clientId', 'integer', (col) => col.notNull())
        .addColumn('employeeId', 'integer', (col) => col.notNull())
        .addColumn('payrollRunId', 'integer', (col) => col.notNull())
        .addColumn('loanId', 'integer', (col) => col.notNull())
        .addColumn('amount', 'real', (col) => col.notNull())
        .addColumn('type', 'text', (col) => col.notNull().defaultTo('deduction'))
        .addColumn('createdAt', 'text', (col) => col.notNull())
        .execute();

    await db.schema
        .createIndex('idx_loan_tx_clientId').on('loan_transactions').column('clientId')
        .execute();

    await db.schema
        .createIndex('idx_loan_tx_employeeId').on('loan_transactions').column('employeeId')
        .execute();

    await db.schema
        .createIndex('idx_loan_tx_payrollRunId').on('loan_transactions').column('payrollRunId')
        .execute();

    await db.schema
        .createIndex('idx_loan_tx_loanId').on('loan_transactions').column('loanId')
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('loan_transactions').ifExists().execute();
}
