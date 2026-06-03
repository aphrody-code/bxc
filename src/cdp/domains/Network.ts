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
 * Network domain handler.
 *
 * Implements CDP Network domain methods for the static transport:
 *   - Network.enable
 *   - Network.clearBrowserCookies
 *   - Network.emulateNetworkConditions
 *   - Network.getAllCookies
 *   - Network.getCookies
 *   - Network.getResponseBody
 *   - Network.setCookies
 *   - Network.setExtraHTTPHeaders
 *
 * Events emitted during Page.navigate (in StaticDomTransport.#navigate):
 *   - Network.requestWillBeSent
 *   - Network.responseReceived
 *   - Network.loadingFinished
 *   - Network.loadingFailed
 *
 * Cookie jar is shared across all sessions via ctx.networkCtx.cookies.
 * Response bodies are cached in ctx.networkCtx.requestRegistry and
 * available via Network.getResponseBody.
 */

import type { CdpCookie, CdpCookieParam, DomainHandler } from "../types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives domain/path from a URL string when not explicitly provided.
 */
function domainFromUrl(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

/**
 * Builds a canonical jar key "domain|path|name" for cookie storage.
 */
function cookieKey(domain: string, path: string, name: string): string {
	return `${domain}|${path}|${name}`;
}

/**
 * Checks whether the given URL matches a cookie's domain/path scope.
 * The matching rules follow RFC 6265 loosely:
 *   - Domain: exact match or suffix match (domain cookie)
 *   - Path: exact match or prefix match
 */
function cookieMatchesUrl(cookie: CdpCookie, url: string): boolean {
	let hostname: string;
	let pathname: string;
	try {
		const parsed = new URL(url);
		hostname = parsed.hostname;
		pathname = parsed.pathname;
	} catch {
		return false;
	}

	// Domain match: exact or suffix (.google.com matches sub.google.com)
	const cookieDomain = cookie.domain.startsWith(".")
		? cookie.domain.slice(1)
		: cookie.domain;
	const domainMatch =
		hostname === cookieDomain || hostname.endsWith(`.${cookieDomain}`);
	if (!domainMatch) return false;

	// Path match: cookie path must be a prefix of the URL path
	const cookiePath = cookie.path || "/";
	if (cookiePath !== "/") {
		if (!pathname.startsWith(cookiePath)) return false;
	}

	// Expiry: -1 means session cookie (never expires during session)
	if (cookie.expires > 0 && cookie.expires < Date.now() / 1000) return false;

	return true;
}

/**
 * Converts a CdpCookieParam (from Network.setCookies) into a CdpCookie
 * suitable for storage in the jar.
 */
function normalizeCookieParam(param: CdpCookieParam): CdpCookie {
	let domain = param.domain ?? "";
	const path = param.path ?? "/";

	// If domain is not set but url is, derive from url
	if (!domain && param.url) {
		domain = domainFromUrl(param.url);
	}

	const valueStr = param.value;
	const size = param.name.length + 1 + valueStr.length; // name=value

	return {
		name: param.name,
		value: valueStr,
		domain,
		path,
		expires: param.expires ?? -1,
		size,
		httpOnly: param.httpOnly ?? false,
		secure: param.secure ?? false,
		session: param.expires === undefined,
		sameSite: param.sameSite,
		priority: param.priority ?? "Medium",
	};
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const NetworkHandler: DomainHandler = async (
	method,
	params,
	ctx,
	_sessionId,
) => {
	const net = ctx.networkCtx;

	switch (method) {
		// ------------------------------------------------------------------
		// Network.enable — acknowledge; events are emitted in navigate()
		// ------------------------------------------------------------------
		case "Network.enable":
			return {};

		// ------------------------------------------------------------------
		// Network.clearBrowserCookies — wipe the entire jar
		// ------------------------------------------------------------------
		case "Network.clearBrowserCookies": {
			net.cookies.clear();
			return {};
		}

		// ------------------------------------------------------------------
		// Network.emulateNetworkConditions — store for reference (no real throttle in static)
		// ------------------------------------------------------------------
		case "Network.emulateNetworkConditions": {
			const p = params as {
				offline?: boolean;
				latency?: number;
				downloadThroughput?: number;
				uploadThroughput?: number;
				connectionType?: string;
			};
			if (p.offline === true) {
				net.networkConditions = {
					offline: true,
					latency: p.latency ?? 0,
					downloadThroughput: p.downloadThroughput ?? -1,
					uploadThroughput: p.uploadThroughput ?? -1,
					connectionType: p.connectionType,
				};
			} else {
				net.networkConditions = null;
			}
			return {};
		}

		// ------------------------------------------------------------------
		// Network.getAllCookies — return entire jar
		// ------------------------------------------------------------------
		case "Network.getAllCookies": {
			const cookies = [...net.cookies.values()];
			return { cookies };
		}

		// ------------------------------------------------------------------
		// Network.getCookies — return cookies filtered by url list
		// ------------------------------------------------------------------
		case "Network.getCookies": {
			const p = params as { urls?: string[] };
			const urls = p.urls ?? [];
			let cookies: CdpCookie[];

			if (urls.length === 0) {
				// No url filter: return all cookies
				cookies = [...net.cookies.values()];
			} else {
				// Filter by url scope
				const seen = new Set<string>();
				cookies = [];
				for (const cookie of net.cookies.values()) {
					const key = cookieKey(cookie.domain, cookie.path, cookie.name);
					if (seen.has(key)) continue;
					for (const url of urls) {
						if (cookieMatchesUrl(cookie, url)) {
							seen.add(key);
							cookies.push(cookie);
							break;
						}
					}
				}
			}
			return { cookies };
		}

		// ------------------------------------------------------------------
		// Network.getResponseBody — return cached body for a requestId
		// ------------------------------------------------------------------
		case "Network.getResponseBody": {
			const p = params as { requestId: string };
			const entry = net.requestRegistry.get(p.requestId);
			if (!entry) {
				// Per CDP spec, throw an error if the requestId is unknown
				throw new Error(
					`No response body available for requestId: ${p.requestId}`,
				);
			}
			if (!entry.responseBody) {
				throw new Error(
					`Response body not yet available for requestId: ${p.requestId}`,
				);
			}

			// Detect whether the body is binary (not valid UTF-8) and base64-encode
			let body: string;
			let base64Encoded: boolean;
			try {
				body = new TextDecoder("utf-8", { fatal: true }).decode(
					entry.responseBody,
				);
				base64Encoded = false;
			} catch {
				body = (entry.responseBody as Uint8Array).toBase64();
				base64Encoded = true;
			}

			return { body, base64Encoded };
		}

		// ------------------------------------------------------------------
		// Network.setCookies — add/replace cookies in the jar
		// ------------------------------------------------------------------
		case "Network.setCookies": {
			const p = params as { cookies: CdpCookieParam[] };
			for (const param of p.cookies ?? []) {
				const cookie = normalizeCookieParam(param);
				const key = cookieKey(cookie.domain, cookie.path, cookie.name);
				net.cookies.set(key, cookie);
			}
			return {};
		}

		// ------------------------------------------------------------------
		// Network.setExtraHTTPHeaders — store for injection in next navigate
		// ------------------------------------------------------------------
		case "Network.setExtraHTTPHeaders": {
			const p = params as { headers: Record<string, string> };
			// Replace the extra-headers map entirely (CDP semantics)
			for (const k of Object.keys(net.extraHeaders)) {
				delete net.extraHeaders[k];
			}
			Object.assign(net.extraHeaders, p.headers ?? {});
			return {};
		}

		default:
			return null;
	}
};
