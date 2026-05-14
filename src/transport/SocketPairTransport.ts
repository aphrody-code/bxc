/**
 * SocketPairTransport — ConnectionTransport that spawns Lightpanda as a
 * sub-process (`lightpanda serve`) and proxies CDP messages to it via a
 * WebSocket on an ephemeral local TCP port.
 *
 * NOTE on the name: the original design called for a true `socketpair(2)`
 * AF_UNIX pair so the two ends would live as file descriptors inside the
 * same OS process group with no port allocation.  Lightpanda's `serve`
 * command, however, only accepts TCP and Bun has no public socketpair API
 * yet, so this implementation uses a loopback TCP WebSocket instead.  The
 * file name and exported symbol are preserved for source compatibility.
 *
 * Architecture:
 *
 *   ┌─────────────────────────┐    WebSocket (CDP)    ┌────────────────────────┐
 *   │  Bun main process       │ ◄───────────────────► │ lightpanda serve --port │
 *   │  SocketPairTransport     │  newline-free JSON   │  (sub-process, stdio  │
 *   │  (Puppeteer-compatible)  │                      │   captured for logs)  │
 *   └─────────────────────────┘                       └────────────────────────┘
 *
 * Key responsibilities:
 *   - Spawn `lightpanda serve --port <ephemeral>` and watch stderr for the
 *     "server running" readiness line (or poll `/json/version`).
 *   - Open a WebSocket to `ws://127.0.0.1:<port>/` and forward
 *     `send()` / `onmessage` / `onclose` per the Puppeteer
 *     ConnectionTransport interface.
 *   - Optionally auto-respawn on unexpected exit, with a bounded back-off
 *     and a callback hook so the caller can re-attach Puppeteer state.
 *
 * Lightpanda's CDP server only allows ONE concurrent WebSocket connection
 * per process and resets all state on close.  Callers that need parallel
 * pages should create multiple `SocketPairTransport` instances, each on its
 * own ephemeral port.
 *
 * @example
 * ```ts
 * import { SocketPairTransport } from "bunlight/transport/SocketPairTransport";
 * import puppeteer from "puppeteer-core";
 *
 * const transport = await SocketPairTransport.create();
 * const browser   = await puppeteer.connect({ transport });
 * const ctx       = await browser.createBrowserContext();
 * const page      = await ctx.newPage();
 * await page.goto("https://example.com");
 * await page.close();
 * await ctx.close();
 * await browser.disconnect();
 * await transport.closeProcess();
 * ```
 */

import type { ConnectionTransport } from "../../types/ConnectionTransport.js";
import { drainStream } from "../internal/stream-drain.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SocketPairTransportOptions {
	/** Path to the `lightpanda` binary.  Defaults to `lightpanda` on $PATH. */
	binaryPath?: string;
	/** Extra environment variables to pass to the sub-process. */
	env?: Record<string, string>;
	/** Timeout in milliseconds to wait for the process to become ready. */
	readyTimeoutMs?: number;
	/**
	 * Specific TCP port to use.  When omitted an ephemeral port in the range
	 * [49152, 65535] is selected by probing.
	 */
	port?: number;
	/** Host interface for the CDP server.  Defaults to 127.0.0.1. */
	host?: string;
	/** Lightpanda log level (`debug` | `info` | `warn` | `error` | `fatal`). */
	logLevel?: "debug" | "info" | "warn" | "error" | "fatal";
	/**
	 * If true, spawn `lightpanda` with `--obey-robots`.  Defaults to false.
	 */
	obeyRobots?: boolean;
	/**
	 * If true, automatically respawn the sub-process if it exits before
	 * `close()` is called.  Defaults to false because Lightpanda resets
	 * all state on connection close, so a respawn is rarely useful without
	 * caller-side reattachment logic.
	 */
	autoRespawn?: boolean;
	/**
	 * Maximum respawn attempts when `autoRespawn` is enabled.  Defaults to 3.
	 */
	maxRespawns?: number;
	/**
	 * Hook invoked after a successful respawn so the caller can re-create
	 * targets / re-attach sessions.  Receives the new ws endpoint URL.
	 */
	onRespawn?: (ws: string) => void | Promise<void>;
	/** Optional logger for stderr messages from the sub-process. */
	stderrLogger?: (chunk: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Probe an ephemeral TCP port that is currently free on `host`. */
async function findFreePort(host: string): Promise<number> {
	for (let attempt = 0; attempt < 32; attempt++) {
		const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
		// eslint-disable-next-line no-await-in-loop
		const free = await new Promise<boolean>((resolve) => {
			try {
				const server = Bun.serve({
					hostname: host,
					port,
					fetch: () => new Response(null),
				});
				server.stop(true);
				resolve(true);
			} catch {
				resolve(false);
			}
		});
		if (free) return port;
	}
	throw new Error("SocketPairTransport: could not find a free TCP port");
}

/** Sleep helper — Bun-native. */
const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

/**
 * Polls `http://host:port/json/version` until it responds (or times out).
 * Returns the `webSocketDebuggerUrl` reported by Lightpanda.
 *
 * Poll interval is 10 ms (down from 50 ms) to detect Lightpanda readiness in
 * the tightest window possible.  Lightpanda typically starts within 60-90 ms,
 * so the faster poll saves ~40 ms of dead sleep.
 */
async function waitForReady(
	host: string,
	port: number,
	timeoutMs: number,
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let lastErr: unknown;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://${host}:${port}/json/version`, {
				signal: AbortSignal.timeout(1000),
			});
			if (res.ok) {
				const body = (await res.json()) as { webSocketDebuggerUrl?: string };
				if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
				// Fallback: build it manually
				return `ws://${host}:${port}/`;
			}
		} catch (err) {
			lastErr = err;
		}
		await sleep(10);
	}
	throw new Error(
		`SocketPairTransport: lightpanda did not become ready within ${timeoutMs}ms` +
			(lastErr ? ` (last error: ${String(lastErr)})` : ""),
	);
}

