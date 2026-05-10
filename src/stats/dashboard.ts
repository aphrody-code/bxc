/**
 * @module bunlight/stats/dashboard
 *
 * Live HTTP dashboard for Bunlight statistics.
 * Exposes a minimal single-page HTML dashboard (auto-refresh every 1 s)
 * and a JSON API endpoint for CI consumption.
 *
 * All served via `Bun.serve` — zero external dependencies.
 *
 * Usage:
 * ```ts
 * import { Statistics } from "./Statistics.ts";
 * import { startDashboard } from "./dashboard.ts";
 *
 * const stats = new Statistics();
 * stats.startTracking();
 *
 * const dashboard = await startDashboard(stats, 9229);
 * // ... run crawler ...
 * await dashboard.stop();
 * ```
 */

import type { Statistics, StatisticsSnapshot } from "./Statistics.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardHandle {
	/** The port the dashboard is listening on. */
	readonly port: number;
	/** Base URL of the dashboard (e.g. `http://localhost:9229`). */
	readonly url: string;
	/** Stop the HTTP server and release the port. */
	stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function renderHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bunlight Stats Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", monospace;
    background: #0f1117;
    color: #e2e8f0;
    padding: 24px;
    min-height: 100vh;
  }
  h1 { font-size: 1.5rem; margin-bottom: 4px; color: #f8fafc; letter-spacing: -0.5px; }
  .subtitle { font-size: 0.8rem; color: #64748b; margin-bottom: 24px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .card {
    background: #1e2430;
    border: 1px solid #2d3748;
    border-radius: 8px;
    padding: 16px;
  }
  .card-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #64748b;
    margin-bottom: 6px;
  }
  .card-value {
    font-size: 1.6rem;
    font-weight: 600;
    color: #38bdf8;
    font-variant-numeric: tabular-nums;
  }
  .card-value.green { color: #4ade80; }
  .card-value.red   { color: #f87171; }
  .card-value.amber { color: #fbbf24; }
  .section-title {
    font-size: 0.85rem;
    color: #94a3b8;
    margin-bottom: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid #2d3748;
  }
  .errors-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  .errors-table th, .errors-table td {
    padding: 6px 10px;
    text-align: left;
    border-bottom: 1px solid #2d3748;
  }
  .errors-table th { color: #64748b; font-weight: 500; }
  #status { font-size: 0.7rem; color: #475569; margin-top: 24px; }
  #status span { color: #38bdf8; }
</style>
</head>
<body>
<h1>Bunlight Stats Dashboard</h1>
<p class="subtitle">Live crawler statistics &mdash; auto-refresh every second</p>

<div class="grid" id="cards">
  <div class="card"><div class="card-label">Requests Total</div><div class="card-value" id="val-total">-</div></div>
  <div class="card"><div class="card-label">Finished</div><div class="card-value green" id="val-finished">-</div></div>
  <div class="card"><div class="card-label">Failed</div><div class="card-value red" id="val-failed">-</div></div>
  <div class="card"><div class="card-label">Retried</div><div class="card-value amber" id="val-retried">-</div></div>
  <div class="card"><div class="card-label">Success Rate</div><div class="card-value" id="val-rate">-</div></div>
  <div class="card"><div class="card-label">Req / min</div><div class="card-value" id="val-rpm">-</div></div>
  <div class="card"><div class="card-label">Avg Duration</div><div class="card-value" id="val-avg">-</div></div>
  <div class="card"><div class="card-label">p50 Latency</div><div class="card-value" id="val-p50">-</div></div>
  <div class="card"><div class="card-label">p95 Latency</div><div class="card-value" id="val-p95">-</div></div>
  <div class="card"><div class="card-label">Runtime</div><div class="card-value" id="val-runtime">-</div></div>
</div>

<div class="section-title">Error Breakdown</div>
<table class="errors-table">
  <thead><tr><th>Error Type</th><th>Count</th></tr></thead>
  <tbody id="errors-body"><tr><td colspan="2" style="color:#475569">No errors recorded</td></tr></tbody>
</table>

<div id="status">Last updated: <span id="ts">-</span></div>

<script>
function fmtMs(ms) {
  if (ms === 0) return '0 ms';
  if (ms < 1000) return ms.toFixed(1) + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(2) + ' s';
  return (ms / 60000).toFixed(1) + ' min';
}
function fmtPct(r) { return (r * 100).toFixed(1) + '%'; }

async function refresh() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const s = await res.json();

    document.getElementById('val-total').textContent    = s.requestsTotal;
    document.getElementById('val-finished').textContent = s.requestsFinished;
    document.getElementById('val-failed').textContent   = s.requestsFailed;
    document.getElementById('val-retried').textContent  = s.requestsRetried;
    document.getElementById('val-rate').textContent     = fmtPct(s.successRate);
    document.getElementById('val-rpm').textContent      = s.requestsPerMinute.toFixed(1);
    document.getElementById('val-avg').textContent      = fmtMs(s.requestAvgFinishedDurationMs);
    document.getElementById('val-p50').textContent      = fmtMs(s.p50DurationMs);
    document.getElementById('val-p95').textContent      = fmtMs(s.p95DurationMs);
    document.getElementById('val-runtime').textContent  = fmtMs(s.crawlerRuntimeMillis);

    const tbody = document.getElementById('errors-body');
    const entries = Object.entries(s.errorBreakdown);
    if (entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" style="color:#475569">No errors recorded</td></tr>';
    } else {
      tbody.innerHTML = entries
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => '<tr><td>' + k + '</td><td>' + v + '</td></tr>')
        .join('');
    }

    document.getElementById('ts').textContent = new Date().toLocaleTimeString();
  } catch (_) {}
}

refresh();
setInterval(refresh, 1000);
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// startDashboard
// ---------------------------------------------------------------------------

/**
 * Start a live HTTP dashboard on `port` (default 9229) backed by `stats`.
 *
 * Routes:
 *   GET /          -> HTML dashboard (auto-refresh every 1 s)
 *   GET /api/stats -> JSON snapshot of current statistics
 *
 * Returns a handle with `stop()` to tear down the server.
 *
 * @example
 * ```ts
 * const stats = new Statistics();
 * stats.startTracking();
 * const dash = await startDashboard(stats, 9229);
 * // navigate to http://localhost:9229
 * await dash.stop();
 * ```
 */
export async function startDashboard(stats: Statistics, port = 9229): Promise<DashboardHandle> {
	const html = renderHtml();
	const htmlBytes = new TextEncoder().encode(html);

	const server = Bun.serve({
		port,
		fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === "/api/stats") {
				const snap: StatisticsSnapshot = stats.snapshot();
				return new Response(JSON.stringify(snap), {
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "no-cache",
						"Access-Control-Allow-Origin": "*",
					},
				});
			}

			// Serve the HTML dashboard for all other GET requests
			if (req.method === "GET") {
				return new Response(htmlBytes, {
					headers: {
						"Content-Type": "text/html; charset=utf-8",
						"Cache-Control": "no-cache",
					},
				});
			}

			return new Response("Method Not Allowed", { status: 405 });
		},
		error(err) {
			return new Response(`Internal server error: ${err.message}`, { status: 500 });
		},
	});

	const actualPort = server.port ?? port;
	const baseUrl = `http://localhost:${actualPort}`;

	return {
		port: actualPort,
		url: baseUrl,
		async stop(): Promise<void> {
			await server.stop(true);
		},
	};
}
