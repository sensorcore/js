import type { ResolvedSensorCoreConfig } from './SensorCoreConfig.js';
import type { SensorCoreEntry } from './SensorCoreEntry.js';
import { entryToServerJSON } from './SensorCoreEntry.js';
import { SensorCoreError } from './SensorCoreError.js';
import { SensorCorePersistence } from './SensorCorePersistence.js';
import { SensorCoreRemoteConfig } from './SensorCoreRemoteConfig.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum entries in the in-memory queue. */
const QUEUE_CAPACITY = 1_000;

/** Circuit breaker cooldown steps (seconds). */
const COOLDOWN_STEPS = [60, 120, 300, 600] as const;

// ---------------------------------------------------------------------------
// SensorCoreClient
// ---------------------------------------------------------------------------

/**
 * Internal networking client — owns the log queue, persistence, circuit
 * breaker, and all network I/O.
 *
 * ## Architecture (mirrors iOS `SensorCoreClient` actor)
 *
 * ```
 *  log()          logAsync()
 *    │                │
 *    ▼                ▼
 * enqueue()      sendThrowing()   ← bypasses queue, async/throws
 *    │
 *    ▼
 * queue[]             ← bounded FIFO array (max 1 000 entries)
 *    │
 *    ▼
 * drainQueue()        ← microtask consumer (setTimeout-based)
 *    │
 *    ▼
 * transmit() → fetch() → server
 *    │                      │
 *    │                 429? → cooldown (timed exponential backoff)
 *    │
 *    └── network error? → persistence.save([entry])
 *                              │
 *                    online event / next enqueue
 *                              │
 *                              ▼
 *                        flushPending()
 * ```
 */
export class SensorCoreClient {
    // -- Private state ---------------------------------------------------------

    private readonly config: ResolvedSensorCoreConfig;
    private readonly persistence: SensorCorePersistence | null;

    /** In-memory FIFO queue. */
    private readonly queue: SensorCoreEntry[] = [];

    /** Whether the queue consumer is currently scheduled. */
    private draining = false;

    // -- Circuit breaker -------------------------------------------------------

    /** When true, all enqueue / send calls are silently dropped. */
    private _isSilenced = false;

    /** Timestamp (ms) when the circuit breaker cooldown expires. */
    private _silencedUntil = 0;

    /** Index into COOLDOWN_STEPS. Increases on each consecutive 429. */
    private _cooldownIndex = 0;

    /** Whether a flush is currently in progress (prevent concurrent runs). */
    private _isFlushing = false;

    /** Cleanup function for the online event listener. */
    private onlineCleanup: (() => void) | null = null;

    // -- Constructor -----------------------------------------------------------

    constructor(config: ResolvedSensorCoreConfig) {
        this.config = config;

        // Persistence
        if (config.persistFailedLogs) {
            this.persistence = new SensorCorePersistence(
                config.maxPendingLogs,
                config.pendingLogMaxAge,
            );
        } else {
            this.persistence = null;
        }

        // Flush any pending entries from a previous session
        this.flushPending();

        // Network recovery: browser → listen for 'online' event
        if (typeof globalThis !== 'undefined' && typeof (globalThis as any).addEventListener === 'function') {
            const handler = () => this.flushPending();
            (globalThis as any).addEventListener('online', handler);
            this.onlineCleanup = () => (globalThis as any).removeEventListener('online', handler);
        }
    }

    // -- Public API ------------------------------------------------------------

    /**
     * Push a log entry into the queue. **Synchronous, never throws.**
     * If the circuit breaker is active, the entry is silently dropped.
     */
    enqueue(entry: SensorCoreEntry): void {
        if (this.isSilenced()) return;

        if (this.queue.length >= QUEUE_CAPACITY) {
            // Queue full — drop newest (oldest are preserved, matching iOS)
            return;
        }

        this.queue.push(entry);
        this.scheduleDrain();
    }

    /**
     * Send an entry directly, bypassing the queue. Throws on failure.
     */
    async sendThrowing(entry: SensorCoreEntry): Promise<void> {
        if (this.isSilenced()) throw SensorCoreError.rateLimited();

        let response: Response;
        try {
            response = await this.doFetch(entry);
        } catch (err) {
            this.persistence?.save([entry]);
            throw SensorCoreError.networkError(err);
        }

        if (response.status === 429) {
            this.activateCooldown();
            throw SensorCoreError.rateLimited();
        }

        if (response.status === 403 && await SensorCoreClient.isQuotaExceeded(response)) {
            this.activateCooldown('free-tier quota exceeded (HTTP 403). Upgrade at https://sensorcore.dev');
            throw SensorCoreError.quotaExceeded();
        }

        if (!response.ok) {
            throw SensorCoreError.serverError(response.status);
        }

        // Success → reset circuit breaker
        this.resetCooldown();
    }

