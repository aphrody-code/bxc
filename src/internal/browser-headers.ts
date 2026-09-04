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
 * @module bxc/internal/browser-headers
 *
 * Single source of truth for the request headers a real browser sends.
 *
 * Every bxc fetch path used to build its own header map, and most of them sent
 * `User-Agent` alone.  WAFs score the *whole* set: a request without
 * `Accept-Language` is a bot tell strong enough, on its own, to earn a 403 on
 * a plain image (measured on comic.dragonballcn.com — dropping that single
 * header flips 200 to 403).  Fixing it in one place fixes every caller, the
 * same rule `purge-engine.ts` and `src/media/` already follow.
 *
 * Header *values* are derived from the User-Agent, never hardcoded next to it:
 * a UA claiming Windows with `Sec-CH-UA-Platform: "macOS"` is a worse tell than
 * sending no hint at all.
 */

/** Chrome build the default UA claims. Bump with the impersonation targets. */
export const DEFAULT_CHROME_MAJOR = 131;

/** Desktop Chrome User-Agent used when the caller has no preference. */
export const DEFAULT_DESKTOP_UA =
	`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
	`(KHTML, like Gecko) Chrome/${DEFAULT_CHROME_MAJOR}.0.0.0 Safari/537.36`;

/** Accept-Language sent when the caller has no locale preference. */
export const DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9";

/** Fetch destination, mapped to the `Sec-Fetch-Dest` header. */
export type FetchDest =
	| "document"
	| "image"
	| "style"
	| "script"
	| "font"
	| "media"
	| "empty";

/** `Accept` value a real Chrome sends for each destination. */
const ACCEPT_BY_DEST: Record<FetchDest, string> = {
	document:
		"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif," +
		"image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
	image: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
	style: "text/css,*/*;q=0.1",
	script: "*/*",
	font: "*/*",
	media: "*/*",
	empty: "*/*",
};

/**
 * Rewrites the `HeadlessChrome/` token Chrome puts in its UA under
 * `--headless=new` back to `Chrome/`.
 *
 * This token is the single cheapest bot signal on the web — a WAF matching it
 * needs no fingerprinting at all. Everything else about the request can be
 * perfect and the page still returns a challenge.
 */
export function stripHeadlessMarker(ua: string): string {
	return ua.replace(/HeadlessChrome\//g, "Chrome/");
}

/** Extracts the Chrome major version from a UA, if it claims one. */
export function chromeMajorOf(ua: string): number | null {
	const m = /(?:Headless)?Chrome\/(\d+)/.exec(ua);
	return m?.[1] ? Number.parseInt(m[1], 10) : null;
}

/** Platform token for `Sec-CH-UA-Platform`, derived from the UA string. */
export function platformOf(ua: string): string {
	if (/Android/i.test(ua)) return "Android";
	if (/(iPhone|iPad|iPod)/i.test(ua)) return "iOS";
	if (/(Macintosh|Mac OS X)/i.test(ua)) return "macOS";
	if (/(Windows|Win64|WOW64)/i.test(ua)) return "Windows";
	if (/(X11|Linux)/i.test(ua)) return "Linux";
	return "Unknown";
}

/** Whether the UA claims a mobile device (`Sec-CH-UA-Mobile`). */
export function isMobileUa(ua: string): boolean {
	return /(Android|iPhone|iPad|iPod|Mobile)/i.test(ua);
}

/**
 * Builds the `Sec-CH-UA` brand list for a Chrome major version.
 *
 * Chrome emits three brands including one GREASE entry; omitting the list
 * entirely on a UA that claims Chrome 100+ is itself inconsistent.
 */
export function secChUa(major: number): string {
	return (
		`"Google Chrome";v="${major}", "Chromium";v="${major}", ` +
		`"Not_A Brand";v="24"`
	);
}

/** Normalises a locale into a Chrome-shaped `Accept-Language` value. */
export function acceptLanguageFor(locale?: string): string {
	if (!locale) return DEFAULT_ACCEPT_LANGUAGE;
	const base = locale.split("-")[0];
	return base && base !== locale
		? `${locale},${base};q=0.9,en;q=0.8`
		: `${locale},en;q=0.8`;
}

/** Inputs for {@link browserHeaders}. */
export interface BrowserHeaderOptions {
	/** User-Agent to claim. Defaults to {@link DEFAULT_DESKTOP_UA}. */
	userAgent?: string;
	/** BCP-47 locale driving `Accept-Language` (e.g. `"zh-CN"`). */
	locale?: string;
	/** Resource kind being fetched. Defaults to `"document"`. */
	dest?: FetchDest;
	/** Referring page, when there is one. Also decides `Sec-Fetch-Site`. */
	referer?: string;
	/** URL being fetched — used to classify the referer as same-origin. */
	url?: string;
	/** Caller headers, merged last so they always win. */
	extra?: Record<string, string>;
}

/** Classifies `Sec-Fetch-Site` from the referer/target pair. */
function fetchSite(referer?: string, url?: string): string {
	if (!referer) return "none";
	if (!url) return "same-origin";
	try {
		const a = new URL(referer);
		const b = new URL(url);
		if (a.origin === b.origin) return "same-origin";
		// Registrable-domain comparison is good enough here: the point is
		// same-site vs cross-site, and a wrong guess is only a weaker signal.
		const host = (h: string) => h.split(".").slice(-2).join(".");
		return host(a.hostname) === host(b.hostname) ? "same-site" : "cross-site";
	} catch {
		return "same-origin";
	}
}

/**
 * Builds a complete, self-consistent browser header set.
 *
 * Keys use canonical casing; HTTP/2 lowercases them on the wire anyway, and
 * `fetch()` normalises before sending.
 */
export function browserHeaders(
	opts: BrowserHeaderOptions = {},
): Record<string, string> {
	const ua = stripHeadlessMarker(opts.userAgent ?? DEFAULT_DESKTOP_UA);
	const dest = opts.dest ?? "document";
	const isDocument = dest === "document";

	const headers: Record<string, string> = {
		"User-Agent": ua,
		Accept: ACCEPT_BY_DEST[dest],
		"Accept-Language": acceptLanguageFor(opts.locale),
	};

	// Client hints only make sense for a UA that claims Chromium.
	const major = chromeMajorOf(ua);
	if (major !== null) {
		headers["Sec-CH-UA"] = secChUa(major);
		headers["Sec-CH-UA-Mobile"] = isMobileUa(ua) ? "?1" : "?0";
		headers["Sec-CH-UA-Platform"] = `"${platformOf(ua)}"`;
		headers["Sec-Fetch-Dest"] = dest;
		headers["Sec-Fetch-Mode"] = isDocument ? "navigate" : "no-cors";
		headers["Sec-Fetch-Site"] = fetchSite(opts.referer, opts.url);
		if (isDocument) {
			headers["Sec-Fetch-User"] = "?1";
			headers["Upgrade-Insecure-Requests"] = "1";
		}
	}

	if (opts.referer) headers.Referer = opts.referer;

	return { ...headers, ...opts.extra };
}
