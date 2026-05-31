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
 * @module bxc/react/parser
 *
 * Parsers for React / Next.js / Nuxt / Remix / Astro / SvelteKit hydration
 * payloads. Operates on raw HTML (any profile) or on a `Page` instance.
 *
 * Sources detected :
 *   - Next.js Pages Router : `<script id="__NEXT_DATA__" type="application/json">`
 *     payload (router state, props, query, build id, page).
 *   - Next.js App Router   : `self.__next_f.push([1, "..."])` flight chunks
 *     (RSC streaming format).
 *   - Nuxt 3              : `<script>window.__NUXT__=...</script>`.
 *   - Remix               : `<script>window.__remixContext=...</script>`.
 *   - Astro               : `<astro-island ...>` element data-* attrs.
 *   - SvelteKit           : `<script type="application/json"
 *     data-sveltekit-fetched ...>`.
 *   - Generic             : `window.__INITIAL_STATE__`,
 *     `window.__APOLLO_STATE__`, `window.__PRELOADED_STATE__`.
 *
 * The implementations are pure-function (no DOM dependency) — they work
 * on any HTML string, including the result of `Page.content()` from any
 * bxc profile.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NextDataPayload {
	/** Pages Router route name e.g. `/users/[id]`. */
	page?: string;
	/** Resolved route + query params. */
	query?: Record<string, string | string[]>;
	/** Server-side `getServerSideProps` / `getStaticProps` output. */
	props?: { pageProps?: Record<string, unknown>; [key: string]: unknown };
	/** Per-build random id, useful for `/_next/data/<buildId>/...` calls. */
	buildId?: string;
	/** Whether the page was fallback statically rendered. */
	isFallback?: boolean;
	/** Whether the page is in dev mode. */
	dev?: boolean;
	/** Locale info. */
	locale?: string;
	locales?: string[];
	defaultLocale?: string;
	/** Raw payload (un-narrowed) for callers that need extras. */
	raw: Record<string, unknown>;
}

export interface AppRouterFlightChunk {
	index: number;
	payload: string;
}

export interface ReactRootInfo {
	/** Root selector if available (`#__next`, `#root`, ...). */
	selector: string;
	/** `data-react-helmet`, `data-reactroot`, `data-reactid` markers. */
	markers: string[];
	/** Inner HTML byte length (heuristic for SSR vs CSR). */
	contentBytes: number;
}

export interface HydrationSignal {
	framework:
		| "next-pages"
		| "next-app"
		| "nuxt"
		| "remix"
		| "astro"
		| "sveltekit"
		| "react"
		| "unknown";
	hydrated: boolean;
	/** Best-effort version string when discoverable. */
	version?: string;
}

// ---------------------------------------------------------------------------
// Next.js — __NEXT_DATA__
// ---------------------------------------------------------------------------

const NEXT_DATA_RE =
	/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>\s*([\s\S]*?)\s*<\/script>/i;

