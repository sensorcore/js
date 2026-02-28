/**
 * Configuration options for the SensorCore SDK.
 *
 * All properties except `apiKey` and `host` have sensible defaults,
 * so the minimal setup is just:
 * ```ts
 * SensorCore.configure({ apiKey: 'sc_xxx', host: 'https://api.sensorcore.dev' });
 * ```
 */
export interface SensorCoreConfig {
    /**
     * Your project's API key.
     * Found in the SensorCore dashboard under **Project → Settings → API Key**.
     */
    apiKey: string;

    /**
     * Base URL of the SensorCore server.
     * Must include the scheme, e.g. `https://api.sensorcore.dev`.
     * Do **not** include a trailing slash — the SDK appends `/api/logs` automatically.
     */
    host: string;

    /**
     * A stable identifier for the currently signed-in user.
     * When set, this value is attached to every log entry automatically.
     * You can still override it per-call via `log('...', { userId: '...' })`.
     * @default undefined
     */
    defaultUserId?: string;

    /**
     * When `false`, every `log()` / `logAsync()` call is a silent no-op.
     * Useful for disabling logging in test environments.
     * @default true
     */
    enabled?: boolean;

    /**
     * Network request timeout in **milliseconds**.
     * @default 10000
     */
    timeout?: number;

    /**
     * When `true`, log entries that fail to send due to network errors
     * are saved to storage and automatically retried when connectivity returns.
     * @default true
     */
    persistFailedLogs?: boolean;

    /**
     * Maximum number of log entries stored in the offline buffer.
     * Oldest entries are dropped when this limit is reached.
     * @default 500
     */
    maxPendingLogs?: number;

    /**
     * Maximum age (in **seconds**) for a pending log entry before it is discarded.
     * @default 86400 (24 hours)
     */
    pendingLogMaxAge?: number;
}

/** Resolved config with all defaults filled in. */
export interface ResolvedSensorCoreConfig {
    apiKey: string;
    host: string;
    defaultUserId: string | undefined;
    enabled: boolean;
    timeout: number;
    persistFailedLogs: boolean;
    maxPendingLogs: number;
    pendingLogMaxAge: number;
}

/** Apply defaults to user-supplied config. */
export function resolveConfig(config: SensorCoreConfig): ResolvedSensorCoreConfig {
    return {
        apiKey: config.apiKey,
        host: config.host.replace(/\/+$/, ''), // strip trailing slashes
        defaultUserId: config.defaultUserId,
        enabled: config.enabled ?? true,
        timeout: config.timeout ?? 10_000,
        persistFailedLogs: config.persistFailedLogs ?? true,
        maxPendingLogs: config.maxPendingLogs ?? 500,
        pendingLogMaxAge: config.pendingLogMaxAge ?? 86_400,
    };
}
