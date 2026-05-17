import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { db } from '../db/kysely';
import { logAudit } from '../services/auditService';

const uploadDir = path.join(__dirname, '../../uploads/documents');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

router.get('/:clientId/employees/:employeeId/documents', async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const employeeId = parseInt(req.params.employeeId, 10);
        if (isNaN(clientId) || isNaN(employeeId)) return res.status(400).json({ message: 'Invalid ID' });
        const docs = await db.selectFrom('documents').selectAll().where('clientId', '=', clientId).where('employeeId', '=', employeeId).orderBy('uploadedAt', 'desc').execute();
        res.json(docs);
    } catch (err) {
        console.error('Error fetching documents:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/:clientId/employees/:employeeId/documents/upload', upload.single('file'), async (req, res) => {
    try {
        const clientId = parseInt(req.params.clientId, 10);
        const employeeId = parseInt(req.params.employeeId, 10);
        if (isNaN(clientId) || isNaN(employeeId)) return res.status(400).json({ message: 'Invalid ID' });
        if (!req.file) return res.status(400).json({ message: 'No file provided' });
        const { documentType, notes } = req.body;
        const now = new Date().toISOString();
        const result = await db.insertInto('documents').values({
            clientId,
            employeeId,
            documentType: documentType || 'other',
            fileName: req.file.filename,
            originalName: req.file.originalname,
            fileSize: req.file.size,
            mimeType: req.file.mimetype,
            notes: notes || '',
            uploadedAt: now,
        }).executeTakeFirst();
        const id = Number(result.insertId || 0);
        const doc = await db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirst();
        logAudit({
            clientId,
            employeeId,
            action: 'UPLOAD',
            entityType: 'document',
            entityId: id,
            newValues: doc,
            performedBy: 'admin',
        });

        res.status(201).json(doc);
    } catch (err) {
        console.error('Error uploading document:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/:clientId/documents/:id/download', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });
        const doc = await db.selectFrom('documents').selectAll().where('id', '=', id).where('clientId', '=', clientId).executeTakeFirst();
        if (!doc) return res.status(404).json({ message: 'Document not found' });
        const filePath = path.join(uploadDir, doc.fileName);
        if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found on disk' });
        res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${doc.originalName}"`);
        res.sendFile(filePath);
    } catch (err) {
        console.error('Error downloading document:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.delete('/:clientId/documents/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const clientId = parseInt(req.params.clientId, 10);
        if (isNaN(id) || isNaN(clientId)) return res.status(400).json({ message: 'Invalid ID' });
        const doc = await db.selectFrom('documents').selectAll().where('id', '=', id).where('clientId', '=', clientId).executeTakeFirst();
        if (!doc) return res.status(404).json({ message: 'Document not found' });
        const filePath = path.join(uploadDir, doc.fileName);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        await db.deleteFrom('documents').where('id', '=', id).execute();

        logAudit({
            clientId,
            employeeId: doc.employeeId,
            action: 'DELETE',
            entityType: 'document',
            entityId: id,
            oldValues: doc,
            performedBy: 'admin',
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting document:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
