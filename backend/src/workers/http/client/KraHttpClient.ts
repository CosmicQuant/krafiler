import got from 'got';
import { CookieJar } from 'tough-cookie';
import { KraError, KraErrorCode } from '../errors/index';
import { CaptureContext, CaptureStep } from '../capture';

export interface KraHttpClientOptions {
    baseUrl?: string;
    cookieJar?: CookieJar;
    timeout?: number;
    debug?: boolean;
    captureContext?: CaptureContext;
}

export interface KraHttpRequestOptions {
    timeout?: number;
    headers?: Record<string, string>;
    /** Capture step label; used only when a capture context is attached. */
    step?: CaptureStep;
}

export class KraHttpClient {
    private baseUrl: string;
    private cookieJar: CookieJar;
    private timeout: number;
    private debug: boolean;
    private captureContext?: CaptureContext;

    constructor(options: KraHttpClientOptions = {}) {
        this.baseUrl = options.baseUrl ?? 'https://itax.kra.go.ke/KRA-Portal/';
        this.cookieJar = options.cookieJar ?? new CookieJar();
        this.timeout = options.timeout ?? 30_000;
        this.debug = options.debug ?? false;
        this.captureContext = options.captureContext;
    }

    getCookieJar(): CookieJar {
        return this.cookieJar;
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    private resolveUrl(path: string): string {
        if (path.startsWith('http')) {
            return path;
        }
        const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        return `${base}${cleanPath}`;
    }

    private defaultHeaders(): Record<string, string> {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
            'Sec-Ch-Ua': '"Not/A)Brand";v="99", "Chromium";v="148"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
        };
    }

    async get(path: string, options: KraHttpRequestOptions = {}): Promise<string> {
        const url = this.resolveUrl(path);
        const step = options.step ?? 'custom';
        try {
            const response = await got.get(url, {
                cookieJar: this.cookieJar,
                timeout: { request: options.timeout ?? this.timeout },
                headers: {
                    ...this.defaultHeaders(),
                    ...options.headers,
                },
                http2: false,
                followRedirect: true,
                decompress: true,
            });
            await this.recordCapture(step, 'GET', url, options.headers, undefined, response.statusCode, response.statusMessage, response.headers, response.body);
            return response.body;
        } catch (error: any) {
            await this.recordErrorCapture(step, 'GET', url, options.headers, undefined, error);
            throw this.normalizeError(error, url);
        }
    }

    async post(
        path: string,
        body: Record<string, string | string[] | number | boolean | undefined> | URLSearchParams,
        options: KraHttpRequestOptions = {}
    ): Promise<string> {
        const url = this.resolveUrl(path);
        const step = options.step ?? 'custom';
        const form: Record<string, string> | URLSearchParams = body instanceof URLSearchParams
            ? body
            : (() => {
                const record: Record<string, string> = {};
                for (const [key, value] of Object.entries(body)) {
                    if (value !== undefined && value !== null) {
                        record[key] = String(value);
                    }
                }
                return record;
            })();

        try {
            const response = await got.post(url, {
                cookieJar: this.cookieJar,
                timeout: { request: options.timeout ?? this.timeout },
                form,
                headers: {
                    ...this.defaultHeaders(),
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Origin: 'https://itax.kra.go.ke',
                    Referer: 'https://itax.kra.go.ke/KRA-Portal/',
                    'Upgrade-Insecure-Requests': '1',
                    ...options.headers,
                },
                http2: false,
                followRedirect: true,
                decompress: true,
            });
            await this.recordCapture(step, 'POST', url, options.headers, form, response.statusCode, response.statusMessage, response.headers, response.body);
            return response.body;
        } catch (error: any) {
            await this.recordErrorCapture(step, 'POST', url, options.headers, form, error);
            throw this.normalizeError(error, url);
        }
    }

