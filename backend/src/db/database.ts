import { logger } from '../logger';

export async function initDb() {
    logger.info('SQLite removed — skipping DB initialization');
}

export async function openDb(): Promise<any> {
    throw new Error('SQLite has been removed from this deployment');
}
