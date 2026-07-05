import {
    CaptureArtifactMeta,
    CaptureArtifactType,
    CaptureConsoleEntry,
    CaptureDialogEntry,
    CaptureFormFieldsEntry,
    CaptureHttpEntry,
    CaptureManifest,
    CaptureOptions,
    CaptureStep,
    CaptureTokenEntry,
} from './types';

/**
 * In-memory capture context for a single job.
 *
 * Collects artifacts during a filing run and delegates uploads to a
 * CaptureUploader when the job finishes (or incrementally for long runs).
 */
export class CaptureContext {
    private jobId: string;
    private userId: string;
    private clientId?: string;
    private taxObligationType: string;
    private isNil: boolean;
    private kraPin?: string;
    private options: CaptureOptions;
    private artifacts: CaptureArtifactMeta[] = [];
    private seq = 0;
    private startedAt: string;
    private consoleEntries: CaptureConsoleEntry[] = [];
    private dialogEntries: CaptureDialogEntry[] = [];
    private tokenEntries: CaptureTokenEntry[] = [];
    private formFieldsEntries: CaptureFormFieldsEntry[] = [];
    private uploader?: CaptureUploader;

    constructor(opts: {
        jobId: string;
        userId: string;
        clientId?: string;
        taxObligationType: string;
        isNil?: boolean;
        kraPin?: string;
        options: CaptureOptions;
        uploader?: CaptureUploader;
    }) {
        this.jobId = opts.jobId;
        this.userId = opts.userId;
        this.clientId = opts.clientId;
        this.taxObligationType = opts.taxObligationType;
        this.isNil = opts.isNil ?? false;
        this.kraPin = opts.kraPin;
        this.options = opts.options;
        this.uploader = opts.uploader;
        this.startedAt = new Date().toISOString();
    }

    get enabled(): boolean {
        return this.options.enabled;
    }

    get captureScreenshots(): boolean {
        return !!this.options.screenshots;
    }

    get prefix(): string {
        return `captures/${this.jobId}`;
    }

    nextSeq(): number {
        this.seq += 1;
        return this.seq;
    }

    artifactPath(seq: number, step: CaptureStep, type: CaptureArtifactType, ext: string): string {
        const stepSlug = step.replace(/[^a-z0-9-]/g, '-');
        const typeSlug = type.replace(/[^a-z0-9-]/g, '-');
        return `${this.prefix}/${String(seq).padStart(4, '0')}-${stepSlug}-${typeSlug}.${ext}`;
    }

    manifestPath(): string {
        return `${this.prefix}/manifest.json`;
    }

    recordArtifact(meta: CaptureArtifactMeta): void {
        this.artifacts.push(meta);
    }

    recordConsole(entry: CaptureConsoleEntry): void {
        this.consoleEntries.push(entry);
    }

    recordDialog(entry: CaptureDialogEntry): void {
        this.dialogEntries.push(entry);
    }

    recordToken(entry: CaptureTokenEntry): void {
        this.tokenEntries.push(entry);
    }

    recordFormFields(entry: CaptureFormFieldsEntry): void {
        this.formFieldsEntries.push(entry);
    }

    async uploadHttpEntry(entry: CaptureHttpEntry): Promise<void> {
        if (!this.enabled || !this.uploader) return;
        await this.uploader.uploadHttpEntry(this, entry);
    }

    async uploadBuffer(
        step: CaptureStep,
        type: CaptureArtifactType,
        buffer: Buffer,
        ext: string,
        contentType: string,
        meta?: Partial<Omit<CaptureArtifactMeta, 'seq' | 'step' | 'type' | 'fileName' | 'gcsPath' | 'timestamp' | 'contentType' | 'sizeBytes'>>
    ): Promise<void> {
        if (!this.enabled || !this.uploader) return;
        await this.uploader.uploadBuffer(this, step, type, buffer, ext, contentType, meta);
    }

    async uploadText(
        step: CaptureStep,
        type: CaptureArtifactType,
        text: string,
        ext: string,
        contentType: string,
        meta?: Partial<Omit<CaptureArtifactMeta, 'seq' | 'step' | 'type' | 'fileName' | 'gcsPath' | 'timestamp' | 'contentType' | 'sizeBytes'>>
    ): Promise<void> {
        if (!this.enabled || !this.uploader) return;
        await this.uploader.uploadBuffer(this, step, type, Buffer.from(text, 'utf-8'), ext, contentType, meta);
    }

    async flushConsoleBuffer(): Promise<void> {
        if (!this.enabled || !this.uploader || this.consoleEntries.length === 0) return;
        await this.uploader.uploadJson(this, 'custom', 'console', this.consoleEntries);
        this.consoleEntries = [];
    }

    async flushDialogBuffer(): Promise<void> {
        if (!this.enabled || !this.uploader || this.dialogEntries.length === 0) return;
        await this.uploader.uploadJson(this, 'custom', 'dialog', this.dialogEntries);
        this.dialogEntries = [];
    }

    async flushTokenBuffer(): Promise<void> {
        if (!this.enabled || !this.uploader || this.tokenEntries.length === 0) return;
        await this.uploader.uploadJson(this, 'custom', 'token', this.tokenEntries);
        this.tokenEntries = [];
    }

    async flushFormFieldsBuffer(): Promise<void> {
        if (!this.enabled || !this.uploader || this.formFieldsEntries.length === 0) return;
        await this.uploader.uploadJson(this, 'custom', 'form-fields', this.formFieldsEntries);
        this.formFieldsEntries = [];
    }

    buildManifest(outcome: CaptureManifest['outcome'] = 'unknown'): CaptureManifest {
        return {
            jobId: this.jobId,
            userId: this.userId,
            clientId: this.clientId,
            taxObligationType: this.taxObligationType,
            isNil: this.isNil,
            kraPin: this.kraPin,
            startedAt: this.startedAt,
            finishedAt: new Date().toISOString(),
            outcome,
            artifacts: this.artifacts,
        };
    }

    async finalize(outcome: CaptureManifest['outcome'] = 'unknown'): Promise<{ manifestGcsPath?: string }> {
        if (!this.enabled || !this.uploader) return {};

        await this.flushConsoleBuffer();
        await this.flushDialogBuffer();
        await this.flushTokenBuffer();
        await this.flushFormFieldsBuffer();

        const manifest = this.buildManifest(outcome);
        const manifestGcsPath = await this.uploader.uploadManifest(this, manifest);
        return { manifestGcsPath };
    }
}

// Forward declaration to avoid circular dependency; actual type imported by consumers.
export interface CaptureUploader {
    uploadHttpEntry(context: CaptureContext, entry: CaptureHttpEntry): Promise<void>;
    uploadBuffer(
        context: CaptureContext,
        step: CaptureStep,
        type: CaptureArtifactType,
        buffer: Buffer,
        ext: string,
        contentType: string,
        meta?: Partial<Omit<CaptureArtifactMeta, 'seq' | 'step' | 'type' | 'fileName' | 'gcsPath' | 'timestamp' | 'contentType' | 'sizeBytes'>>
    ): Promise<void>;
    uploadJson(context: CaptureContext, step: CaptureStep, type: CaptureArtifactType, data: unknown): Promise<void>;
    uploadManifest(context: CaptureContext, manifest: CaptureManifest): Promise<string>;
}
