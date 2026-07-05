import { KraHttpClient } from '../client/KraHttpClient';

export class KraHttpSession {
    client: KraHttpClient;
    tokenKey: string | null = null;
    lastResponse: string | null = null;
    lastUrl: string | null = null;

    constructor(options: { baseUrl?: string; timeout?: number; debug?: boolean } = {}) {
        this.client = new KraHttpClient({
            baseUrl: options.baseUrl,
            timeout: options.timeout,
            debug: options.debug,
        });
    }

    updateToken(html: string): void {
        const match = html.match(/<input[^>]+name=["']token_key["'][^>]+value=["']([^"']+)["'][^>]*>/i);
        if (match) {
            this.tokenKey = match[1];
        }
    }

    requireToken(): string {
        if (!this.tokenKey) {
            throw new Error('KRA session token_key is missing. A login or form fetch may have failed.');
        }
        return this.tokenKey;
    }

    async get(path: string, options?: { timeout?: number }): Promise<string> {
        const response = await this.client.get(path, options);
        this.lastResponse = response;
        this.lastUrl = path;
        this.updateToken(response);
        return response;
    }

    async post(
        path: string,
        body: Record<string, string | string[] | number | boolean | undefined> | URLSearchParams,
        options?: { timeout?: number; headers?: Record<string, string> }
    ): Promise<string> {
        const response = await this.client.post(path, body, options);
        this.lastResponse = response;
        this.lastUrl = path;
        this.updateToken(response);
        return response;
    }

    async getBuffer(path: string, options?: { timeout?: number; headers?: Record<string, string> }): Promise<Buffer> {
        return this.client.getBuffer(path, options);
    }

    async postMultipart(path: string, formData: any, options?: { timeout?: number }): Promise<string> {
        const response = await this.client.postMultipart(path, formData, options);
        this.lastResponse = response;
        this.lastUrl = path;
        this.updateToken(response);
        return response;
    }
}
