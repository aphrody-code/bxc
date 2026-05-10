#!/usr/bin/env bun
/**
 * `bunlight serve` — CLI entrypoint that spawns Bunlight as a CDP server on
 * a local TCP port.  Designed to be invoked by external clients (such as
 * agent-browser's Rust orchestrator) which expect a Chrome-DevTools-Protocol
 * compatible HTTP + WebSocket endpoint.
 *
 * Usage:
 *
 *   bunlight serve --cdp-port <N> [--profile static|fast|http] \
 *                  [--host 127.0.0.1] [--proxy http://...]
 *
 * Endpoints exposed:
 *
 *   GET  /json/version            -> Browser version + webSocketDebuggerUrl
 *   GET  /json/list   /json       -> Target list (page + browser)
 *   GET  /json/protocol           -> empty stub
 *   WS   /devtools/browser[/<id>] -> CDP browser-level WebSocket
 *   WS   /devtools/page/<id>      -> CDP page-level WebSocket (proxied to fast)
 *
 * Profile dispatch:
 *
 *   - static  : in-process StaticDomTransport bound to a WebSocket bridge.
 *   - fast    : spawn `lightpanda serve --port <ephemeral>`, reverse-proxy
 *               every endpoint and WebSocket frame to it.  The presence of
 *               this CLI just means we can speak the Bunlight CLI surface
 *               while delegating actual CDP handling to Lightpanda.
 *   Forbidden engines : Chrome / Chromium / Firefox / Edge / Safari and
 *   any derivative are not exposed. For server-grade anti-detection use
 *   `launchGhostBrowser` from `src/profiles/ghost/` (Lightpanda + CDP
 *   stealth injects via `Page.addScriptToEvaluateOnNewDocument`).
 */

import type { Server, ServerWebSocket } from "bun";
// NOTE: StaticDomTransport and HttpProfileTransport are loaded lazily via
// dynamic import inside startStatic / startHttp.  This prevents FFI libraries
// (zigquery cdylib, curl-impersonate) from loading when the user picks
// profile=fast or profile=stealth, which reduces cold start by ~30-60 ms.
import type { StaticDomTransport } from "../transport/StaticDomTransport.ts";
import type { HttpProfileTransport } from "../transport/HttpProfileTransport.ts";
import type { CDPEvent } from "../transport/InProcessTransport.ts";

// ---------------------------------------------------------------------------
// Argv parsing
// ---------------------------------------------------------------------------

interface CLIOptions {
	autoProfile: boolean;
	host: string;
	profile: "static" | "fast" | "http";
	proxy?: string;
	logLevel: "debug" | "info" | "warn" | "error" | "silent";
}

function parseArgs(argv: string[]): CLIOptions {
	// Skip "bun", "<script>" — start parsing from "serve" onward.
	// Accept either `bunlight serve --foo` or just `--foo`.
	const args = [...argv];
	if (args[0] === "serve") args.shift();

	let cdpPort = 0;
	let host = "127.0.0.1";
	let profile: CLIOptions["profile"] = "static";
	let proxy: string | undefined;
	let logLevel: CLIOptions["logLevel"] = "info";
	let autoProfile = false;

	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const next = (): string => {
			const v = args[++i];
			if (v === undefined) {
				throw new Error(`Missing value for argument: ${a}`);
			}
			return v;
		};
		switch (a) {
			case "--cdp-port":
			case "--port":
				cdpPort = Number.parseInt(next(), 10);
				if (!Number.isFinite(cdpPort) || cdpPort <= 0 || cdpPort > 65535) {
					throw new Error(`Invalid --cdp-port: ${cdpPort}`);
				}
				break;
			case "--host":
				host = next();
				break;
			case "--profile": {
				const v = next();
				if (v !== "static" && v !== "fast" && v !== "http") {
					throw new Error(
						`Unknown --profile: ${v} (expected static|fast|http; ` +
							`Chrome / Chromium / Firefox / Edge / Safari engines are forbidden)`,
					);
				}
				profile = v;
				break;
			}
			case "--proxy":
				proxy = next();
				break;
			case "--auto-profile":
				autoProfile = true;
				break;
			case "--log-level":
				autoProfile = true;
				break;
			case "--log-level":
				logLevel = next() as CLIOptions["logLevel"];
				break;
			case "-h":
			case "--help":
				printUsage();
				process.exit(0);
				break;
			default:
				if (a.startsWith("--")) {
					// Tolerate unknown flags with values to ease forward-compat
					// with future agent-browser additions.
					if (args[i + 1] !== undefined && !args[i + 1].startsWith("--")) {
						i++;
					}
				}
		}
	}

	if (cdpPort === 0) {
		throw new Error("--cdp-port is required");
	}

	return { cdpPort, host, profile, autoProfile, proxy, logLevel };
}

