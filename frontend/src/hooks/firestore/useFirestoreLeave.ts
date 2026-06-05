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

export type LeaveRequest = {
    id: string;
    clientId: string;
    employeeId: string;
    employeeName?: string;
    type: string;
    startDate: string;
    endDate: string;
    days: number;
    status: 'pending' | 'approved' | 'rejected';
    reason?: string;
    [key: string]: any;
};

export function useFirestoreLeave(clientId?: string, employeeId?: string) {
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !clientId) {
            setRequests([]);
            setLoading(false);
            return;
        }

        let q = query(
            collection(db, 'leaveRequests'),
            where('ownerUid', '==', uid),
            where('clientId', '==', clientId)
        );

        if (employeeId) {
            q = query(q, where('employeeId', '==', employeeId));
        }

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const data = snapshot.docs.map((d) => ({
                    id: d.id,
                    ...d.data(),
                })) as LeaveRequest[];
                setRequests(data);
                setLoading(false);
            },
            (err) => {
                console.error('[useFirestoreLeave] Listener error:', err);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [clientId, employeeId]);

    return { requests, loading };
}

export async function createLeaveRequest(clientId: string, data: Partial<LeaveRequest>) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');
    return addDoc(collection(db, 'leaveRequests'), {
        ...data,
        clientId,
        ownerUid: uid,
        status: 'pending',
        createdAt: serverTimestamp(),
    });
}

export async function updateLeaveRequest(id: string, data: Partial<LeaveRequest>) {
    return updateDoc(doc(db, 'leaveRequests', id), {
        ...data,
        updatedAt: serverTimestamp(),
    });
}

export async function deleteLeaveRequest(id: string) {
    return deleteDoc(doc(db, 'leaveRequests', id));
}