// ---------------------------------------------------------------------------
// SocketPairTransport
// ---------------------------------------------------------------------------

/**
 * Puppeteer-compatible `ConnectionTransport` backed by a `lightpanda`
 * sub-process.  Speaks raw CDP over a WebSocket on a loopback TCP port.
 *
 * Lifecycle:
 *   1. `create(opts)` spawns the binary, waits for `/json/version`, opens
 *      the WebSocket, and resolves once the socket is OPEN.
 *   2. `send()` forwards a CDP request frame; `onmessage` is invoked with
 *      every incoming frame (responses + events).
 *   3. `close()` closes the WebSocket; `closeProcess()` additionally kills
 *      the sub-process and awaits its exit.
 *
 * Send queue: messages issued before the WebSocket reaches OPEN state are
 * queued and flushed atomically once the socket is ready.  This matches the
 * behaviour of Puppeteer's WebSocketTransport and avoids races during
 * connection setup.
 */
export class SocketPairTransport implements ConnectionTransport {
	onmessage?: (message: string) => void;
	onclose?: () => void;

	readonly #proc: ReturnType<typeof Bun.spawn>;
	readonly #port: number;
	readonly #wsUrl: string;
	readonly #opts: Readonly<SocketPairTransportOptions>;

	#ws: WebSocket;
	#closed = false;
	#closing = false;
	#sendQueue: string[] = [];
	#respawnCount = 0;

	private constructor(
		proc: ReturnType<typeof Bun.spawn>,
		ws: WebSocket,
		port: number,
		wsUrl: string,
		opts: Readonly<SocketPairTransportOptions>,
	) {
		this.#proc = proc;
		this.#ws = ws;
		this.#port = port;
		this.#wsUrl = wsUrl;
		this.#opts = opts;
		this.#wireSocket(ws);
		this.#watchProcess();
	}

