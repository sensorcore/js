import { describe, it, expect, beforeEach } from 'vitest';
import { SENSOR_CORE_LEVELS } from '../src/SensorCoreLevel.js';
import type { SensorCoreLevel } from '../src/SensorCoreLevel.js';
import { resolveConfig } from '../src/SensorCoreConfig.js';
import {
    createEntry,
    entryToServerJSON,
    sanitizeMetadata,
} from '../src/SensorCoreEntry.js';
import { SensorCoreRemoteConfig } from '../src/SensorCoreRemoteConfig.js';
import { SensorCorePersistence } from '../src/SensorCorePersistence.js';
import { SensorCoreError } from '../src/SensorCoreError.js';
import { SensorCore } from '../src/SensorCore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * In-memory storage backend for testing persistence without disk/localStorage.
 */
class InMemoryStorage {
    private data: string | null = null;
    read() {
        try { return this.data ? JSON.parse(this.data) : []; } catch { return []; }
    }
    write(entries: unknown[]) {
        this.data = entries.length ? JSON.stringify(entries) : null;
    }
    clear() { this.data = null; }
}

function makeTempPersistence(maxEntries = 500, maxAge = 86_400) {
    return new SensorCorePersistence(maxEntries, maxAge, new InMemoryStorage() as any);
}

// ===========================================================================
// SensorCoreLevel
// ===========================================================================

describe('SensorCoreLevel', () => {
    it('has the correct raw values', () => {
        const expected: SensorCoreLevel[] = ['info', 'warning', 'error', 'messages'];
        expect(SENSOR_CORE_LEVELS).toEqual(expected);
    });
});

// ===========================================================================
// SensorCoreConfig
// ===========================================================================

describe('SensorCoreConfig', () => {
    it('applies defaults', () => {
        const cfg = resolveConfig({ apiKey: 'test-key', host: 'https://example.com' });
        expect(cfg.defaultUserId).toBeUndefined();
        expect(cfg.enabled).toBe(true);
        expect(cfg.timeout).toBe(10_000);
        expect(cfg.persistFailedLogs).toBe(true);
        expect(cfg.maxPendingLogs).toBe(500);
        expect(cfg.pendingLogMaxAge).toBe(86_400);
    });

    it('respects custom values', () => {
        const cfg = resolveConfig({
            apiKey: 'sc_abc',
            host: 'https://logs.example.com/',
            defaultUserId: 'user-123',
            enabled: false,
            timeout: 30_000,
        });
        expect(cfg.apiKey).toBe('sc_abc');
        expect(cfg.host).toBe('https://logs.example.com'); // trailing slash stripped
        expect(cfg.defaultUserId).toBe('user-123');
        expect(cfg.enabled).toBe(false);
        expect(cfg.timeout).toBe(30_000);
    });

    it('strips trailing slashes from host', () => {
        const cfg = resolveConfig({ apiKey: 'k', host: 'https://example.com///' });
        expect(cfg.host).toBe('https://example.com');
    });
});

// ===========================================================================
// SensorCoreEntry
// ===========================================================================