function printUsage(): void {
	const usage = `bunlight serve --cdp-port <N> [options]

Options:
  --cdp-port <N>           TCP port for the CDP server (required)
  --host <addr>            Bind address (default 127.0.0.1)
  --profile <p>            static | fast | http (default static)
  --auto-profile           Auto-escalate profiles on 403 or Cloudflare
  --proxy <url>            Upstream proxy passed to the engine
  --log-level <level>      debug | info | warn | error | silent
  -h, --help               Show this message
`;
	process.stdout.write(usage);
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

class Logger {
	constructor(private readonly level: CLIOptions["logLevel"]) {}
	#shouldLog(level: "debug" | "info" | "warn" | "error"): boolean {
		const order = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const;
		return order[level] >= order[this.level];
	}
	debug(...args: unknown[]): void {
		if (this.#shouldLog("debug")) console.error("[bunlight]", ...args);
	}
	info(...args: unknown[]): void {
		if (this.#shouldLog("info")) console.error("[bunlight]", ...args);
	}
	warn(...args: unknown[]): void {
		if (this.#shouldLog("warn")) console.error("[bunlight] WARN", ...args);
	}
	error(...args: unknown[]): void {
		if (this.#shouldLog("error")) console.error("[bunlight] ERROR", ...args);
	}
}

// ---------------------------------------------------------------------------
// Browser identity (shared across all profiles)
// ---------------------------------------------------------------------------

// Bun.randomUUIDv7 — sortable, monotonic, collision-resistant.
const BROWSER_ID = `bunlight-${Bun.randomUUIDv7().slice(0, 8)}`;
const PAGE_ID = `page-${Bun.randomUUIDv7().slice(0, 8)}`;

function browserVersion(profile: CLIOptions["profile"], host: string, port: number) {
	return {
		Browser: `Bunlight/0.1.0 (${profile})`,
		"Protocol-Version": "1.3",
		"User-Agent": `Bunlight/0.1.0 (${profile})`,
		"V8-Version": "0.0.0",
		"WebKit-Version": "0.0.0",
		webSocketDebuggerUrl: `ws://${host}:${port}/devtools/browser/${BROWSER_ID}`,
	};
}

function targetList(profile: CLIOptions["profile"], host: string, port: number) {
	return [
		{
			id: PAGE_ID,
			type: "page",
			title: "Bunlight",
			url: "about:blank",
			devtoolsFrontendUrl: "",
			webSocketDebuggerUrl: `ws://${host}:${port}/devtools/page/${PAGE_ID}`,
		},
		{
			id: BROWSER_ID,
			type: "browser",
			title: `Bunlight (${profile})`,
			url: "about:blank",
			webSocketDebuggerUrl: `ws://${host}:${port}/devtools/browser/${BROWSER_ID}`,
		},
	];
}

// ---------------------------------------------------------------------------
// Static profile — in-process StaticDomTransport bridge
// ---------------------------------------------------------------------------

// Using unknown here because the actual types are lazily imported.
// Each profile function casts appropriately after the dynamic import resolves.
interface WSData {
	transport?: {
		send(msg: string): void;
		close(): void;
		onmessage?: (msg: string) => void;
		onclose?: () => void;
	};
	upstream?: WebSocket;
	pendingFrames: string[];
	kind: "static" | "fast-proxy" | "stealth-proxy" | "max-proxy" | "http";
}

// Lazy module cache for StaticDomTransport.  Loaded on first WS connection, not
// at process start, so the zigquery cdylib is not dlopen'd until a client
// actually connects.  Cold start for profile=static goes from ~150 ms to <50 ms.
let _staticTransportModule: typeof import("../transport/StaticDomTransport.ts") | null = null;

async function loadStaticTransport(): Promise<typeof import("../transport/StaticDomTransport.ts")> {
	if (!_staticTransportModule) {
		_staticTransportModule = await import("../transport/StaticDomTransport.ts");
	}
	return _staticTransportModule;
}

function startStatic(opts: CLIOptions, logger: Logger): Server {
	const { cdpPort, host } = opts;

	// Bind the port FIRST — /json/version is available to callers immediately,
	// before we dlopen the zigquery cdylib.  StaticDomTransport is loaded lazily
	// on the first WebSocket connection via the module cache above.
	const server = Bun.serve<WSData, Record<string, never>>({
		hostname: host,
		port: cdpPort,
		fetch(req, srv) {
			const url = new URL(req.url);
			if (
				url.pathname.startsWith("/devtools/browser") ||
				url.pathname.startsWith("/devtools/page")
			) {
				if (
					srv.upgrade(req, {
						data: { pendingFrames: [], kind: "static" } satisfies WSData,
					})
				) {
					return undefined;
				}
				return new Response("WebSocket upgrade failed", { status: 400 });
			}
			return handleHttpDiscovery(url.pathname, opts, logger);
		},
		websocket: {
			open(ws) {
				logger.debug("ws open (static)", ws.remoteAddress);
				// Lazily import StaticDomTransport.  Frames arriving while the module
				// loads are queued in ws.data.pendingFrames and flushed on resolve.
				loadStaticTransport()
					.then(({ StaticDomTransport }) => {
						const transport = StaticDomTransport.create();
						transport.onmessage = (msg) => {
							try {
								ws.send(msg);
							} catch {
								// socket closed
							}
						};
						transport.onclose = () => {
							try {
								ws.close();
							} catch {
								// already closed
							}
						};
						ws.data.transport = transport;
						// Drain frames queued while the module was loading.
						for (const f of ws.data.pendingFrames) transport.send(f);
						ws.data.pendingFrames = [];
					})
					.catch((err) => {
						logger.error("failed to load StaticDomTransport", err);
						try {
							ws.close();
						} catch {
							// best effort
						}
					});
			},
			message(ws, message) {
				const text = typeof message === "string" ? message : new TextDecoder().decode(message);
				if (ws.data.transport) {
					ws.data.transport.send(text);
				} else {
					ws.data.pendingFrames.push(text);
				}
			},
			close(ws) {
				logger.debug("ws close (static)");
				ws.data.transport?.close();
				ws.data.transport = undefined;
			},
		},
	});

	logger.info(`static profile listening on http://${host}:${cdpPort}/`);
	return server;
}

// ---------------------------------------------------------------------------
// Fast profile — reverse proxy to a private Lightpanda sub-process
// ---------------------------------------------------------------------------

async function findFreePort(host: string): Promise<number> {
	for (let attempt = 0; attempt < 32; attempt++) {
		const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
		try {
			const probe = Bun.serve({
				hostname: host,
				port,
				fetch: () => new Response(null),
			});
			probe.stop(true);
			return port;
		} catch {
			// taken; retry
		}
	}
	throw new Error("Could not find a free TCP port");
}

async function waitForLightpanda(host: string, port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastErr: unknown;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://${host}:${port}/json/version`, {
				signal: AbortSignal.timeout(800),
			});
			if (res.ok) return;
		} catch (err) {
			lastErr = err;
		}
		// Use a 10 ms poll interval instead of 50 ms to detect Lightpanda readiness
		// faster.  Lightpanda typically becomes ready in 60-90 ms so the tighter
		// interval saves ~40 ms of wasted sleep on average.
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(
		`lightpanda did not become ready within ${timeoutMs}ms` +
			(lastErr ? ` (last error: ${String(lastErr)})` : ""),
	);
}

interface FastState {
	upstreamHost: string;
	upstreamPort: number;
	proc: ReturnType<typeof Bun.spawn>;
}

async function findLightpandaBinary(): Promise<string> {
	if (process.env.BUNLIGHT_LIGHTPANDA_PATH) {
		return process.env.BUNLIGHT_LIGHTPANDA_PATH;
	}

	const home = process.env.HOME ?? "";
	// Order matters: the @lightpanda/browser npm package downloads the real
	// native binary into ~/.cache/lightpanda-node/lightpanda but installs a
	// JS wrapper at ~/.bun/bin/lightpanda that only prints help.  We must
	// pick the native binary, never the wrapper.
	const candidates = [
		`${home}/.cache/lightpanda-node/lightpanda`,
		`${home}/.lightpanda/lightpanda`,
		`${home}/.local/bin/lightpanda`,
		// In-tree dev build inside the bunmium monorepo.
		`${home}/bunmium/lightpanda-src/zig-out/bin/lightpanda`,
	];
	for (const c of candidates) {
		try {
			const stat = await Bun.file(c).stat();
			// Native ELF/Mach-O is at least a few hundred KB; the JS wrapper is ~3KB.
			if (stat.size > 32_768) return c;
		} catch {
			/* not present */
		}
	}
	// Last-resort fallback.  May be the JS wrapper, in which case the spawn
	// will exit immediately and we'll surface a clear error to the caller.
	return "lightpanda";
}

async function spawnLightpanda(host: string, logger: Logger, opts: CLIOptions): Promise<FastState> {
	const binary = await findLightpandaBinary();
	const port = await findFreePort(host);
	const args = [
		"serve",
		"--host",
		host,
		"--port",
		String(port),
		"--log_level",
		opts.logLevel === "silent" ? "fatal" : opts.logLevel,
		"--timeout",
		"604800",
	];
	if (opts.proxy) {
		args.push("--http_proxy", opts.proxy);
	}

	logger.info(`spawning lightpanda: ${binary} ${args.join(" ")}`);
	const proc = Bun.spawn([binary, ...args], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});

	const drain = (stream: ReadableStream<Uint8Array> | undefined, prefix: string) => {
		if (!stream) return;
		void (async () => {
			const reader = stream.getReader();
			const decoder = new TextDecoder();
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) return;
					const text = decoder.decode(value, { stream: true });
					for (const line of text.split("\n")) {
						if (line.trim()) logger.debug(`${prefix} ${line}`);
					}
				}
			} catch {
				/* stream ended */
			}
		})();
	};
	drain(proc.stdout as ReadableStream<Uint8Array> | undefined, "[lp:out]");
	drain(proc.stderr as ReadableStream<Uint8Array> | undefined, "[lp:err]");

	void proc.exited.then((code) => {
		logger.error(`lightpanda exited (code=${code})`);
		// If our upstream dies we should die too so the parent retries.
		process.exit(code ?? 1);
	});

	await waitForLightpanda(host, port, 12_000);
	logger.info(`lightpanda ready on ${host}:${port}`);
	return { upstreamHost: host, upstreamPort: port, proc };
}

