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
import { chromeGpuFlags, chromeJsFlags } from "../config/hardware.ts";
import { join } from "node:path";
import { createServer } from "node:net";
import { existsSync } from "node:fs";

export interface WebSocketTransportOptions {
	/** URL to the chromium websocket endpoint (if already running) */
	browserWSEndpoint?: string;
	/** Extra environment variables to pass to the sub-process. */
	env?: Record<string, string>;
	/** Optional logger for stderr messages from the sub-process. */
	stderrLogger?: (chunk: string) => void;
	/** Force headless mode. */
	headless?: boolean;
	/**
	 * Real-Chrome user-data directory to launch against (the user's installed
	 * Chrome profile root). Defaults to `%LOCALAPPDATA%\Google\Chrome\User Data`
	 * on Windows / `$BXC_USER_DATA_DIR`. Combine with `profileDirectory` to
	 * drive a logged-in profile (e.g. for SPA-crash fallback scraping).
	 */
	userDataDir?: string;
	/**
	 * Chrome `--profile-directory` (e.g. `"Default"`, `"Profile 5"`). Resolution
	 * order: this option → `$BXC_CHROME_PROFILE` → `"Default"`.
	 */
	profileDirectory?: string;
	/**
	 * Snapshot the session-bearing files of the requested real profile into a
	 * throwaway user-data-dir and launch against the copy. Lets a debug Chrome
	 * drive a logged-in profile even while the user's own Chrome holds the
	 * singleton lock on the live user-data-dir. See {@link module:bxc/transport/profile-snapshot}.
	 */
	copyProfile?: boolean;

	// --- Legacy Lightpanda Options (SocketPairTransport compatibility) ---
	binaryPath?: string;
	logLevel?: "debug" | "info" | "warn" | "error" | "fatal" | string;
	readyTimeoutMs?: number;
}

/**
 * Find a free TCP port by binding a raw `net.createServer` socket.
 * This is orders of magnitude cheaper than spinning up a full HTTP server
 * (Bun.serve) just to check availability — no HTTP parser, no routing, no
 * TLS scaffolding.  The socket is immediately closed after the bind succeeds,
 * leaving the port free for the caller (Chrome / Lightpanda) to claim.
 */
