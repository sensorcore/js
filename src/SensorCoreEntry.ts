import type { SensorCoreLevel } from './SensorCoreLevel.js';

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/**
 * Supported metadata value types.
 * Unsupported types (arrays, nested objects) are silently dropped.
 */
export type SensorCoreMetadataValue = string | number | boolean;

/**
 * Flat key-value metadata dictionary.
 * Only `string`, `number`, and `boolean` values are kept; everything else is dropped.
 */
export type SensorCoreMetadata = Record<string, SensorCoreMetadataValue>;

/**
 * Filters a raw metadata dict, keeping only supported primitive values.
 * Returns `undefined` if input is nullish or all values are unsupported.
 */
export function sanitizeMetadata(
    raw: Record<string, unknown> | undefined | null,
): SensorCoreMetadata | undefined {
    if (!raw) return undefined;
    const result: SensorCoreMetadata = {};
    let hasKeys = false;
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            result[key] = value;
            hasKeys = true;
        }
        // arrays, objects, null, undefined → silently dropped
    }
    return hasKeys ? result : undefined;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * Internal representation of a single log entry.
 *
 * Created by the public API and passed to `SensorCoreClient` for queuing
 * and transmission. Consumers interact only through `SensorCore.log()`.
 */
export interface SensorCoreEntry {
    /** Log message text (already truncated to 5 000 chars). */
    content: string;

    /** Severity level raw string, e.g. `"info"`, `"error"`. */
    level: SensorCoreLevel;

    /** External user identifier. Snake-cased to match server field name. */
    user_id: string | undefined;

    /** Key-value metadata (only primitives). */
    metadata: SensorCoreMetadata | undefined;

    /** ISO-8601 timestamp captured at log-creation time on the client. */
    created_at: string;

    /**
     * Number of times this entry has been retried after a network failure.
     * Excluded from the JSON sent to the server.
     */
    retryCount: number;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Create a new entry with the current timestamp. */
export function createEntry(
    content: string,
    level: SensorCoreLevel,
    userId: string | undefined,
    metadata: Record<string, unknown> | undefined,
): SensorCoreEntry {
    const truncated = content.length > 5_000 ? content.slice(0, 4_997) + '...' : content;
    return {
        content: truncated,
        level,
        user_id: userId,
        metadata: sanitizeMetadata(metadata),
        created_at: new Date().toISOString(),
        retryCount: 0,
    };
}

/**
 * Returns a plain object ready to be sent as JSON to the server.
 * Excludes internal fields like `retryCount`.
 */
export function entryToServerJSON(entry: SensorCoreEntry): Record<string, unknown> {
    const obj: Record<string, unknown> = {
        content: entry.content,
        level: entry.level,
        created_at: entry.created_at,
    };
    if (entry.user_id !== undefined) obj.user_id = entry.user_id;
    if (entry.metadata !== undefined) obj.metadata = entry.metadata;
    return obj;
}