    async getBuffer(path: string, options: KraHttpRequestOptions = {}): Promise<Buffer> {
        const url = this.resolveUrl(path);
        const step = options.step ?? 'custom';
        try {
            const response = await got.get(url, {
                cookieJar: this.cookieJar,
                timeout: { request: options.timeout ?? this.timeout },
                responseType: 'buffer',
                headers: {
                    ...this.defaultHeaders(),
                    Referer: 'https://itax.kra.go.ke/KRA-Portal/',
                    ...options.headers,
                },
                http2: false,
                followRedirect: true,
                decompress: true,
            });
            await this.recordCapture(step, 'GET', url, options.headers, undefined, response.statusCode, response.statusMessage, response.headers, response.body);
            return response.body;
        } catch (error: any) {
            await this.recordErrorCapture(step, 'GET', url, options.headers, undefined, error);
            throw this.normalizeError(error, url);
        }
    }

    async postMultipart(
        path: string,
        formData: any,
        options: KraHttpRequestOptions = {}
    ): Promise<string> {
        const url = this.resolveUrl(path);
        const step = options.step ?? 'custom';
        try {
            const response = await got.post(url, {
                cookieJar: this.cookieJar,
                timeout: { request: options.timeout ?? this.timeout },
                body: formData,
                headers: {
                    ...this.defaultHeaders(),
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    Referer: `${this.baseUrl}eReturns.htm`,
                    Origin: 'https://itax.kra.go.ke',
                    'Sec-Fetch-Site': 'same-origin',
                    ...options.headers,
                },
                http2: false,
                followRedirect: true,
                decompress: true,
            });
            await this.recordCapture(step, 'POST', url, options.headers, '[multipart/form-data]', response.statusCode, response.statusMessage, response.headers, response.body);
            return response.body;
        } catch (error: any) {
            await this.recordErrorCapture(step, 'POST', url, options.headers, '[multipart/form-data]', error);
            throw this.normalizeError(error, url);
        }
    }

    async postMultipartBuffer(
        path: string,
        formData: any,
        options: KraHttpRequestOptions = {}
    ): Promise<Buffer> {
        const url = this.resolveUrl(path);
        const step = options.step ?? 'custom';
        try {
            const response = await got.post(url, {
                cookieJar: this.cookieJar,
                timeout: { request: options.timeout ?? this.timeout },
                body: formData,
                responseType: 'buffer',
                headers: {
                    ...this.defaultHeaders(),
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    Referer: `${this.baseUrl}eReturns.htm`,
                    Origin: 'https://itax.kra.go.ke',
                    'Sec-Fetch-Site': 'same-origin',
                    ...options.headers,
                },
                http2: false,
                followRedirect: true,
                decompress: true,
            });
            await this.recordCapture(step, 'POST', url, options.headers, '[multipart/form-data]', response.statusCode, response.statusMessage, response.headers, response.body);
            return response.body;
        } catch (error: any) {
            await this.recordErrorCapture(step, 'POST', url, options.headers, '[multipart/form-data]', error);
            throw this.normalizeError(error, url);
        }
    }

    async postRaw(
        path: string,
        rawBody: string | Buffer,
        options: KraHttpRequestOptions = {}
    ): Promise<string> {
        const url = this.resolveUrl(path);
        const step = options.step ?? 'custom';
        try {
            const response = await got.post(url, {
                cookieJar: this.cookieJar,
                timeout: { request: options.timeout ?? this.timeout },
                body: rawBody,
                headers: {
                    ...this.defaultHeaders(),
                    ...options.headers,
                },
                http2: false,
                followRedirect: true,
                decompress: true,
            });
            await this.recordCapture(step, 'POST', url, options.headers, rawBody, response.statusCode, response.statusMessage, response.headers, response.body);
            return response.body;
        } catch (error: any) {
            await this.recordErrorCapture(step, 'POST', url, options.headers, rawBody, error);
            throw this.normalizeError(error, url);
        }
    }

    async postRawBuffer(
        path: string,
        rawBody: string | Buffer,
        options: KraHttpRequestOptions = {}
    ): Promise<Buffer> {
        const url = this.resolveUrl(path);
        const step = options.step ?? 'custom';
        try {
            const response = await got.post(url, {
                cookieJar: this.cookieJar,
                timeout: { request: options.timeout ?? this.timeout },
                body: rawBody,
                responseType: 'buffer',
                headers: {
                    ...this.defaultHeaders(),
                    ...options.headers,
                },
                http2: false,
                followRedirect: true,
                decompress: true,
            });
            await this.recordCapture(step, 'POST', url, options.headers, rawBody, response.statusCode, response.statusMessage, response.headers, response.body);
            return response.body;
        } catch (error: any) {
            await this.recordErrorCapture(step, 'POST', url, options.headers, rawBody, error);
            throw this.normalizeError(error, url);
        }
    }