/** Extracts the `__NEXT_DATA__` JSON payload from server-rendered HTML. */
export function parseNextData(html: string): NextDataPayload | null {
	const m = html.match(NEXT_DATA_RE);
	if (!m) return null;
	const json = m[1].trim();
	if (!json) return null;
	try {
		const raw = JSON.parse(json) as Record<string, unknown>;
		const props = raw["props"] as Record<string, unknown> | undefined;
		return {
			page:
				typeof raw["page"] === "string" ? (raw["page"] as string) : undefined,
			query:
				(raw["query"] as Record<string, string | string[]> | undefined) ??
				undefined,
			props,
			buildId:
				typeof raw["buildId"] === "string"
					? (raw["buildId"] as string)
					: undefined,
			isFallback: raw["isFallback"] as boolean | undefined,
			dev: raw["dev"] as boolean | undefined,
			locale: raw["locale"] as string | undefined,
			locales: raw["locales"] as string[] | undefined,
			defaultLocale: raw["defaultLocale"] as string | undefined,
			raw,
		};
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Next.js App Router — RSC flight chunks
// ---------------------------------------------------------------------------

const APP_FLIGHT_RE =
	/self\.__next_f\.push\(\s*\[\s*(\d+)\s*,\s*((?:"(?:[^"\\]|\\.)*")|null)\s*\]\s*\)/g;

/**
 * Extracts the App Router RSC flight chunks (the streaming payload Next.js
 * uses to hydrate Server Components on the client). Each chunk is a single
 * `self.__next_f.push([N, "..."])` call.
 */
export function parseAppRouterFlight(html: string): AppRouterFlightChunk[] {
	const chunks: AppRouterFlightChunk[] = [];
	for (const m of html.matchAll(APP_FLIGHT_RE)) {
		const index = Number.parseInt(m[1], 10);
		let payload = m[2];
		if (payload === "null") {
			payload = "";
		} else {
			try {
				payload = JSON.parse(payload) as string;
			} catch {
				// keep as-is
			}
		}
		chunks.push({ index, payload });
	}
	return chunks;
}

// ---------------------------------------------------------------------------
// Nuxt / Remix / SvelteKit / Astro / generic
// ---------------------------------------------------------------------------

function extractAssignment(html: string, lhs: string): unknown | null {
	const re = new RegExp(
		`(?:window|self|globalThis)\\.${lhs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*([\\s\\S]*?);?\\s*<\\/script>`,
		"i",
	);
	const m = html.match(re);
	if (!m) return null;
	try {
		// Many SSR frameworks emit a JSON-stringified object; eval is unsafe so
		// we attempt JSON.parse only.
		return JSON.parse(m[1]);
	} catch {
		return null;
	}
}

export function parseNuxtState(html: string): unknown | null {
	return extractAssignment(html, "__NUXT__");
}

export function parseRemixContext(html: string): unknown | null {
	return extractAssignment(html, "__remixContext");
}

export function parseInitialState(html: string): unknown | null {
	return (
		extractAssignment(html, "__INITIAL_STATE__") ??
		extractAssignment(html, "__PRELOADED_STATE__") ??
		extractAssignment(html, "__APOLLO_STATE__") ??
		null
	);
}

const SVELTEKIT_RE =
	/<script[^>]+type=["']application\/json["'][^>]+data-sveltekit-fetched[^>]*>\s*([\s\S]*?)\s*<\/script>/i;

export function parseSvelteKitFetched(html: string): unknown | null {
	const m = html.match(SVELTEKIT_RE);
	if (!m) return null;
	try {
		return JSON.parse(m[1]);
	} catch {
		return null;
	}
}

const ASTRO_ISLAND_RE = /<astro-island[^>]+>/g;

export function parseAstroIslands(html: string): Array<Record<string, string>> {
	const islands: Array<Record<string, string>> = [];
	for (const m of html.matchAll(ASTRO_ISLAND_RE)) {
		const tag = m[0];
		const attrs: Record<string, string> = {};
		for (const a of tag.matchAll(/([a-z][a-z0-9-]*)=["']([^"']*)["']/gi)) {
			attrs[a[1].toLowerCase()] = a[2];
		}
		islands.push(attrs);
	}
	return islands;
}

// ---------------------------------------------------------------------------
// React roots discovery
// ---------------------------------------------------------------------------

export function findReactRoots(html: string): ReactRootInfo[] {
	const roots: ReactRootInfo[] = [];
	const candidates = ["__next", "__nuxt", "root", "app", "react-root"];
	for (const id of candidates) {
		const re = new RegExp(
			`<([a-z]+)[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
			"i",
		);
		const m = html.match(re);
		if (!m) continue;
		const inner = m[2];
		const markers = [
			...(inner.match(/data-reactroot/g) ?? []),
			...(inner.match(/data-reactid/g) ?? []),
			...(inner.match(/data-react-class/g) ?? []),
			...(inner.match(/data-react-helmet/g) ?? []),
		];
		roots.push({
			selector: `#${id}`,
			markers: [...new Set(markers)],
			contentBytes: inner.length,
		});
	}
	return roots;
}

// ---------------------------------------------------------------------------
// Aggregate hydration sniffer
// ---------------------------------------------------------------------------

export function detectHydration(html: string): HydrationSignal {
	if (NEXT_DATA_RE.test(html)) {
		const data = parseNextData(html);
		return {
			framework: "next-pages",
			hydrated: !!data?.props?.pageProps,
			version: data?.dev ? "dev" : undefined,
		};
	}
	if (APP_FLIGHT_RE.test(html)) {
		return {
			framework: "next-app",
			hydrated: html.includes("self.__next_f.push"),
		};
	}
	if (/window\.__NUXT__/i.test(html)) {
		return { framework: "nuxt", hydrated: true };
	}
	if (/window\.__remixContext/i.test(html)) {
		return { framework: "remix", hydrated: true };
	}
	if (/<astro-island/i.test(html)) {
		return { framework: "astro", hydrated: true };
	}
	if (/data-sveltekit-fetched/i.test(html)) {
		return { framework: "sveltekit", hydrated: true };
	}
	if (/data-reactroot|data-react-class|data-reactid/i.test(html)) {
		return { framework: "react", hydrated: true };
	}
	return { framework: "unknown", hydrated: false };
}

// ---------------------------------------------------------------------------
// Bxc Page convenience
// ---------------------------------------------------------------------------

interface PageLike {
	url(): string;
	content(): Promise<string>;
}

/**
 * Reads the rendered HTML from a bxc `Page` and returns the merged
 * hydration payload : `__NEXT_DATA__`, App Router flight chunks, generic
 * window state. Use after `page.goto(url)`.
 */
export async function snapshotHydration(page: PageLike): Promise<{
	url: string;
	signal: HydrationSignal;
	nextData: NextDataPayload | null;
	appRouterChunks: AppRouterFlightChunk[];
	nuxtState: unknown;
	remixContext: unknown;
	initialState: unknown;
	svelteKitFetched: unknown;
	astroIslands: Array<Record<string, string>>;
	reactRoots: ReactRootInfo[];
}> {
	const html = await page.content();
	return {
		url: page.url(),
		signal: detectHydration(html),
		nextData: parseNextData(html),
		appRouterChunks: parseAppRouterFlight(html),
		nuxtState: parseNuxtState(html),
		remixContext: parseRemixContext(html),
		initialState: parseInitialState(html),
		svelteKitFetched: parseSvelteKitFetched(html),
		astroIslands: parseAstroIslands(html),
		reactRoots: findReactRoots(html),
	};
}

// ---------------------------------------------------------------------------
// /_next/data/<buildId>/<route>.json fetcher
// ---------------------------------------------------------------------------

/**
 * Fetches the Next.js Pages Router data endpoint that ships
 * `getServerSideProps` / `getStaticProps` output as JSON. Useful when the
 * static HTML has minimal SSR but a full `_next/data/` API is exposed.
 *
 * Pass the route in the same shape Next emits, e.g. `/users/123` →
 * `/_next/data/<buildId>/users/123.json`.
 */
export async function fetchNextData(
	origin: string,
	route: string,
	buildId: string,
	options?: { headers?: Record<string, string>; timeoutMs?: number },
): Promise<unknown> {
	const cleanRoute = route.startsWith("/") ? route.slice(1) : route;
	const url = new URL(
		`/_next/data/${buildId}/${cleanRoute}.json`,
		origin.endsWith("/") ? origin : `${origin}/`,
	);
	const r = await fetch(url, {
		signal: AbortSignal.timeout(options?.timeoutMs ?? 15_000),
		headers: {
			"x-nextjs-data": "1",
			"User-Agent":
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			...options?.headers,
		},
	});
	if (!r.ok) {
		throw new Error(
			`/_next/data/ fetch returned HTTP ${r.status} for ${url.href}`,
		);
	}
	return r.json();
}
