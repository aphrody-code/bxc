/**
 * Local mock HTTP server used by benchmarks to avoid hammering real websites.
 *
 * Serves:
 *   GET /static/<n>      — simple static HTML pages (50–120 KB)
 *   GET /spa/<n>         — SPA skeleton pages (small HTML, content injected by JS)
 *   GET /cf/<n>          — pages that simulate Cloudflare IUAM challenge HTML
 *   GET /turnstile/<n>   — pages with a mock Turnstile widget (always-pass sitekey)
 *
 * Usage:
 *   import { startMockServer, stopMockServer } from "./mock-server.ts";
 *   const port = await startMockServer();
 *   // ... run benchmarks ...
 *   await stopMockServer();
 */

let server: ReturnType<typeof Bun.serve> | null = null;

function makeStaticHtml(n: number): string {
	const items = Array.from(
		{ length: 30 },
		(_, i) => `<li><a href="/item/${i}">Article ${i + 1} on page ${n}</a></li>`,
	).join("\n");
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Static Page ${n} — Benchmark</title>
  <meta name="description" content="Benchmark static page number ${n}">
</head>
<body>
  <header><h1>Benchmark Static Page ${n}</h1></header>
  <main>
    <p>This is a static page generated for benchmark purposes. It contains enough content
    to be representative of a typical blog post or documentation page.</p>
    <ul>${items}</ul>
    <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
    incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
    exercitation ullamco laboris. Duis aute irure dolor in reprehenderit in voluptate.
    Velit esse cillum dolore eu fugiat nulla pariatur.</p>
  </main>
  <footer><p>Page ${n} of 30</p></footer>
</body>
</html>`;
}

function makeSpaHtml(n: number): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SPA Page ${n} — Benchmark</title>
</head>
<body>
  <div id="root"><p>Loading...</p></div>
  <script>
    // Simulate SPA hydration
    setTimeout(function() {
      var root = document.getElementById('root');
      var items = Array.from({length: 10}, function(_, i) {
        return '<li>Dynamic item ' + i + ' on SPA ${n}</li>';
      }).join('');
      root.innerHTML = '<h1>SPA Page ${n}</h1><ul>' + items + '</ul>';
      document.title = 'SPA Page ${n} — Hydrated';
    }, 50);
  </script>
</body>
</html>`;
}

function makeCfChallengeHtml(n: number): string {
	// Simulates the HTML of a Cloudflare IUAM page (does NOT do actual challenge)
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Just a moment... (CF mock ${n})</title>
</head>
<body>
  <div id="cf-wrapper">
    <div class="cf-browser-verification">
      <h1 class="cf-error-title">Checking your browser before accessing...</h1>
      <p>This is a mock Cloudflare challenge page for benchmarking. No real challenge.</p>
      <noscript>Please enable JavaScript</noscript>
    </div>
  </div>
  <!-- __cf_chl_opt mock marker -->
  <script>window.__cf_chl_opt = { cType: "non-interactive", cNounce: "${Math.random().toString(36).slice(2)}", cRay: "mock-ray-${n}", cHash: "mock-hash-${n}" };</script>
</body>
</html>`;
}

function makeTurnstileHtml(n: number): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Turnstile Mock ${n}</title>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body>
  <h1>Protected Page (Mock Turnstile ${n})</h1>
  <form method="POST">
    <div class="cf-turnstile"
         data-sitekey="1x00000000000000000000AA"
         data-callback="onSuccess">
    </div>
    <button type="submit">Submit</button>
  </form>
  <script>
    function onSuccess(token) {
      console.log('Turnstile token received (mock):', token);
    }
  </script>
</body>
</html>`;
}

export async function startMockServer(port = 0): Promise<number> {
	if (server) return server.port;
	// port=0 lets the OS pick an ephemeral free port

	server = Bun.serve({
		port,
		fetch(req) {
			const url = new URL(req.url);
			const path = url.pathname;

			// Static pages
			const staticMatch = path.match(/^\/static\/(\d+)$/);
			if (staticMatch) {
				const n = Number(staticMatch[1]);
				return new Response(makeStaticHtml(n), {
					headers: { "content-type": "text/html; charset=utf-8" },
				});
			}

			// SPA pages
			const spaMatch = path.match(/^\/spa\/(\d+)$/);
			if (spaMatch) {
				const n = Number(spaMatch[1]);
				return new Response(makeSpaHtml(n), {
					headers: { "content-type": "text/html; charset=utf-8" },
				});
			}

			// Cloudflare mock
			const cfMatch = path.match(/^\/cf\/(\d+)$/);
			if (cfMatch) {
				const n = Number(cfMatch[1]);
				return new Response(makeCfChallengeHtml(n), {
					status: 403,
					headers: {
						"content-type": "text/html; charset=utf-8",
						server: "cloudflare",
						"cf-ray": `mock-ray-${n}-LHR`,
						"cf-mitigated": "challenge",
					},
				});
			}

			// Turnstile mock
			const tsMatch = path.match(/^\/turnstile\/(\d+)$/);
			if (tsMatch) {
				const n = Number(tsMatch[1]);
				return new Response(makeTurnstileHtml(n), {
					headers: { "content-type": "text/html; charset=utf-8" },
				});
			}

			// Health check
			if (path === "/health") {
				return Response.json({ ok: true, port: server?.port ?? port });
			}

			return new Response("Not Found", { status: 404 });
		},
	});

	return server.port ?? 0;
}

export async function stopMockServer(): Promise<void> {
	if (server) {
		server.stop(true);
		server = null;
	}
}
