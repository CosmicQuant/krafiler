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

export type Loan = {
    id: string;
    clientId: string;
    employeeId: string;
    employeeName?: string;
    amount: number;
    interestRate?: number;
    totalRepayable?: number;
    installmentAmount: number;
    remainingInstallments: number;
    startDate: string;
    status: 'active' | 'completed' | 'defaulted';
    [key: string]: any;
};

export function useFirestoreLoans(clientId?: string, employeeId?: string) {
    const [loans, setLoans] = useState<Loan[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !clientId) {
            setLoans([]);
            setLoading(false);
            return;
        }

        let q = query(
            collection(db, 'loans'),
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
                })) as Loan[];
                setLoans(data);
                setLoading(false);
            },
            (err) => {
                console.error('[useFirestoreLoans] Listener error:', err);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [clientId, employeeId]);

    return { loans, loading };
}

export async function createLoan(clientId: string, data: Partial<Loan>) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');
    return addDoc(collection(db, 'loans'), {
        ...data,
        clientId,
        ownerUid: uid,
        status: 'active',
        createdAt: serverTimestamp(),
    });
}

export async function updateLoan(id: string, data: Partial<Loan>) {
    return updateDoc(doc(db, 'loans', id), {
        ...data,
        updatedAt: serverTimestamp(),
    });
}

export async function deleteLoan(id: string) {
    return deleteDoc(doc(db, 'loans', id));
}
