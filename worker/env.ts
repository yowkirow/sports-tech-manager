import type { AccessConfiguration } from './auth.ts';

export interface AppEnv extends AccessConfiguration {
    ENVIRONMENT: 'staging' | 'production';
    DB: D1Database;
    MEDIA: R2Bucket;
    ASSETS?: Fetcher;
    VERSION?: { id: string };
    GUEST_TOKEN_SECRET: string;
    SMS_API_KEY?: string;
    SMS_DEVICE_ID?: string;
    PRINT_QUEUE_ENABLED?: string;
    MUTATIONS_ENABLED?: string;
}
