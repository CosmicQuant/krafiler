import { useEffect, useState } from 'react';
import { X, FileText, Image as ImageIcon, Download, Code, AlertCircle } from 'lucide-react';
import { fetchCaptureManifest, captureArtifactUrl, CaptureManifest, CaptureArtifact, ApiError } from '../services/api';

interface CaptureViewerProps {
    jobId: string;
    onClose: () => void;
}

const stepOrder: Record<string, number> = {
    'login-start': 1,
    'login-end': 2,
    'captcha-solve': 3,
    'navigate-returns-start': 4,
    'navigate-returns-end': 5,
    'select-obligation-start': 6,
    'select-obligation-end': 7,
    'form-load': 8,
    'form-submit': 9,
    'post-submit': 10,
    'receipt-download-start': 11,
    'receipt-download-end': 12,
    'error': 99,
    'custom': 100,
};

function artifactIcon(type: string) {
    switch (type) {
        case 'screenshot':
        case 'har':
            return <ImageIcon className="w-4 h-4" />;
        case 'request':
        case 'response':
            return <Code className="w-4 h-4" />;
        default:
            return <FileText className="w-4 h-4" />;
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CaptureViewer({ jobId, onClose }: CaptureViewerProps) {
    const [manifest, setManifest] = useState<CaptureManifest | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedArtifact, setSelectedArtifact] = useState<CaptureArtifact | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                setLoading(true);
                setError(null);
                const data = await fetchCaptureManifest(jobId);
                if (cancelled) return;
                setManifest(data);
            } catch (err) {
                if (cancelled) return;
                const msg = err instanceof ApiError ? err.message : 'Failed to load captures';
                setError(msg);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [jobId]);

    const grouped = manifest?.artifacts.reduce((acc, artifact) => {
        if (!acc[artifact.step]) acc[artifact.step] = [];
        acc[artifact.step].push(artifact);
        return acc;
    }, {} as Record<string, CaptureArtifact[]>) ?? {};

    const sortedSteps = Object.keys(grouped).sort((a, b) =>
        (stepOrder[a] ?? 50) - (stepOrder[b] ?? 50)
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-800">Job Capture</h2>
                        <p className="text-sm text-slate-500 font-mono">{jobId}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-slate-200 transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5 text-slate-600" />
                    </button>
                </div>

                {loading && (
                    <div className="flex-1 flex items-center justify-center text-slate-500">
                        Loading captures...
                    </div>
                )}

                {!loading && error && (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-600 p-8">
                        <AlertCircle className="w-10 h-10 text-amber-500 mb-3" />
                        <p>{error}</p>
                    </div>
                )}

                {!loading && !manifest && !error && (
                    <div className="flex-1 flex items-center justify-center text-slate-500">
                        No captures found for this job.
                    </div>
                )}

                {manifest && (
                    <div className="flex-1 flex overflow-hidden">
                        <div className="w-80 border-r border-slate-200 overflow-y-auto bg-slate-50 p-4">
                            <div className="mb-4 text-xs text-slate-500">
                                <div>Type: <span className="font-medium text-slate-700">{manifest.taxObligationType}</span></div>
                                <div>Outcome: <span className="font-medium text-slate-700">{manifest.outcome ?? 'unknown'}</span></div>
                                <div>Artifacts: <span className="font-medium text-slate-700">{manifest.artifacts.length}</span></div>
                            </div>

                            {sortedSteps.map((step) => (
                                <div key={step} className="mb-4">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{step}</h3>
                                    <div className="space-y-1">
                                        {grouped[step]
                                            .sort((a, b) => a.seq - b.seq)
                                            .map((artifact) => (
                                                <button
                                                    key={artifact.seq}
                                                    onClick={() => setSelectedArtifact(artifact)}
                                                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition-colors ${
                                                        selectedArtifact?.seq === artifact.seq
                                                            ? 'bg-blue-100 text-blue-800'
                                                            : 'hover:bg-white text-slate-700'
                                                    }`}
                                                >
                                                    {artifactIcon(artifact.type)}
                                                    <span className="flex-1 truncate">{artifact.type}</span>
                                                    <span className="text-[10px] text-slate-400">{formatBytes(artifact.sizeBytes)}</span>
                                                </button>
                                            ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex-1 bg-white overflow-hidden flex flex-col">
                            {selectedArtifact ? (
                                <>
                                    <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                                        <div className="text-sm font-medium text-slate-700">
                                            {selectedArtifact.fileName}
                                            {selectedArtifact.statusCode !== undefined && (
                                                <span className="ml-2 text-xs text-slate-500">({selectedArtifact.statusCode})</span>
                                            )}
                                        </div>
                                        <a
                                            href={captureArtifactUrl(jobId, selectedArtifact.fileName)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                                        >
                                            <Download className="w-3 h-3" />
                                            Open
                                        </a>
                                    </div>
                                    <div className="flex-1 overflow-auto p-0">
                                        {selectedArtifact.contentType.startsWith('image/') ? (
                                            <img
                                                src={captureArtifactUrl(jobId, selectedArtifact.fileName)}
                                                alt={selectedArtifact.fileName}
                                                className="w-full h-auto"
                                            />
                                        ) : (
                                            <iframe
                                                src={captureArtifactUrl(jobId, selectedArtifact.fileName)}
                                                title={selectedArtifact.fileName}
                                                className="w-full h-full border-0"
                                                sandbox="allow-same-origin"
                                            />
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                                    Select an artifact to preview
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
