/**
 * Severity level of a log entry sent to the SensorCore server.
 *
 * Matches the server-side `level` field values exactly.
 * The level is used in the dashboard for filtering, colouring, and analytics.
 *
 * @example
 * ```ts
 * SensorCore.log('Device storage low', { level: 'warning' });
 * SensorCore.log('Payment declined',   { level: 'error' });
 * ```
 */
export type SensorCoreLevel = 'info' | 'warning' | 'error' | 'messages';

/** All valid log level values. */
export const SENSOR_CORE_LEVELS: readonly SensorCoreLevel[] = [
    'info',
    'warning',
    'error',
    'messages',
] as const;
