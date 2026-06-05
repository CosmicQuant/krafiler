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

export type DocumentRecord = {
    id: string;
    clientId: string;
    name: string;
    category?: string;
    url?: string;
    size?: number;
    mimeType?: string;
    uploadedAt?: string;
    [key: string]: any;
};

export function useFirestoreDocuments(clientId?: string) {
    const [documents, setDocuments] = useState<DocumentRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !clientId) {
            setDocuments([]);
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, 'documents'),
            where('ownerUid', '==', uid),
            where('clientId', '==', clientId)
        );

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const data = snapshot.docs.map((d) => ({
                    id: d.id,
                    ...d.data(),
                })) as DocumentRecord[];
                setDocuments(data);
                setLoading(false);
            },
            (err) => {
                console.error('[useFirestoreDocuments] Listener error:', err);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [clientId]);

    return { documents, loading };
}

export async function createDocument(clientId: string, data: Partial<DocumentRecord>) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');
    return addDoc(collection(db, 'documents'), {
        ...data,
        clientId,
        ownerUid: uid,
        createdAt: serverTimestamp(),
    });
}

export async function updateDocument(id: string, data: Partial<DocumentRecord>) {
    return updateDoc(doc(db, 'documents', id), {
        ...data,
        updatedAt: serverTimestamp(),
    });
}

export async function deleteDocument(id: string) {
    return deleteDoc(doc(db, 'documents', id));
}
