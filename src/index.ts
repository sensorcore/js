// Re-export all public API from a single entry point.

export { SensorCore } from './SensorCore.js';
export { default } from './SensorCore.js';

// Types & classes consumers may need
export type { SensorCoreConfig } from './SensorCoreConfig.js';
export type { SensorCoreLevel } from './SensorCoreLevel.js';
export type { LogOptions } from './SensorCore.js';
export type { SensorCoreMetadata, SensorCoreMetadataValue } from './SensorCoreEntry.js';

export { SensorCoreError } from './SensorCoreError.js';
export type { SensorCoreErrorCode } from './SensorCoreError.js';
export { SensorCoreRemoteConfig } from './SensorCoreRemoteConfig.js';
export { SENSOR_CORE_LEVELS } from './SensorCoreLevel.js';