async function findFreePort(host: string): Promise<number> {
	for (let attempt = 0; attempt < 32; attempt++) {
		const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
		const free = await new Promise<boolean>((resolve) => {
			const srv = createServer();
			srv.listen(port, host, () => {
				srv.close(() => resolve(true));
			});
			srv.on("error", () => resolve(false));
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
			let userDataDir = opts.userDataDir ?? Bun.env["BXC_USER_DATA_DIR"];
			// `--profile-directory`: option → env → "Default". This is what lets
			// the SPA-crash fallback reuse the user's logged-in profile (e.g.
			// "Profile 5") instead of a throwaway Default profile.
			const profileDirectory =
				opts.profileDirectory ?? Bun.env["BXC_CHROME_PROFILE"] ?? "Default";
			const isWin = process.platform === "win32";

			if (isWin) {
				// Windows 'Native Power' Discovery
				if (!chromePath) {
					const winPaths = [
						"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
						"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
						join(Bun.env["LOCALAPPDATA"] || "", "Google\\Chrome\\Application\\chrome.exe")
					];
					for (const p of winPaths) {
						if (await Bun.file(p).exists()) {
							chromePath = p;
							break;
						}
					}
				}
				if (!userDataDir) {
					userDataDir = join(Bun.env["LOCALAPPDATA"] || "", "Google\\Chrome\\User Data");
				}
			}
			
			if (!chromePath) {
				const pathArgs = bin 
					? [bin, "chrome-path"]
					: ["cargo", "run", "--manifest-path", cargoTomlPath, "--bin", "bxc-engine", "--", "chrome-path"];

				const pathProc = Bun.spawnSync(pathArgs, {
					env: Bun.env,
				});
				if (!pathProc.success) {
					throw new Error("Failed to resolve chrome path: " + pathProc.stderr.toString());
				}
				chromePath = pathProc.stdout.toString().trim().split("\n").pop()?.trim();
				if (!chromePath) {
					throw new Error("Failed to parse resolved chromium path");
				}
			}

			// Snapshot fallback: when asked to drive a real logged-in profile, a
			// live Chrome holds the singleton lock on its user-data-dir, so a debug
			// launch against it can never open the port. Copy the session-bearing
			// files into a throwaway user-data-dir and launch there instead — works
			// whether or not the user's Chrome is open, and never disturbs it.
			if (opts.copyProfile && userDataDir && existsSync(userDataDir)) {
				try {
					const { snapshotChromeProfile } = await import("./profile-snapshot.ts");
					const snap = await snapshotChromeProfile(userDataDir, profileDirectory);
					opts.stderrLogger?.(
						`[bxc] snapshot profile "${profileDirectory}" → ${snap.userDataDir} (${snap.copied.length} artefacts)\n`,
					);
					userDataDir = snap.userDataDir;
				} catch (e) {
					opts.stderrLogger?.(
						`[bxc] profile snapshot failed (${e instanceof Error ? e.message : e}); using live dir\n`,
					);
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
					// Size the V8 heap to the host RAM (16 GB → 4 GB old-space).
					`--js-flags=${chromeJsFlags()}`,
				];
				// Hardware-aware GPU acceleration (NVIDIA via ANGLE/D3D11 on
				// Windows; `--disable-gpu` on headless Linux). See config/hardware.
				launchArgs.push(...chromeGpuFlags());

				if (isWin) {
					launchArgs.push("--no-sandbox");
					if (headless) {
						launchArgs.push("--headless=new");
					} else {
						launchArgs.push("--start-maximized");
					}
					if (userDataDir) {
						launchArgs.push("--user-data-dir=" + userDataDir);
						launchArgs.push("--profile-directory=" + profileDirectory);
					}
				} else {
					// Linux Server Optimized Flags (Headless Dominance)
					if (headless) {
						launchArgs.push("--headless=new");
					}
					launchArgs.push("--disable-dev-shm-usage");
					launchArgs.push("--no-sandbox");
					// Honour an explicit real-profile request on Linux/macOS too.
					if (userDataDir) {
						launchArgs.push("--user-data-dir=" + userDataDir);
						launchArgs.push("--profile-directory=" + profileDirectory);
					}
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
				// Actionable hint reused by both the EOF and the timeout paths: the
				// dominant failure when targeting the user's real user-data-dir is a
				// Chrome instance already running on that profile.
				const busyHint = userDataDir
					? ` — a Chrome instance is likely already running on profile "${profileDirectory}" (${userDataDir}). Close it first, or attach to it via browserWSEndpoint / BXC_BROWSER_WS_ENDPOINT.`
					: "";
				// Bound the launch. When Chrome hands a navigation off to an existing
				// instance it may stay alive yet never open the debug port nor close
				// its stderr — `reader.read()` would then await forever (observed as a
				// 180 s outer-timeout kill on `max`). Kill the child and fail fast.
				const launchTimeoutMs = opts.readyTimeoutMs ?? 20_000;
				wsUrl = await new Promise<string>((resolve, reject) => {
					// Chromium typically logs the WebSocket URL to stderr.
					// We keep only the last incomplete line across chunks so the
					// accumulated buffer never grows beyond one line (~200 B),
					// making the scan O(chunk) instead of O(total_output).
					const reader = (proc!.stderr as ReadableStream<Uint8Array>).getReader();
					const decoder = new TextDecoder();
					let tail = ""; // incomplete line carried from the previous chunk
					let settled = false;

					const timer = setTimeout(() => {
						if (settled) return;
						settled = true;
						reader.cancel().catch(() => undefined);
						try {
							proc?.kill();
						} catch {
							/* already gone */
						}
						reject(
							new Error(
								`Timed out after ${launchTimeoutMs} ms waiting for the Chrome debug port.${busyHint}`,
							),
						);
					}, launchTimeoutMs);

					const settleResolve = (v: string) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						resolve(v);
					};
					const settleReject = (e: Error) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						reject(e);
					};

					const readLoop = async () => {
						try {
							const { done, value } = await reader.read();
							if (settled) return;
							if (value) {
								const text = decoder.decode(value, { stream: true });
								if (opts.stderrLogger) opts.stderrLogger(text);

								// Split on newlines; `tail` holds an incomplete last line.
								const combined = tail + text;
								const nl = combined.lastIndexOf("\n");
								// Lines that are complete (terminated by \n)
								const complete = nl >= 0 ? combined.slice(0, nl) : "";
								tail = nl >= 0 ? combined.slice(nl + 1) : combined;

								for (const line of complete.split("\n")) {
									const match = line.match(/ws:\/\/[^\s]+/);
									if (match) {
										settleResolve(match[0].trim());
										return;
									}
								}
								// Also scan the current tail in case the URL arrived
								// without a trailing newline yet.
								const tailMatch = tail.match(/ws:\/\/[^\s]+/);
								if (tailMatch) {
									settleResolve(tailMatch[0].trim());
									return;
								}
							}
							if (!done) {
								readLoop();
							} else {
								// Chrome exited without opening the debug port — almost
								// always the already-running-profile case.
								settleReject(
									new Error("Process exited before emitting ws url." + busyHint),
								);
							}
						} catch (e) {
							settleReject(e instanceof Error ? e : new Error(String(e)));
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