	/**
	 * Spawns a `lightpanda serve` sub-process and connects to it via WebSocket.
	 *
	 * Resolves once the WebSocket is in the OPEN state and the transport is
	 * ready to forward CDP messages.  Rejects if the process fails to start,
	 * the readiness probe times out, or the WebSocket fails to open.
	 */
	static async create(
		opts: SocketPairTransportOptions = {},
	): Promise<SocketPairTransport> {
		const binary = opts.binaryPath ?? "lightpanda";
		const host = opts.host ?? "127.0.0.1";
		const port = opts.port ?? (await findFreePort(host));
		const readyTimeout = opts.readyTimeoutMs ?? 10000;
		const logLevel = opts.logLevel ?? "error";

		// Verify binary exists if it's a path
		if (binary.includes("/") && !(await Bun.file(binary).exists())) {
			throw new Error(`SocketPairTransport: binary not found at ${binary}`);
		}

		const args = [
			"serve",
			"--host",
			host,
			"--port",
			String(port),
			"--log-level",
			logLevel,
		];
		if (opts.obeyRobots) args.push("--obey-robots");

		const proc = Bun.spawn([binary, ...args], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				BUNLIGHT_TRANSPORT: "socketpair",
				...opts.env,
			},
		});

		// Drain stdout/stderr so the pipes don't fill up.  Optionally forward
		// stderr to a user-supplied logger — useful for debugging crashes.
		drainStream(proc.stdout as ReadableStream<Uint8Array> | undefined);
		drainStream(
			proc.stderr as ReadableStream<Uint8Array> | undefined,
			opts.stderrLogger,
		);

		// Race readiness against process exit
		let earlyExit: Error | null = null;
		const exitPromise = proc.exited.then((code) => {
			earlyExit = new Error(
				`lightpanda exited prematurely (code ${code}) before becoming ready`,
			);
		});

		let wsUrl: string;
		try {
			wsUrl = await Promise.race([
				waitForReady(host, port, readyTimeout),
				exitPromise.then(() => {
					throw earlyExit ?? new Error("lightpanda exited prematurely");
				}),
			]);
		} catch (err) {
			try {
				proc.kill();
			} catch {
				// best effort
			}
			throw err;
		}

		// Open the WebSocket
		const ws = new WebSocket(wsUrl);
		await new Promise<void>((resolve, reject) => {
			const onOpen = () => {
				ws.removeEventListener("error", onErr);
				resolve();
			};
			const onErr = (ev: Event) => {
				ws.removeEventListener("open", onOpen);
				reject(
					new Error(
						`SocketPairTransport: WebSocket failed to open (${(ev as ErrorEvent).message ?? "unknown error"})`,
					),
				);
			};
			ws.addEventListener("open", onOpen, { once: true });
			ws.addEventListener("error", onErr, { once: true });
		});

		void host;
		return new SocketPairTransport(proc, ws, port, wsUrl, opts);
	}

	/** Forwards a single CDP request frame to the sub-process. */
	send(message: string): void {
		if (this.#closed) return;
		if (this.#ws.readyState === WebSocket.OPEN) {
			this.#ws.send(message);
		} else {
			this.#sendQueue.push(message);
		}
	}

	/** Closes the WebSocket and signals upper layers via `onclose`. */
	close(): void {
		if (this.#closed) return;
		this.#closing = true;
		this.#closed = true;
		try {
			if (
				this.#ws.readyState === WebSocket.OPEN ||
				this.#ws.readyState === WebSocket.CONNECTING
			) {
				this.#ws.close();
			}
		} catch {
			// best effort
		}
		try {
			this.#proc.kill();
		} catch {
			// best effort
		}
		queueMicrotask(() => {
			this.onclose?.();
		});
	}

	/** Closes the WebSocket, kills the sub-process, awaits its exit. */
	async closeProcess(): Promise<void> {
		this.close();
		try {
			await this.#proc.exited;
		} catch {
			// ignore
		}
	}

	/** PID of the underlying sub-process, useful for tests. */
	get pid(): number | undefined {
		return this.#proc.pid;
	}

	/** Bound TCP port of the CDP server. */
	get port(): number {
		return this.#port;
	}

	/** Resolved WebSocket debugger URL. */
	get webSocketDebuggerUrl(): string {
		return this.#wsUrl;
	}

	/** Whether the transport has been closed (or its socket has died). */
	get closed(): boolean {
		return this.#closed;
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	#wireSocket(ws: WebSocket): void {
		ws.addEventListener("message", (ev: MessageEvent) => {
			if (this.#closed) return;
			const data = typeof ev.data === "string" ? ev.data : String(ev.data);
			this.onmessage?.(data);
		});
		ws.addEventListener("close", () => {
			if (this.#closed) return;
			// If the socket dies but we are not in the middle of an explicit
			// close(), surface this as a transport close.
			this.#closed = true;
			queueMicrotask(() => {
				this.onclose?.();
			});
		});
		ws.addEventListener("error", () => {
			// Errors on a CDP WebSocket typically precede a close — let the
			// close handler do the work to avoid double-firing onclose.
		});

		// Flush any queued messages once the socket is open.
		if (ws.readyState === WebSocket.OPEN) {
			this.#flushQueue();
		} else {
			ws.addEventListener("open", () => this.#flushQueue(), { once: true });
		}
	}

	#flushQueue(): void {
		while (this.#sendQueue.length > 0 && !this.#closed) {
			const msg = this.#sendQueue.shift();
			if (msg !== undefined) this.#ws.send(msg);
		}
	}

	#watchProcess(): void {
		// If the sub-process dies and autoRespawn is enabled, attempt to bring
		// it back.  Note: Puppeteer state (targets, sessions) is lost on
		// Lightpanda restart, so the caller must use the `onRespawn` hook to
		// re-create whatever they need.
		void this.#proc.exited.then(async (code) => {
			if (this.#closing) return;
			if (
				this.#opts.autoRespawn &&
				this.#respawnCount < (this.#opts.maxRespawns ?? 3)
			) {
				this.#respawnCount++;
				try {
					await this.#respawn();
				} catch {
					this.#closed = true;
					queueMicrotask(() => this.onclose?.());
				}
			} else {
				this.#closed = true;
				queueMicrotask(() => this.onclose?.());
			}
			void code;
		});
	}

	async #respawn(): Promise<void> {
		// Spawn a fresh sub-process and adopt its WebSocket as ours.  Lightpanda
		// resets all state on disconnect, so caller-side reattachment must be
		// performed in the `onRespawn` callback below.
		const next = await SocketPairTransport.create({
			...this.#opts,
			autoRespawn: false, // avoid recursive respawns
			port: undefined, // pick a fresh port
		});
		// Adopt the new socket: forward incoming frames + close event back
		// through *this* instance's listeners so the caller never noticed.
		next.onmessage = (m) => this.onmessage?.(m);
		next.onclose = () => {
			if (!this.#closing) this.onclose?.();
		};
		this.#ws = next.unsafeWebSocket();
		await this.#opts.onRespawn?.(next.webSocketDebuggerUrl);
	}

	/**
	 * @internal — exposed only for the respawn path.  Returns the underlying
	 * WebSocket so a parent transport can adopt it after a sub-process restart.
	 */
	unsafeWebSocket(): WebSocket {
		return this.#ws;
	}
}
