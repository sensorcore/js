/**
 * Error codes returned by the SensorCore SDK.
 *
 * @example
 * ```ts
 * try {
 *   await SensorCore.logAsync('Event');
 * } catch (e) {
 *   if (e instanceof SensorCoreError) {
 *     switch (e.code) {
 *       case 'not_configured': break;
 *       case 'network_error':  break;
 *       case 'server_error':   break;
 *       case 'encoding_failed': break;
 *       case 'rate_limited':   break;
 *       case 'quota_exceeded': break;
 *     }
 *   }
 * }
 * ```
 */
export type SensorCoreErrorCode =
    | 'not_configured'
    | 'encoding_failed'
    | 'server_error'
    | 'network_error'
    | 'rate_limited'
    | 'quota_exceeded';

/**
 * Typed error thrown by {@link SensorCore.logAsync} and used internally.
 *
 * For fire-and-forget calls via {@link SensorCore.log}, these errors are
 * swallowed internally and logged to the console in development only.
 */
export class SensorCoreError extends Error {
    /** Machine-readable error code. */
    readonly code: SensorCoreErrorCode;

    /** HTTP status code (only set for `server_error`). */
    readonly statusCode?: number;

    /** Original error that caused this one (network / encoding failures). */
    readonly cause?: unknown;

    constructor(
        code: SensorCoreErrorCode,
        message: string,
        options?: { statusCode?: number; cause?: unknown },
    ) {
        super(message);
        this.name = 'SensorCoreError';
        this.code = code;
        this.statusCode = options?.statusCode;
        this.cause = options?.cause;
    }

    // -- Factory helpers -------------------------------------------------------

    static notConfigured(): SensorCoreError {
        return new SensorCoreError(
            'not_configured',
            'SensorCore is not configured. Call SensorCore.configure(...) first.',
        );
    }

    static encodingFailed(cause: unknown): SensorCoreError {
        return new SensorCoreError(
            'encoding_failed',
            `Failed to encode log entry: ${cause}`,
            { cause },
        );
    }

    static serverError(statusCode: number): SensorCoreError {
        return new SensorCoreError(
            'server_error',
            `Server returned HTTP ${statusCode}`,
            { statusCode },
        );
    }

    static networkError(cause: unknown): SensorCoreError {
        return new SensorCoreError(
            'network_error',
            `Network error: ${cause instanceof Error ? cause.message : cause}`,
            { cause },
        );
    }

    static rateLimited(): SensorCoreError {
        return new SensorCoreError(
            'rate_limited',
            'SensorCore rate-limited (HTTP 429). Logging paused temporarily.',
        );
    }

    static quotaExceeded(): SensorCoreError {
        return new SensorCoreError(
            'quota_exceeded',
            'SensorCore free-tier quota exceeded (HTTP 403). Upgrade to Pro at https://sensorcore.dev',
            { statusCode: 403 },
        );
    }
}
