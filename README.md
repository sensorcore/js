# SensorCore JavaScript SDK

TypeScript SDK for sending logs to your [SensorCore](https://github.com/udevwork/SensorCore) server. Zero external dependencies, works in browser and Node.js 18+.

## Installation

```bash
npm install sensorcore
```

## Quick Start

```ts
import SensorCore from 'sensorcore';

// 1. Configure once at app startup
SensorCore.configure({
  apiKey: 'sc_your_api_key',
  host: 'https://api.sensorcore.dev',
});

// 2a. Fire-and-forget — no await needed, never throws (most common)
SensorCore.log('App launched');
SensorCore.log('User signed up', { level: 'info', userId: 'user-uuid-123' });
SensorCore.log('Payment failed', { level: 'error', metadata: { code: 'card_declined', amount: 99 } });

// 2b. Async/await — when you need delivery confirmation
try {
  await SensorCore.logAsync('Critical error', { level: 'error' });
} catch (err) {
  console.error('Log failed:', err);
}
```

## Configuration Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `apiKey` | `string` | — | Your project API key |
| `host` | `string` | — | Your SensorCore server URL |
| `defaultUserId` | `string?` | `undefined` | Auto-attached user ID for every log |
| `enabled` | `boolean` | `true` | Set `false` to silence all logs (e.g. in tests) |
| `timeout` | `number` | `10000` | Network request timeout in **milliseconds** |
| `persistFailedLogs` | `boolean` | `true` | Save failed logs for auto-retry |
| `maxPendingLogs` | `number` | `500` | Max entries buffered offline |
| `pendingLogMaxAge` | `number` | `86400` | Drop buffered entries older than this (seconds) |

### Full config example

```ts
SensorCore.configure({
  apiKey: 'sc_abc123',
  host: 'https://api.sensorcore.dev',
  defaultUserId: currentUser?.id,
  enabled: process.env.NODE_ENV !== 'test',
  timeout: 15_000,
  persistFailedLogs: true,
  maxPendingLogs: 500,
  pendingLogMaxAge: 86400,
});
```

## Log Levels

| Level | Use case |
|-------|----------|
| `'info'` | General events (default) |
| `'warning'` | Recoverable issues |
| `'error'` | Failures — triggers error indicator in dashboard |
| `'messages'` | User-facing messages / chat events |

## Metadata

Pass a flat object with `string`, `number`, or `boolean` values.
Unsupported types (arrays, nested objects, null) are silently dropped.

```ts
SensorCore.log('Purchase completed', {
  metadata: {
    product_id: 'sku-42',
    price: 9.99,
    is_trial: false,
    attempt: 1,
  },
});
```

## Error Handling

When using `logAsync`, you can catch typed `SensorCoreError`:

```ts
import { SensorCoreError } from 'sensorcore';

try {
  await SensorCore.logAsync('Event');
} catch (err) {
  if (err instanceof SensorCoreError) {
    switch (err.code) {
      case 'not_configured':  break; // forgot to call configure()
      case 'network_error':   break; // no internet / timeout
      case 'server_error':    break; // server returned 4xx / 5xx
      case 'encoding_failed': break; // metadata serialisation failed
      case 'rate_limited':    break; // server returned 429
    }
  }
}
```

### Rate Limiting

If the server returns **HTTP 429**, the SDK activates a circuit breaker with exponential backoff (60s → 120s → 300s → 600s max). After the cooldown expires, logging is automatically resumed. A successful request resets the backoff timer.

## Offline Buffering

When a log fails to send (e.g. no internet), the SDK automatically:

1. **Saves** the entry to storage (`localStorage` in browser, `~/.sensorcore/pending.json` in Node.js)
2. **Monitors** connectivity (`online` event in browser)
3. **Retries** all pending entries when the network returns
4. **Flushes** entries from previous sessions on next startup

Each entry keeps its **original timestamp** from when `log()` was called.

**Safeguards:**

- Max **500 entries** stored — oldest dropped when full
- Max **3 retry attempts** per entry — then permanently dropped
- **24-hour TTL** — stale entries are pruned automatically
- Configurable via `persistFailedLogs`, `maxPendingLogs`, `pendingLogMaxAge`
- Set `persistFailedLogs: false` to disable entirely

## Remote Config

Fetch feature flags from your SensorCore server at runtime — no app release needed.

```ts
const config = await SensorCore.remoteConfig();

// Typed accessors — always undefined-safe, never crash
if (config.bool('show_new_onboarding') === true) {
  showNewOnboarding();
}
const timeout = config.number('api_timeout_seconds') ?? 30;
const variant = config.string('paywall_variant') ?? 'control';
const retries = config.int('max_retries') ?? 3;
```

`remoteConfig()` **never throws** — if the server is unreachable it returns an empty config.

| Accessor | Returns | Notes |
|----------|---------|-------|
| `bool(key)` | `boolean \| undefined` | `undefined` if absent or wrong type |
| `string(key)` | `string \| undefined` | `undefined` if absent or wrong type |
| `number(key)` | `number \| undefined` | Any numeric value |
| `int(key)` | `number \| undefined` | Only exact integers |
| `get(key)` | `unknown` | Raw value |
| `config.raw` | `Record<string, unknown>` | Full decoded dictionary |

## Requirements

- **Browser:** Any modern browser with `fetch` support
- **Node.js:** 18+ (native `fetch`)
- **TypeScript:** 5.0+ (optional — works with plain JavaScript too)

## License

MIT
