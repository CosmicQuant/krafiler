import { Router } from 'express';
import multer from 'multer';
import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { logAudit } from '../services/auditService';
import { AuthenticatedRequest } from '../middleware/verifyAuth';
import { uploadBuffer, getSignedDownloadUrl, deleteFile, docPath } from '../lib/cloudStorage';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

const DOCUMENTS_COLLECTION = 'documents';

router.get('/:clientId/employees/:employeeId/documents', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const employeeId = req.params.employeeId;
        const snapshot = await adminDb
            .collection(DOCUMENTS_COLLECTION)
            .where('ownerUid', '==', uid)
            .where('clientId', '==', clientId)
            .where('employeeId', '==', employeeId)
            .orderBy('uploadedAt', 'desc')
            .get();
        res.json(snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (err) {
        console.error('Error fetching documents from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/:clientId/employees/:employeeId/documents/upload', upload.single('file'), async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const employeeId = req.params.employeeId;
        if (!req.file) return res.status(400).json({ message: 'No file provided' });
        const { documentType, notes } = req.body;
        const now = Timestamp.now();

        const safeName = `${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const gcsPath = docPath(uid, clientId, safeName);
        await uploadBuffer(req.file.buffer, gcsPath, {
            contentType: req.file.mimetype,
            metadata: {
                originalName: req.file.originalname,
                uploadedBy: uid,
            },
        });

        const docRef = await adminDb.collection(DOCUMENTS_COLLECTION).add({
            ownerUid: uid,
            clientId,
            employeeId,
            documentType: documentType || 'other',
            gcsPath,
            originalName: req.file.originalname,
            fileSize: req.file.size,
            mimeType: req.file.mimetype,
            notes: notes || '',
            uploadedAt: now,
        });
        const doc = await docRef.get();
        const record = { id: doc.id, ...doc.data() };
        logAudit({
            clientId: clientId as any,
            employeeId: employeeId as any,
            action: 'UPLOAD',
            entityType: 'document',
            entityId: doc.id as any,
            newValues: record,
            performedBy: 'admin',
        } as any);
        res.status(201).json(record);
    } catch (err) {
        console.error('Error uploading document to Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/:clientId/documents/:id/download', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;
        const doc = await adminDb.collection(DOCUMENTS_COLLECTION).doc(id).get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Document not found' });
        }
        const data = doc.data() as any;
        if (!data.gcsPath) {
            return res.status(404).json({ message: 'File not found in storage' });
        }
        const signedUrl = await getSignedDownloadUrl(data.gcsPath, 15);
        res.redirect(signedUrl);
    } catch (err) {
        console.error('Error downloading document:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.delete('/:clientId/documents/:id', async (req: AuthenticatedRequest, res) => {
    try {
        const uid = req.user!.uid;
        const clientId = req.params.clientId;
        const id = req.params.id;
        const docRef = adminDb.collection(DOCUMENTS_COLLECTION).doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data()?.ownerUid !== uid || doc.data()?.clientId !== clientId) {
            return res.status(404).json({ message: 'Document not found' });
        }
        const data = doc.data() as any;
        if (data.gcsPath) {
            await deleteFile(data.gcsPath).catch(() => {});
        }
        await docRef.delete();
        logAudit({
            clientId: clientId as any,
            employeeId: data.employeeId as any,
            action: 'DELETE',
            entityType: 'document',
            entityId: id as any,
            oldValues: { id: doc.id, ...data },
            performedBy: 'admin',
        } as any);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting document from Firestore:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
