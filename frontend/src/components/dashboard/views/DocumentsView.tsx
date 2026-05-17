import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../../services/api';
import { Upload, Download, Trash2, FileText, FileImage, FileArchive, File } from 'lucide-react';

interface Doc {
    id: number;
    employeeId: number;
    documentType: string;
    fileName: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
    notes: string;
    uploadedAt: string;
}

interface Employee {
    id: number;
    employeeName: string;
}

const TYPE_OPTIONS = ['contract', 'id', 'certificate', 'other'];

function fileIcon(mime: string) {
    if (mime.startsWith('image/')) return <FileImage className="h-4 w-4 text-blue-500" />;
    if (mime.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />;
    if (mime.includes('zip') || mime.includes('rar')) return <FileArchive className="h-4 w-4 text-amber-500" />;
    return <File className="h-4 w-4 text-slate-400" />;
}

function formatSize(bytes: number) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function DocumentsView({ client }: { client: { id: number; name: string } }) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [selectedEmpId, setSelectedEmpId] = useState<number | null>(null);
    const [docs, setDocs] = useState<Doc[]>([]);
    const [loading, setLoading] = useState(false);
    const [docType, setDocType] = useState('other');
    const [docNotes, setDocNotes] = useState('');
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        apiFetch(`/clients/${client.id}/employees`).then(r => r.ok && r.json()).then(d => setEmployees(d || [])).catch(() => {});
    }, [client.id]);

    const fetchDocs = async (empId: number) => {
        setLoading(true);
        try {
            const r = await apiFetch(`/clients/${client.id}/employees/${empId}/documents`);
            if (r.ok) setDocs(await r.json());
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selectedEmpId) fetchDocs(selectedEmpId);
        else setDocs([]);
    }, [selectedEmpId]);

    const handleUpload = async () => {
        const file = fileRef.current?.files?.[0];
        if (!file || !selectedEmpId) return;
        setUploading(true);
        try {
            const form = new FormData();
            form.append('file', file);
            form.append('documentType', docType);
            form.append('notes', docNotes);
            const r = await apiFetch(`/clients/${client.id}/employees/${selectedEmpId}/documents/upload`, { method: 'POST', body: form });
            if (r.ok) {
                if (fileRef.current) fileRef.current.value = '';
                setDocNotes('');
                fetchDocs(selectedEmpId);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setUploading(false);
        }
    };

    const deleteDoc = async (doc: Doc) => {
        if (!confirm(`Delete ${doc.originalName}?`)) return;
        const r = await apiFetch(`/clients/${client.id}/documents/${doc.id}`, { method: 'DELETE' });
        if (r.ok && selectedEmpId) fetchDocs(selectedEmpId);
    };

    const downloadDoc = (doc: Doc) => {
        window.open(`/api/clients/${client.id}/documents/${doc.id}/download`, '_blank');
    };

    return (
        <div className="p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800">Documents</h3>

            <div className="flex items-center gap-3">
                <select
                    value={selectedEmpId || ''}
                    onChange={e => setSelectedEmpId(e.target.value ? parseInt(e.target.value) : null)}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs max-w-xs"
                >
                    <option value="">Select employee...</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.employeeName}</option>)}
                </select>
            </div>

            {selectedEmpId && (
                <>
                    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <input ref={fileRef} type="file" className="flex-1 text-xs" />
                        <select value={docType} onChange={e => setDocType(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs">
                            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <input value={docNotes} onChange={e => setDocNotes(e.target.value)} placeholder="Notes" className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs w-40" />
                        <button onClick={handleUpload} disabled={uploading} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition disabled:opacity-40">
                            <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading...' : 'Upload'}
                        </button>
                    </div>

                    {loading ? (
                        <p className="text-xs text-slate-400">Loading...</p>
                    ) : docs.length === 0 ? (
                        <p className="text-xs text-slate-400">No documents uploaded for this employee.</p>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-slate-50 text-left text-slate-500">
                                        <th className="px-4 py-2.5 font-semibold">File</th>
                                        <th className="px-4 py-2.5 font-semibold">Type</th>
                                        <th className="px-4 py-2.5 font-semibold">Size</th>
                                        <th className="px-4 py-2.5 font-semibold">Notes</th>
                                        <th className="px-4 py-2.5 font-semibold">Uploaded</th>
                                        <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {docs.map(d => (
                                        <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                                            <td className="px-4 py-2">
                                                <span className="flex items-center gap-2 font-medium text-slate-800">
                                                    {fileIcon(d.mimeType)} {d.originalName}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2 text-slate-500 capitalize">{d.documentType}</td>
                                            <td className="px-4 py-2 text-slate-500">{formatSize(d.fileSize)}</td>
                                            <td className="px-4 py-2 text-slate-500 max-w-[200px] truncate">{d.notes || '—'}</td>
                                            <td className="px-4 py-2 text-slate-500">{formatDate(d.uploadedAt)}</td>
                                            <td className="px-4 py-2 text-right">
                                                <button onClick={() => downloadDoc(d)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Download className="h-3.5 w-3.5" /></button>
                                                <button onClick={() => deleteDoc(d)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
