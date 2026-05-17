import { db } from '../db/kysely';

export async function logAudit(params: {
    clientId: number;
    employeeId?: number;
    action: string;
    entityType: string;
    entityId?: number;
    oldValues?: any;
    newValues?: any;
    performedBy: string;
}): Promise<void> {
    try {
        await db.insertInto('audit_log').values({
            clientId: params.clientId,
            employeeId: params.employeeId || null,
            action: params.action,
            entityType: params.entityType,
            entityId: params.entityId || null,
            oldValues: params.oldValues ? JSON.stringify(params.oldValues) : null,
            newValues: params.newValues ? JSON.stringify(params.newValues) : null,
            performedBy: params.performedBy || 'system',
            createdAt: new Date().toISOString(),
        }).execute();
    } catch (err) {
        console.error('Audit log error:', err);
    }
}
