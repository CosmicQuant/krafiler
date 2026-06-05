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
import { db } from '../../lib/firebase';
import { auth } from '../../lib/firebase';
import { ClientObligation } from '../../types';

export function useFirestoreClients() {
    const [clients, setClients] = useState<ClientObligation[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid) {
            setClients([]);
            setLoading(false);
            return;
        }

        const q = query(collection(db, 'clients'), where('ownerUid', '==', uid));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const data = snapshot.docs.map((d) => ({
                    id: d.id,
                    ...d.data(),
                })) as ClientObligation[];
                setClients(data);
                setLoading(false);
            },
            (err) => {
                console.error('[useFirestoreClients] Listener error:', err);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, []);

    return { clients, loading };
}

export async function createClient(data: Partial<ClientObligation>) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');
    return addDoc(collection(db, 'clients'), {
        ...data,
        ownerUid: uid,
        createdAt: serverTimestamp(),
    });
}

export async function updateClient(id: string, data: Partial<ClientObligation>) {
    return updateDoc(doc(db, 'clients', id), {
        ...data,
        updatedAt: serverTimestamp(),
    });
}

export async function deleteClient(id: string) {
    return deleteDoc(doc(db, 'clients', id));
}
