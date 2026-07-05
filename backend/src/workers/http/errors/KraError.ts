import { KraErrorCode } from './KraErrorCode';

export class KraError extends Error {
    code: KraErrorCode;
    retryable: boolean;
    rawResponse?: string;

    constructor(
        code: KraErrorCode,
        message: string,
        options: { retryable?: boolean; rawResponse?: string; cause?: unknown } = {}
    ) {
        super(message);
        this.name = 'KraError';
        this.code = code;
        this.retryable = options.retryable ?? false;
        this.rawResponse = options.rawResponse;
    }
}
