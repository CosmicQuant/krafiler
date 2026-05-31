import { Kysely, SqliteDialect } from 'kysely';
import path from 'path';
import { Database as KyselyDatabase } from './schema';

const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, 'krafiler.sqlite');

function createKyselyDb() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const dialect = new SqliteDialect({
        database: new Database(dbPath),
    });
    return new Kysely<KyselyDatabase>({ dialect });
}

export const db = process.env.DATABASE_MODE === 'firestore'
    ? ({} as Kysely<KyselyDatabase>)
    : createKyselyDb();
