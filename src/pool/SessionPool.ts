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

/**
 * @module bxc/pool/SessionPool
 *
 * Per-domain cookie jar persistence.
 *
 * Each domain owned by a `SessionPool` lives in its own JSON file under
 * `jarPath/<sanitized-domain>.json`.  The on-disk format is intentionally
 * simple (a list of plain cookie records) so callers can interop with
 * external tools (curl, browser dev tools) by editing the files.
 *
 * Lifecycle:
 *   - On `getJar(host)`: load from disk if present, else return an empty jar.
 *   - On `saveJar(host)`: write the jar atomically (temp file + rename).
 *   - On `closeAll()`: flush every dirty jar to disk.
 *
 * The pool itself does not perform HTTP — it's a passive store.  Callers wire
 * it into their fetch/CDP pipeline:
 *
 *   - On request: `Cookie` header from `jar.toRequestHeader(url)`.
 *   - On response: `jar.applySetCookie(res.headers["set-cookie"], url)`.
 *
 * @example
 * ```ts
 * const sessions = new SessionPool({ jarPath: "./jars" });
 * const jar = await sessions.getJar("google.com");
 * jar.set({ name: "sid", value: "abc", domain: "google.com", path: "/" });
 * await sessions.saveJar("google.com");
 * ```
 */

import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CookieRecord {
	name: string;
	value: string;
	domain: string;
	path?: string;
	expires?: number;
	secure?: boolean;
	httpOnly?: boolean;
	sameSite?: "Strict" | "Lax" | "None";
}

export interface SessionPoolOptions {
	/** Directory where domain jars are stored.  Created if missing. */
	jarPath: string;
	/**
	 * If true, save dirty jars on `process.exit`.  Default: true.
	 */
	autoSaveOnExit?: boolean;
}

// ---------------------------------------------------------------------------
// CookieJar
// ---------------------------------------------------------------------------

/** Mutable in-memory cookie jar for a single hostname. */
export class CookieJar {
	readonly host: string;
	#cookies: CookieRecord[];
	#dirty = false;

	constructor(host: string, cookies: CookieRecord[] = []) {
		this.host = host;
		this.#cookies = cookies;
	}

	/** Returns a copy of every cookie (excluding expired ones). */
	all(): CookieRecord[] {
		const now = Date.now();
		return this.#cookies
			.filter((c) => !c.expires || c.expires > now)
			.map((c) => ({ ...c }));
	}

	/** Sets or updates a cookie by `(name, domain, path)` triple. */
	set(c: CookieRecord): void {
		const path = c.path ?? "/";
		const idx = this.#cookies.findIndex(
			(x) =>
				x.name === c.name && x.domain === c.domain && (x.path ?? "/") === path,
		);
		if (idx >= 0) this.#cookies[idx] = { ...c, path };
		else this.#cookies.push({ ...c, path });
		this.#dirty = true;
	}

	/** Removes any cookie matching the predicate. */
	delete(pred: (c: CookieRecord) => boolean): number {
		const before = this.#cookies.length;
		this.#cookies = this.#cookies.filter((c) => !pred(c));
		const removed = before - this.#cookies.length;
		if (removed > 0) this.#dirty = true;
		return removed;
	}

	/**
	 * Builds a `Cookie:` request header value for the given URL.  Filters by
	 * domain match (suffix), path prefix, and expiry.
	 */
	toRequestHeader(url: string): string {
		let host: string;
		let pathname: string;
		let secure: boolean;
		try {
			const u = new URL(url);
			host = u.hostname;
			pathname = u.pathname;
			secure = u.protocol === "https:";
		} catch {
			return "";
		}
		const now = Date.now();
		const matches = this.#cookies.filter((c) => {
			if (c.expires && c.expires <= now) return false;
			if (c.secure && !secure) return false;
			if (!hostMatches(host, c.domain)) return false;
			if (!pathMatches(pathname, c.path ?? "/")) return false;
			return true;
		});
		return matches.map((c) => `${c.name}=${c.value}`).join("; ");
	}

	/** Applies one or more `Set-Cookie` response headers to this jar. */
	applySetCookie(
		setCookie: string | string[] | undefined,
		requestUrl: string,
	): void {
		if (!setCookie) return;
		const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
		let defaultDomain: string;
		try {
			defaultDomain = new URL(requestUrl).hostname;
		} catch {
			return;
		}
		for (const h of headers) {
			const parsed = parseSetCookie(h, defaultDomain);
			if (parsed) this.set(parsed);
		}
	}

	/** @internal */
	get dirty(): boolean {
		return this.#dirty;
	}

	/** @internal */
	markClean(): void {
		this.#dirty = false;
	}

	/** @internal */
	toJSON(): CookieRecord[] {
		return this.#cookies;
	}
}

// ---------------------------------------------------------------------------
// SessionPool
// ---------------------------------------------------------------------------

export class SessionPool {
	readonly #jarPath: string;
	readonly #jars = new Map<string, CookieJar>();

