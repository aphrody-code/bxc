#!/usr/bin/env bun
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
 * @module examples/challonge-api/server
 *
 * Local HTTP API mimicking the official Challonge REST surface
 * (https://challonge.apidog.io/getting-started-1726706m0) but powered by
 * bxc's `http` profile (curl-impersonate Chrome 131 + cookie injection).
 *
 * Why : the official Challonge API requires per-account API keys and rate
 * limits aggressively. Many self-hosted scenarios already have a logged-in
 * browser session — exporting its cookies and replaying them via bxc
 * gives the exact same data without going through the REST API.
 *
 * Endpoints (URL-compatible with the official API where possible) :
 *
 *   GET  /healthz                                  Liveness
 *   GET  /openapi.json                             OpenAPI 3.1 spec
 *   GET  /v1/tournaments/:slug.json                full tournament JSON
 *                                                  (mirrors Challonge's
 *                                                  reverse-engineered endpoint)
 *   GET  /v1/tournaments/:slug/participants.json   participants array
 *   GET  /v1/tournaments/:slug/matches.json        matches array
 *   GET  /v1/tournaments/:slug/log.json            activity log entries
 *   GET  /v1/tournaments/:slug/standings.json      standings table
 *   GET  /v1/users/:username.json                  user profile JSON
 *
 * Cookie injection :
 *   - Place a cookie jar in `cookies/private/challonge.json` (gitignored).
 *   - The directory layout supports the Playwright JSON shape produced by
 *     `import-cookies.ts` (run once after exporting from DevTools).
 *
 * Usage :
 *   bun run examples/challonge-api/server.ts
 *   curl 'http://localhost:8090/v1/tournaments/B_TS5.json' | jq .
 *
 * License : 0BSD (see workspace root). Bun-native only.
 */

import { Browser, type HttpPage } from "../../src/api/browser.ts";
import { recon } from "../../src/cli/recon.ts";

// ---------------------------------------------------------------------------
// Server configuration
// ---------------------------------------------------------------------------

const PORT = Number.parseInt(Bun.env.CHALLONGE_API_PORT ?? "8090", 10);
const HOST = Bun.env.CHALLONGE_API_HOST ?? "0.0.0.0";
const COOKIE_JAR =
	Bun.env.CHALLONGE_COOKIES ?? `${import.meta.dir}/cookies/private/challonge.json`;
const AUTH_TOKEN = Bun.env.CHALLONGE_API_AUTH ?? null;
const CACHE_TTL_MS = Number.parseInt(Bun.env.CHALLONGE_CACHE_TTL_MS ?? "60000", 10);
const CHALLONGE_ORIGIN = "https://challonge.com";
const OFFICIAL_API_BASE = "https://api.challonge.com/v1";

/**
 * User-Agent pattern aligned with the Rose-Griffon scraping convention :
 * `<service>/<version> (+<contact-url>)` — see ~/vps/docs/scraping.md §10.
 * Override at runtime via `CHALLONGE_API_UA`.
 */
const UA =
	Bun.env.CHALLONGE_API_UA ??
	"challonge-api-bridge/0.1 (+https://developers.google.com/aphrody-code/bxc)";

/**
 * Retry policy on transient upstream failures (429 / 502 / 503 / 504).
 * Aligned with ~/vps/docs/scraping.md §10 "retry x3 backoff exponentiel".
 */
const RETRY_MAX = 3;
const RETRY_BASE_MS = 800;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Optional Challonge API key. When set, requests are routed through the
 * official `api.challonge.com/v1/*.json` endpoints with HTTP Basic auth
 * instead of the reverse-engineered `challonge.com/{slug}.json` routes.
 * The official API works without cookies and is rate-limited per key.
 */
const API_KEY = Bun.env.CHALLONGE_API_KEY ?? null;

// ---------------------------------------------------------------------------
// Tiny LRU cache (per-route, JSON body cached as string)
// ---------------------------------------------------------------------------

interface CacheEntry {
	body: string;
	contentType: string;
	upstreamStatus: number;
	expiresAt: number;
}

class LruCache {
	#map = new Map<string, CacheEntry>();
	constructor(private readonly max: number) {}
	get(key: string): CacheEntry | null {
		const e = this.#map.get(key);
		if (!e) return null;
		if (Date.now() > e.expiresAt) {
			this.#map.delete(key);
			return null;
		}
		this.#map.delete(key);
		this.#map.set(key, e);
		return e;
	}
	set(key: string, entry: CacheEntry): void {
		if (this.#map.size >= this.max) {
			const oldest = this.#map.keys().next().value;
			if (oldest !== undefined) this.#map.delete(oldest);
		}
		this.#map.set(key, entry);
	}
}

const cache = new LruCache(256);

// ---------------------------------------------------------------------------
// Cookie jar loader (best-effort, falls back to no auth)
// ---------------------------------------------------------------------------

async function cookieJarPresent(): Promise<boolean> {
	return Bun.file(COOKIE_JAR).exists();
}

// ---------------------------------------------------------------------------
// Bxc fetch — http profile + cookie jar + curl-impersonate Chrome 131
// ---------------------------------------------------------------------------

async function fetchChallongeRaw(url: string): Promise<{ body: string; status: number }> {
	const havesJar = await cookieJarPresent();
	const page = (await Browser.newPage({
		profile: "http",
		cookies: havesJar ? COOKIE_JAR : undefined,
		httpOpts: { profile: "chrome131" },
	})) as HttpPage;
	try {
		const nav = await page.goto(url, { timeoutMs: 25_000 });
		const body = await page.content().catch(() => "");
		return { body, status: nav.status };
	} finally {
		await page.close().catch(() => undefined);
		await Browser.close().catch(() => undefined);
	}
}

/**
 * Hits the official `api.challonge.com/v1/*.json` surface with HTTP Basic
 * auth (`api_key:<key>`) when `CHALLONGE_API_KEY` is set. Bypasses Cloudflare
 * because the api host is NOT behind the same challenge bucket as the
 * web UI.
 */
/**
 * Retry x3 with exponential backoff for transient upstream errors,
 * per `~/vps/docs/scraping.md §10`. Retries on 429 / 502 / 503 / 504
 * and network failures.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
	let last: Response | undefined;
	for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
		const r = await fetch(url, {
			...init,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		}).catch((err) => {
			if (attempt === RETRY_MAX - 1) throw err;
			return undefined;
		});
		if (!r) {
			await Bun.sleep(RETRY_BASE_MS * 2 ** attempt);
			continue;
		}
		if (r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504) {
			last = r;
			await Bun.sleep(RETRY_BASE_MS * 2 ** attempt);
			continue;
		}
		return r;
	}
	if (last) return last;
	throw new Error(`fetchWithRetry exhausted ${RETRY_MAX} attempts for ${url}`);
}

async function fetchOfficialApiJson(path: string): Promise<unknown> {
	if (!API_KEY) {
		throw new Error("CHALLONGE_API_KEY is not set; falling back to reverse-engineered route");
	}
	const url = `${OFFICIAL_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
	const auth = btoa(`api_key:${API_KEY}`);
	const r = await fetchWithRetry(url, {
		headers: { authorization: `Basic ${auth}`, "User-Agent": UA },
	});
	if (!r.ok) {
		throw new Error(`Challonge official API HTTP ${r.status} for ${url}`);
	}
	return r.json();
}

/**
 * Fetch a Challonge endpoint that returns JSON natively (e.g. `.json`
 * suffix routes). Returns parsed JSON or throws on non-2xx / parse fail.
 */
async function fetchChallongeJson(url: string): Promise<unknown> {
	const { body, status } = await fetchChallongeRaw(url);
	if (status >= 400) {
		throw new Error(`Challonge upstream HTTP ${status} for ${url}`);
	}
	try {
		return JSON.parse(body);
	} catch (err) {
		throw new Error(
			`Failed to parse JSON from ${url}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

// ---------------------------------------------------------------------------
// Endpoint implementations
// ---------------------------------------------------------------------------

interface TournamentResource {
	id?: number;
	url: string;
	slug: string;
	name?: string;
	state?: string;
	type?: string;
	startedAt?: string | null;
	completedAt?: string | null;
	participantsCount?: number;
}

async function getTournament(slug: string): Promise<TournamentResource> {
	// Mode A : official API key set — talk to api.challonge.com/v1
	// Mode B : cookie jar present — talk to challonge.com/{slug}.json
	const json = (await (API_KEY
		? fetchOfficialApiJson(`/tournaments/${encodeURIComponent(slug)}.json`)
		: fetchChallongeJson(`${CHALLONGE_ORIGIN}/${slug}.json`))) as Record<string, unknown>;
	const t = (json["tournament"] as Record<string, unknown>) ?? json;
	return {
		id: typeof t["id"] === "number" ? (t["id"] as number) : undefined,
		url: `${CHALLONGE_ORIGIN}/${slug}`,
		slug,
		name: t["name"] as string | undefined,
		state: t["state"] as string | undefined,
		type: t["tournament_type"] as string | undefined,
		startedAt: (t["started_at"] as string) ?? null,
		completedAt: (t["completed_at"] as string) ?? null,
		participantsCount: t["participants_count"] as number | undefined,
	};
}

interface DiagnoseResult {
	slug: string;
	mode: "official-api-key" | "session-cookies" | "no-auth";
	canFetch: boolean;
	upstreamStatus?: number;
	bytes?: number;
	hint?: string;
}

/**
 * Tries the configured upstream and reports whether the slug can be
 * fetched. Useful first call from any client to know if cookies are stale
 * or the API key is wrong before issuing N requests.
 */
async function diagnose(slug: string): Promise<DiagnoseResult> {
	const havesJar = await cookieJarPresent();
	const mode: DiagnoseResult["mode"] = API_KEY
		? "official-api-key"
		: havesJar
			? "session-cookies"
			: "no-auth";

	if (mode === "no-auth") {
		return {
			slug,
			mode,
			canFetch: false,
			hint: "Set CHALLONGE_API_KEY (official API) or place a cookie jar in cookies/private/challonge.json (reverse-engineered .json endpoints).",
		};
	}

	if (mode === "official-api-key") {
		try {
			await fetchOfficialApiJson(`/tournaments/${encodeURIComponent(slug)}.json`);
			return { slug, mode, canFetch: true };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				slug,
				mode,
				canFetch: false,
				hint: msg.slice(0, 200),
			};
		}
	}

	// session-cookies mode
	const r = await fetchChallongeRaw(`${CHALLONGE_ORIGIN}/${slug}.json`);
	if (r.status === 200) {
		try {
			JSON.parse(r.body);
			return { slug, mode, canFetch: true, upstreamStatus: r.status, bytes: r.body.length };
		} catch {
			return {
				slug,
				mode,
				canFetch: false,
				upstreamStatus: r.status,
				bytes: r.body.length,
				hint: "Got 200 but body is not JSON — likely an HTML response (possibly Cloudflare interstitial).",
			};
		}
	}
	return {
		slug,
		mode,
		canFetch: false,
		upstreamStatus: r.status,
		bytes: r.body.length,
		hint:
			r.status === 403
				? "HTTP 403 + Cloudflare cf-mitigated. Cookie jar likely missing cf_clearance or _challonge_session_production. Refresh from a logged-in browser via DevTools > Application > Cookies."
				: `Upstream returned ${r.status}. Verify the slug exists and your session is valid.`,
	};
}

async function getRawJson(slug: string, suffix = ""): Promise<unknown> {
	return fetchChallongeJson(`${CHALLONGE_ORIGIN}/${slug}${suffix}`);
}

async function getRecon(slug: string): Promise<unknown> {
	return recon({
		url: `${CHALLONGE_ORIGIN}/${slug}`,
		profile: "http",
		screenshot: false,
		json: true,
		timeoutMs: 25_000,
		quiet: true,
		plain: false,
		insecure: false,
	});
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { "content-type": "application/json", ...extra },
	});
}

function isAuthed(req: Request): boolean {
	if (!AUTH_TOKEN) return true;
	return req.headers.get("authorization") === `Bearer ${AUTH_TOKEN}`;
}

function corsHeaders(): Record<string, string> {
	return {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "GET, OPTIONS",
		"access-control-allow-headers": "content-type, authorization",
		"x-bxc-source": "examples/challonge-api",
	};
}

// ---------------------------------------------------------------------------
// OpenAPI 3.1 spec — typed paths, 0BSD
// ---------------------------------------------------------------------------

function openApiSpec(): unknown {
	return {
		openapi: "3.1.0",
		info: {
			title: "Challonge API (bxc bridge)",
			version: "0.1.0",
			description:
				"Local HTTP bridge to Challonge powered by bxc's `http` profile (curl-impersonate Chrome 131) + a private cookie jar. URL-compatible with the official API where the routes overlap.",
			license: { name: "0BSD" },
		},
		servers: [{ url: `http://${HOST}:${PORT}` }],
		components: {
			schemas: {
				Error: {
					type: "object",
					required: ["error"],
					properties: { error: { type: "string" }, reason: { type: "string" } },
				},
				Tournament: {
					type: "object",
					required: ["url", "slug"],
					properties: {
						id: { type: "integer" },
						url: { type: "string", format: "uri" },
						slug: { type: "string" },
						name: { type: "string" },
						state: { type: "string" },
						type: { type: "string" },
						startedAt: { type: "string", nullable: true },
						completedAt: { type: "string", nullable: true },
						participantsCount: { type: "integer" },
					},
				},
			},
		},
		paths: {
			"/healthz": {
				get: {
					summary: "Liveness probe",
					responses: { "200": { description: "OK" } },
				},
			},
			"/v1/tournaments/{slug}.json": {
				get: {
					summary: "Tournament metadata (mirrors Challonge .json reverse endpoint)",
					parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
					responses: {
						"200": {
							description: "Tournament resource",
							content: {
								"application/json": { schema: { $ref: "#/components/schemas/Tournament" } },
							},
						},
					},
				},
			},
			"/v1/tournaments/{slug}/participants.json": {
				get: {
					summary: "Participants list (raw upstream JSON)",
					parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
					responses: { "200": { description: "Participants array" } },
				},
			},
			"/v1/tournaments/{slug}/matches.json": {
				get: {
					summary: "Matches list (raw upstream JSON)",
					parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
					responses: { "200": { description: "Matches array" } },
				},
			},
			"/v1/tournaments/{slug}/log.json": {
				get: {
					summary: "Activity log (raw upstream JSON)",
					parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
					responses: { "200": { description: "Log entries" } },
				},
			},
			"/v1/tournaments/{slug}/standings.json": {
				get: {
					summary: "Standings (raw upstream JSON)",
					parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
					responses: { "200": { description: "Standings array" } },
				},
			},
			"/v1/users/{username}.json": {
				get: {
					summary: "User profile (raw upstream JSON)",
					parameters: [
						{ name: "username", in: "path", required: true, schema: { type: "string" } },
					],
					responses: { "200": { description: "User profile JSON" } },
				},
			},
			"/v1/tournaments/{slug}/recon": {
				get: {
					summary: "bxc recon (HTTP + CDN + frameworks + assets) for the tournament page",
					parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
					responses: { "200": { description: "Recon result" } },
				},
			},
		},
		security: AUTH_TOKEN ? [{ bearerAuth: [] }] : [],
		// Additional routes wired in the server (added at bottom of openapi to keep
		// the doc focused on official-API-compatible URLs first).
		"x-extensions": {
			additionalPaths: {
				"/v1/_diagnose/{slug}": "Probe upstream + report mode/auth issues",
				"/v1/tournaments/{slug}/module": "Raw HTML of the bracket /module page",
				"/v1/tournaments/{slug}/module.json": "Parsed bracket store (TournamentStore)",
				"/v1/tournaments/{slug}/stations.json": "Live station status",
				"/v1/communities/{org}/tournaments": "Org tournaments list (?past=0|1&page=N)",
				"/v1/users/{username}/tournaments": "Tournaments hosted/joined by user",
			},
		},
	};
}

// ---------------------------------------------------------------------------
// Bun.serve routes object syntax
// ---------------------------------------------------------------------------

async function handleCached(cacheKey: string, fetcher: () => Promise<unknown>): Promise<Response> {
	const hit = cache.get(cacheKey);
	const headers = { ...corsHeaders() };
	if (hit) {
		return new Response(hit.body, {
			status: hit.upstreamStatus,
			headers: { ...headers, "content-type": hit.contentType, "x-cache": "hit" },
		});
	}
	try {
		const data = await fetcher();
		const body = JSON.stringify(data, null, 2);
		cache.set(cacheKey, {
			body,
			contentType: "application/json",
			upstreamStatus: 200,
			expiresAt: Date.now() + CACHE_TTL_MS,
		});
		return new Response(body, {
			status: 200,
			headers: { ...headers, "content-type": "application/json", "x-cache": "miss" },
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return jsonResponse(502, { error: "upstream", reason: msg.slice(0, 240) }, headers);
	}
}

const server = Bun.serve({
	port: PORT,
	hostname: HOST,
	error(err) {
		return jsonResponse(500, { error: "internal", reason: err.message.slice(0, 200) });
	},
	routes: {
		"/healthz": async (_req: Request) => {
			const havesJar = await cookieJarPresent();
			return jsonResponse(
				200,
				{
					ok: true,
					mode: API_KEY ? "official-api-key" : havesJar ? "session-cookies" : "no-auth",
					cookieJar: havesJar,
					cookieJarPath: COOKIE_JAR,
					apiKey: API_KEY ? "set" : "absent",
					authRequired: AUTH_TOKEN !== null,
					hint:
						!API_KEY && !havesJar
							? "Set CHALLONGE_API_KEY or import cookies into cookies/private/challonge.json. Without one of these every upstream request will hit Cloudflare's 403 cf-mitigated wall."
							: undefined,
				},
				corsHeaders(),
			);
		},
		"/openapi.json": (_req: Request) => jsonResponse(200, openApiSpec(), corsHeaders()),
		"/v1/_diagnose/:slug": async (req: Request & { params: { slug: string } }) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const result = await diagnose(req.params.slug);
			return jsonResponse(result.canFetch ? 200 : 503, result, corsHeaders());
		},
		"/v1/tournaments/:slug.json": async (req: any) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { slug } = req.params;
			return handleCached(`tournament:${slug}`, () => getTournament(slug));
		},
		"/v1/tournaments/:slug/participants.json": async (
			req: Request & { params: { slug: string } },
		) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { slug } = req.params;
			return handleCached(`participants:${slug}`, () => getRawJson(slug, "/participants.json"));
		},
		"/v1/tournaments/:slug/matches.json": async (req: Request & { params: { slug: string } }) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { slug } = req.params;
			return handleCached(`matches:${slug}`, () => getRawJson(slug, "/matches.json"));
		},
		"/v1/tournaments/:slug/log.json": async (req: Request & { params: { slug: string } }) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { slug } = req.params;
			return handleCached(`log:${slug}`, () => getRawJson(slug, "/log.json"));
		},
		"/v1/tournaments/:slug/standings.json": async (req: Request & { params: { slug: string } }) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { slug } = req.params;
			return handleCached(`standings:${slug}`, () => getRawJson(slug, "/standings.json"));
		},
		"/v1/tournaments/:slug/recon": async (req: Request & { params: { slug: string } }) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { slug } = req.params;
			return handleCached(`recon:${slug}`, () => getRecon(slug));
		},
		// Full typed snapshot extracted from a single page hit. This is the
		// fastest endpoint when you want everything at once : metadata,
		// matches, participants, derived standings, react mount and gon
		// globals — all from one HTML response (one Cloudflare round trip).
		"/v1/tournaments/:slug/full.json": async (req: Request & { params: { slug: string } }) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { slug } = req.params;
			return handleCached(`full:${slug}`, async () => {
				const url = new URL(req.url);
				const lang = url.searchParams.get("lang") ?? "fr";
				const pageUrl = `${CHALLONGE_ORIGIN}/${lang}/${slug}`;
				const r = await fetchChallongeRaw(pageUrl);
				if (r.status !== 200) {
					return {
						error: "upstream",
						status: r.status,
						hint:
							r.status === 403
								? "Cloudflare 403 — refresh cookies/private/challonge.json"
								: undefined,
						body: r.body.slice(0, 200),
					};
				}
				const { extractChallongeTournament } = await import("../../src/scrapers/challonge.ts");
				return extractChallongeTournament(r.body, { url: pageUrl }) as unknown as Record<
					string,
					unknown
				>;
			});
		},
		"/v1/tournaments/:slug/stations.json": async (req: Request & { params: { slug: string } }) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { slug } = req.params;
			return handleCached(`stations:${slug}`, () => getRawJson(slug, "/stations.json"));
		},
		"/v1/tournaments/:slug/module": async (req: Request & { params: { slug: string } }) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { slug } = req.params;
			const cached = cache.get(`module-html:${slug}`);
			if (cached) {
				return new Response(cached.body, {
					status: cached.upstreamStatus,
					headers: { "content-type": cached.contentType, "x-cache": "hit", ...corsHeaders() },
				});
			}
			try {
				const r = await fetchChallongeRaw(`${CHALLONGE_ORIGIN}/${slug}/module`);
				cache.set(`module-html:${slug}`, {
					body: r.body,
					contentType: "text/html; charset=utf-8",
					upstreamStatus: r.status,
					expiresAt: Date.now() + CACHE_TTL_MS,
				});
				return new Response(r.body, {
					status: r.status,
					headers: {
						"content-type": "text/html; charset=utf-8",
						"x-cache": "miss",
						...corsHeaders(),
					},
				});
			} catch (err) {
				return jsonResponse(
					502,
					{
						error: "upstream",
						reason: (err instanceof Error ? err.message : String(err)).slice(0, 240),
					},
					corsHeaders(),
				);
			}
		},
		"/v1/tournaments/:slug/module.json": async (req: Request & { params: { slug: string } }) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { slug } = req.params;
			return handleCached(`module-json:${slug}`, async () => {
				const r = await fetchChallongeRaw(`${CHALLONGE_ORIGIN}/${slug}/module`);
				if (r.status >= 400) {
					throw new Error(`module HTTP ${r.status}`);
				}
				// Best-effort store extraction from the inline `_initialStoreState`.
				const m = r.body.match(/window\._initialStoreState\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
				if (!m) {
					return { warning: "no _initialStoreState found", htmlBytes: r.body.length };
				}
				try {
					const store = JSON.parse(m[1]) as Record<string, unknown>;
					return { tournamentStore: store["TournamentStore"] ?? null, raw: store };
				} catch (err) {
					return {
						warning: `parse failed: ${err instanceof Error ? err.message : String(err)}`.slice(
							0,
							200,
						),
					};
				}
			});
		},
		"/v1/communities/:org/tournaments": async (req: Request & { params: { org: string } }) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const url = new URL(req.url);
			const past = url.searchParams.get("past") === "1";
			const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
			const search = url.searchParams.get("search") ?? "";
			const zip = url.searchParams.get("zip") ?? "";
			const proximity = url.searchParams.get("proximity") ?? "";
			const { org } = req.params;
			const cacheKey = `community:${org}:past=${past}:page=${page}:s=${search}:z=${zip}:p=${proximity}`;
			return handleCached(cacheKey, async () => {
				const qs = new URLSearchParams({
					page: String(page),
					search,
					zip,
					proximity,
					...(past ? { past: "1" } : {}),
				});
				const html = (
					await fetchChallongeRaw(
						`${CHALLONGE_ORIGIN}/fr/communities/${encodeURIComponent(org)}/tournaments?${qs}`,
					)
				).body;
				// Light HTMLRewriter scan for tournament cards.
				const tournaments: Array<{ slug: string; title: string; href: string }> = [];
				type El = { getAttribute: (n: string) => string | null };
				const Rewriter = (
					globalThis as unknown as {
						HTMLRewriter?: new () => {
							on(sel: string, h: { element: (el: El) => void }): unknown;
							transform(html: string): string;
						};
					}
				).HTMLRewriter;
				if (Rewriter) {
					const rw = new Rewriter();
					rw.on("a.tournament, a[href*='/'][class*='tournament']", {
						element(el) {
							const href = el.getAttribute("href") ?? "";
							const title = el.getAttribute("title") ?? "";
							const slug = href.replace(/^\/(?:[a-z]{2}\/)?/, "").split("?")[0];
							if (slug) tournaments.push({ slug, title, href });
						},
					});
					rw.transform(html);
				}
				return {
					org,
					past,
					page,
					count: tournaments.length,
					tournaments,
				};
			});
		},
		"/v1/users/:username/tournaments": async (req: Request & { params: { username: string } }) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { username } = req.params;
			return handleCached(`user-tournaments:${username}`, async () => {
				const html = (
					await fetchChallongeRaw(
						`${CHALLONGE_ORIGIN}/fr/users/${encodeURIComponent(username)}/tournaments`,
					)
				).body;
				return { username, htmlBytes: html.length, raw: html.slice(0, 4000) };
			});
		},
		"/v1/users/:username.json": async (req: any) => {
			if (!isAuthed(req)) return jsonResponse(401, { error: "unauthorized" }, corsHeaders());
			const { username } = req.params;
			return handleCached(`user:${username}`, async () => {
				const html = (
					await fetchChallongeRaw(
						`${CHALLONGE_ORIGIN}/fr/users/${encodeURIComponent(username)}`,
					)
				).body;
				return { username, htmlBytes: html.length, raw: html.slice(0, 4000) };
			});
		},
		"/": (_req: Request) =>
			new Response(
				`<!doctype html><meta charset="utf-8"><title>challonge-api (bxc)</title>
<body style="font:14px/1.5 system-ui;max-width:720px;margin:2em auto;padding:0 1em">
<h1>challonge-api (bxc)</h1>
<p>Local Challonge bridge powered by bxc HTTP profile.</p>
<ul>
<li><a href="/healthz">/healthz</a></li>
<li><a href="/openapi.json">/openapi.json</a></li>
<li><code>/v1/tournaments/{slug}.json</code></li>
<li><code>/v1/tournaments/{slug}/participants.json</code></li>
<li><code>/v1/tournaments/{slug}/matches.json</code></li>
<li><code>/v1/tournaments/{slug}/log.json</code></li>
<li><code>/v1/tournaments/{slug}/standings.json</code></li>
<li><code>/v1/tournaments/{slug}/recon</code></li>
<li><code>/v1/users/{username}.json</code></li>
</ul>
<p>Set CHALLONGE_COOKIES=path/to/jar.json — defaults to <code>cookies/private/challonge.json</code>.</p>
</body>`,
				{ headers: { "content-type": "text/html; charset=utf-8", ...corsHeaders() } },
			),
	},
});

Bun.stderr.write(
	`challonge-api: listening on http://${HOST}:${server.port}  ` +
		`(cookies=${(await cookieJarPresent()) ? COOKIE_JAR : "absent"}, auth=${AUTH_TOKEN ? "required" : "open"})\n`,
);
