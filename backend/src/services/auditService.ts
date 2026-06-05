import { adminDb } from '../lib/firebaseAdmin';

export async function logAudit(params: {
    clientId: number | string;
    employeeId?: number | string;
    action: string;
    entityType: string;
    entityId?: number | string;
    oldValues?: any;
    newValues?: any;
    performedBy: string;
}): Promise<void> {
    try {
        await adminDb.collection('auditLogs').add({
            clientId: params.clientId,
            employeeId: params.employeeId || null,
            action: params.action,
            entityType: params.entityType,
            entityId: params.entityId || null,
            oldValues: params.oldValues ? JSON.stringify(params.oldValues) : null,
            newValues: params.newValues ? JSON.stringify(params.newValues) : null,
            performedBy: params.performedBy || 'system',
            createdAt: new Date().toISOString(),
        });
    } catch (err) {
        console.error('Audit log error:', err);
    }
}