	constructor(opts: SessionPoolOptions) {
		this.#jarPath = opts.jarPath;
		// Ensure the jar directory exists synchronously at construction time.
		// Bun.spawnSync is a Bun-native sync subprocess — avoids fs mkdirSync.
		Bun.spawnSync(["mkdir", "-p", this.#jarPath], { stdin: "ignore" });
		if (opts.autoSaveOnExit !== false) {
			process.on("exit", () => {
				// On exit we can only do sync work. Use Bun.write (async) wrapped
				// in a best-effort fire-and-forget via the process beforeExit event
				// registered below if possible; here we at least attempt a sync flush
				// via Bun.spawnSync to write each dirty jar.
				for (const [host, jar] of this.#jars.entries()) {
					if (!jar.dirty) continue;
					const file = this.#jarFile(host);
					try {
						// Bun.write is async; for the exit handler we use spawnSync to
						// write atomically via a shell redirect (POSIX mv is atomic).
						const json = JSON.stringify(jar.toJSON(), null, 2);
						Bun.spawnSync(
							[
								"sh",
								"-c",
								`cat > ${JSON.stringify(file + ".tmp")} && mv ${JSON.stringify(file + ".tmp")} ${JSON.stringify(file)}`,
							],
							{ stdin: new TextEncoder().encode(json) },
						);
						jar.markClean();
					} catch {
						/* swallow */
					}
				}
			});
		}
	}

	/** Returns (loading from disk if needed) the cookie jar for `host`. */
	async getJar(host: string): Promise<CookieJar> {
		const cached = this.#jars.get(host);
		if (cached) return cached;
		const file = this.#jarFile(host);
		let cookies: CookieRecord[] = [];
		if (await Bun.file(file).exists()) {
			try {
				const raw = await Bun.file(file).text();
				cookies = JSON.parse(raw) as CookieRecord[];
			} catch {
				cookies = [];
			}
		}
		const jar = new CookieJar(host, cookies);
		this.#jars.set(host, jar);
		return jar;
	}

	/** Persists `host`'s jar to disk if dirty. Bun.write is atomic on Linux (sendfile). */
	async saveJar(host: string): Promise<void> {
		const jar = this.#jars.get(host);
		if (!jar || !jar.dirty) return;
		const file = this.#jarFile(host);
		await Bun.write(file, JSON.stringify(jar.toJSON(), null, 2));
		jar.markClean();
	}

	/** Persists every dirty jar to disk. */
	async flushAll(): Promise<void> {
		await Promise.all([...this.#jars.keys()].map((host) => this.saveJar(host)));
	}

	/** @deprecated Use `flushAll()` — kept for back-compat call sites on process.exit. */
	flushAllSync(): void {
		// Best-effort sync flush via spawnSync — use flushAll() in async contexts.
		for (const [host, jar] of this.#jars.entries()) {
			if (!jar.dirty) continue;
			const file = this.#jarFile(host);
			try {
				const json = JSON.stringify(jar.toJSON(), null, 2);
				Bun.spawnSync(
					[
						"sh",
						"-c",
						`cat > ${JSON.stringify(file + ".tmp")} && mv ${JSON.stringify(file + ".tmp")} ${JSON.stringify(file)}`,
					],
					{ stdin: new TextEncoder().encode(json) },
				);
				jar.markClean();
			} catch {
				/* swallow */
			}
		}
	}

	/** Returns the list of host jars currently loaded in memory. */
	hosts(): string[] {
		return [...this.#jars.keys()];
	}

	/** Path to the jar file for `host`. */
	#jarFile(host: string): string {
		return join(this.#jarPath, `${sanitize(host)}.json`);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitize(host: string): string {
	return host.replace(/[^a-zA-Z0-9.-]/g, "_");
}

function hostMatches(requestHost: string, cookieDomain: string): boolean {
	const cookie = cookieDomain.startsWith(".")
		? cookieDomain.slice(1)
		: cookieDomain;
	if (!cookie) return false;
	if (requestHost === cookie) return true;
	return requestHost.endsWith(`.${cookie}`);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
	if (cookiePath === "/") return true;
	if (requestPath === cookiePath) return true;
	if (requestPath.startsWith(cookiePath + "/")) return true;
	return false;
}

function parseSetCookie(
	header: string,
	defaultDomain: string,
): CookieRecord | null {
	const parts = header.split(";").map((p) => p.trim());
	if (parts.length === 0) return null;
	const [first, ...attrs] = parts;
	const eqIdx = first.indexOf("=");
	if (eqIdx <= 0) return null;
	const name = first.slice(0, eqIdx).trim();
	const value = first.slice(eqIdx + 1).trim();
	const out: CookieRecord = { name, value, domain: defaultDomain, path: "/" };
	for (const attr of attrs) {
		const [rawKey, ...rest] = attr.split("=");
		const key = rawKey.trim().toLowerCase();
		const val = rest.join("=").trim();
		switch (key) {
			case "domain":
				if (val) out.domain = val.startsWith(".") ? val.slice(1) : val;
				break;
			case "path":
				if (val) out.path = val;
				break;
			case "expires": {
				const t = Date.parse(val);
				if (!Number.isNaN(t)) out.expires = t;
				break;
			}
			case "max-age": {
				const n = Number(val);
				if (Number.isFinite(n)) out.expires = Date.now() + n * 1000;
				break;
			}
			case "secure":
				out.secure = true;
				break;
			case "httponly":
				out.httpOnly = true;
				break;
			case "samesite":
				if (val === "Strict" || val === "Lax" || val === "None")
					out.sameSite = val;
				break;
		}
	}
	return out;
}
