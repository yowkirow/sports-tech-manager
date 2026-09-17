export class HttpError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'HttpError';
        this.status = status;
        this.code = code;
    }
}