async function startFast(opts: CLIOptions, logger: Logger): Promise<Server> {
	const { cdpPort, host } = opts;

	// OPTIMIZATION: Bind the public CDP port FIRST so that agent-browser (which
	// polls /json/version immediately after spawning us) sees a live endpoint
	// without waiting for Lightpanda to start.  The subprocess is spawned
	// concurrently.  Any WebSocket connections that arrive before it is ready are
	// held by the pending-frames queue and flushed once the upstream connects.
	let fastState: FastState | null = null;
	const fastReady = spawnLightpanda(host, logger, opts).then((state) => {
		fastState = state;
		logger.info(`fast profile upstream ready at lightpanda :${state.upstreamPort}`);
		return state;
	});

	const server = Bun.serve<WSData, Record<string, never>>({
		hostname: host,
		port: cdpPort,
		// Allow long-lived WebSockets for CDP traffic.
		idleTimeout: 0,
		async fetch(req, srv) {
			const url = new URL(req.url);

			// HTTP discovery endpoints — re-write upstream's URLs so callers see
			// our public host:port instead of lightpanda's private ephemeral port.
			if (
				url.pathname === "/json/version" ||
				url.pathname === "/json/list" ||
				url.pathname === "/json" ||
				url.pathname === "/json/protocol"
			) {
				// If Lightpanda is already up, proxy its response with URL rewriting.
				// Otherwise synthesize a minimal response so the poller doesn't stall.
				if (fastState) {
					return proxyDiscovery(url.pathname, fastState, host, cdpPort, logger);
				}
				if (url.pathname === "/json/version") {
					return Response.json(browserVersion("fast", host, cdpPort));
				}
				if (url.pathname === "/json/list" || url.pathname === "/json") {
					return Response.json(targetList("fast", host, cdpPort));
				}
				return Response.json({ domains: [] });
			}

			// WebSocket upgrade — open an upstream WS and bridge the two ends.
			// Accept both /devtools/... paths (Puppeteer/agent-browser) and
			// plain "/" (what Lightpanda advertises in its /json/version response).
			if (
				url.pathname.startsWith("/devtools/browser") ||
				url.pathname.startsWith("/devtools/page") ||
				url.pathname === "/"
			) {
				if (
					srv.upgrade(req, {
						data: { pendingFrames: [], kind: "fast-proxy" } satisfies WSData,
						headers: {
							// Carry the original path so we know what to connect to upstream.
							"x-bunlight-path": url.pathname + url.search,
						},
					})
				) {
					return undefined;
				}
				return new Response("WebSocket upgrade failed", { status: 400 });
			}

			return new Response("Not Found", { status: 404 });
		},
		websocket: {
			open(ws) {
				// Wait for Lightpanda to be ready, then bridge this socket.
				// Handles the race where a client connects before the subprocess starts.
				fastReady
					.then((fast) => {
						const upstreamUrl = `ws://${fast.upstreamHost}:${fast.upstreamPort}/`;
						logger.debug("ws open (fast) -> bridging to", upstreamUrl);
						const upstream = new WebSocket(upstreamUrl);
						ws.data.upstream = upstream;

						upstream.addEventListener("open", () => {
							for (const f of ws.data.pendingFrames) {
								try {
									upstream.send(f);
								} catch (err) {
									logger.warn("upstream send (queued) failed", err);
								}
							}
							ws.data.pendingFrames = [];
						});
						upstream.addEventListener("message", (ev: MessageEvent) => {
							const data = typeof ev.data === "string" ? ev.data : String(ev.data);
							try {
								ws.send(data);
							} catch {
								/* downstream closed */
							}
						});
						upstream.addEventListener("close", () => {
							try {
								ws.close();
							} catch {
								/* already closed */
							}
						});
						upstream.addEventListener("error", (err) => {
							logger.warn("upstream ws error", err);
							try {
								ws.close();
							} catch {
								/* already closed */
							}
						});
					})
					.catch((err) => {
						logger.error("lightpanda startup failed, closing ws", err);
						try {
							ws.close();
						} catch {
							// best effort
						}
					});
			},
			message(ws, message) {
				const text = typeof message === "string" ? message : new TextDecoder().decode(message);
				const upstream = ws.data.upstream;
				if (upstream && upstream.readyState === WebSocket.OPEN) {
					upstream.send(text);
				} else {
					ws.data.pendingFrames.push(text);
				}
			},
			close(ws) {
				logger.debug("ws close (fast)");
				try {
					ws.data.upstream?.close();
				} catch {
					/* best effort */
				}
				ws.data.upstream = undefined;
			},
		},
	});

	// Emit the "port bound" signal immediately — this is what agent-browser
	// waits for before issuing its first /json/version probe.
	logger.info(`fast profile port bound on http://${host}:${cdpPort}/ (lightpanda spawning...)`);

	// Block until Lightpanda is fully up so the function contract is preserved:
	// callers that await startFast() know the upstream is operational.
	await fastReady;

	logger.info(
		`fast profile ready on http://${host}:${cdpPort}/  (upstream: lightpanda :${fastState!.upstreamPort})`,
	);

	const shutdown = () => {
		logger.info("shutting down");
		try {
			fastState?.proc.kill();
		} catch {
			/* best effort */
		}
		try {
			server.stop();
		} catch {
			/* best effort */
		}
	};
	process.on("SIGINT", () => {
		shutdown();
		process.exit(0);
	});
	process.on("SIGTERM", () => {
		shutdown();
		process.exit(0);
	});

	return server;
}

