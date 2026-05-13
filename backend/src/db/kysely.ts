import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import path from 'path';
import { Database as KyselyDatabase } from './schema';

const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, 'krafiler.sqlite');

const dialect = new SqliteDialect({
    database: new Database(dbPath),
});

export const db = new Kysely<KyselyDatabase>({
    dialect,
});
