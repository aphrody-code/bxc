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
 * @module bunlight/cookies/cookie-loader
 *
 * Multi-format cookie loader. Reads exported cookies from disk and produces a
 * normalised array of {@link Cookie} objects suitable for injection into a CDP
 * session (`Network.setCookies`) or for emission as a HTTP `Cookie` header
 * with the `http` (curl-impersonate) profile.
 *
 * Supported input formats (auto-detected from content):
 *
 *   1. **JSON Playwright/CDP** — array of objects with `name`, `value`,
 *      `domain`, `path`, `expires`, `httpOnly`, `secure`, `sameSite`.
 *      This is the format produced by Playwright's `context.cookies()` and
 *      by Chrome DevTools "Copy as JSON" on the cookies pane (with the
 *      `Cookie-Editor` browser extension this is the default export).
 *
 *   2. **JSON DevTools raw** — same shape but with `expirationDate`
 *      (Chrome DevTools' native field name) and `hostOnly`.  Common for
 *      EditThisCookie / Cookie Editor exports.
 *
 *   3. **Netscape `cookies.txt`** — legacy format used by `curl --cookie`,
 *      `wget`, `yt-dlp`.  Tab-separated:
 *      `domain\tflag\tpath\tsecure\texpiry\tname\tvalue`
 *
 * Expired cookies are filtered out (when `expires > 0` and in the past).
 *
 * @example
 * ```ts
 * import { loadCookieJar } from "bunlight/cookies/cookie-loader";
 *
 * const cookies = await loadCookieJar("./cookies/private/challonge.json");
 * console.log(`Loaded ${cookies.length} cookies`);
 * ```
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A normalised cookie record.  Mirrors the CDP `Network.CookieParam` shape so
 * that the array can be passed directly to `Network.setCookies`.
 *
 * `expires` is a UNIX timestamp in **seconds** (CDP convention).  A value of
 * `-1` (or `0`/missing) marks a session cookie.
 */
export interface Cookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	/** UNIX seconds. `-1` for session cookies. */
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Strict" | "Lax" | "None";
	/** Whether this cookie is locked to the host (no leading `.`). */
	hostOnly?: boolean;
}

/** Lenient variant — fields that an external exporter might use. */
interface RawJsonCookie {
	name?: string;
	value?: string;
	domain?: string;
	path?: string;
	expires?: number;
	expirationDate?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: string;
	hostOnly?: boolean;
	session?: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads, parses, validates and filters cookies from a file on disk.
 *
 * @param filePath - Path to a cookie file (JSON or Netscape `cookies.txt`).
 * @returns Array of valid, non-expired {@link Cookie} records.
 * @throws If the file does not parse as a known format.
 */
export async function loadCookieJar(filePath: string): Promise<Cookie[]> {
	const raw = await Bun.file(filePath).text();
	const parsed = parseCookies(raw);
	return filterExpired(parsed);
}

/**
 * Loads cookies from an in-memory string.  Useful for tests, fixtures, or
 * cookie data fetched over the network.
 */
export function parseCookies(raw: string): Cookie[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];

	// JSON formats start with `[` or `{`
	if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
		return parseJsonCookies(trimmed);
	}

	// Netscape format starts with `# Netscape` header or contains tabs
	if (
		trimmed.startsWith("#") ||
		/^[^\s]+\t(TRUE|FALSE)\t/m.test(trimmed) ||
		trimmed.includes("\t")
	) {
		return parseNetscapeCookies(trimmed);
	}

	throw new Error(
		"loadCookieJar: unrecognised cookie file format (expected JSON array or Netscape cookies.txt)",
	);
}

/**
 * Removes cookies whose `expires` is set and lies in the past.
 * Session cookies (`expires <= 0`) are kept.
 */
export function filterExpired(cookies: Cookie[]): Cookie[] {
	const now = Math.floor(Date.now() / 1000);
	return cookies.filter((c) => c.expires <= 0 || c.expires > now);
}

