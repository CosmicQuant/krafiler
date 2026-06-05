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

export type Employee = {
    id: string;
    clientId: string;
    employeeName: string;
    kraPin: string;
    idNumber?: string;
    email?: string;
    phone?: string;
    department?: string;
    jobTitle?: string;
    employmentType?: string;
    employmentStatus?: string;
    dateJoined?: string;
    basicPay?: number;
    nssfNo?: string;
    nhifNo?: string;
    shaNo?: string;
    bankName?: string;
    bankAccount?: string;
    bankCode?: string;
    [key: string]: any;
};

export function useFirestoreEmployees(clientId?: string) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !clientId) {
            setEmployees([]);
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, 'employees'),
            where('ownerUid', '==', uid),
            where('clientId', '==', clientId)
        );

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const data = snapshot.docs.map((d) => ({
                    id: d.id,
                    ...d.data(),
                })) as Employee[];
                setEmployees(data);
                setLoading(false);
            },
            (err) => {
                console.error('[useFirestoreEmployees] Listener error:', err);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [clientId]);

    return { employees, loading };
}

export async function createEmployee(clientId: string, data: Partial<Employee>) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');
    return addDoc(collection(db, 'employees'), {
        ...data,
        clientId,
        ownerUid: uid,
        createdAt: serverTimestamp(),
    });
}

export async function updateEmployee(id: string, data: Partial<Employee>) {
    return updateDoc(doc(db, 'employees', id), {
        ...data,
        updatedAt: serverTimestamp(),
    });
}

export async function deleteEmployee(id: string) {
    return deleteDoc(doc(db, 'employees', id));
}
