# Statistics Tracker + Live Dashboard

Bunlight includes a `Statistics` class inspired by Crawlee's statistics tracker,
plus a live HTTP dashboard served via `Bun.serve`.

---

## Synopsis

```ts
import { Statistics } from "bunlight/stats/Statistics";
import { startDashboard } from "bunlight/stats/dashboard";

const stats = new Statistics({ sessionName: "my-crawler" });
stats.startTracking();

// Register results as requests complete:
stats.register(durationMs, true);            // success
stats.register(durationMs, false, "Timeout"); // failure with error type

// Get a point-in-time snapshot:
const snap = stats.snapshot();
console.log(snap.requestsPerMinute, snap.p95DurationMs);

// Start the live dashboard (default port 9229):
const dash = await startDashboard(stats, 9229);
// Navigate to http://localhost:9229

// Stop when done:
stats.stopTracking();
await dash.stop();
```

---

## Statistics class

### Constructor options (`StatisticsOptions`)

| Option | Type | Default | Description |
|---|---|---|---|
| `dbPath` | `string` | none | Path to a SQLite file for persistence. Omit for in-memory only. |
| `sessionName` | `string` | `"default"` | Session key used in the SQLite table. |
| `maxSamples` | `number` | `10000` | Max duration samples kept for percentile computation (sliding window). |

### Methods

| Method | Description |
|---|---|
| `startTracking()` | Starts the runtime timer. Call before crawling. |
| `stopTracking()` | Freezes the elapsed time counter. |
| `register(durationMs, success, errorType?)` | Records one request outcome. |
| `registerRetry()` | Increments the retry counter. |
| `snapshot()` | Returns a `StatisticsSnapshot` with all current metrics. |
| `reset()` | Clears all counters and duration samples. Does not stop the timer. |
| `loadLastSnapshot()` | Restores state from the last SQLite row (resume after restart). |
| `closeDb()` | Closes the SQLite connection. |

### Snapshot fields (`StatisticsSnapshot`)

| Field | Type | Description |
|---|---|---|
| `requestsTotal` | `number` | Total requests (finished + failed). |
| `requestsFinished` | `number` | Successful request count. |
| `requestsFailed` | `number` | Failed request count. |
| `requestsRetried` | `number` | Retry attempt count. |
| `requestAvgFinishedDurationMs` | `number` | Mean duration of successful requests (ms). |
| `p50DurationMs` | `number` | Median latency of successful requests (ms). |
| `p95DurationMs` | `number` | 95th percentile latency (ms). |
| `requestsPerMinute` | `number` | Throughput since `startTracking()`. |
| `crawlerRuntimeMillis` | `number` | Elapsed runtime since `startTracking()` (ms). |
| `successRate` | `number` | Fraction in [0, 1]. 1.0 if no requests yet. |
| `errorBreakdown` | `Record<string, number>` | Per-error-type failure counts. |

---

## Dashboard

### `startDashboard(stats, port?)`

Starts a `Bun.serve` HTTP server on the given port (default: **9229**).

Returns a `DashboardHandle`:

```ts
interface DashboardHandle {
  readonly port: number;   // actual port bound
  readonly url: string;    // e.g. "http://localhost:9229"
  stop(): Promise<void>;   // gracefully stops the server
}
```

### Routes

| Route | Description |
|---|---|
| `GET /` | HTML dashboard with auto-refresh every 1 second. |
| `GET /api/stats` | JSON snapshot of current statistics (CORS-enabled). |

### CI usage

Fetch the JSON endpoint from any CI step:

```bash
curl -s http://localhost:9229/api/stats | jq .requestsPerMinute
```

---

## SQLite persistence

When `dbPath` is provided, every `register()` call appends a snapshot row to:

```sql
TABLE statistics_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session      TEXT,
  recorded_at  TEXT,
  snapshot_json TEXT
)
```

Stored at the path you specify, e.g. `./storage/stats.sqlite`.

Call `loadLastSnapshot()` on startup to resume from a previous run.

---

## Example with AutoscaledPool

```ts
import { Statistics } from "bunlight/stats/Statistics";
import { startDashboard } from "bunlight/stats/dashboard";
import { AutoscaledPool } from "bunlight/pool/AutoscaledPool";

const stats = new Statistics({ dbPath: "./storage/stats.sqlite" });
stats.startTracking();
const dash = await startDashboard(stats, 9229);

const items = ["https://example.com", "https://bun.sh"];
let idx = 0;

const pool = new AutoscaledPool({
  minConcurrency: 1,
  maxConcurrency: 10,
  runTaskFunction: async () => {
    const url = items[idx++];
    const t0 = Date.now();
    try {
      await fetch(url);
      stats.register(Date.now() - t0, true);
    } catch (err) {
      stats.register(Date.now() - t0, false, (err as Error).constructor.name);
    }
  },
  isTaskReadyFunction: async () => idx < items.length,
  isFinishedFunction: async () => idx >= items.length,
});

await pool.run();
stats.stopTracking();
console.log(stats.snapshot());
await dash.stop();
```
