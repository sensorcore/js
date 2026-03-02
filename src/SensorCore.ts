import type { SensorCoreConfig } from './SensorCoreConfig.js';
import { resolveConfig } from './SensorCoreConfig.js';
import type { ResolvedSensorCoreConfig } from './SensorCoreConfig.js';
import { SensorCoreClient } from './SensorCoreClient.js';
import { createEntry } from './SensorCoreEntry.js';
import { SensorCoreError } from './SensorCoreError.js';
import type { SensorCoreLevel } from './SensorCoreLevel.js';
import { SensorCoreRemoteConfig } from './SensorCoreRemoteConfig.js';

// ---------------------------------------------------------------------------
// Log options
// ---------------------------------------------------------------------------

/** Options accepted by `SensorCore.log()` and `SensorCore.logAsync()`. */
export interface LogOptions {
    /** Severity level. @default 'info' */
    level?: SensorCoreLevel;

    /** Override the `defaultUserId` set in config for this single call. */
    userId?: string;

    /** Arbitrary key-value pairs. Only `string`, `number`, `boolean` are kept. */
    metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// SensorCore — public facade (singleton)
// ---------------------------------------------------------------------------

/**
 * Main entry point for the SensorCore SDK.
 *
 * ## Setup
 * ```ts
 * import SensorCore from 'sensorcore';
 *
 * SensorCore.configure({
 *   apiKey: 'sc_your_api_key',
 * });
 * ```
 *
 * ## Logging
 * ```ts
 * // Fire-and-forget (most common)
 * SensorCore.log('User signed up');
 * SensorCore.log('Payment failed', { level: 'error', metadata: { code: 'card_declined' } });
 *
 * // Async — when you need to know the result
 * await SensorCore.logAsync('Critical event', { level: 'error' });
 * ```
 *
 * ## Remote Config
 * ```ts
 * const config = await SensorCore.remoteConfig();
 * if (config.bool('show_new_feature') === true) {
 *   // feature enabled via SensorCore dashboard or AI agent
 * }
 * ```
 */
class SensorCore {
    // -- Singleton state -------------------------------------------------------

    private static client: SensorCoreClient | null = null;
    private static config: ResolvedSensorCoreConfig | null = null;

    /** Prevent instantiation — use static methods. */
    private constructor() { }

    // -- Configuration ---------------------------------------------------------

    /**
     * Configure the SDK. Must be called before any `log` calls.
     *
     * Safe to call multiple times — reconfigures the SDK with the new settings.
     * Previous client resources are cleaned up automatically.
     */
    static configure(config: SensorCoreConfig): void {
        const resolved = resolveConfig(config);

        // Clean up previous client
        if (SensorCore.client) {
            SensorCore.client.destroy();
        }

        SensorCore.config = resolved;
        SensorCore.client = resolved.enabled ? new SensorCoreClient(resolved) : null;

        if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
            if (resolved.enabled) {
                console.log(
                    `[SensorCore] ✅ configured\n` +
                    `  Host:    ${resolved.host}\n` +
                    `  User:    ${resolved.defaultUserId ?? '(none)'}\n` +
                    `  Timeout: ${resolved.timeout}ms`,
                );
            } else {
                console.log('[SensorCore] ⚠️  SDK is disabled (enabled: false). No logs will be sent.');
            }
        }
    }

    // -- Logging ---------------------------------------------------------------

    /**
     * Send a log entry. **Fire-and-forget** — returns immediately, never throws.
     *
     * @param content Log message (max 5 000 characters, auto-truncated).
     * @param options Optional level, userId, and metadata.
     */
    static log(content: string, options?: LogOptions): void {
        const prepared = SensorCore.prepareEntry(content, options);
        if (!prepared) return;
        prepared.client.enqueue(prepared.entry);
    }

    /**
     * Send a log entry and **await** the result. Throws `SensorCoreError` on failure.
     *
     * Use this when you need confirmation the log was delivered.
     *
     * @param content Log message (max 5 000 characters, auto-truncated).
     * @param options Optional level, userId, and metadata.
     * @throws {SensorCoreError}
     */
    static async logAsync(content: string, options?: LogOptions): Promise<void> {
        const prepared = SensorCore.prepareEntry(content, options);
        if (!prepared) throw SensorCoreError.notConfigured();
        await prepared.client.sendThrowing(prepared.entry);
    }

    // -- Remote Config ---------------------------------------------------------

    /**
     * Fetch the current Remote Config flags from the SensorCore server.
     *
     * Always safe to call — returns an empty config if the SDK is not configured,
     * the server is unreachable, or the response is invalid.
     */
    static async remoteConfig(): Promise<SensorCoreRemoteConfig> {
        if (!SensorCore.client) return SensorCoreRemoteConfig.empty;
        return SensorCore.client.fetchRemoteConfig();
    }

    // -- Private helpers -------------------------------------------------------

    private static prepareEntry(
        content: string,
        options?: LogOptions,
    ): { entry: ReturnType<typeof createEntry>; client: SensorCoreClient } | null {
        const client = SensorCore.client;
        const config = SensorCore.config;
        if (!client || !config) return null;

        const level = options?.level ?? 'info';
        const userId = options?.userId ?? config.defaultUserId;
        const entry = createEntry(content, level, userId, options?.metadata);
        return { entry, client };
    }
}

export default SensorCore;
export { SensorCore };
