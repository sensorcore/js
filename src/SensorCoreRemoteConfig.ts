/**
 * A snapshot of Remote Config flags fetched from the SensorCore server.
 *
 * Always safe to use — if the server is unreachable, returns no flags.
 * Access values with typed helpers:
 *
 * ```ts
 * const config = await SensorCore.remoteConfig();
 *
 * if (config.bool('show_new_onboarding') === true) {
 *   showNewOnboarding();
 * }
 * const timeout = config.number('api_timeout_seconds') ?? 30;
 * const variant = config.string('paywall_variant') ?? 'control';
 * const retries = config.int('max_retries') ?? 3;
 * ```
 */
export class SensorCoreRemoteConfig {
    /** The raw decoded JSON dictionary. */
    readonly raw: Record<string, unknown>;

    constructor(raw: Record<string, unknown>) {
        this.raw = raw;
    }

    // -- Typed accessors -------------------------------------------------------

    /** Returns the value for `key`, or `undefined` if absent. */
    get(key: string): unknown {
        return this.raw[key];
    }

    /** Returns the value for `key` as `string`, or `undefined` if absent or wrong type. */
    string(key: string): string | undefined {
        const v = this.raw[key];
        return typeof v === 'string' ? v : undefined;
    }

    /**
     * Returns the value for `key` as `boolean`, or `undefined` if absent or wrong type.
     * A string `"true"` would not match — use `string()` in that case.
     */
    bool(key: string): boolean | undefined {
        const v = this.raw[key];
        return typeof v === 'boolean' ? v : undefined;
    }

    /**
     * Returns the value for `key` as `number`, or `undefined` if absent or not numeric.
     */
    number(key: string): number | undefined {
        const v = this.raw[key];
        return typeof v === 'number' ? v : undefined;
    }

    /**
     * Returns the value for `key` as an integer, or `undefined` if absent or not an exact integer.
     */
    int(key: string): number | undefined {
        const v = this.raw[key];
        if (typeof v === 'number' && Number.isInteger(v)) return v;
        return undefined;
    }

    // -- Static ----------------------------------------------------------------

    /** Empty config returned when the server is unreachable or not configured. */
    static readonly empty = new SensorCoreRemoteConfig({});
}
