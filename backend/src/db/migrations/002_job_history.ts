import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('job_history')
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('jobId', 'text', (col) => col.notNull())
        .addColumn('clientPin', 'text', (col) => col.notNull())
        .addColumn('taxObligation', 'text', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull()) // 'completed' | 'failed'
        .addColumn('receiptPath', 'text')
        .addColumn('receiptNumber', 'text')
        .addColumn('errorMessage', 'text')
        .addColumn('startedAt', 'text', (col) => col.notNull())
        .addColumn('completedAt', 'text', (col) => col.notNull())
        .addColumn('durationMs', 'integer', (col) => col.notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('job_history').execute();
}
