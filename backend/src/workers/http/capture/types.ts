/**
 * Capture types for HTTP and Playwright filing flows.
 *
 * Every job can optionally record request/response pairs, HTML snapshots,
 * console logs, and HAR files. Captures are uploaded to Cloud Storage and
 * linked to the job document so developers can replay flows locally.
 */

export type CaptureStep =
    | 'login-start'
    | 'login-end'
    | 'captcha-solve'
    | 'navigate-returns-start'
    | 'navigate-returns-end'
    | 'select-obligation-start'
    | 'select-obligation-end'
    | 'form-load'
    | 'form-submit'
    | 'post-submit'
    | 'receipt-download-start'
    | 'receipt-download-end'
    | 'error'
    | 'custom';

export type CaptureArtifactType =
    | 'request'
    | 'response'
    | 'snapshot'
    | 'console'
    | 'har'
    | 'dialog'
    | 'token'
    | 'form-fields'
    | 'screenshot'
    | 'metadata';

export interface CaptureHttpRequest {
    method: string;
    url: string;
    headers: Record<string, string | string[]>;
    body?: string | Record<string, unknown>;
}

export interface CaptureHttpResponse {
    statusCode: number;
    statusMessage?: string;
    headers: Record<string, string | string[]>;
    body: string | Buffer;
}

export interface CaptureHttpEntry {
    seq: number;
    step: CaptureStep;
    timestamp: string;
    request: CaptureHttpRequest;
    response: CaptureHttpResponse;
}

export interface CaptureConsoleEntry {
    type: 'log' | 'warn' | 'error' | 'info' | 'debug';
    text: string;
    timestamp: string;
    location?: { url?: string; lineNumber?: number; columnNumber?: number };
}

export interface CaptureDialogEntry {
    type: string;
    message: string;
    timestamp: string;
}

export interface CaptureTokenEntry {
    timestamp: string;
    tokenKey: string | null;
    source: string;
}

export interface CaptureFormFieldsEntry {
    timestamp: string;
    selector: string;
    fields: Record<string, string | undefined>;
}

export interface CaptureArtifactMeta {
    seq: number;
    step: CaptureStep;
    type: CaptureArtifactType;
    fileName: string;
    gcsPath: string;
    url?: string;
    statusCode?: number;
    label?: string;
    description?: string;
    timestamp: string;
    contentType: string;
    sizeBytes: number;
}

export interface CaptureManifest {
    jobId: string;
    userId: string;
    clientId?: string;
    taxObligationType: string;
    isNil?: boolean;
    kraPin?: string;
    startedAt: string;
    finishedAt?: string;
    outcome?: 'success' | 'failure' | 'cancelled' | 'unknown';
    artifacts: CaptureArtifactMeta[];
}

export interface CaptureOptions {
    /** Enable capture for this job. Can be overridden by KRA_CAPTURE_ENABLED env var. */
    enabled: boolean;
    /** Capture screenshots (expensive). Defaults to false. */
    screenshots?: boolean;
    /** Retention days hint (used for metadata only; lifecycle rule handles actual deletion). */
    retentionDays?: number;
}
