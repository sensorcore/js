import type { SensorCoreEntry } from './SensorCoreEntry.js';

// ---------------------------------------------------------------------------
// Storage abstraction
// ---------------------------------------------------------------------------

/**
 * Minimal abstraction over persistence backends.
 * - Browser → `localStorage`
 * - Node.js → JSON file via `fs`
 */
interface StorageBackend {
    read(): SensorCoreEntry[];
    write(entries: SensorCoreEntry[]): void;
    clear(): void;
}

// ---------------------------------------------------------------------------
// Detect environment
// ---------------------------------------------------------------------------

const isBrowser =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).localStorage !== 'undefined';

const STORAGE_KEY = 'sensorcore_pending';

// ---------------------------------------------------------------------------
// Browser backend — localStorage
// ---------------------------------------------------------------------------

class BrowserStorage implements StorageBackend {
    read(): SensorCoreEntry[] {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            return JSON.parse(raw) as SensorCoreEntry[];
        } catch {
            return [];
        }
    }

    write(entries: SensorCoreEntry[]): void {
        try {
            if (entries.length === 0) {
                localStorage.removeItem(STORAGE_KEY);
            } else {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
            }
        } catch {
            // localStorage quota exceeded or unavailable — silently ignore
        }
    }

    clear(): void {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            // ignore
        }
    }
}

// ---------------------------------------------------------------------------
// Node.js backend — file system
// ---------------------------------------------------------------------------

class NodeStorage implements StorageBackend {
    private filePath: string | null = null;
    private fs: any = null;
    private initialised = false;

    private init(): boolean {
        if (this.initialised) return this.fs !== null;
        this.initialised = true;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const fs = require('node:fs');
            const path = require('node:path');
            const os = require('node:os');

            this.fs = fs;
            const dir = path.join(os.homedir(), '.sensorcore');
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            this.filePath = path.join(dir, 'pending.json');
            return true;
        } catch {
            return false;
        }
    }

    read(): SensorCoreEntry[] {
        if (!this.init() || !this.filePath) return [];
        try {
            if (!this.fs.existsSync(this.filePath)) return [];
            const raw = this.fs.readFileSync(this.filePath, 'utf-8');
            return JSON.parse(raw) as SensorCoreEntry[];
        } catch {
            return [];
        }
    }

    write(entries: SensorCoreEntry[]): void {
        if (!this.init() || !this.filePath) return;
        try {
            if (entries.length === 0) {
                if (this.fs.existsSync(this.filePath)) {
                    this.fs.unlinkSync(this.filePath);
                }
            } else {
                this.fs.writeFileSync(this.filePath, JSON.stringify(entries), 'utf-8');
            }
        } catch {
            // ignore
        }
    }

    clear(): void {
        if (!this.init() || !this.filePath) return;
        try {
            if (this.fs.existsSync(this.filePath)) {
                this.fs.unlinkSync(this.filePath);
            }
        } catch {
            // ignore
        }
    }
}

// ---------------------------------------------------------------------------
// SensorCorePersistence
// ---------------------------------------------------------------------------

/**
 * Disk/localStorage-backed buffer for log entries that failed to send.
 *
 * Automatically picks the right backend:
 * - Browser → `localStorage` (key: `sensorcore_pending`)
 * - Node.js → `~/.sensorcore/pending.json`
 *
 * Supports pruning by age, cap, and retry count.
 */
export class SensorCorePersistence {
    private readonly backend: StorageBackend;
    private readonly maxEntries: number;
    private readonly maxAge: number; // seconds

    constructor(
        maxEntries: number = 500,
        maxAge: number = 86_400,
        /** @internal Override for testing */
        testBackend?: StorageBackend,
    ) {
        this.maxEntries = maxEntries;
        this.maxAge = maxAge;

        if (testBackend) {
            this.backend = testBackend;
        } else {
            this.backend = isBrowser ? new BrowserStorage() : new NodeStorage();
        }
    }

    /** Append failed entries to storage. */
    save(entries: SensorCoreEntry[]): void {
        if (entries.length === 0) return;
        const existing = this.backend.read();
        this.backend.write([...existing, ...entries]);
    }

    /** Load pending entries, pruning stale / over-cap / over-retried. */
    loadPending(): SensorCoreEntry[] {
        const raw = this.backend.read();
        if (raw.length === 0) return [];

        const now = Date.now();
        let entries = raw.filter((entry) => {
            // Prune: too many retries
            if (entry.retryCount >= 3) return false;

            // Prune: stale entries
            const entryTime = new Date(entry.created_at).getTime();
            if (!isNaN(entryTime) && (now - entryTime) / 1_000 > this.maxAge) return false;

            return true;
        });

        // Prune: over cap — keep newest, drop oldest
        if (entries.length > this.maxEntries) {
            entries = entries.slice(entries.length - this.maxEntries);
        }

        return entries;
    }

    /** Replace all pending entries (used after partial flush). */
    replacePending(entries: SensorCoreEntry[]): void {
        this.backend.write(entries);
    }

    /** Delete all pending entries. */
    clear(): void {
        this.backend.clear();
    }

    /** Number of pending entries (after pruning). */
    get pendingCount(): number {
        return this.loadPending().length;
    }
}