describe('SensorCoreEntry', () => {
    it('encodes required fields', () => {
        const entry = createEntry('hello', 'warning', undefined, undefined);
        expect(entry.content).toBe('hello');
        expect(entry.level).toBe('warning');
        expect(entry.user_id).toBeUndefined();
        expect(entry.metadata).toBeUndefined();
        expect(entry.created_at).toBeDefined();
        expect(entry.retryCount).toBe(0);
    });

    it('encodes userId', () => {
        const entry = createEntry('test', 'info', 'abc-123', undefined);
        expect(entry.user_id).toBe('abc-123');
    });

    it('encodes all supported metadata types', () => {
        const entry = createEntry('meta test', 'info', undefined, {
            str: 'value',
            int: 42,
            dbl: 3.14,
            bool: true,
        });
        expect(entry.metadata).toEqual({
            str: 'value',
            int: 42,
            dbl: 3.14,
            bool: true,
        });
    });

    it('drops unsupported metadata values', () => {
        const entry = createEntry('test', 'info', undefined, {
            valid: 'yes',
            invalid: [1, 2, 3],
            nested: { a: 1 },
            nullable: null,
        });
        expect(entry.metadata).toEqual({ valid: 'yes' });
    });

    it('toServerJSON excludes retryCount', () => {
        const entry = createEntry('test', 'info', undefined, undefined);
        entry.retryCount = 2;

        const json = entryToServerJSON(entry);
        expect(json).not.toHaveProperty('retryCount');
        expect(json).not.toHaveProperty('retry_count');
        expect(json.content).toBe('test');
        expect(json.created_at).toBeDefined();
    });

    it('created_at is a valid ISO-8601 timestamp close to now', () => {
        const entry = createEntry('ts test', 'info', undefined, undefined);
        const date = new Date(entry.created_at);
        expect(date.getTime()).not.toBeNaN();
        expect(Math.abs(Date.now() - date.getTime())).toBeLessThan(2_000);
    });

    it('truncates content longer than 5000 characters', () => {
        const long = 'a'.repeat(6000);
        const entry = createEntry(long, 'info', undefined, undefined);
        expect(entry.content.length).toBe(5_000);
        expect(entry.content.endsWith('...')).toBe(true);
    });

    it('does not truncate content at exactly 5000 characters', () => {
        const exact = 'b'.repeat(5000);
        const entry = createEntry(exact, 'info', undefined, undefined);
        expect(entry.content.length).toBe(5_000);
        expect(entry.content.endsWith('...')).toBe(false);
    });
});

// ===========================================================================
// sanitizeMetadata
// ===========================================================================

describe('sanitizeMetadata', () => {
    it('returns undefined for null/undefined input', () => {
        expect(sanitizeMetadata(null)).toBeUndefined();
        expect(sanitizeMetadata(undefined)).toBeUndefined();
    });

    it('returns undefined when all values are unsupported', () => {
        expect(sanitizeMetadata({ a: [1], b: { x: 1 } })).toBeUndefined();
    });
});

// ===========================================================================
// SensorCoreRemoteConfig
// ===========================================================================

describe('SensorCoreRemoteConfig', () => {
    it('returns typed values with accessors', () => {
        const config = new SensorCoreRemoteConfig({
            flag: true,
            count: 7,
            ratio: 0.5,
            label: 'hello',
        });

        // bool
        expect(config.bool('flag')).toBe(true);
        expect(config.bool('label')).toBeUndefined();
        expect(config.bool('missing')).toBeUndefined();

        // int
        expect(config.int('count')).toBe(7);
        expect(config.int('ratio')).toBeUndefined(); // 0.5 is not integer

        // number
        expect(config.number('ratio')).toBe(0.5);
        expect(config.number('count')).toBe(7);

        // string
        expect(config.string('label')).toBe('hello');
        expect(config.string('count')).toBeUndefined();
    });

    it('handles empty config', () => {
        const config = new SensorCoreRemoteConfig({});
        expect(config.get('anything')).toBeUndefined();
        expect(config.bool('flag')).toBeUndefined();
        expect(config.string('label')).toBeUndefined();
        expect(Object.keys(config.raw)).toHaveLength(0);
    });

    it('static empty is an empty config', () => {
        expect(Object.keys(SensorCoreRemoteConfig.empty.raw)).toHaveLength(0);
    });
});

// ===========================================================================
// SensorCoreError
// ===========================================================================

describe('SensorCoreError', () => {
    it('creates typed errors with correct codes', () => {
        expect(SensorCoreError.notConfigured().code).toBe('not_configured');
        expect(SensorCoreError.encodingFailed(new Error('x')).code).toBe('encoding_failed');
        expect(SensorCoreError.serverError(500).code).toBe('server_error');
        expect(SensorCoreError.serverError(500).statusCode).toBe(500);
        expect(SensorCoreError.networkError(new Error('timeout')).code).toBe('network_error');
        expect(SensorCoreError.rateLimited().code).toBe('rate_limited');
    });

    it('is instanceof Error', () => {
        const err = SensorCoreError.notConfigured();
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(SensorCoreError);
        expect(err.name).toBe('SensorCoreError');
    });
});

// ===========================================================================
// SensorCorePersistence
// ===========================================================================

