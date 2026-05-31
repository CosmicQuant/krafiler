import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    try {
        await db.schema
            .alterTable('loan_transactions')
            .addColumn('clientId', 'integer')
            .execute();
    } catch {
        // Column may already exist; ignore
    }
}

export async function down(db: Kysely<any>): Promise<void> {
    try {
        await db.schema
            .alterTable('loan_transactions')
            .dropColumn('clientId')
            .execute();
    } catch {
        // Column may not exist; ignore
    }
}