/**
 * Produces a masked, log-safe textual representation of a cookie list.
 * Values are replaced with `<masked:N>` so secrets never reach stdout.
 */
export function maskCookiesForLog(cookies: Cookie[]): string {
	return cookies
		.map((c) => `${c.name}=<masked:${c.value.length}> @ ${c.domain}${c.path}`)
		.join(", ");
}

// ---------------------------------------------------------------------------
// JSON parsers
// ---------------------------------------------------------------------------

function parseJsonCookies(raw: string): Cookie[] {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (err) {
		throw new Error(`loadCookieJar: invalid JSON (${(err as Error).message})`);
	}
	if (!Array.isArray(json)) {
		throw new Error("loadCookieJar: JSON cookie file must be an array of cookie objects");
	}
	const out: Cookie[] = [];
	for (const item of json) {
		const cookie = normaliseJsonCookie(item as RawJsonCookie);
		if (cookie) out.push(cookie);
	}
	return out;
}

function normaliseJsonCookie(c: RawJsonCookie): Cookie | null {
	if (!c || typeof c !== "object") return null;
	if (typeof c.name !== "string" || c.name.length === 0) return null;
	if (typeof c.value !== "string") return null;
	if (typeof c.domain !== "string" || c.domain.length === 0) return null;

	const path = typeof c.path === "string" && c.path.length > 0 ? c.path : "/";

	let expires: number;
	if (c.session === true) {
		expires = -1;
	} else if (typeof c.expirationDate === "number") {
		expires = Math.floor(c.expirationDate);
	} else if (typeof c.expires === "number") {
		expires = Math.floor(c.expires);
	} else {
		expires = -1;
	}

	return {
		name: c.name,
		value: c.value,
		domain: c.domain,
		path,
		expires,
		httpOnly: c.httpOnly === true,
		secure: c.secure === true,
		sameSite: normaliseSameSite(c.sameSite),
		hostOnly: c.hostOnly === true,
	};
}

function normaliseSameSite(input: unknown): "Strict" | "Lax" | "None" {
	if (typeof input !== "string") return "Lax";
	const lower = input.toLowerCase();
	if (lower === "strict") return "Strict";
	if (lower === "none" || lower === "no_restriction") return "None";
	if (lower === "unspecified") return "Lax";
	return "Lax";
}

// ---------------------------------------------------------------------------
// Netscape cookies.txt parser
// ---------------------------------------------------------------------------

/**
 * Parses Netscape-format cookies.txt.  Format (one cookie per line, tab-sep):
 *
 *   domain  flag  path  secure  expiry  name  value
 *
 * Lines beginning with `#` are comments.  An optional `#HttpOnly_` prefix on
 * the domain marks an HttpOnly cookie (curl/wget convention).
 */
function parseNetscapeCookies(raw: string): Cookie[] {
	const out: Cookie[] = [];
	const lines = raw.split(/\r?\n/);

	for (const lineRaw of lines) {
		if (!lineRaw) continue;

		// Detect HttpOnly marker (curl/wget convention)
		let httpOnly = false;
		let line = lineRaw;
		if (line.startsWith("#HttpOnly_")) {
			httpOnly = true;
			line = line.slice("#HttpOnly_".length);
		} else if (line.startsWith("#")) {
			continue; // regular comment
		}

		const parts = line.split("\t");
		if (parts.length < 7) continue;

		const [domain, hostFlag, path, secureFlag, expiryStr, name, ...valueParts] = parts;
		const value = valueParts.join("\t"); // values may contain tabs

		if (!domain || !name) continue;

		const expires = parseInt(expiryStr ?? "0", 10);
		out.push({
			name,
			value,
			domain,
			path: path || "/",
			expires: Number.isFinite(expires) ? expires : -1,
			httpOnly,
			secure: (secureFlag ?? "").toUpperCase() === "TRUE",
			sameSite: "Lax",
			hostOnly: (hostFlag ?? "").toUpperCase() === "FALSE",
		});
	}

	return out;
}
