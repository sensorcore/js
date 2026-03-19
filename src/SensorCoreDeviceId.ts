// ---------------------------------------------------------------------------
// SensorCoreDeviceId
// ---------------------------------------------------------------------------

/**
 * Generates and persists a device-level anonymous UUID.
 *
 * Used as a fallback `user_id` when no explicit ID is provided via
 * `defaultUserId` or per-call `userId`. This ensures every log entry
 * has a `user_id` — required for user-centric analytics tools.
 *
 * ## Storage
 * - **Browser**: `localStorage` (key: `sensorcore_device_id`)
 * - **Node.js**: `~/.sensorcore/device_id` (plain text file)
 *
 * ## Lifecycle
 * - Persists across page reloads / app restarts
 * - Cleared on `localStorage.clear()` (browser) or file deletion (Node)
 * - Call `resetDeviceId()` on logout to generate a new ID next access
 *
 * ## Priority
 * ```
 * per-call userId  >  config.defaultUserId  >  auto device ID
 * ```
 */

const STORAGE_KEY = 'sensorcore_device_id';

const isBrowser =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).localStorage !== 'undefined';

/** Cached ID — avoids repeated storage reads during a single session. */
let cachedId: string | null = null;

// ---------------------------------------------------------------------------
// UUID v4 generation
// ---------------------------------------------------------------------------

/**
 * Generate a UUID v4 string.
 * Uses `crypto.randomUUID()` when available (modern browsers, Node 19+),
 * falls back to `crypto.getRandomValues()` for Node 18.
 */
function generateUUID(): string {
    // Modern path — available in all modern browsers and Node 19+
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    // Fallback — Node 18 has crypto.getRandomValues but not randomUUID
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        // Set version (4) and variant (RFC 4122)
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        return [
            hex.slice(0, 8),
            hex.slice(8, 12),
            hex.slice(12, 16),
            hex.slice(16, 20),
            hex.slice(20, 32),
        ].join('-');
    }

    // Last resort — Math.random (not cryptographically secure, but functional)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

// ---------------------------------------------------------------------------
// Browser storage
// ---------------------------------------------------------------------------

function readBrowser(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function writeBrowser(id: string): void {
    try {
        localStorage.setItem(STORAGE_KEY, id);
    } catch {
        // localStorage unavailable or quota exceeded — ID still cached in memory
    }
}

function clearBrowser(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // ignore
    }
}

// ---------------------------------------------------------------------------
// Node.js storage
// ---------------------------------------------------------------------------

let nodeFs: any = null;
let nodeFilePath: string | null = null;
let nodeInitialised = false;

function initNode(): boolean {
    if (nodeInitialised) return nodeFs !== null;
    nodeInitialised = true;
    try {
        const fs = require('node:fs');
        const path = require('node:path');
        const os = require('node:os');
        nodeFs = fs;
        const dir = path.join(os.homedir(), '.sensorcore');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        nodeFilePath = path.join(dir, 'device_id');
        return true;
    } catch {
        return false;
    }
}

function readNode(): string | null {
    if (!initNode() || !nodeFilePath) return null;
    try {
        if (!nodeFs.existsSync(nodeFilePath)) return null;
        const raw = nodeFs.readFileSync(nodeFilePath, 'utf-8').trim();
        return raw || null;
    } catch {
        return null;
    }
}

function writeNode(id: string): void {
    if (!initNode() || !nodeFilePath) return;
    try {
        nodeFs.writeFileSync(nodeFilePath, id, 'utf-8');
    } catch {
        // ignore — ID still cached in memory
    }
}

function clearNode(): void {
    if (!initNode() || !nodeFilePath) return;
    try {
        if (nodeFs.existsSync(nodeFilePath)) {
            nodeFs.unlinkSync(nodeFilePath);
        }
    } catch {
        // ignore
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the persistent device ID, generating one if it doesn't exist.
 *
 * The ID is cached in memory for the duration of the process / page,
 * so repeated calls are O(1) after the first one.
 */
export function getDeviceId(): string {
    if (cachedId) return cachedId;

    // Try to load from storage
    const stored = isBrowser ? readBrowser() : readNode();
    if (stored) {
        cachedId = stored;
        return stored;
    }

    // Generate and persist
    const id = generateUUID();
    cachedId = id;
    if (isBrowser) {
        writeBrowser(id);
    } else {
        writeNode(id);
    }
    return id;
}

/**
 * Clear the stored device ID. A new one will be generated on the next
 * call to `getDeviceId()`.
 *
 * Use this on user logout to ensure the next anonymous session gets
 * a fresh identifier.
 */
export function resetDeviceId(): void {
    cachedId = null;
    if (isBrowser) {
        clearBrowser();
    } else {
        clearNode();
    }
}
