import { KraHttpClient, KraHttpRequestOptions } from '../client/KraHttpClient';
import { KraError, KraErrorCode } from '../errors';
import { CaptureContext, CaptureStep } from '../capture';

export interface KraHttpSessionOptions {
    baseUrl?: string;
    timeout?: number;
    debug?: boolean;
    captureContext?: CaptureContext;
}

export class KraHttpSession {
    client: KraHttpClient;
    tokenKey: string | null = null;
    lastResponse: string | null = null;
    lastUrl: string | null = null;
    captureContext?: CaptureContext;

    constructor(options: KraHttpSessionOptions = {}) {
        this.captureContext = options.captureContext;
        this.client = new KraHttpClient({
            baseUrl: options.baseUrl,
            timeout: options.timeout,
            debug: options.debug,
            captureContext: options.captureContext,
        });
    }

    /**
     * Returns true if the session has been authenticated (token key set from a login response).
     * Used by HttpPrnService to skip re-login for subsequent PRN types in a multi-PRN flow.
     */
    isAuthenticated(): boolean {
        return this.tokenKey !== null && this.tokenKey !== '';
    }

    updateToken(html: string, source = 'response'): void {
        // Don't corrupt the session token if the response is a login/unauthenticated page.
        // KRA returns the login page when a token_key is invalid or the session has expired;
        // the login page contains its own token_key which is NOT a session-authenticated token.
        // Replacing the valid token with it would silently kill all subsequent requests.
        //
        // NOTE: "Kenya Revenue Authority" appears on EVERY KRA page (header/footer), so it
        // must NOT be used as a guard pattern — it would block token updates from the
        // authenticated dashboard returned after a successful login. Only use patterns that
        // are unique to the login page itself.
        if (/generatecaptchaservlet|<form[^>]+name=["']loginForm["']/i.test(html)) {
            return;
        }
        const match = html.match(/<input[^>]+name=["']token_key["'][^>]+value=["']([^"']+)["'][^>]*>/i);
        if (match && match[1] !== this.tokenKey) {
            this.tokenKey = match[1];
            this.captureContext?.recordToken({
                timestamp: new Date().toISOString(),
                tokenKey: this.tokenKey,
                source,
            });
        }
    }

    requireToken(): string {
        if (!this.tokenKey) {
            throw new Error('KRA session token_key is missing. A login or form fetch may have failed.');
        }
        return this.tokenKey;
    }

    async get(path: string, options?: KraHttpRequestOptions): Promise<string> {
        const response = await this.client.get(path, options);
        this.lastResponse = response;
        this.lastUrl = path;
        this.updateToken(response, `GET ${path}`);
        return response;
    }

    async post(
        path: string,
        body: Record<string, string | string[] | number | boolean | undefined> | URLSearchParams,
        options?: KraHttpRequestOptions
    ): Promise<string> {
        const response = await this.client.post(path, body, options);
        this.lastResponse = response;
        this.lastUrl = path;
        this.updateToken(response, `POST ${path}`);
        return response;
    }

    async getBuffer(path: string, options?: KraHttpRequestOptions): Promise<Buffer> {
        return this.client.getBuffer(path, options);
    }

    async postMultipart(path: string, formData: any, options?: KraHttpRequestOptions): Promise<string> {
        const response = await this.client.postMultipart(path, formData, options);
        this.lastResponse = response;
        this.lastUrl = path;
        this.updateToken(response, `POST ${path}`);
        return response;
    }

    async postMultipartBuffer(path: string, formData: any, options?: KraHttpRequestOptions): Promise<Buffer> {
        // If formData is a Buffer (raw multipart body), use postRawBuffer directly.
        if (Buffer.isBuffer(formData)) {
            return this.client.postRawBuffer(path, formData, options);
        }
        return this.client.postMultipartBuffer(path, formData, options);
    }

    async snapshotHtml(step: CaptureStep, html?: string): Promise<void> {
        if (!this.captureContext) return;
        const content = html ?? this.lastResponse ?? '';
        await this.captureContext.uploadText(step, 'snapshot', content, 'html', 'text/html; charset=utf-8', {
            url: this.lastUrl ?? undefined,
        });
    }

    async snapshotFormFields(step: CaptureStep, selector: string, fields: Record<string, string | undefined>): Promise<void> {
        if (!this.captureContext) return;
        this.captureContext.recordFormFields({
            timestamp: new Date().toISOString(),
            selector,
            fields,
        });
    }
}
