import { Router } from 'express';
import multer from 'multer';
import { openDb } from '../db/database';
import path from 'path';
import fs from 'fs/promises';

const router = Router();
const upload = multer({ dest: path.resolve(__dirname, '..', '..', 'tmp') });

// Get all clients
router.get('/', async (req, res) => {
    try {
        const db = await openDb();
        const clients = await db.all('SELECT * FROM clients');
        res.json(clients);
    } catch (err) {
        console.error('Error fetching clients:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update or upload master CSV
router.post('/:id/master-csv', upload.single('masterCsv'), async (req, res) => {
    try {
        const clientId = req.params.id;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const db = await openDb();
        const client = await db.get('SELECT * FROM clients WHERE id = ?', [clientId]);
        if (!client) {
            await fs.unlink(file.path);
            return res.status(404).json({ message: 'Client not found' });
        }

        const targetDir = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients', client.name);
        await fs.mkdir(targetDir, { recursive: true });
        
        const targetPath = path.join(targetDir, file.originalname);
        await fs.rename(file.path, targetPath);

        const fileUrl = `/clients/${encodeURIComponent(client.name)}/${file.originalname}`;

        await db.run('UPDATE clients SET masterFileUrl = ?, masterFileLabel = ? WHERE id = ?', [
            fileUrl,
            file.originalname,
            clientId
        ]);

        res.json({ message: 'Master CSV updated successfully', masterFileUrl: fileUrl, masterFileLabel: file.originalname });
    } catch (err) {
        console.error('Error updating master CSV:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Remove master CSV
router.delete('/:id/master-csv', async (req, res) => {
    try {
        const clientId = req.params.id;
        const db = await openDb();
        const client = await db.get('SELECT masterFileUrl, name FROM clients WHERE id = ?', [clientId]);
        
        if (!client) {
            return res.status(404).json({ message: 'Client not found' });
        }

        if (client.masterFileUrl) {
            try {
                // Decode the URI component to get the true filename from the URL route
                const decUrl = decodeURIComponent(client.masterFileUrl);
                const relPath = decUrl.replace(/^\/clients\//, '');
                // The DB stores paths like /clients/Client Name/Filename.csv
                const absolutePath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'clients', relPath);
                
                const stats = await fs.stat(absolutePath).catch(() => null);
                if (stats) {
                    await fs.unlink(absolutePath);
                }
            } catch (fsErr) {
                console.error('Error unlinking existing master CSV:', fsErr);
            }
        }

        await db.run('UPDATE clients SET masterFileUrl = NULL, masterFileLabel = NULL WHERE id = ?', [clientId]);
        res.json({ success: true, message: 'Master CSV deleted' });
        
    } catch (err) {
        console.error('Error deleting Master CSV:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Add new client
router.post('/', async (req, res) => {
    try {
        const { name, pin, password, obligations } = req.body;
        if (!name || !pin || !password) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const db = await openDb();
        const result = await db.run(
            `INSERT INTO clients (name, pin, password, obligations) VALUES (?, ?, ?, ?)`,
            [name, pin, password, obligations || '']
        );
        
        const newClient = await db.get('SELECT * FROM clients WHERE id = ?', [result.lastID]);
        res.status(201).json(newClient);
    } catch (err) {
        console.error('Error adding client:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update payroll source URL 
router.post('/:id/payroll-source', async (req, res) => {
    try {
        const { payrollSourceUrl } = req.body;
        const clientId = req.params.id;
        
        const db = await openDb();
        await db.run('UPDATE clients SET payrollSourceUrl = ? WHERE id = ?', [payrollSourceUrl, clientId]);
        
        res.json({ message: 'Updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;