describe('SensorCorePersistence', () => {
    it('saves and loads entries', () => {
        const p = makeTempPersistence();
        const e1 = createEntry('log one', 'info', 'u1', { key: 'val' });
        const e2 = createEntry('log two', 'error', undefined, undefined);

        p.save([e1, e2]);

        const loaded = p.loadPending();
        expect(loaded).toHaveLength(2);
        expect(loaded[0].content).toBe('log one');
        expect(loaded[0].level).toBe('info');
        expect(loaded[0].user_id).toBe('u1');
        expect(loaded[1].content).toBe('log two');
        expect(loaded[1].level).toBe('error');
        expect(loaded[1].user_id).toBeUndefined();
    });

    it('prunes stale entries', async () => {
        const p = makeTempPersistence(500, 1); // 1 second max age
        const entry = createEntry('stale', 'info', undefined, undefined);
        p.save([entry]);

        // Wait for expiry
        await new Promise((r) => setTimeout(r, 1_500));

        expect(p.loadPending()).toHaveLength(0);
    });

    it('respects max cap', () => {
        const p = makeTempPersistence(5);
        const entries = Array.from({ length: 10 }, (_, i) =>
            createEntry(`log ${i}`, 'info', undefined, undefined),
        );
        p.save(entries);

        const loaded = p.loadPending();
        expect(loaded).toHaveLength(5);
        // Should keep the newest (last 5)
        expect(loaded[0].content).toBe('log 5');
        expect(loaded[4].content).toBe('log 9');
    });

    it('clears all entries', () => {
        const p = makeTempPersistence();
        p.save([createEntry('to clear', 'info', undefined, undefined)]);
        expect(p.loadPending()).toHaveLength(1);

        p.clear();
        expect(p.loadPending()).toHaveLength(0);
    });

    it('prunes entries with too many retries', () => {
        const p = makeTempPersistence();
        const bad = createEntry('retried too much', 'info', undefined, undefined);
        bad.retryCount = 3; // >= 3 → pruned
        p.save([bad]);

        const good = createEntry('still ok', 'info', undefined, undefined);
        good.retryCount = 2; // < 3 → kept
        p.save([good]);

        const loaded = p.loadPending();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].content).toBe('still ok');
    });

    it('replacePending overwrites existing entries', () => {
        const p = makeTempPersistence();
        p.save([
            createEntry('old1', 'info', undefined, undefined),
            createEntry('old2', 'info', undefined, undefined),
        ]);
        expect(p.loadPending()).toHaveLength(2);

        p.replacePending([createEntry('new1', 'info', undefined, undefined)]);
        const loaded = p.loadPending();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].content).toBe('new1');
    });

    it('pendingCount returns correct count', () => {
        const p = makeTempPersistence();
        expect(p.pendingCount).toBe(0);
        p.save([createEntry('x', 'info', undefined, undefined)]);
        expect(p.pendingCount).toBe(1);
    });
});

// ===========================================================================
// SensorCore (facade)
// ===========================================================================

describe('SensorCore', () => {
    beforeEach(() => {
        // Reset state between tests by configuring with disabled
        SensorCore.configure({
            apiKey: 'test-key',
            host: 'http://localhost:0',
            enabled: false,
        });
    });

    it('disabled SDK log() does not crash', () => {
        SensorCore.configure({
            apiKey: 'key',
            host: 'http://localhost:0',
            enabled: false,
        });
        // Should be a no-op, no crash
        expect(() => SensorCore.log('this should be ignored', { level: 'error' })).not.toThrow();
    });

    it('logAsync throws not_configured when SDK is disabled', async () => {
        SensorCore.configure({
            apiKey: 'key',
            host: 'http://localhost:0',
            enabled: false,
        });
        await expect(SensorCore.logAsync('test')).rejects.toThrow(SensorCoreError);
    });

    it('remoteConfig returns empty when not configured', async () => {
        SensorCore.configure({
            apiKey: 'key',
            host: 'http://localhost:0',
            enabled: false,
        });
        const config = await SensorCore.remoteConfig();
        expect(Object.keys(config.raw)).toHaveLength(0);
    });

    it('log() with long content does not crash', () => {
        SensorCore.configure({
            apiKey: 'test-key',
            host: 'http://localhost:0',
            enabled: true,
        });
        const longMessage = 'a'.repeat(6000);
        expect(() => SensorCore.log(longMessage)).not.toThrow();
    });
});