    /**
     * Fetch the current Remote Config from the server.
     * Never throws — returns empty config on any failure.
     */
    async fetchRemoteConfig(): Promise<SensorCoreRemoteConfig> {
        const url = `${this.config.host}/api/config`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'x-api-key': this.config.apiKey },
                signal: AbortSignal.timeout(this.config.timeout),
            });

            if (!response.ok) return SensorCoreRemoteConfig.empty;

            const json = await response.json();
            if (typeof json !== 'object' || json === null || Array.isArray(json)) {
                return SensorCoreRemoteConfig.empty;
            }

            return new SensorCoreRemoteConfig(json as Record<string, unknown>);
        } catch {
            return SensorCoreRemoteConfig.empty;
        }
    }

    /**
     * Clean up resources (event listeners, etc.).
     * Called when the SDK is reconfigured.
     */
    destroy(): void {
        if (this.onlineCleanup) {
            this.onlineCleanup();
            this.onlineCleanup = null;
        }
    }

    // -- Circuit breaker -------------------------------------------------------

    /**
     * Check if the circuit breaker is currently active.
     * Auto-resets if the cooldown has expired.
     */
    private isSilenced(): boolean {
        if (!this._isSilenced) return false;
        if (Date.now() > this._silencedUntil) {
            // Cooldown expired — reset
            this._isSilenced = false;
            return false;
        }
        return true;
    }

    /** Activate the circuit breaker with exponential backoff. */
    private activateCooldown(reason?: string): void {
        const cooldownSec = COOLDOWN_STEPS[Math.min(this._cooldownIndex, COOLDOWN_STEPS.length - 1)];
        this._isSilenced = true;
        this._silencedUntil = Date.now() + cooldownSec * 1_000;
        this._cooldownIndex = Math.min(this._cooldownIndex + 1, COOLDOWN_STEPS.length - 1);

        if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
            console.warn(
                `[SensorCore] ⚠️ ${reason ?? 'HTTP 429 — rate limited'}. Logging paused for ${cooldownSec}s.`,
            );
        }
    }

    /**
     * Check if a 403 response body contains the server's `QUOTA_EXCEEDED` code.
     * Uses `response.clone()` because the body can only be read once.
     */
    private static async isQuotaExceeded(response: Response): Promise<boolean> {
        try {
            const body = await response.clone().json();
            return body?.code === 'QUOTA_EXCEEDED';
        } catch {
            return false;
        }
    }

    /** Reset the circuit breaker after a successful request. */
    private resetCooldown(): void {
        if (this._cooldownIndex > 0 || this._isSilenced) {
            this._isSilenced = false;
            this._silencedUntil = 0;
            this._cooldownIndex = 0;
        }
    }

    // -- Queue consumer --------------------------------------------------------

    /** Schedule the queue drain loop via microtask. */
    private scheduleDrain(): void {
        if (this.draining) return;
        this.draining = true;
        // Use setTimeout(0) to batch multiple synchronous enqueue() calls
        setTimeout(() => this.drainQueue(), 0);
    }

    /** Process all entries in the queue sequentially. */
    private async drainQueue(): Promise<void> {
        while (this.queue.length > 0) {
            if (this.isSilenced()) {
                // Persist remaining entries so they aren't lost during cooldown
                this.persistence?.save([...this.queue]);
                this.queue.length = 0;
                break;
            }

            const entry = this.queue.shift()!;
            const shouldStop = await this.transmit(entry);
            if (shouldStop) {
                // 429 received — persist remaining queue entries before dropping
                this.persistence?.save([...this.queue]);
                this.queue.length = 0;
                break;
            }
        }
        this.draining = false;
    }

    // -- Network I/O -----------------------------------------------------------

    /**
     * Send one entry. Returns `true` if the consumer loop should stop (429).
     */
    private async transmit(entry: SensorCoreEntry): Promise<boolean> {
        if (this.isSilenced()) return true;

        try {
            const response = await this.doFetch(entry);

            if (response.status === 429) {
                this.activateCooldown();
                return true;
            }

            if (response.status === 403 && await SensorCoreClient.isQuotaExceeded(response)) {
                this.activateCooldown('free-tier quota exceeded (HTTP 403). Upgrade at https://sensorcore.dev');
                return true;
            }

            if (response.ok) {
                this.resetCooldown();
            }
            // Non-2xx, non-429, non-403-quota → log dropped (matches iOS behaviour)
        } catch {
            // Network error → persist for retry
            this.persistence?.save([entry]);
        }
        return false;
    }

    /** Execute the actual fetch POST request. */
    private doFetch(entry: SensorCoreEntry): Promise<Response> {
        const url = `${this.config.host}/api/logs`;
        const body = JSON.stringify(entryToServerJSON(entry));

        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.config.apiKey,
            },
            body,
            signal: AbortSignal.timeout(this.config.timeout),
        });
    }

    // -- Pending flush ---------------------------------------------------------

    /** Load and retry all pending entries from persistence. */
    async flushPending(): Promise<void> {
        if (!this.persistence) return;
        if (this.isSilenced()) return;
        if (this._isFlushing) return;
        this._isFlushing = true;

        try {
            const pending = this.persistence.loadPending();
            if (pending.length === 0) return;

            const stillFailed: SensorCoreEntry[] = [];

            for (let i = 0; i < pending.length; i++) {
                if (this.isSilenced()) {
                    // Rate-limited mid-flush — preserve remaining
                    for (let j = i; j < pending.length; j++) {
                        stillFailed.push(pending[j]);
                    }
                    break;
                }

                const entry = pending[i];
                try {
                    const response = await this.doFetch(entry);

                    if (response.status === 429) {
                        this.activateCooldown();
                        // Preserve current + remaining
                        for (let j = i; j < pending.length; j++) {
                            stillFailed.push(pending[j]);
                        }
                        break;
                    }

                    if (response.status === 403 && await SensorCoreClient.isQuotaExceeded(response)) {
                        this.activateCooldown('free-tier quota exceeded (HTTP 403). Upgrade at https://sensorcore.dev');
                        for (let j = i; j < pending.length; j++) {
                            stillFailed.push(pending[j]);
                        }
                        break;
                    }

                    if (!response.ok) {
                        entry.retryCount += 1;
                        stillFailed.push(entry);
                    }

                    if (response.ok) {
                        this.resetCooldown();
                    }
                    // 2xx → success, entry not re-saved
                } catch {
                    // Still no network
                    entry.retryCount += 1;
                    stillFailed.push(entry);
                }
            }

            this.persistence.replacePending(stillFailed);
        } finally {
            this._isFlushing = false;
        }
    }
}
