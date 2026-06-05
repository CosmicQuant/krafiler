import { useState, useEffect } from 'react';
import {
    collection,
    query,
    where,
    onSnapshot,
    addDoc,
    doc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';

export type PayrollRun = {
    id: string;
    clientId: string;
    period: string;
    status: 'draft' | 'closed';
    lockedAt?: string;
    createdAt?: string;
    [key: string]: any;
};

export function useFirestorePayrollRuns(clientId?: string) {
    const [runs, setRuns] = useState<PayrollRun[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !clientId) {
            setRuns([]);
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, 'payrollRuns'),
            where('ownerUid', '==', uid),
            where('clientId', '==', clientId)
        );

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const data = snapshot.docs.map((d) => ({
                    id: d.id,
                    ...d.data(),
                })) as PayrollRun[];
                setRuns(data);
                setLoading(false);
            },
            (err) => {
                console.error('[useFirestorePayrollRuns] Listener error:', err);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [clientId]);

    return { runs, loading };
}

export async function createPayrollRun(clientId: string, data: Partial<PayrollRun>) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');
    return addDoc(collection(db, 'payrollRuns'), {
        ...data,
        clientId,
        ownerUid: uid,
        status: 'draft',
        createdAt: serverTimestamp(),
    });
}

export async function updatePayrollRun(id: string, data: Partial<PayrollRun>) {
    return updateDoc(doc(db, 'payrollRuns', id), {
        ...data,
        updatedAt: serverTimestamp(),
    });
}

export async function deletePayrollRun(id: string) {
    return deleteDoc(doc(db, 'payrollRuns', id));
}