async function proxyDiscovery(
	pathname: string,
	fast: FastState,
	publicHost: string,
	publicPort: number,
	logger: Logger,
): Promise<Response> {
	const upstreamUrl = `http://${fast.upstreamHost}:${fast.upstreamPort}${pathname}`;
	try {
		const res = await fetch(upstreamUrl, { signal: AbortSignal.timeout(2000) });
		const ct = res.headers.get("content-type") ?? "application/json";
		const text = await res.text();
		// Rewrite ws:// URLs from upstream's host:port to ours so the caller can
		// reach us directly.  This is what /json/version does for Chrome behind
		// a port-forward — same trick.
		const rewritten = rewriteWsUrls(
			text,
			fast.upstreamHost,
			fast.upstreamPort,
			publicHost,
			publicPort,
		);
		return new Response(rewritten, {
			status: res.status,
			headers: { "content-type": ct },
		});
	} catch (err) {
		logger.error("discovery proxy failed", err);
		// Synthesize a minimal /json/version on failure so callers don't 500.
		if (pathname === "/json/version") {
			return Response.json(browserVersion("fast", publicHost, publicPort));
		}
		if (pathname === "/json/list" || pathname === "/json") {
			return Response.json(targetList("fast", publicHost, publicPort));
		}
		return new Response("Upstream unreachable", { status: 502 });
	}
}