    private normalizeCaptureBody(body: unknown): string | Record<string, unknown> | undefined {
        if (body === undefined || body === null) return undefined;
        if (typeof body === 'string') return body;
        if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
        if (Buffer.isBuffer(body)) return body.toString('utf-8');
        if (typeof body === 'object') return body as Record<string, unknown>;
        return String(body);
    }

    private async recordCapture(
        step: CaptureStep,
        method: string,
        url: string,
        requestHeaders?: Record<string, string>,
        requestBody?: unknown,
        statusCode?: number,
        statusMessage?: string,
        responseHeaders?: unknown,
        responseBody?: string | Buffer
    ): Promise<void> {
        if (!this.captureContext) return;
        try {
            await this.captureContext.uploadHttpEntry({
                seq: this.captureContext.nextSeq(),
                step,
                timestamp: new Date().toISOString(),
                request: {
                    method,
                    url,
                    headers: this.headersToRecord(requestHeaders),
                    body: this.normalizeCaptureBody(requestBody),
                },
                response: {
                    statusCode: statusCode ?? 0,
                    statusMessage,
                    headers: this.headersToRecord(responseHeaders),
                    body: responseBody ?? '',
                },
            });
        } catch (err: any) {
            // Capture failures must not break the filing flow.
            if (this.debug) {
                console.warn('[KraHttpClient] Capture recording failed:', err.message);
            }
        }
    }

    private async recordErrorCapture(
        step: CaptureStep,
        method: string,
        url: string,
        requestHeaders?: Record<string, string>,
        requestBody?: unknown,
        error?: any
    ): Promise<void> {
        if (!this.captureContext) return;
        const statusCode = error?.response?.statusCode;
        const statusMessage = error?.response?.statusMessage ?? error?.code ?? error?.message ?? 'Unknown error';
        const body = error?.response?.body ?? '';
        await this.recordCapture(
            step,
            method,
            url,
            requestHeaders,
            requestBody,
            statusCode,
            statusMessage,
            error?.response?.headers,
            typeof body === 'string' ? body : Buffer.from(body)
        );
    }

    private headersToRecord(headers?: unknown): Record<string, string | string[]> {
        const result: Record<string, string | string[]> = {};
        if (!headers || typeof headers !== 'object') return result;
        for (const [key, value] of Object.entries(headers)) {
            if (value === undefined || value === null) continue;
            result[key] = Array.isArray(value) ? value : String(value);
        }
        return result;
    }

    private normalizeError(error: any, url: string): Error {
        if (error instanceof KraError) {
            return error;
        }

        const statusCode = error?.response?.statusCode;
        const statusMessage = error?.response?.statusMessage ?? error?.code ?? error?.message ?? 'Unknown error';
        const body = error?.response?.body?.toString() ?? '';

        const classified = this.classifyError(statusCode, statusMessage, body);
        if (classified) {
            return classified;
        }

        return new KraError(
            KraErrorCode.UNKNOWN,
            `HTTP request failed for ${url}: ${statusMessage}`,
            { retryable: false, rawResponse: body, cause: error }
        );
    }

    private classifyError(
        statusCode: number | undefined,
        statusMessage: string,
        bodyText: string
    ): KraError | null {
        if (statusCode && statusCode >= 500) {
            return new KraError(
                KraErrorCode.PORTAL_UNAVAILABLE,
                `KRA portal returned ${statusCode} ${statusMessage}`,
                { retryable: true, rawResponse: bodyText }
            );
        }

        if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED/i.test(statusMessage)) {
            return new KraError(
                KraErrorCode.PORTAL_UNAVAILABLE,
                `Network error reaching KRA: ${statusMessage}`,
                { retryable: true, rawResponse: bodyText }
            );
        }

        return null;
    }
}
