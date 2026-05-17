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
 * @module bunlight/cookies/cookie-injector
 *
 * Injects {@link Cookie} arrays into Bunlight's various transport layers.
 *
 * Two injection paths:
 *
 *   1. **CDP transport** (`profile: "fast" | "static"`) → `Network.setCookies`
 *      batched call.  Works on any transport that exposes `send()` and
 *      relays CDP responses through `onmessage`.
 *
 *   2. **HTTP transport** (`profile: "http"` / `ImpersonatedClient`) →
 *      builds a `Cookie:` header from cookies whose `domain`/`path` match the
 *      target URL.  This is required because the curl-impersonate cookie
 *      engine starts empty per request and does not pre-populate from a jar.
 *
 *   3. **Patchright** (stealth/max profiles) already has its own
 *      `loadCookies()` helper in `src/profiles/humanize.ts` — that one stays
 *      authoritative; we re-export {@link buildPatchrightCookies} for
 *      callers who want to feed our normalised {@link Cookie} type into a
 *      Playwright/patchright `context.addCookies()` call.
 *
 * SECURITY: never log raw cookie values.  Use {@link maskCookiesForLog} from
 * `cookie-loader.ts` for any logging.
 */

import type { ConnectionTransport } from "../../types/ConnectionTransport.ts";
import { cdpCall } from "../internal/cdp-call.ts";
import type { Cookie } from "./cookie-loader.ts";

// ---------------------------------------------------------------------------
// CDP injection
// ---------------------------------------------------------------------------

/**
 * Injects every cookie in the array into the CDP-backed browser via
 * `Network.setCookies` (batched, single round-trip).
 *
 * Falls back to per-cookie `Network.setCookie` calls when the transport
 * rejects the batched form (some StaticDomTransport implementations).
 *
 * @param transport - Any `ConnectionTransport` (StaticDomTransport,
 *   SocketPairTransport, …).
 * @param cookies   - Cookies to inject.
 * @param sessionId - Optional CDP session id (required for `flatten=true`
 *   sessions like the ones Bunlight's `Page` uses).
 */
export async function injectCookies(
	transport: ConnectionTransport,
	cookies: Cookie[],
	sessionId?: string,
): Promise<void> {
	if (cookies.length === 0) return;

	const cdpCookies = cookies.map(toCdpCookieParam);

	try {
		await cdpCall(
			transport,
			"Network.setCookies",
			{ cookies: cdpCookies },
			sessionId,
		);
		return;
	} catch (err) {
		// Some transports (e.g. minimal StaticDomTransport) do not implement
		// `Network.setCookies` — try the singular form one-by-one.  If even
		// that fails, swallow silently because static mode has no real
		// network stack to attach cookies to.
		void err;
	}

	for (const c of cdpCookies) {
		try {
			await cdpCall(transport, "Network.setCookie", c, sessionId);
		} catch {
			// best-effort: a transport without a network stack is non-fatal
			return;
		}
	}
}

/**
 * Converts a {@link Cookie} into the CDP `Network.CookieParam` shape.
 */
function toCdpCookieParam(c: Cookie): Record<string, unknown> {
	const param: Record<string, unknown> = {
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		secure: c.secure,
		httpOnly: c.httpOnly,
		sameSite: c.sameSite,
	};
	if (c.expires > 0) {
		param.expires = c.expires;
	}
	return param;
}

// ---------------------------------------------------------------------------
// HTTP (curl-impersonate) injection
// ---------------------------------------------------------------------------

/**
 * Builds a `Cookie:` header value from every cookie whose `domain`+`path`
 * matches the target `url`, following RFC 6265 matching rules.
 *
 * @returns Header value (`"k1=v1; k2=v2"`) or `null` if no cookies match.
 *
 * @example
 * ```ts
 * const header = buildCookieHeader(cookies, "https://challonge.com/fr/B_TS5");
 * // → "cf_clearance=...; session_production=..."
 * ```
 */
export function buildCookieHeader(
	cookies: Cookie[],
	url: string,
): string | null {
	if (cookies.length === 0) return null;

	let host: string;
	let path: string;
	let scheme: string;
	try {
		const u = new URL(url);
		host = u.hostname.toLowerCase();
		path = u.pathname || "/";
		scheme = u.protocol.replace(":", "").toLowerCase();
	} catch {
		return null;
	}

	const matching = cookies
		.filter((c) => domainMatches(host, c.domain, c.hostOnly === true))
		.filter((c) => pathMatches(path, c.path))
		.filter((c) => !c.secure || scheme === "https");

	if (matching.length === 0) return null;

	// Longer path first (RFC 6265 §5.4 step 2)
	matching.sort((a, b) => b.path.length - a.path.length);

	return matching.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * RFC 6265 §5.1.3 domain matching.
 *
 * - exact match wins;
 * - cookies with leading-dot or non-host-only domains match any subdomain;
 * - host-only cookies must match exactly.
 */
function domainMatches(
	requestHost: string,
	cookieDomain: string,
	hostOnly: boolean,
): boolean {
	const needle = cookieDomain.toLowerCase().replace(/^\./, "");
	if (requestHost === needle) return true;
	if (hostOnly) return false;
	return requestHost.endsWith(`.${needle}`);
}

/** RFC 6265 §5.1.4 path matching. */
function pathMatches(requestPath: string, cookiePath: string): boolean {
	if (requestPath === cookiePath) return true;
	if (cookiePath === "/") return true;
	if (requestPath.startsWith(cookiePath)) {
		// must be a path-segment boundary
		if (cookiePath.endsWith("/")) return true;
		if (
			requestPath.length > cookiePath.length &&
			requestPath[cookiePath.length] === "/"
		) {
			return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Patchright bridge
// ---------------------------------------------------------------------------

/**
 * Patchright/Playwright `addCookies()` accepts a structurally-compatible
 * shape; this helper converts our normalised {@link Cookie} into the exact
 * field set Playwright expects.
 */
export function buildPatchrightCookies(cookies: Cookie[]): Array<{
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Strict" | "Lax" | "None";
}> {
	return cookies.map((c) => ({
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		expires: c.expires > 0 ? c.expires : -1,
		httpOnly: c.httpOnly,
		secure: c.secure,
		sameSite: c.sameSite,
	}));
}