function rewriteWsUrls(
	body: string,
	fromHost: string,
	fromPort: number,
	toHost: string,
	toPort: number,
): string {
	const fromHostBracketed = fromHost.includes(":") ? `[${fromHost}]` : fromHost;
	const toHostBracketed = toHost.includes(":") ? `[${toHost}]` : toHost;
	const candidates = [
		`ws://${fromHost}:${fromPort}`,
		`ws://${fromHostBracketed}:${fromPort}`,
		`ws://localhost:${fromPort}`,
		`ws://0.0.0.0:${fromPort}`,
		`ws://127.0.0.1:${fromPort}`,
	];
	let out = body;
	for (const c of candidates) {
		out = out.split(c).join(`ws://${toHostBracketed}:${toPort}`);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Forbidden engines: stealth (patchright Chromium) and max (Camoufox FF)
// have been removed from bunlight per workspace policy. Use the Lightpanda-
// backed `ghost` helper in `src/profiles/ghost/` instead.
// ---------------------------------------------------------------------------

async function startStealth(_opts: CLIOptions, _logger: Logger): Promise<Server> {
	throw new Error(
		"profile=stealth is removed. bunlight is Lightpanda-only. " +
			"Use `launchGhostBrowser` from `src/profiles/ghost/` for anti-detection.",
	);
}

async function startMax(_opts: CLIOptions, _logger: Logger): Promise<Server> {
	throw new Error(
		"profile=max is removed. bunlight is Lightpanda-only. " +
			"Use `launchGhostBrowser` from `src/profiles/ghost/` for anti-detection.",
	);
}

async function loadHttpTransport(): Promise<typeof import("../transport/HttpProfileTransport.ts")> {
	if (!_httpTransportModule) {
		_httpTransportModule = await import("../transport/HttpProfileTransport.ts");
	}
	return _httpTransportModule;
}

function startHttp(opts: CLIOptions, logger: Logger): Server {
	const { cdpPort, host } = opts;

	const server = Bun.serve<WSData, Record<string, never>>({
		hostname: host,
		port: cdpPort,
		fetch(req, srv) {
			const url = new URL(req.url);
			if (
				url.pathname.startsWith("/devtools/browser") ||
				url.pathname.startsWith("/devtools/page")
			) {
				if (
					srv.upgrade(req, {
						data: { pendingFrames: [], kind: "http" } satisfies WSData,
					})
				) {
					return undefined;
				}
				return new Response("WebSocket upgrade failed", { status: 400 });
			}
			return handleHttpDiscovery(url.pathname, opts, logger);
		},
		websocket: {
			open(ws) {
				logger.debug("ws open (http)");
				loadHttpTransport()
					.then(({ HttpProfileTransport }) => HttpProfileTransport.create({ profile: "chrome131" }))
					.then((transport) => {
						transport.onmessage = (msg) => {
							try {
								ws.send(msg);
							} catch {
								// socket closed
							}
						};
						transport.onclose = () => {
							try {
								ws.close();
							} catch {
								// already closed
							}
						};
						ws.data.transport = transport;
						for (const f of ws.data.pendingFrames) transport.send(f);
						ws.data.pendingFrames = [];
					})
					.catch((err) => {
						logger.error("http transport init failed", err);
						try {
							ws.close();
						} catch {
							// best effort
						}
					});
			},
			message(ws, message) {
				const text = typeof message === "string" ? message : new TextDecoder().decode(message);
				if (ws.data.transport) {
					ws.data.transport.send(text);
				} else {
					ws.data.pendingFrames.push(text);
				}
			},
			close(ws) {
				logger.debug("ws close (http)");
				ws.data.transport?.close();
				ws.data.transport = undefined;
			},
		},
	});

	logger.info(`http profile listening on http://${host}:${cdpPort}/`);
	return server;
}

// ---------------------------------------------------------------------------
// HTTP discovery handler shared by static (and as a synthesis layer for fast).
// ---------------------------------------------------------------------------

function handleHttpDiscovery(pathname: string, opts: CLIOptions, _logger: Logger): Response {
	if (pathname === "/json/version") {
		return Response.json(browserVersion(opts.profile, opts.host, opts.cdpPort));
	}
	if (pathname === "/json" || pathname === "/json/list") {
		return Response.json(targetList(opts.profile, opts.host, opts.cdpPort));
	}
	if (pathname === "/json/protocol") {
		// Empty stub — Puppeteer/Playwright don't strictly need this.
		return Response.json({ domains: [] });
	}
	if (pathname === "/" || pathname === "/health") {
		return new Response(`Bunlight CLI (profile=${opts.profile}) ready\n`, {
			headers: { "content-type": "text/plain" },
		});
	}
	return new Response("Not Found", { status: 404 });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	let opts: CLIOptions;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(`[bunlight] ${(err as Error).message}\n`);
		printUsage();
		process.exit(2);
	}

	const logger = new Logger(opts.logLevel);
	logger.info(
		`starting profile=${opts.profile} host=${opts.host} port=${opts.cdpPort}` +
			(opts.proxy ? ` proxy=${opts.proxy}` : ""),
	);

	switch (opts.profile) {
		case "static":
			startStatic(opts, logger);
			break;
		case "fast":
			await startFast(opts, logger);
			break;
		case "http":
			startHttp(opts, logger);
			break;
	}

	// Touch CDPEvent so the import is not stripped by tree-shakers; we keep it
	// for type compatibility with future profile implementations.
	void (null as CDPEvent | null);
}

main().catch((err) => {
	console.error("[bunlight] fatal", err);
	process.exit(1);
});
