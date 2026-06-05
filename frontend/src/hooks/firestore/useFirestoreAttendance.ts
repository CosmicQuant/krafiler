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

export type AttendanceRecord = {
    id: string;
    clientId: string;
    employeeId: string;
    date: string;
    status: 'P' | 'A' | 'L' | 'H' | 'O';
    notes?: string;
    hoursWorked?: number;
    [key: string]: any;
};

export function useFirestoreAttendance(clientId?: string, employeeId?: string, month?: string) {
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || !clientId) {
            setRecords([]);
            setLoading(false);
            return;
        }

        let q = query(
            collection(db, 'attendanceRecords'),
            where('ownerUid', '==', uid),
            where('clientId', '==', clientId)
        );

        if (employeeId) {
            q = query(q, where('employeeId', '==', employeeId));
        }

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                let data = snapshot.docs.map((d) => ({
                    id: d.id,
                    ...d.data(),
                })) as AttendanceRecord[];
                if (month) {
                    data = data.filter((r) => r.date?.startsWith(month));
                }
                setRecords(data);
                setLoading(false);
            },
            (err) => {
                console.error('[useFirestoreAttendance] Listener error:', err);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [clientId, employeeId, month]);

    return { records, loading };
}

export async function createAttendanceRecord(clientId: string, data: Partial<AttendanceRecord>) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not authenticated');
    return addDoc(collection(db, 'attendanceRecords'), {
        ...data,
        clientId,
        ownerUid: uid,
        createdAt: serverTimestamp(),
    });
}

export async function updateAttendanceRecord(id: string, data: Partial<AttendanceRecord>) {
    return updateDoc(doc(db, 'attendanceRecords', id), {
        ...data,
        updatedAt: serverTimestamp(),
    });
}

export async function deleteAttendanceRecord(id: string) {
    return deleteDoc(doc(db, 'attendanceRecords', id));
}
