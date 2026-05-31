/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ConnectionTransport } from "../../types/ConnectionTransport.js";
import { drainStream } from "../internal/stream-drain.ts";
import { join } from "node:path";

export interface WebSocketTransportOptions {
	/** URL to the chromium websocket endpoint (if already running) */
	browserWSEndpoint?: string;
	/** Extra environment variables to pass to the sub-process. */
	env?: Record<string, string>;
	/** Optional logger for stderr messages from the sub-process. */
	stderrLogger?: (chunk: string) => void;
	/** Force headless mode. */
	headless?: boolean;

	// --- Legacy Lightpanda Options (SocketPairTransport compatibility) ---
	binaryPath?: string;
	logLevel?: "debug" | "info" | "warn" | "error" | "fatal" | string;
	readyTimeoutMs?: number;
}

async function findFreePort(host: string): Promise<number> {
	for (let attempt = 0; attempt < 32; attempt++) {
		const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
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
	throw new Error("WebSocketTransport: could not find a free TCP port");
}

export class WebSocketTransport implements ConnectionTransport {
	onmessage?: (message: string) => void;
	onclose?: () => void;

	readonly #wsUrl: string;
	#proc?: ReturnType<typeof Bun.spawn>;
	#ws: WebSocket;
	#closed = false;
	#sendQueue: string[] = [];

	private constructor(
		ws: WebSocket,
		wsUrl: string,
		proc?: ReturnType<typeof Bun.spawn>,
	) {
		this.#ws = ws;
		this.#wsUrl = wsUrl;
		this.#proc = proc;
		this.#wireSocket(ws);
	}

	static async create(
		opts: WebSocketTransportOptions = {},
	): Promise<WebSocketTransport> {
		let wsUrl = opts.browserWSEndpoint;
		let proc: ReturnType<typeof Bun.spawn> | undefined;

		if (!wsUrl) {
			const repoRoot = join(import.meta.dir, "..", "..");
			const cargoTomlPath = join(repoRoot, "rust-bridge", "Cargo.toml");

			const ext = process.platform === "win32" ? ".exe" : "";
			const binName = `bxc-engine${ext}`;
			const binPaths = [
				join(repoRoot, "rust-bridge", "target", "release", binName),
				join(repoRoot, "rust-bridge", "target", "debug", binName),
				join(repoRoot, "dist", binName),
				join(process.cwd(), binName),
			];

			let bin: string | null = null;
			for (const p of binPaths) {
				if (Bun.file(p).size > 0) {
					bin = p;
					break;
				}
			}

			let chromePath = Bun.env["BXC_CHROME_BIN"] ?? Bun.env["CHROME_PATH"];
			let userDataDir = Bun.env["BXC_USER_DATA_DIR"];
			const isWin = process.platform === "win32";

			if (isWin) {
				// Windows 'Native Power' Discovery
				if (!chromePath) {
					const winPaths = [
						"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
						"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
						join(
							Bun.env["LOCALAPPDATA"] || "",
							"Google\\Chrome\\Application\\chrome.exe",
						),
					];
					for (const p of winPaths) {
						if (await Bun.file(p).exists()) {
							chromePath = p;
							break;
						}
					}
				}
				if (!userDataDir) {
					userDataDir = join(
						Bun.env["LOCALAPPDATA"] || "",
						"Google\\Chrome\\User Data",
					);
				}
			}

			if (!chromePath) {
				const pathArgs = bin
					? [bin, "chrome-path"]
					: [
							"cargo",
							"run",
							"--manifest-path",
							cargoTomlPath,
							"--bin",
							"bxc-engine",
							"--",
							"chrome-path",
						];

				const pathProc = Bun.spawnSync(pathArgs, {
					env: Bun.env,
				});
				if (!pathProc.success) {
					throw new Error(
						"Failed to resolve chrome path: " + pathProc.stderr.toString(),
					);
				}
				chromePath = pathProc.stdout
					.toString()
					.trim()
					.split("\n")
					.pop()
					?.trim();
				if (!chromePath) {
					throw new Error("Failed to parse resolved chromium path");
				}
			}

			const isLightpanda = chromePath.includes("lightpanda");
			const headless = opts.headless ?? (isWin ? false : true);
			const port = await findFreePort("127.0.0.1");

			let args: string[];

			if (isLightpanda) {
				args = [chromePath, "serve", "--port", port.toString()];
				if (opts.headless !== false) {
					// Lightpanda is headless by default, but we can pass stealth
				}
				if (opts.logLevel) {
					args.push(`--log-level=${opts.logLevel}`);
				}
			} else {
				const launchArgs = [
					`--remote-debugging-port=${port}`,
					"--remote-allow-origins=*", // Required for CDP connections
				];

				if (isWin) {
					// Windows Optimized Flags
					launchArgs.push("--enable-gpu");
					launchArgs.push("--no-sandbox");
					if (headless) {
						launchArgs.push("--headless=new");
					} else {
						launchArgs.push("--start-maximized");
					}
					if (userDataDir) {
						launchArgs.push("--user-data-dir=" + userDataDir);
						launchArgs.push("--profile-directory=Default");
					}
				} else {
					// Linux Server Optimized Flags (Headless Dominance)
					if (headless) {
						launchArgs.push("--headless=new");
					}
					launchArgs.push("--disable-gpu");
					launchArgs.push("--disable-dev-shm-usage");
					launchArgs.push("--no-sandbox");
				}
				args = [chromePath, ...launchArgs];
			}

			// Inherit advanced VPS variables: BXC_USER_DATA_DIR, BXC_PROFILE
			proc = Bun.spawn(args, {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...Bun.env,
					...opts.env,
				},
			});

			drainStream(
				proc.stdout as ReadableStream<Uint8Array> | undefined,
				opts.stderrLogger,
			);

			if (isLightpanda) {
				wsUrl = `ws://127.0.0.1:${port}`;
				// Lightpanda starts extremely fast, but wait a small fraction just in case
				await Bun.sleep(50);
			} else {
				wsUrl = await new Promise<string>((resolve, reject) => {
					let output = "";
					// Chromium typically logs the WebSocket URL to stderr
					const reader = (
						proc!.stderr as ReadableStream<Uint8Array>
					).getReader();

					const readLoop = async () => {
						try {
							const { done, value } = await reader.read();
							if (value) {
								const text = new TextDecoder().decode(value);
								output += text;
								if (opts.stderrLogger) opts.stderrLogger(text);

								const lines = output.split("\n");
								for (const line of lines) {
									const match = line.match(/ws:\/\/[^\s]+/);
									if (match) {
										resolve(match[0].trim());
										return;
									}
								}
							}
							if (!done) {
								readLoop();
							} else {
								reject(
									new Error(
										"Process exited before emitting ws url. Output: " + output,
									),
								);
							}
						} catch (e) {
							reject(e);
						}
					};
					readLoop();
				});
			}
		}

		let ws: WebSocket;
		let attempts = 0;
		const maxAttempts = 5;

		while (true) {
			try {
				ws = new WebSocket(wsUrl);
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(() => {
						ws.close();
						reject(new Error("Connection timeout"));
					}, 5000);

					const onOpen = () => {
						clearTimeout(timer);
						ws.removeEventListener("error", onErr);
						resolve();
					};
					const onErr = (ev: Event) => {
						clearTimeout(timer);
						ws.removeEventListener("open", onOpen);
						reject(ev);
					};
					ws.addEventListener("open", onOpen, { once: true });
					ws.addEventListener("error", onErr, { once: true });
				});
				// Connected!
				break;
			} catch (err) {
				attempts++;
				if (attempts >= maxAttempts) {
					throw new Error(
						`WebSocketTransport: WebSocket failed to open after ${maxAttempts} attempts to ${wsUrl} (${(err as ErrorEvent).message ?? "Connection Refused"})`,
					);
				}
				// Exponential backoff
				await Bun.sleep(200 * Math.pow(2, attempts - 1));
			}
		}

		return new WebSocketTransport(ws, wsUrl, proc);
	}

	send(message: string): void {
		if (this.#closed) return;
		if (this.#ws.readyState === WebSocket.OPEN) {
			this.#ws.send(message);
		} else {
			this.#sendQueue.push(message);
		}
	}

	close(): void {
		if (this.#closed) return;
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
			this.#proc?.kill();
		} catch {
			// best effort
		}
		queueMicrotask(() => {
			this.onclose?.();
		});
	}

	async closeProcess(): Promise<void> {
		this.close();
		try {
			await this.#proc?.exited;
		} catch {
			// ignore
		}
	}

	get webSocketDebuggerUrl(): string {
		return this.#wsUrl;
	}

	get closed(): boolean {
		return this.#closed;
	}

	#wireSocket(ws: WebSocket): void {
		ws.addEventListener("message", (ev: MessageEvent) => {
			if (this.#closed) return;
			const data = typeof ev.data === "string" ? ev.data : String(ev.data);
			this.onmessage?.(data);
		});
		ws.addEventListener("close", () => {
			if (this.#closed) return;
			this.#closed = true;
			queueMicrotask(() => {
				this.onclose?.();
			});
		});

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
}
